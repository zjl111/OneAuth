package handler

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/pkg/mailer"
	"sso-server/pkg/response"
)

// DepartmentHandler ---------------------------
type DepartmentHandler struct {
	Repo *repository.DepartmentRepository
}

func (h *DepartmentHandler) Tree(c *gin.Context) {
	items, err := h.Repo.ListAll()
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	// 构建树
	idx := make(map[uuid.UUID]*model.Department)
	for i := range items {
		idx[items[i].ID] = &items[i]
	}
	var roots []*model.Department
	for i := range items {
		d := &items[i]
		if d.ParentID == nil {
			roots = append(roots, d)
		} else if p, ok := idx[*d.ParentID]; ok {
			p.Children = append(p.Children, d)
		} else {
			roots = append(roots, d)
		}
	}
	response.OK(c, roots)
}

func (h *DepartmentHandler) List(c *gin.Context) {
	items, _ := h.Repo.ListAll()
	response.OK(c, items)
}

func (h *DepartmentHandler) Create(c *gin.Context) {
	var d model.Department
	if err := c.ShouldBindJSON(&d); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.Repo.Create(&d); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, d)
}

func (h *DepartmentHandler) Update(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	d, err := h.Repo.Get(id)
	if err != nil {
		response.NotFound(c, "部门不存在")
		return
	}
	var in struct {
		Name        *string    `json:"name"`
		ParentID    *uuid.UUID `json:"parent_id"`
		SortOrder   *int       `json:"sort_order"`
		Description *string    `json:"description"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if in.Name != nil {
		d.Name = *in.Name
	}
	if in.ParentID != nil {
		d.ParentID = in.ParentID
	}
	if in.SortOrder != nil {
		d.SortOrder = *in.SortOrder
	}
	if in.Description != nil {
		d.Description = *in.Description
	}
	if err := h.Repo.Update(d); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, d)
}

func (h *DepartmentHandler) Delete(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	if err := h.Repo.Delete(id); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

// RoleHandler ------------------------------------
type RoleHandler struct {
	Repo     *repository.RoleRepository
	PermRepo *repository.PermissionRepository
}

func (h *RoleHandler) List(c *gin.Context) {
	items, _ := h.Repo.List()
	response.OK(c, items)
}

func (h *RoleHandler) Create(c *gin.Context) {
	var r model.Role
	if err := c.ShouldBindJSON(&r); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.Repo.Create(&r); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, r)
}

func (h *RoleHandler) Update(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	r, err := h.Repo.Get(id)
	if err != nil {
		response.NotFound(c, "角色不存在")
		return
	}
	var in struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if in.Name != nil {
		r.Name = *in.Name
	}
	if in.Description != nil {
		r.Description = *in.Description
	}
	if err := h.Repo.Update(r); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, r)
}

func (h *RoleHandler) Delete(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	if err := h.Repo.Delete(id); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

func (h *RoleHandler) SetPermissions(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		PermissionIDs []uuid.UUID `json:"permission_ids"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.Repo.SetPermissions(id, req.PermissionIDs); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

func (h *RoleHandler) PermissionTree(c *gin.Context) {
	items, _ := h.PermRepo.ListAll()
	idx := make(map[uuid.UUID]*model.Permission)
	for i := range items {
		idx[items[i].ID] = &items[i]
	}
	var roots []*model.Permission
	for i := range items {
		p := &items[i]
		if p.ParentID == nil {
			roots = append(roots, p)
		} else if pa, ok := idx[*p.ParentID]; ok {
			pa.Children = append(pa.Children, p)
		} else {
			roots = append(roots, p)
		}
	}
	response.OK(c, roots)
}

// LogHandler ---------------------------------
type LogHandler struct {
	Repo *repository.LogRepository
}

func parseLogQuery(c *gin.Context) repository.LogQuery {
	q := repository.LogQuery{
		Username: c.Query("username"),
		Status:   c.Query("status"),
		ClientID: c.Query("client_id"),
		Resource: c.Query("resource"),
		Page:     parseInt(c.Query("page"), 1),
		PageSize: parseInt(c.Query("page_size"), 20),
	}
	if v := c.Query("start_time"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.StartTime = &t
		}
	}
	if v := c.Query("end_time"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.EndTime = &t
		}
	}
	return q
}

func (h *LogHandler) Login(c *gin.Context) {
	q := parseLogQuery(c)
	items, total, _ := h.Repo.ListLoginLogs(q)
	response.Page(c, total, items)
}

func (h *LogHandler) Operation(c *gin.Context) {
	q := parseLogQuery(c)
	items, total, _ := h.Repo.ListOperationLogs(q)
	response.Page(c, total, items)
}

func (h *LogHandler) Access(c *gin.Context) {
	q := parseLogQuery(c)
	items, total, _ := h.Repo.ListAccessLogs(q)
	response.Page(c, total, items)
}

// ConfigHandler -----------------------------
type ConfigHandler struct {
	Repo     *repository.ConfigRepository
	DictRepo *repository.DictionaryRepository
	Mailer   *mailer.Mailer
	LDAP     *service.LDAPService
}

