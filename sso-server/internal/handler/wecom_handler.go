package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

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
	Store        oauth.Store
	Issuer       string
	FrontendBase string
}

// --- OAuth state 防 CSRF（一次性消费，10 分钟有效） ---------------------------
// 对齐 Cordys 的 OAuthStateService：SecureRandom 32 字节 + 前缀 + 一次性消费 + 过期。
// 与 Cordys 用 HTTP Session 保存不同，这里用进程级 oauth.Store（Redis/内存）保存，
// 因为企微回调是整页跳转，不一定携带登录发起时的会话 Cookie。

const (
	wecomStatePrefix = "wecom."
	wecomStateTTL    = 10 * time.Minute
)

func wecomStateKey(state string) string { return "wecom:state:" + state }

// issueState 签发一次性 state：SecureRandom 32 字节 + 前缀，存入 Store（TTL 10 分钟）。
// mode 记录该 state 的用途（login=扫码登录，bind=扫码绑定当前账号），回调时据此分支。
func (h *WeComHandler) issueState(ctx context.Context, mode string) (string, error) {
	if h.Store == nil {
		return "", errors.New("state 存储未初始化")
	}
	if mode == "" {
		mode = "login"
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	state := wecomStatePrefix + base64.RawURLEncoding.EncodeToString(b)
	if err := h.Store.Set(ctx, wecomStateKey(state), []byte(mode), wecomStateTTL); err != nil {
		return "", err
	}
	return state, nil
}

// validateAndConsumeState 校验并一次性消费 state：非空、前缀匹配、存在即消费；
// 校验后立即删除，确保同一 state 最多成功使用一次（重放被拒绝）。返回 state 记录的用途 mode。
func (h *WeComHandler) validateAndConsumeState(ctx context.Context, state string) (string, error) {
	if h.Store == nil || state == "" || !strings.HasPrefix(state, wecomStatePrefix) {
		return "", errors.New("state 无效")
	}
	val, err := h.Store.Get(ctx, wecomStateKey(state))
	if err == oauth.ErrNotFound {
		return "", errors.New("state 无效或已过期")
	}
	_ = h.Store.Del(ctx, wecomStateKey(state))
	if err != nil {
		return "", err
	}
	return string(val), nil
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

// Verify 校验企业微信配置（corp_id + secret）是否正确。仅管理员可调，不启用登录、不消费 token。
func (h *WeComHandler) Verify(c *gin.Context) {
	if h.WeCom == nil {
		response.BadRequest(c, "企业微信模块未初始化")
		return
	}
	var req struct {
		CorpID string `json:"corp_id"`
		Secret string `json:"secret"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.WeCom.Verify(req.CorpID, req.Secret); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	// 校验通过即落库 verified，作为启用企业微信登录的前置条件（Enabled() 也要求 verified=true）。
	// 由后端统一持久化，避免前端单独写 verified 失败导致“校验成功却无法启用”的不一致。
	if h.ConfigRepo != nil {
		if err := h.ConfigRepo.Set("wecom", "verified", "true"); err != nil {
			response.ServerError(c, err.Error())
			return
		}
	}
	response.OK(c, gin.H{"ok": true})
}

// QRConfig 给前端 wwLogin jssdk 用：返回内嵌二维码需要的 corp_id / agent_id / redirect_uri / state
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
	// mode：login=扫码登录；bind=扫码绑定当前已登录账号。编码进 state，不污染 redirect_uri。
	mode := c.Query("mode")
	if mode != "bind" {
		mode = "login"
	}
	// 签发一次性 state：前端把它交给 jssdk，企微回调时原样带回，回调端据此防 CSRF/重放。
	state, err := h.issueState(c.Request.Context(), mode)
	if err != nil {
		response.ServerError(c, "生成登录安全凭证失败")
		return
	}
	response.OK(c, gin.H{
		"corp_id":      cfg.CorpID,
		"agent_id":     cfg.AgentID,
		"redirect_uri": redirect,
		"state":        state,
		"mode":         mode,
	})
}

// Login 跳转到企微扫码页
func (h *WeComHandler) Login(c *gin.Context) {
	if h.WeCom == nil || !h.WeCom.Enabled() {
		response.BadRequest(c, "企业微信登录未启用")
		return
	}
	// state：一次性安全凭证（10 分钟有效、消费即删），替代原先可重放的纳秒时间戳。
	state, err := h.issueState(c.Request.Context(), "login")
	if err != nil {
		response.ServerError(c, "生成登录安全凭证失败")
		return
	}
	redirectURI := h.effectiveBase() + "/oauth/wecom/callback"
	authURL, err := h.WeCom.AuthorizeURL(redirectURI, state)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

// Authorize 跳转到企业微信「OAuth2 网页授权」链接，用于"企业微信内置浏览器点击应用 → 自动登录"。
// 与 Login（JSSDK 扫码登录）是两条独立链路：Login 跳 login.work.weixin.qq.com（扫码），
// Authorize 跳 open.weixin.qq.com/connect/oauth2/authorize（内置浏览器授权拿 code）。
// 二者最终都回调到同一个 /oauth/wecom/callback，由 Callback 统一消费 code + state 完成登录，
// 因此本方法不影响扫码登录。前端在"检测到处于企业微信内置浏览器"时自动跳到此端点。
func (h *WeComHandler) Authorize(c *gin.Context) {
	if h.WeCom == nil || !h.WeCom.Enabled() {
		response.BadRequest(c, "企业微信登录未启用")
		return
	}
	// 签发一次性 state（mode=login），企微授权回调时原样带回，Callback 据此防 CSRF 并消费。
	state, err := h.issueState(c.Request.Context(), "login")
	if err != nil {
		response.ServerError(c, "生成登录安全凭证失败")
		return
	}
	// 回调地址与扫码链路一致：/oauth/wecom/callback。
	// 该地址的域名必须与企微后台「网页授权回调域」一致（否则企微报"回调地址不匹配"）。
	redirectURI := h.effectiveBase() + "/oauth/wecom/callback"
	authURL, err := h.WeCom.AuthorizeURLOAuth2(redirectURI, state)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	c.Redirect(http.StatusFound, authURL)
}

// wecomFixedState 是"企业微信应用主页配置固定 OAuth2 链接"场景约定的固定 state 值。
// 该值与企微后台主页里手拼链接的 state 参数一致，供 Callback 校验放行。
// 安全性：仅接受这一个固定 state（不是放行任意 state），弱化了"随机 state 防 CSRF"这一层，
// 但仍保留"仅特定 state 通过" + "企微 code 5 分钟一次性有效"两道防线。
const wecomFixedState = "fit2cloud-wecom-client"

// Callback 企微回调
func (h *WeComHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	if code == "" {
		response.BadRequest(c, "缺少 code")
		return
	}
	// 先消费 state（一次性、10 分钟有效），防 CSRF 与回调重放；同时取出 state 记录的用途 mode。
	mode, err := h.validateAndConsumeState(c.Request.Context(), c.Query("state"))
	if err != nil {
		// 兼容"企业微信应用主页配置固定 OAuth2 链接 + 固定 state"场景：
		// 固定主页链接里的 state 是写死的（= wecomFixedState），后端 issueState 从未签发过，
		// validateAndConsumeState 必然失败。此处**仅当回调 state 恰为该固定值**时才放行，
		// 其它非法 state 仍拒绝（不放开任意 state，避免 CSRF 面扩大）。
		// 安全性：企微 code 本身 5 分钟内一次性有效（ResolveCode 依赖 getuserinfo 消费 code），
		// 是防重放的第二层防线；此处仅弱化了"state 随机化"这一层。
		if c.Query("state") == wecomFixedState {
			// 固定值放行只是"回调校验"的中间通过，此处用户身份（userid）尚未解析，
			// 不记登录日志，避免误解为失败并污染失败统计；后续 ResolveCode 成功后
			// 会正常记录一条带用户名的正式登录日志。
			log.Printf("[wecom] 回调 state=%q 为固定值，放行（不阻断）", wecomFixedState)
			mode = "login"
		} else {
			h.LogRepo.RecordLogin(nil, "", c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", "state 校验失败:"+err.Error())
			response.BadRequest(c, "登录安全凭证无效，请重新扫码")
			return
		}
	}
	userid, userTicket, err := h.WeCom.ResolveCode(code)
	if err != nil {
		h.LogRepo.RecordLogin(nil, "", c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", err.Error())
		response.BadRequest(c, "企业微信登录失败："+err.Error())
		return
	}

	// —— 绑定模式：当前已登录用户扫码，把企微 userid 绑定到当前账号（不切换登录身份）——
	if mode == "bind" {
		uid, uname, berr := h.currentUserID(c)
		if berr != nil {
			h.LogRepo.RecordLogin(nil, userid, c.ClientIP(), c.GetHeader("User-Agent"), "wecom_bind", "failure", berr.Error())
			response.BadRequest(c, berr.Error())
			return
		}
		if berr := h.WeCom.BindWeCom(uid, userid); berr != nil {
			h.LogRepo.RecordLogin(&uid, uname, c.ClientIP(), c.GetHeader("User-Agent"), "wecom_bind", "failure", berr.Error())
			response.BadRequest(c, "绑定失败："+berr.Error())
			return
		}
		h.LogRepo.RecordLogin(&uid, uname, c.ClientIP(), c.GetHeader("User-Agent"), "wecom_bind", "success", "绑定企微 "+userid)
		target := h.effectiveBase() + "/admin/profile?bind=success&t=" + url.QueryEscape(time.Now().Format("150405"))
		c.Redirect(http.StatusFound, target)
		return
	}

	user, err := h.WeCom.FindOrCreateUser(userid, userTicket)
	if err != nil {
		h.LogRepo.RecordLogin(nil, userid, c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", err.Error())
		response.BadRequest(c, err.Error())
		return
	}
	// 登录校验：锁定 / 已禁用 / 已离职的用户不允许登录（对齐 Cordys 匹配后校验 enable 抛异常）。
	if user.IsLocked {
		h.LogRepo.RecordLogin(&user.ID, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", "账号已锁定")
		response.BadRequest(c, "账号已锁定，请联系管理员解锁")
		return
	}
	if !user.IsActive {
		h.LogRepo.RecordLogin(&user.ID, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", "账号已禁用")
		response.BadRequest(c, "账号已禁用，请联系管理员处理")
		return
	}
	if user.HireStatus == "resigned" {
		h.LogRepo.RecordLogin(&user.ID, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "wecom", "failure", "已离职")
		response.BadRequest(c, "该账号已离职，请联系管理员处理")
		return
	}

	// 创建 SSO 会话 cookie，让浏览器之后访问 /oauth/authorize 时已"登录"
	sd, err := h.SessionMgr.Create(c.Request.Context(), user.ID.String(), user.Username, sessionDisplayName(user), c.ClientIP(), c.GetHeader("User-Agent"), user.IsStaff)
	if err != nil {
		response.ServerError(c, "创建会话失败")
		return
	}
	setSSOCookieRaw(c, sd)
	if access, err := h.TokenService.IssueAccessToken(user.Username, user.ID.String(), "sso-admin", user.Username, "openid profile email roles", 0); err == nil {
		setCookieRaw(c, session.AccessTokenCookieName, access, int(h.TokenService.AccessTTL().Seconds()))
	}

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
	setCookieRaw(c, session.CookieName, sd.SessionID, int(session.DefaultTTL.Seconds()))
}

// GetWeComBinding GET /api/v1/users/:id/wecom —— 查用户当前绑定的企微 userid
func (h *WeComHandler) GetWeComBinding(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	userid, err := h.WeCom.GetWeComBinding(id)
	if err != nil {
		response.ServerError(c, "查询绑定失败")
		return
	}
	response.OK(c, gin.H{"wecom_userid": userid})
}

// BindWeCom PUT /api/v1/users/:id/wecom —— 绑定/解绑企微 userid（body={wecom_userid}，空串=解绑）
func (h *WeComHandler) BindWeCom(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var req struct {
		WeComUserID string `json:"wecom_userid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.WeCom.BindWeCom(id, req.WeComUserID); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	// 回查绑定结果
	userid, _ := h.WeCom.GetWeComBinding(id)
	response.OK(c, gin.H{"wecom_userid": userid})
}

// GetWeComBindingSelf GET /api/v1/profile/wecom —— 查当前登录用户绑定的企微 userid
func (h *WeComHandler) GetWeComBindingSelf(c *gin.Context) {
	uid, ok := selfUserID(c)
	if !ok {
		return
	}
	userid, err := h.WeCom.GetWeComBinding(uid)
	if err != nil {
		response.ServerError(c, "查询绑定失败")
		return
	}
	response.OK(c, gin.H{"wecom_userid": userid})
}

// BindWeComSelf PUT /api/v1/profile/wecom —— 当前用户手动绑定/解绑企微（wecom_userid 为空=解绑）
func (h *WeComHandler) BindWeComSelf(c *gin.Context) {
	uid, ok := selfUserID(c)
	if !ok {
		return
	}
	var req struct {
		WeComUserID string `json:"wecom_userid"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	if err := h.WeCom.BindWeCom(uid, req.WeComUserID); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	userid, _ := h.WeCom.GetWeComBinding(uid)
	response.OK(c, gin.H{"wecom_userid": userid})
}

// selfUserID 从 authed 组中间件写入的 user_id 解析当前用户
func selfUserID(c *gin.Context) (uuid.UUID, bool) {
	v, ok := c.Get("user_id")
	if !ok {
		response.Unauthorized(c, "未登录")
		return uuid.Nil, false
	}
	s, ok := v.(string)
	if !ok {
		response.Unauthorized(c, "未登录")
		return uuid.Nil, false
	}
	id, err := uuid.Parse(s)
	if err != nil {
		response.Unauthorized(c, "用户标识无效")
		return uuid.Nil, false
	}
	return id, true
}

// currentUserID 从 SSO 会话解析当前已登录用户（同时返回其用户名，供绑定日志记录）。
// 解析顺序（OAuth 回调不在 authed 组内，需自行读取会话；用于扫码绑定当前账号）：
//  1. sso_session cookie —— 首选，但依赖进程内/Redis 内存会话，进程重启或 8 小时 TTL 过期后失效；
//  2. sso_access_token cookie 兜底 —— 与 OAuth/CAS/SAML 的 recoverSessionFromAccessToken 一致：
//     access token 有效则据此重建会话。这样免密/扫码登录后 SSO 会话过期时，绑定仍能识别"当前已登录用户"，
//     不会再报"登录状态已失效，请重新登录后再绑定"。
func (h *WeComHandler) currentUserID(c *gin.Context) (uuid.UUID, string, error) {
	var sd *session.SessionData
	if sid, err := c.Cookie(session.CookieName); err == nil && sid != "" {
		if s, err := h.SessionMgr.Get(c.Request.Context(), sid); err == nil && s != nil {
			sd = s
		}
	}
	if sd == nil {
		sd = recoverSessionFromAccessToken(c, h.SessionMgr, h.TokenService, h.UserService)
	}
	if sd == nil {
		return uuid.Nil, "", errors.New("请先登录后再绑定企业微信")
	}
	id, err := uuid.Parse(sd.UserID)
	if err != nil {
		return uuid.Nil, sd.Username, errors.New("当前用户标识无效")
	}
	return id, sd.Username, nil
}

func setCookieRaw(c *gin.Context, name, value string, ttlSeconds int) {
	secure := strings.HasPrefix(c.Request.URL.Scheme, "https") || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, value, ttlSeconds, "/", "", secure, true)
}
