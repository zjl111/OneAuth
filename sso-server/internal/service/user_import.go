// Package service - user_import.go：用户批量导入。
//
// 支持 CSV / XLSX。解析时表头允许以下别名（前端模板下载用规范表头，但后端
// 容忍稍微变动一下）：
//   登录账号 / 姓名 / 密码 / 邮箱 / 手机号 / 部门 / 用户类型 / 管理员
// 表头行带 * 后缀的视为必填的"提示"，不影响解析（去除星号后取列名）。
//
// 行级语义：
//   - 必填项缺失 → 该行 fail，继续处理后续行
//   - 部门按 name 查（树里找一个匹配的；找不到则 fail）
//   - 用户类型为空时默认 internal；其它合法值 internal/external
//   - 管理员列为空/否/no/false → 普通；是/yes/true → 加 super_admin 角色
package service

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	"sso-server/internal/repository"
)

// ImportUsersResult 导入结果汇总
type ImportUsersResult struct {
	Total   int               `json:"total"`
	Success int               `json:"success"`
	Failed  int               `json:"failed"`
	Errors  []ImportRowError  `json:"errors"` // 失败行明细
}

type ImportRowError struct {
	Row      int    `json:"row"`      // 1 是表头，从 2 开始算
	Username string `json:"username"` // 失败行尝试创建的账号
	Reason   string `json:"reason"`
}

// UserImportService 包了 UserService + 部门/角色查找
type UserImportService struct {
	UserSvc  *UserService
	DeptRepo *repository.DepartmentRepository
	RoleRepo *repository.RoleRepository
}

func NewUserImportService(u *UserService, d *repository.DepartmentRepository, r *repository.RoleRepository) *UserImportService {
	return &UserImportService{UserSvc: u, DeptRepo: d, RoleRepo: r}
}

// 表头列规范名 → 数据 key
const (
	colUsername = "登录账号"
	colNickname = "姓名"
	colPassword = "密码"
	colEmail    = "邮箱"
	colPhone    = "手机号"
	colDept     = "部门"
	colType     = "用户类型"
	colAdmin    = "管理员"
)

// ImportFromBytes 自动按文件后缀分发到 csv / xlsx 解析。
func (s *UserImportService) ImportFromBytes(filename string, data []byte) (*ImportUsersResult, error) {
	rows, err := parseRows(filename, data)
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, errors.New("文件为空或只有表头")
	}
	header := normalizeHeader(rows[0])
	colIdx := buildColIdx(header)
	for _, c := range []string{colUsername, colNickname, colPassword} {
		if _, ok := colIdx[c]; !ok {
			return nil, fmt.Errorf("缺少必填列：%s", c)
		}
	}

	// 预查部门 name → id；角色拿 super_admin id
	depts, _ := s.DeptRepo.ListAll()
	deptByName := make(map[string]string, len(depts))
	for _, d := range depts {
		deptByName[d.Name] = d.ID.String()
	}
	roles, _ := s.RoleRepo.List()
	var superAdminRoleID string
	for _, r := range roles {
		if r.Code == "super_admin" {
			superAdminRoleID = r.ID.String()
			break
		}
	}

	out := &ImportUsersResult{Total: len(rows) - 1}
	for i := 1; i < len(rows); i++ {
		row := rows[i]
		username := getCell(row, colIdx, colUsername)
		nickname := getCell(row, colIdx, colNickname)
		password := getCell(row, colIdx, colPassword)
		email := getCell(row, colIdx, colEmail)
		phone := getCell(row, colIdx, colPhone)
		deptName := getCell(row, colIdx, colDept)
		userType := strings.ToLower(getCell(row, colIdx, colType))
		adminFlag := parseBool(getCell(row, colIdx, colAdmin))

		// 全空行（粘贴时常见）跳过，不算 total 也不算 failed
		if username == "" && nickname == "" && password == "" && email == "" && phone == "" && deptName == "" {
			out.Total--
			continue
		}

		fail := func(reason string) {
			out.Failed++
			out.Errors = append(out.Errors, ImportRowError{Row: i + 1, Username: username, Reason: reason})
		}
		if username == "" {
			fail("登录账号不能为空")
			continue
		}
		if nickname == "" {
			fail("姓名不能为空")
			continue
		}
		if password == "" {
			fail("密码不能为空")
			continue
		}

		in := CreateUserInput{
			Username: username,
			Nickname: nickname,
			Password: password,
			Email:    email,
			Phone:    phone,
		}
		if userType == "external" || userType == "外部" || userType == "外部协作" {
			in.UserType = "external"
		} else if userType != "" && userType != "internal" && userType != "内部" && userType != "内部员工" {
			fail("用户类型只能是 internal / external")
			continue
		} else {
			in.UserType = "internal"
		}
		if deptName != "" {
			id, ok := deptByName[deptName]
			if !ok {
				fail(fmt.Sprintf("部门 %q 不存在", deptName))
				continue
			}
			parsed, err := uuid.Parse(id)
			if err == nil {
				in.DepartmentID = &parsed
			}
		}
		if adminFlag {
			if superAdminRoleID == "" {
				fail("super_admin 角色未初始化")
				continue
			}
			parsed, err := uuid.Parse(superAdminRoleID)
			if err == nil {
				in.RoleIDs = []uuid.UUID{parsed}
			}
		}

		if _, err := s.UserSvc.Create(in); err != nil {
			fail(err.Error())
			continue
		}
		out.Success++
	}
	return out, nil
}

// parseRows 把一个文件解析成 [][]string，包含表头那一行。
func parseRows(filename string, data []byte) ([][]string, error) {
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".csv"):
		return parseCSV(data)
	case strings.HasSuffix(lower, ".xlsx") || strings.HasSuffix(lower, ".xls"):
		return parseXLSX(data)
	default:
		return nil, errors.New("仅支持 .csv / .xlsx 文件")
	}
}

func parseCSV(data []byte) ([][]string, error) {
	// 兼容 UTF-8 BOM（Excel 另存的 csv 常带）
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	r := csv.NewReader(bytes.NewReader(data))
	r.FieldsPerRecord = -1
	var rows [][]string
	for {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("CSV 解析失败：%v", err)
		}
		rows = append(rows, rec)
	}
	return rows, nil
}

func parseXLSX(data []byte) ([][]string, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("XLSX 解析失败：%v", err)
	}
	defer f.Close()
	sheet := f.GetSheetName(0)
	rows, err := f.GetRows(sheet)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func normalizeHeader(row []string) []string {
	out := make([]string, len(row))
	for i, c := range row {
		c = strings.TrimSpace(c)
		c = strings.TrimSuffix(c, "*") // 去掉必填星号
		c = strings.TrimSpace(c)
		out[i] = c
	}
	return out
}

func buildColIdx(header []string) map[string]int {
	m := make(map[string]int, len(header))
	for i, h := range header {
		if h != "" {
			m[h] = i
		}
	}
	return m
}

func getCell(row []string, idx map[string]int, key string) string {
	i, ok := idx[key]
	if !ok || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

func parseBool(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "1", "true", "yes", "y", "是", "管理员":
		return true
	}
	return false
}
