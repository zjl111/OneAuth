package handler

import (
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

func (h *DirectorySyncHandler) Run(c *gin.Context) {
	summary, err := h.Service.Sync(false)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, summary)
}

func (h *DirectorySyncHandler) Logs(c *gin.Context) {
	logs, err := h.Service.LatestLogs(10)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, logs)
}
