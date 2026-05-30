package handler

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"sso-server/internal/oauth"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/internal/session"
	"sso-server/pkg/response"
)

// WeComHandler 处理"企业微信扫码登录"两个端点：
//
//	GET /oauth/wecom/login    —— 生成跳转到企微的 URL（前端"用企业微信登录"按钮）
//	GET /oauth/wecom/callback —— 接收企微回调的 code，换 userid → 本地账号 → 颁发 SSO Cookie + JWT，
//	                            最后 302 回前端登录页（带 token 哈希 / 直接进入门户）
type WeComHandler struct {
	WeCom        *service.WeComService
	UserService  *service.UserService
	TokenService *oauth.TokenService
	SessionMgr   *session.Manager
	ConfigRepo   *repository.ConfigRepository
	LogRepo      *repository.LogRepository
	Issuer       string
	FrontendBase string
}

// effectiveBase 拼前端登录页 base URL
func (h *WeComHandler) effectiveBase() string {
	if h.FrontendBase != "" {
		return strings.TrimRight(h.FrontendBase, "/")
	}
	if h.ConfigRepo != nil {
		if v := h.ConfigRepo.SiteURL(); v != "" {
			return strings.TrimRight(v, "/")
		}
	}
	return strings.TrimRight(h.Issuer, "/")
}

// Status 前端登录页用：返回企业微信是否启用，避免渲染失败按钮
func (h *WeComHandler) Status(c *gin.Context) {
	response.OK(c, gin.H{"enabled": h.WeCom != nil && h.WeCom.Enabled()})
}

// QRConfig 给前端 wwLogin jssdk 用：返回内嵌二维码需要的 corp_id / agent_id / redirect_uri
func (h *WeComHandler) QRConfig(c *gin.Context) {
	if h.WeCom == nil || !h.WeCom.Enabled() {
		response.BadRequest(c, "企业微信登录未启用")
		return
	}
	cfg := h.WeCom.PublicConfig()
	redirect := h.effectiveBase() + "/oauth/wecom/callback"
	if rt := c.Query("return_to"); rt != "" {
		redirect += "?return_to=" + rt
	}
	response.OK(c, gin.H{
		"corp_id":      cfg.CorpID,
		"agent_id":     cfg.AgentID,
		"redirect_uri": redirect,
	})
}

// Login 跳转到企微扫码页
func (h *WeComHandler) Login(c *gin.Context) {
	if h.WeCom == nil || !h.WeCom.Enabled() {
		response.BadRequest(c, "企业微信登录未启用")
		return
	}
	// state 仅做 CSRF 防御占位，30 分钟有效
	state := fmt.Sprintf("wecom-%d", time.Now().UnixNano())
	redirectURI := h.effectiveBase() + "/oauth/wecom/callback"
	authURL, err := h.WeCom.AuthorizeURL(redirectURI, state)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

// Callback 企微回调
func (h *WeComHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		response.BadRequest(c, "缺少 code")
		return
	}
	userid, err := h.WeCom.ResolveCode(code)
	if err != nil {
		h.LogRepo.RecordLogin(nil, "", c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", err.Error())
		response.BadRequest(c, "企业微信登录失败："+err.Error())
		return
	}
	user, err := h.WeCom.FindOrCreateUser(userid)
	if err != nil {
		h.LogRepo.RecordLogin(nil, userid, c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", err.Error())
		response.BadRequest(c, err.Error())
		return
	}

	// 创建 SSO 会话 cookie，让浏览器之后访问 /oauth/authorize 时已"登录"
	sd, err := h.SessionMgr.Create(c.Request.Context(), user.ID.String(), user.Username, c.ClientIP(), c.GetHeader("User-Agent"), user.IsStaff)
	if err != nil {
		response.ServerError(c, "创建会话失败")
		return
	}
	setSSOCookieRaw(c, sd)

	h.LogRepo.RecordLogin(&user.ID, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "success", "")

	// 重定向回前端门户（让 SPA 自己拉 /api/v1/auth/profile 拿用户信息）
	target := h.effectiveBase() + "/portal"
	// 兼容 return_to 透传
	if rt := c.Query("return_to"); rt != "" {
		target = rt
	}
	c.Redirect(http.StatusFound, target+"?login=wecom&t="+url.QueryEscape(time.Now().Format("150405")))
}

// setSSOCookieRaw 与 AuthHandler.setSSOCookie 等价（不引入循环依赖，单独写一份）
func setSSOCookieRaw(c *gin.Context, sd *session.SessionData) {
	secure := strings.HasPrefix(c.Request.URL.Scheme, "https") || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(session.CookieName, sd.SessionID, int(session.DefaultTTL.Seconds()), "/", "", secure, true)
}
