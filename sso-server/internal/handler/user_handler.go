package handler

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"

	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/pkg/response"
)

type UserHandler struct {
	Service       *service.UserService
	ImportService *service.UserImportService
}

func (h *UserHandler) List(c *gin.Context) {
	page, size := parsePagination(c)
	q := repository.UserQuery{
		Username: c.Query("username"),
		Email:    c.Query("email"),
		Page:     page,
		PageSize: size,
	}
	if v := c.Query("is_active"); v != "" {
		b := v == "true"
		q.IsActive = &b
	}
	if v := c.Query("department_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			q.DepartmentID = &id
		}
	}
	if v := c.Query("department_ids"); v != "" {
		for _, raw := range strings.Split(v, ",") {
			raw = strings.TrimSpace(raw)
			if raw == "" {
				continue
			}
			if id, err := uuid.Parse(raw); err == nil {
				q.DepartmentIDs = append(q.DepartmentIDs, id)
			}
		}
	}
	if v := c.Query("keyword"); v != "" {
		q.Keyword = v
	}
	items, total, err := h.Service.List(q)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.Page(c, total, items)
}

func (h *UserHandler) Create(c *gin.Context) {
	var in service.CreateUserInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	u, err := h.Service.Create(in)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, u)
}

func (h *UserHandler) Detail(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	u, err := h.Service.GetByID(id)
	if err != nil {
		response.NotFound(c, "用户不存在")
		return
	}
	response.OK(c, u)
}

func (h *UserHandler) Update(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	// 先解原始 map 用于检测 department_id 是否被显式置为 null
	var raw map[string]any
	body, _ := c.GetRawData()
	_ = json.Unmarshal(body, &raw)
	clearDept := false
	if v, ok := raw["department_id"]; ok && v == nil {
		clearDept = true
	}
	// 再把 body 还回去解码 struct
	c.Request.Body = io.NopCloser(bytes.NewBuffer(body))
	var in service.UpdateUserInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if clearDept {
		// 让 service 知道要清空：用 zero uuid 作哨兵
		zero := uuid.Nil
		in.DepartmentID = &zero
	}
	u, err := h.Service.Update(id, in)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, u)
}

func (h *UserHandler) Delete(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	if err := h.Service.Delete(id); err != nil {
		if errors.Is(err, service.ErrUserProtected) {
			response.BadRequest(c, err.Error())
			return
		}
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

func (h *UserHandler) ResetPassword(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.Service.ResetPassword(id, req.NewPassword); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, nil)
}

func (h *UserHandler) Lock(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		Lock bool `json:"lock"`
	}
	_ = c.ShouldBindJSON(&req)
	if err := h.Service.Lock(id, req.Lock); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

// UploadAvatar 管理员给指定用户上传头像
func (h *UserHandler) UploadAvatar(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	url, err := saveAvatarFile(c)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	avatar := url
	in := service.UpdateUserInput{Avatar: &avatar}
	u, err := h.Service.Update(id, in)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, gin.H{"url": url, "user": u})
}

// saveAvatarFile 解析上传文件，保存到 ./data/uploads，返回访问 URL。
func saveAvatarFile(c *gin.Context) (string, error) {
	file, err := c.FormFile("file")
	if err != nil {
		return "", fmt.Errorf("未选择文件")
	}
	if file.Size > 5*1024*1024 {
		return "", fmt.Errorf("文件不能超过 5MB")
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowed := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true}
	if !allowed[ext] {
		return "", fmt.Errorf("仅支持 png/jpg/jpeg/webp/gif")
	}
	dir := "./data/uploads"
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	name := fmt.Sprintf("avatar-%d%s", time.Now().UnixNano(), ext)
	if err := c.SaveUploadedFile(file, filepath.Join(dir, name)); err != nil {
		return "", err
	}
	return "/uploads/" + name, nil
}

func (h *UserHandler) SetRoles(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		RoleIDs []uuid.UUID `json:"role_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	in := service.UpdateUserInput{RoleIDs: req.RoleIDs}
	u, err := h.Service.Update(id, in)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, u)
}

// BatchDelete POST /api/v1/users/batch-delete  body={ids:[uuid,...]}
//
//	逐条调用 service.Delete；任何一条失败也继续，返回 deleted 数量 + 失败 ids。
func (h *UserHandler) BatchDelete(c *gin.Context) {
	var req struct {
		IDs []uuid.UUID `json:"ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if len(req.IDs) == 0 {
		response.BadRequest(c, "未选择用户")
		return
	}
	deleted := 0
	failed := []string{}
	for _, id := range req.IDs {
		if err := h.Service.Delete(id); err != nil {
			failed = append(failed, id.String())
			continue
		}
		deleted++
	}
	response.OK(c, gin.H{"deleted": deleted, "failed": failed})
}

