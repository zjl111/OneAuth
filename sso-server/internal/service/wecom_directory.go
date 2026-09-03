package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// 本文件对齐 CordysCRM 的真实企业微信通讯录同步实现
// (backend/.../integration/wecom/service/WeComDepartmentService.java)：
//   - 部门：department/list?access_token=...&id=1 一次拿到全量扁平部门列表；
//   - 成员：对【每个部门】逐一调用 user/list?access_token=...&department_id=DEPT_ID，
//     按 main_department 归属去重（一个成员可能出现在多个部门，只归到主部门一次）。
//
// 与 Cordys 的差异（OneAuth 架构所需，非 Cordys 行为）：
//   - OneAuth 的导入流水线按「用户 + departmentPath」解析部门（见 applySnapshot 的
//     buildDepartmentPathIndex / departmentPath），而非 Cordys 的 departmentUserMap，
//     因此这里额外为每个部门计算「/根/子/孙」全路径，并把成员映射成
//     departmentPath(主部门全路径) 供下游复用，无需为 wecom 单独维护字段映射。
//   - Cordys 不做在职/离职判定（status 字段仅用于展示），这里同样不在同步期判定
//     status，一律视为远端在册成员；禁用/未激活(企微 status=2/4)不等同离职，
//     交由后续导入流水线的 DeactivateMissing 策略统一处理，避免误禁用户。

// FetchDirectorySnapshot 拉取企业微信通讯录：
//   - depts：部门树（供前端「部门匹配」弹窗展示远端部门层级）
//   - users：扁平用户映射列表（供目录同步导入流水线，键名与考勤桥接一致）
func (s *WeComService) FetchDirectorySnapshot() ([]DirectoryDepartment, []map[string]any, error) {
	if !s.Enabled() {
		return nil, nil, errors.New("企业微信未启用或未通过配置校验，无法拉取通讯录")
	}
	token, err := s.getAccessToken()
	if err != nil {
		return nil, nil, err
	}
	tree, departments, pathOf, err := s.fetchWeComDepartments(token)
	if err != nil {
		return nil, nil, err
	}

	// 完整同步才逐部门拉取成员。管理页的「拉取远端部门」只调用
	// FetchDirectoryDepartments，避免为了展示部门树而串行请求所有部门的成员。
	users, err := s.fetchWeComUsersByDept(token, departments, pathOf)
	if err != nil {
		return nil, nil, err
	}

	return tree, users, nil
}

// FetchDirectoryDepartments 只拉取企微部门树，不拉取成员。
// 供管理页部门匹配使用，请求数量固定为 gettoken（可能命中缓存）+ department/list。
func (s *WeComService) FetchDirectoryDepartments() ([]DirectoryDepartment, error) {
	if !s.Enabled() {
		return nil, errors.New("企业微信未启用或未通过配置校验，无法拉取通讯录")
	}
	token, err := s.getAccessToken()
	if err != nil {
		return nil, err
	}
	tree, _, _, err := s.fetchWeComDepartments(token)
	return tree, err
}

type wecomDepartment struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	ParentID int    `json:"parentid"`
	Order    int    `json:"order"`
}

func (s *WeComService) fetchWeComDepartments(token string) ([]DirectoryDepartment, []wecomDepartment, func(int) string, error) {

	// 1) 拉取可见范围内的全量部门。
	//    注意：不传 id（而非 id=1）。官方语义：不传 id 默认获取全量组织架构，
	//    但【只能拉取 token 对应应用可见范围内的部门列表】；若对不可见的根部门 id=1
	//    显式传参，会返回 60011 no privilege。这里依赖企微按可见范围自动裁剪，
	//    从而兼容「应用只勾选一个/几个部门」的常见配置。
	deptBody, err := s.wecomHTTP(token, "department/list", url.Values{})
	if err != nil {
		return nil, nil, nil, err
	}
	var deptResp struct {
		Errcode    int               `json:"errcode"`
		Errmsg     string            `json:"errmsg"`
		Department []wecomDepartment `json:"department"`
	}
	if err := json.Unmarshal(deptBody, &deptResp); err != nil {
		return nil, nil, nil, err
	}
	if deptResp.Errcode != 0 {
		return nil, nil, nil, fmt.Errorf("企业微信部门列表失败 %d: %s", deptResp.Errcode, deptResp.Errmsg)
	}

	// 2) 构建 id -> 部门信息，供计算全路径与构建部门树。
	byID := make(map[int]struct {
		id       int
		parentid int
		name     string
	}, len(deptResp.Department))
	for _, d := range deptResp.Department {
		byID[d.ID] = struct {
			id       int
			parentid int
			name     string
		}{id: d.ID, parentid: d.ParentID, name: d.Name}
	}
	pathOf := func(id int) string {
		var names []string
		cur := id
		seen := make(map[int]bool, len(byID)+1)
		for cur != 0 && !seen[cur] {
			seen[cur] = true
			d, ok := byID[cur]
			if !ok {
				break
			}
			names = append([]string{d.name}, names...)
			cur = d.parentid
		}
		return "/" + strings.Join(names, "/")
	}

	// 3) 构建部门树（DirectoryDepartment），供前端部门匹配 UI 展示。
	nodes := make(map[int]*DirectoryDepartment, len(deptResp.Department))
	for _, d := range deptResp.Department {
		nodes[d.ID] = &DirectoryDepartment{
			ExternalID: fmt.Sprintf("%d", d.ID),
			ID:         fmt.Sprintf("%d", d.ID),
			Name:       d.Name,
			Path:       pathOf(d.ID),
			ParentPath: pathOf(d.ParentID),
		}
	}
	for _, d := range deptResp.Department {
		if d.ParentID != 0 {
			if parent, ok := nodes[d.ParentID]; ok {
				child := nodes[d.ID]
				parent.Children = append(parent.Children, *child)
			}
		}
	}
	// 树根 = 父部门不在可见范围内的顶层部门（其 parentid 可能是 0/根部门 1/或不可见的上级部门）。
	// 不能只按 ParentID==0 判定根：可见范围被裁剪后，顶层部门的上级往往不可见（如根部门 1），
	// 这些一定是不在任何 nodes 父节点 children 里的节点。
	var tree []DirectoryDepartment
	for _, d := range deptResp.Department {
		_, parentVisible := nodes[d.ParentID]
		if !parentVisible {
			if n, ok := nodes[d.ID]; ok {
				tree = append(tree, *n)
			}
		}
	}

	return tree, deptResp.Department, pathOf, nil
}

