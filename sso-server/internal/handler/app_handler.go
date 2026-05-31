package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/pkg/response"
)

type AppHandler struct {
	Service *service.ClientService
}

func (h *AppHandler) List(c *gin.Context) {
	page, size := parsePagination(c)
	items, total, err := h.Service.List(repository.ClientQuery{
		Name:     c.Query("name"),
		Page:     page,
		PageSize: size,
	})
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.Page(c, total, items)
}

func (h *AppHandler) Create(c *gin.Context) {
	var in service.CreateClientInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	cl, err := h.Service.Create(in)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, cl)
}

func (h *AppHandler) Detail(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	cl, err := h.Service.GetByID(id)
	if err != nil {
		response.NotFound(c, "应用不存在")
		return
	}
	grants, _ := h.Service.GrantsByClient(cl.ClientID)
	response.OK(c, gin.H{
		"client": cl,
		"grants": grants,
	})
}

func (h *AppHandler) Update(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var in service.UpdateClientInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	cl, err := h.Service.Update(id, in)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, cl)
}

func (h *AppHandler) Delete(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	if err := h.Service.Delete(id); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, nil)
}

// BatchDelete 批量删除应用：失败的条目跳过，最终汇总返回
func (h *AppHandler) BatchDelete(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	deleted := 0
	failed := []string{}
	for _, raw := range req.IDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			failed = append(failed, raw)
			continue
		}
		if err := h.Service.Delete(id); err != nil {
			failed = append(failed, raw)
			continue
		}
		deleted++
	}
	response.OK(c, gin.H{"deleted": deleted, "failed": failed})
}

func (h *AppHandler) RotateSecret(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	secret, err := h.Service.RotateSecret(id)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, gin.H{"client_secret": secret})
}

func (h *AppHandler) ToggleStatus(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	cl, err := h.Service.GetByID(id)
	if err != nil {
		response.NotFound(c, "应用不存在")
		return
	}
	newActive := !cl.IsActive
	updated, err := h.Service.Update(id, service.UpdateClientInput{IsActive: &newActive})
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, updated)
}
