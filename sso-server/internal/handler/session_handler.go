package handler

import (
	"github.com/gin-gonic/gin"

	"sso-server/internal/session"
	"sso-server/pkg/response"
)

// SessionHandler 提供在线会话查询和强制下线能力
type SessionHandler struct {
	SessionMgr *session.Manager
}

func (h *SessionHandler) List(c *gin.Context) {
	items := h.SessionMgr.ListAll(c.Request.Context())
	response.OK(c, items)
}

func (h *SessionHandler) Count(c *gin.Context) {
	n := h.SessionMgr.Count(c.Request.Context())
	response.OK(c, gin.H{"count": n})
}

func (h *SessionHandler) Kick(c *gin.Context) {
	sid := c.Param("sid")
	if sid == "" {
		response.BadRequest(c, "缺少会话 ID")
		return
	}
	if err := h.SessionMgr.Delete(c.Request.Context(), sid); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}