func (h *ConfigHandler) List(c *gin.Context) {
	items, _ := h.Repo.ListAll()
	response.OK(c, items)
}

func (h *ConfigHandler) ByCategory(c *gin.Context) {
	items, _ := h.Repo.GetByCategory(c.Param("category"))
	response.OK(c, items)
}

func (h *ConfigHandler) Set(c *gin.Context) {
	var req []struct {
		Category string `json:"category"`
		Key      string `json:"key"`
		Value    string `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	for _, r := range req {
		if err := h.Repo.Set(r.Category, r.Key, r.Value); err != nil {
			response.ServerError(c, err.Error())
			return
		}
	}
	response.OK(c, nil)
}

// TestSMTP 给指定收件人发一封测试邮件，验证 SMTP 配置是否可用
func (h *ConfigHandler) TestSMTP(c *gin.Context) {
	var req struct {
		To string `json:"to" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "请输入有效的测试收件邮箱")
		return
	}
	if h.Mailer == nil {
		response.ServerError(c, "邮件服务未初始化")
		return
	}
	if err := h.Mailer.Send([]string{req.To}, "OneAuth SMTP 测试邮件",
		`<p>你好，</p><p>这是一封来自 OneAuth 的测试邮件，如果你能看到它说明 SMTP 配置生效。</p>`); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, gin.H{"sent_to": req.To})
}

// TestLDAP 用当前 SystemConfig.ldap.* 与 LDAP 服务器做一次连接 + Bind + Search 测试
func (h *ConfigHandler) TestLDAP(c *gin.Context) {
	if h.LDAP == nil {
		response.ServerError(c, "LDAP 服务未初始化")
		return
	}
	if err := h.LDAP.TestConnection(); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, gin.H{"ok": true})
}

// UploadImage 通用图片上传（应用图标等），只落盘并返回 URL，不写任何业务表
func (h *ConfigHandler) UploadImage(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		response.BadRequest(c, "未选择文件")
		return
	}
	if file.Size > 2*1024*1024 {
		response.BadRequest(c, "图片不能超过 2MB")
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowed := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".svg": true, ".webp": true, ".gif": true}
	if !allowed[ext] {
		response.BadRequest(c, "仅支持 png/jpg/jpeg/svg/webp/gif")
		return
	}
	dir := "./data/uploads"
	if err := os.MkdirAll(dir, 0755); err != nil {
		response.ServerError(c, "创建上传目录失败")
		return
	}
	prefix := c.DefaultPostForm("prefix", "img")
	if prefix == "" {
		prefix = "img"
	}
	name := fmt.Sprintf("%s-%d%s", prefix, time.Now().UnixNano(), ext)
	if err := c.SaveUploadedFile(file, filepath.Join(dir, name)); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, gin.H{"url": "/uploads/" + name})
}

// UploadLogo 上传站点 Logo，写入 ./data/uploads/，URL 同步到 SystemConfig(platform.logo)
func (h *ConfigHandler) UploadLogo(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		response.BadRequest(c, "未选择文件")
		return
	}
	if file.Size > 5*1024*1024 {
		response.BadRequest(c, "文件不能超过 5MB")
		return
	}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowed := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".svg": true, ".webp": true, ".gif": true}
	if !allowed[ext] {
		response.BadRequest(c, "仅支持 png/jpg/jpeg/svg/webp/gif")
		return
	}

	uploadDir := "./data/uploads"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		response.ServerError(c, "创建上传目录失败")
		return
	}
	name := fmt.Sprintf("logo-%d%s", time.Now().UnixNano(), ext)
	dst := filepath.Join(uploadDir, name)
	if err := c.SaveUploadedFile(file, dst); err != nil {
		response.ServerError(c, err.Error())
		return
	}

	url := "/uploads/" + name
	if err := h.Repo.Set("platform", "logo", url); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, gin.H{"url": url})
}

func (h *ConfigHandler) ListDict(c *gin.Context) {
	items, _ := h.DictRepo.List(c.Query("category"))
	response.OK(c, items)
}

func (h *ConfigHandler) CreateDict(c *gin.Context) {
	var d model.Dictionary
	if err := c.ShouldBindJSON(&d); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.DictRepo.Create(&d); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, d)
}

func (h *ConfigHandler) UpdateDict(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var d model.Dictionary
	if err := c.ShouldBindJSON(&d); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	d.ID = id
	if err := h.DictRepo.Update(&d); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, d)
}

func (h *ConfigHandler) DeleteDict(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	if err := h.DictRepo.Delete(id); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

// AccessHandler ----------------------------------
type AccessHandler struct {
	Repo *repository.IPAccessRepository
}

func (h *AccessHandler) List(c *gin.Context) {
	items, _ := h.Repo.List()
	response.OK(c, items)
}

func (h *AccessHandler) Create(c *gin.Context) {
	var i model.IPAccess
	if err := c.ShouldBindJSON(&i); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.Repo.Create(&i); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, i)
}

func (h *AccessHandler) Delete(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	if err := h.Repo.Delete(id); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}