// fetchWeComUsersByDept 对每个部门调用 user/list?department_id={deptId}，
// 按 main_department 去重后转换为与考勤桥接一致的统一映射结构。
//
// 去重规则（对齐 Cordys WeComDepartmentService.getDepartmentUser）：
// 对某部门 deptId 返回的成员，仅保留 main_department == deptId 的成员；
// 若成员未返回 main_department 则不过滤（保留）。因逐部门遍历，
// 一个仅出现在非主部门的成员会在其主部门那一次被收录，天然去重。
func (s *WeComService) fetchWeComUsersByDept(token string, depts []wecomDepartment, pathOf func(int) string) ([]map[string]any, error) {
	seen := make(map[string]struct{})
	var users []map[string]any

	for _, d := range depts {
		deptID := d.ID
		q := url.Values{}
		q.Set("department_id", fmt.Sprintf("%d", deptID))
		q.Set("access_token", token)
		body, err := s.wecomHTTP(token, "user/list", q)
		if err != nil {
			return nil, err
		}
		var r struct {
			Errcode  int            `json:"errcode"`
			Errmsg   string         `json:"errmsg"`
			Userlist []wecomRawUser `json:"userlist"`
		}
		if err := json.Unmarshal(body, &r); err != nil {
			return nil, err
		}
		if r.Errcode != 0 {
			return nil, fmt.Errorf("企业微信部门(%d)用户列表失败 %d: %s", deptID, r.Errcode, r.Errmsg)
		}
		for _, u := range r.Userlist {
			// main_department 过滤：仅在未返回主部门或主部门即当前部门时收录。
			if u.MainDepartment != 0 && u.MainDepartment != deptID {
				continue
			}
			if u.UserID == "" {
				continue
			}
			if _, ok := seen[u.UserID]; ok {
				continue // 跨部门去重兜底
			}
			seen[u.UserID] = struct{}{}
			users = append(users, u.toMap(pathOf))
		}
	}
	return users, nil
}

// wecomRawUser 企业微信通讯录用户的基础字段（user/list 返回）。
type wecomRawUser struct {
	UserID         string `json:"userid"`
	Name           string `json:"name"`
	Department     []int  `json:"department"`
	MainDepartment int    `json:"main_department"`
	Position       string `json:"position"`
	Mobile         string `json:"mobile"`
	Email          string `json:"email"`
	Status         int    `json:"status"` // 1=已激活 2=已禁用 4=未激活 5=退出企业（仅展示，不用于同步判定）
}

// toMap 转换为与考勤桥接一致的字段映射，以便下游字段映射/部门解析复用。
// 部门归属取主部门全路径（Cordys 以 main_department 为准），并保留全部部门路径。
func (u wecomRawUser) toMap(pathOf func(int) string) map[string]any {
	main := u.MainDepartment
	if main == 0 && len(u.Department) > 0 {
		main = u.Department[0]
	}
	paths := make([]string, 0, len(u.Department))
	for _, d := range u.Department {
		paths = append(paths, pathOf(d))
	}
	return map[string]any{
		"externalId":      u.UserID,
		"userId":          u.UserID,
		"userName":        u.Name,
		"email":           u.Email,
		"phone":           u.Mobile,
		"position":        u.Position,
		"departmentPath":  pathOf(main),
		"departmentPaths": paths,
	}
}

// wecomHTTP 带 access_token 调用企业微信只读 API 并返回原始响应体。
func (s *WeComService) wecomHTTP(token, api string, q url.Values) ([]byte, error) {
	if q == nil {
		q = url.Values{}
	}
	q.Set("access_token", token)
	resp, err := http.Get("https://qyapi.weixin.qq.com/cgi-bin/" + api + "?" + q.Encode())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}
