package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"sso-server/internal/service"
	"sso-server/pkg/response"
)

type DirectorySyncHandler struct {
	Service *service.DirectorySyncService
}

func (h *DirectorySyncHandler) Config(c *gin.Context) {
	response.OK(c, h.Service.LoadConfig(true))
}

func (h *DirectorySyncHandler) SaveConfig(c *gin.Context) {
	var in service.DirectorySyncConfig
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.Service.SaveConfig(in); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, h.Service.LoadConfig(true))
}

func (h *DirectorySyncHandler) Departments(c *gin.Context) {
	depts, err := h.Service.FetchDepartments()
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, depts)
}

func (h *DirectorySyncHandler) Preview(c *gin.Context) {
	summary, err := h.Service.Sync(true)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, summary)
}

func (h *DirectorySyncHandler) UserImportPreview(c *gin.Context) {
	keyword := c.Query("keyword")
	page, _ := strconv.Atoi(c.Query("page"))
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	preview, err := h.Service.UserImportPreview(keyword, page, pageSize)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, preview)
}

func (h *DirectorySyncHandler) Run(c *gin.Context) {
	summary, err := h.Service.Sync(false)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, summary)
}

// SyncUsers 手动触发完整同步：拉取远端通讯录 → 写入缓冲表 → 应用到用户。
// 与每日凌晨 2:00 的定时任务行为完全一致。供前端「同步用户」按钮调用。
func (h *DirectorySyncHandler) SyncUsers(c *gin.Context) {
	summary, err := h.Service.SyncUsers()
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, summary)
}

// Pull 仅拉取远端通讯录写入缓冲表（刷新「用户导入」预览），不创建/修改/禁用用户。
// 供手动「同步用户」按钮调用；真正建号由「导入选中/导入全部」负责。
func (h *DirectorySyncHandler) Pull(c *gin.Context) {
	summary, err := h.Service.Pull()
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, summary)
}

// ImportUsers 按勾选的 external_id 列表导入用户；body 为空表示导入全部。
type importUsersRequest struct {
	ExternalIDs []string `json:"external_ids"`
	GroupIDs    []string `json:"group_ids"`
}

func (h *DirectorySyncHandler) ImportUsers(c *gin.Context) {
	var in importUsersRequest
	// 允许空 body（导入全部）
	_ = c.ShouldBindJSON(&in)
	summary, err := h.Service.ImportUsers(in.ExternalIDs, in.GroupIDs)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, summary)
}

// EditBufferFieldRequest 行内编辑缓冲字段（用户名/邮箱）请求。
type editBufferFieldRequest struct {
	ExternalID string `json:"external_id"`
	Field      string `json:"field"` // "username" 或 "email"
	Value      string `json:"value"`
}

// EditBufferField 行内编辑「用户导入」预览中的用户名或邮箱：写回缓冲表（含 edited 标记），
// 导入时按编辑值落库；「同步用户」(pull) 重建缓冲时保留编辑值不被覆盖。
// 若编辑后的值与已存在用户冲突，则不写回、返回冲突信息，由前端弹窗让用户选择处理方式。
func (h *DirectorySyncHandler) EditBufferField(c *gin.Context) {
	var in editBufferFieldRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	result, err := h.Service.EditBufferField(in.ExternalID, in.Field, in.Value)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	// 兼容旧字段名：username 字段返回 username，email 字段返回 email
	switch in.Field {
	case "email":
		response.OK(c, gin.H{"email": result.Value, "conflict": result.Conflict})
	default:
		response.OK(c, gin.H{"username": result.Value, "conflict": result.Conflict})
	}
}

// resolveConflictRequest 冲突处理请求（用户名/邮箱通用）。
type resolveConflictRequest struct {
	ExternalID     string `json:"external_id"`
	Field          string `json:"field"` // "username" 或 "email"
	Action         string `json:"action"`
	ConflictUserID string `json:"conflict_user_id"`
	Username       string `json:"username"`
}

// ResolveBufferConflict 处理用户名/邮箱冲突：link=关联已有用户（建立绑定），rename=重命名加序号。
func (h *DirectorySyncHandler) ResolveBufferConflict(c *gin.Context) {
	var in resolveConflictRequest
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	value, err := h.Service.ResolveBufferConflict(in.ExternalID, in.Field, in.Action, in.ConflictUserID, in.Username)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	// 兼容：按 field 返回对应字段名
	key := "username"
	if in.Field == "email" {
		key = "email"
	}
	response.OK(c, gin.H{key: value})
}

func (h *DirectorySyncHandler) Logs(c *gin.Context) {
	logs, err := h.Service.LatestLogs(10)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, logs)
}

func (h *DirectorySyncHandler) ResetDepartments(c *gin.Context) {
	result, err := h.Service.ResetManagedDepartments()
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, result)
}
