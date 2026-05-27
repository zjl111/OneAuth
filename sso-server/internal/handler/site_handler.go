package handler

import (
	"github.com/gin-gonic/gin"

	"sso-server/internal/repository"
	"sso-server/pkg/response"
)

// SiteHandler 提供公开的站点品牌信息（站点名/Logo/主题色），
// 用于登录页、门户、管理后台等所有 UI 入口，无需认证即可访问。
type SiteHandler struct {
	ConfigRepo *repository.ConfigRepository
}

type SiteInfo struct {
	Name       string `json:"name"`
	Logo       string `json:"logo"`
	ThemeColor string `json:"theme_color"`
}

func (h *SiteHandler) Info(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=60")
	info := SiteInfo{Name: "OneAuth", ThemeColor: "#1677ff"}
	items, err := h.ConfigRepo.GetByCategory("platform")
	if err == nil {
		for _, it := range items {
			switch it.Key {
			case "name":
				if it.Value != "" {
					info.Name = it.Value
				}
			case "logo":
				info.Logo = it.Value
			case "theme_color":
				if it.Value != "" {
					info.ThemeColor = it.Value
				}
			}
		}
	}
	response.OK(c, info)
}
