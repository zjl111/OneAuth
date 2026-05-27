package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/pkg/response"
)

type UserHandler struct {
	Service *service.UserService
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