// ImportUsers 接 multipart/form-data：file 字段 = .csv / .xlsx
//
//	POST /api/v1/users/import
//
// 返回 {total, success, failed, errors:[{row,username,reason}]}
func (h *UserHandler) ImportUsers(c *gin.Context) {
	if h.ImportService == nil {
		response.ServerError(c, "导入服务未启用")
		return
	}
	fh, err := c.FormFile("file")
	if err != nil {
		response.BadRequest(c, "请上传 file 字段")
		return
	}
	if fh.Size > 5*1024*1024 {
		response.BadRequest(c, "文件超过 5MB 上限")
		return
	}
	f, err := fh.Open()
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	defer f.Close()
	buf := make([]byte, fh.Size)
	if _, err := io.ReadFull(f, buf); err != nil {
		response.ServerError(c, "读取文件失败："+err.Error())
		return
	}
	res, err := h.ImportService.ImportFromBytes(fh.Filename, buf)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, res)
}

// ImportUpdateExisting 批量更新已存在的用户（从导入结果中选择更新）
//
//	POST /api/v1/users/import/update-existing
func (h *UserHandler) ImportUpdateExisting(c *gin.Context) {
	var req struct {
		Users []struct {
			Username string `json:"username"`
			Nickname string `json:"nickname"`
			Email    string `json:"email"`
			Phone    string `json:"phone"`
		} `json:"users"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "请求参数错误")
		return
	}

	updated := 0
	failed := 0
	var errs []service.ImportRowError

	for i, u := range req.Users {
		// 查找用户
		user, err := h.Service.GetByUsername(u.Username)
		if err != nil {
			failed++
			errs = append(errs, service.ImportRowError{
				Row:      i + 1,
				Username: u.Username,
				Reason:   "用户不存在",
			})
			continue
		}

		// 更新用户信息
		updateInput := service.UpdateUserInput{
			Nickname: &u.Nickname,
			Email:    &u.Email,
			Phone:    &u.Phone,
		}
		_, err = h.Service.Update(user.ID, updateInput)
		if err != nil {
			failed++
			errs = append(errs, service.ImportRowError{
				Row:      i + 1,
				Username: u.Username,
				Reason:   err.Error(),
			})
			continue
		}
		updated++
	}

	response.OK(c, gin.H{
		"updated": updated,
		"failed":  failed,
		"errors":  errs,
	})
}

// ImportTemplate 下载导入模板。?format=csv 返回 utf-8 BOM csv，否则返回 xlsx。
//
//	GET /api/v1/users/import/template
func (h *UserHandler) ImportTemplate(c *gin.Context) {
	headers := []string{
		"登录账号*", "姓名*", "密码*",
		"邮箱", "手机号", "部门", "用户类型", "管理员", "用户组",
	}
	example := []string{
		"jdoe", "张三", "",
		"jdoe@example.com", "13800000000", "总公司", "internal", "否", "研发组,测试组",
	}
	if c.Query("format") == "csv" {
		c.Header("Content-Type", "text/csv; charset=utf-8")
		c.Header("Content-Disposition", `attachment; filename="oneauth-users-template.csv"`)
		var b bytes.Buffer
		b.Write([]byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM，让 Excel 不乱码
		w := csv.NewWriter(&b)
		_ = w.Write(headers)
		_ = w.Write(example)
		w.Flush()
		c.Data(200, "text/csv; charset=utf-8", b.Bytes())
		return
	}
	// 默认 xlsx
	f := excelize.NewFile()
	defer f.Close()
	sheet := f.GetSheetName(0)
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		_ = f.SetCellValue(sheet, cell, h)
	}
	for i, v := range example {
		cell, _ := excelize.CoordinatesToCellName(i+1, 2)
		_ = f.SetCellValue(sheet, cell, v)
	}
	// 表头加粗 + 浅灰底
	headerStyle, _ := f.NewStyle(&excelize.Style{
		Font: &excelize.Font{Bold: true},
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"#F1F5F9"}},
	})
	_ = f.SetCellStyle(sheet, "A1", "I1", headerStyle)
	// 列宽
	for i, w := range []float64{14, 14, 18, 24, 16, 16, 12, 10, 20} {
		col, _ := excelize.ColumnNumberToName(i + 1)
		_ = f.SetColWidth(sheet, col, col, w)
	}
	c.Header("Content-Disposition", `attachment; filename="oneauth-users-template.xlsx"`)
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	_ = f.Write(c.Writer)
}
