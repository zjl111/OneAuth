package handler

import (
	"github.com/gin-gonic/gin"

	"sso-server/internal/repository"
	"sso-server/pkg/mailer"
	"sso-server/pkg/response"
)

// SiteHandler 提供公开的站点品牌信息（站点名/Logo/主题色），
// 用于登录页、门户、管理后台等所有 UI 入口，无需认证即可访问。
type SiteHandler struct {
	ConfigRepo *repository.ConfigRepository
	Mailer     *mailer.Mailer
}

type SiteInfo struct {
	Name            string `json:"name"`
	Logo            string `json:"logo"`
	ThemeColor      string `json:"theme_color"`
	HeroTitle       string `json:"hero_title"`
	HeroSubtitle    string `json:"hero_subtitle"`
	HeroDescription string `json:"hero_description"`
	SMTPEnabled     bool   `json:"smtp_enabled"`
}

func (h *SiteHandler) Info(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=60")
	info := SiteInfo{
		Name:            "OneAuth",
		ThemeColor:      "#1677ff",
		HeroTitle:       "OneAuth",
		HeroSubtitle:    "一键登录所有应用",
		HeroDescription: "OneAuth 是一个简单、安全、开源的 SSO 单点登录项目，让登录更简单，让管理更高效。",
	}
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
			case "hero_title":
				if it.Value != "" {
					info.HeroTitle = it.Value
				}
			case "hero_subtitle":
				if it.Value != "" {
					info.HeroSubtitle = it.Value
				}
			case "hero_description":
				if it.Value != "" {
					info.HeroDescription = it.Value
				}
			}
		}
	}
	if h.Mailer != nil {
		info.SMTPEnabled = h.Mailer.Enabled()
	}
	response.OK(c, info)
}
