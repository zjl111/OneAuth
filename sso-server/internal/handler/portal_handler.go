package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/pkg/response"
)

// PortalHandler 普通用户的应用门户
type PortalHandler struct {
	UserService   *service.UserService
	ClientService *service.ClientService
	GrantRepo     *repository.GrantRepository
	AppGrantRepo  *repository.AppGrantRepository
}

type PortalApp struct {
	ID          string `json:"id"`
	ClientID    string `json:"client_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Protocol    string `json:"protocol"` // 用于前端识别非 SSO 应用（link）
	LogoURL     string `json:"logo_url"`
	HomeURL     string `json:"home_url"`
	IsBuiltin   bool   `json:"is_builtin"`
	IsFavorite  bool   `json:"is_favorite"`
	Granted     bool   `json:"granted"`
}

// Apps 当前用户可访问的应用列表
func (h *PortalHandler) Apps(c *gin.Context) {
	userIDVal, exists := c.Get("user_id")
	if !exists {
		response.Unauthorized(c, "未登录")
		return
	}
	uid, _ := uuid.Parse(userIDVal.(string))
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		response.Unauthorized(c, "用户不存在")
		return
	}

	clients, err := h.ClientService.ListAll()
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	grants, _ := h.GrantRepo.ListByUser(uid)
	grantedSet := make(map[string]bool)
	for _, g := range grants {
		grantedSet[g.ClientID] = true
	}

	// 应用授权过滤：grant_mode=public 全部用户可见；其他模式按 sso_app_grant 表过滤
	var allowedSet map[string]bool
	if h.AppGrantRepo != nil {
		allowedSet, _ = h.AppGrantRepo.AllowedClientIDs(uid)
	}

	apps := []PortalApp{}
	for _, cl := range clients {
		// 管理后台不在应用门户中露出（管理员通过右上角下拉切换进入）
		if cl.ClientID == "sso-admin" {
			continue
		}
		// 受限应用：grant_mode != public 时必须在 allowedSet 里（super_admin 兜底可见）
		if cl.GrantMode != "" && cl.GrantMode != "public" {
			if (allowedSet == nil || !allowedSet[cl.ClientID]) && !user.IsStaff {
				continue
			}
		}
		apps = append(apps, PortalApp{
			ID:          cl.ID.String(),
			ClientID:    cl.ClientID,
			Name:        cl.ClientName,
			Description: cl.Description,
			Protocol:    cl.Protocol,
			LogoURL:     cl.LogoURL,
			HomeURL:     cl.HomeURL,
			IsBuiltin:   cl.IsBuiltin,
			Granted:     grantedSet[cl.ClientID] || cl.IsBuiltin,
		})
	}
	response.OK(c, apps)
}
