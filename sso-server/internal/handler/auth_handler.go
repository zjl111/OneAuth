package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/captcha"
	"sso-server/internal/middleware"
	"sso-server/internal/model"
	"sso-server/internal/oauth"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/internal/session"
	"sso-server/pkg/mailer"
	"sso-server/pkg/response"
	"sso-server/pkg/utils"
)

// AdminClientID 内置管理后台对应的 OAuth2 client_id
const AdminClientID = "sso-admin"

// AdminDefaultScope 管理后台登录默认 scope
const AdminDefaultScope = "openid profile email roles"

type AuthHandler struct {
	UserService   *service.UserService
	LDAPService   *service.LDAPService
	TokenService  *oauth.TokenService
	SessionMgr    *session.Manager
	Store         oauth.Store
	LogRepo       *repository.LogRepository
	LoginRuleRepo *repository.LoginRuleRepository
	ConfigRepo    *repository.ConfigRepository
	IPAccessRepo  *repository.IPAccessRepository
	Mailer        *mailer.Mailer
	Captcha       *captcha.Service
	Issuer        string // 兜底 issuer（config.yaml）
	FrontendBase  string
}

// effectiveIssuer 与 OAuthHandler 同：platform.site_url 优先
func (h *AuthHandler) effectiveIssuer() string {
	if h.ConfigRepo != nil {
		if v := h.ConfigRepo.SiteURL(); v != "" {
			return v
		}
	}
	return h.Issuer
}

const (
	resetTokenPrefix = "pwd_reset:"
	resetTokenTTL    = 30 * time.Minute
)

type resetTokenPayload struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
}

type LoginRequest struct {
	Username      string `json:"username" binding:"required"`
	Password      string `json:"password" binding:"required"`
	Remember      bool   `json:"remember"`
	CaptchaTicket string `json:"captcha_ticket"` // 失败次数 >= 阈值时必须提供
}

type LoginResponse struct {
	AccessToken  string         `json:"access_token"`
	RefreshToken string         `json:"refresh_token"`
	ExpiresIn    int            `json:"expires_in"`
	User         UserInfoPublic `json:"user"`
	Permissions  []string       `json:"permissions"`
}

type LoginFailureData struct {
	RemainingAttempts int    `json:"remaining_attempts,omitempty"`
	LockMinutes       int    `json:"lock_minutes,omitempty"`
	LockUntil         string `json:"lock_until,omitempty"`
}

type UserInfoPublic struct {
	ID       string   `json:"id"`
	Username string   `json:"username"`
	Nickname string   `json:"nickname"`
	Email    string   `json:"email"`
	Phone    string   `json:"phone"`
	Avatar   string   `json:"avatar"`
	IsStaff  bool     `json:"is_staff"`
	IsActive bool     `json:"is_active"`
	Roles    []string `json:"roles"`
}

func toUserInfoPublic(u *model.User) UserInfoPublic {
	roles := make([]string, 0, len(u.Roles))
	for _, r := range u.Roles {
		roles = append(roles, r.Code)
	}
	email := ""
	if u.Email != nil {
		email = *u.Email
	}
	phone := ""
	if u.Phone != nil {
		phone = *u.Phone
	}
	return UserInfoPublic{
		ID:       u.ID.String(),
		Username: u.Username,
		Nickname: u.Nickname,
		Email:    email,
		Phone:    phone,
		Avatar:   u.Avatar,
		IsStaff:  u.IsStaff,
		IsActive: u.IsActive,
		Roles:    roles,
	}
}

func (h *AuthHandler) loginLockMinutes() int {
	dur := h.loginLockoutDuration()
	if dur <= 0 {
		return 0
	}
	return int(math.Ceil(dur.Minutes()))
}

func (h *AuthHandler) sendLoginFailure(c *gin.Context, status int, code int, msg string, data LoginFailureData) {
	response.ErrData(c, status, code, msg, data)
}

// isHTTPSRequest 判断原始请求是否为 HTTPS —— 同时检查直连 TLS 和反向代理头。
func isHTTPSRequest(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	if c.GetHeader("X-Forwarded-Proto") == "https" {
		return true
	}
	if c.Request.URL.Scheme == "https" {
		return true
	}
	return false
}

func (h *AuthHandler) setSSOCookie(c *gin.Context, sd *session.SessionData) {
	setCookie(c, session.CookieName, sd.SessionID, int(h.SessionMgr.TTL().Seconds()))
}

func (h *AuthHandler) setAccessTokenCookie(c *gin.Context, token string) {
	setCookie(c, session.AccessTokenCookieName, token, int(h.TokenService.AccessTTL().Seconds()))
}

func sessionDisplayName(u *model.User) string {
	if u == nil {
		return ""
	}
	if u.Nickname != "" {
		return u.Nickname
	}
	return u.Username
}

func (h *AuthHandler) clearSSOCookies(c *gin.Context) {
	clearCookie(c, session.CookieName)
	clearCookie(c, session.AccessTokenCookieName)
}

// SyncSSOSession 用当前 Bearer JWT 补建/补刷一次服务端 SSO 会话 cookie。
// 适用于前端登录成功后，浏览器偶发没有稳定接住 Set-Cookie 的场景。
func (h *AuthHandler) SyncSSOSession(c *gin.Context) {
	userVal, _ := c.Get("user")
	userIDVal, hasUserID := c.Get("user_id")
	usernameVal, hasUsername := c.Get("username")
	isStaffVal, hasIsStaff := c.Get("is_staff")

	var user *model.User
	if u, ok := userVal.(*model.User); ok {
		user = u
	}

	var userID string
	if user != nil {
		userID = user.ID.String()
	} else if hasUserID {
		if s, ok := userIDVal.(string); ok {
			userID = s
		}
	}
	if userID == "" {
		response.Unauthorized(c, "未登录")
		return
	}

	username := ""
	if user != nil {
		username = user.Username
	} else if hasUsername {
		if s, ok := usernameVal.(string); ok {
			username = s
		}
	}

	isStaff := false
	if user != nil {
		isStaff = user.IsStaff
	} else if hasIsStaff {
		if b, ok := isStaffVal.(bool); ok {
			isStaff = b
		}
	}

	// 如果浏览器已经带了可用的 SSO 会话，直接复用并刷新 cookie。
	if sid, err := c.Cookie(session.CookieName); err == nil && sid != "" {
		if sd, err := h.SessionMgr.Get(c.Request.Context(), sid); err == nil && sd.UserID == userID {
			log.Printf("[session-debug] sync: reusing existing session sid=%q", sid)
			h.setSSOCookie(c, sd)
			response.OK(c, gin.H{"synced": true})
			return
		}
		log.Printf("[session-debug] sync: existing cookie sid=%q not found in store, creating new", sid)
	} else {
		log.Printf("[session-debug] sync: no sso_session cookie in request, creating new session")
	}

	displayName := username
	if user != nil {
		displayName = sessionDisplayName(user)
	}
	sd, err := h.SessionMgr.Create(c.Request.Context(), userID, username, displayName, c.ClientIP(), c.GetHeader("User-Agent"), isStaff)
	if err != nil {
		response.ServerError(c, "同步会话失败")
		return
	}
	log.Printf("[session-debug] sync: created new session sid=%q user=%s", sd.SessionID, username)
	h.setSSOCookie(c, sd)
	response.OK(c, gin.H{"synced": true})
}

// Login 管理后台/SPA 登录（产出 JWT + 设置 SSO Cookie）
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	req.Username = strings.TrimSpace(req.Username)

	// IP 黑名单：被自动封禁或人工拉黑的 IP 直接拒登。
	clientIP := c.ClientIP()
	if h.IPAccessRepo != nil {
		if banned, _ := h.IPAccessRepo.IsBlackBanned(clientIP); banned {
			h.LogRepo.RecordLogin(nil, req.Username, clientIP, c.GetHeader("User-Agent"), "password", "failure", "IP banned")
			response.Forbidden(c, "您的 IP 已被封禁，请稍后再试或联系管理员")
			return
		}
	}

	// 账号锁定：优先于验证码，避免已经锁定的账号还被迫去过验证码。
	lookupUser, err := h.UserService.FindLoginUser(req.Username)
	if err != nil {
		response.ServerError(c, "查询用户状态失败")
		return
	}
	if lookupUser != nil && lookupUser.IsLocked {
		h.LogRepo.RecordLogin(&lookupUser.ID, lookupUser.Username, clientIP, c.GetHeader("User-Agent"), "password", "failure", "locked")
		data := LoginFailureData{}
		if lookupUser.LockUntil != nil && time.Now().Before(*lookupUser.LockUntil) {
			data.LockMinutes = int(math.Ceil(time.Until(*lookupUser.LockUntil).Minutes()))
			data.LockUntil = lookupUser.LockUntil.Format("2006-01-02 15:04")
		}
		response.ErrData(c, http.StatusForbidden, 4003, h.lockedMessage(lookupUser), data)
		return
	}

	// captcha gate：失败次数 >= 阈值时强制校验 ticket
	if h.captchaRequired(c.Request.Context(), req.Username, c.ClientIP()) {
		if h.Captcha == nil || !h.Captcha.ConsumeTicket(c.Request.Context(), req.CaptchaTicket) {
			// 用 403 而不是 200 + code=4090，让前端 axios 走 reject 路径；
			// 也避开 401 的 refresh 拦截器死循环。
			c.JSON(http.StatusForbidden, gin.H{
				"code":    4090,
				"message": "captcha_required",
				"data":    nil,
			})
			return
		}
	}

	user, err := h.UserService.Authenticate(req.Username, req.Password)
	loginMethod := "password"
	if err != nil {
		// 本地认证失败，且 LDAP 启用 → 尝试 LDAP
		if h.LDAPService != nil && h.LDAPService.Enabled() {
			ldapUser, ldapErr := h.LDAPService.Authenticate(req.Username, req.Password)
			if ldapErr == nil && ldapUser != nil {
				user = ldapUser
				err = nil
				loginMethod = "ldap"
			} else if ldapErr != nil {
				// LDAP 报错的具体信息保留到日志，不抛给前端，避免泄漏目录结构
				h.LogRepo.RecordLogin(nil, req.Username, c.ClientIP(), c.GetHeader("User-Agent"), "ldap", "failure", ldapErr.Error())
			}
		}
		if err != nil {
			if err.Error() == "账号已禁用" {
				h.LogRepo.RecordLogin(nil, req.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", err.Error())
				response.Forbidden(c, err.Error())
				return
			}
			if strings.HasPrefix(err.Error(), "账号已锁定") {
				h.LogRepo.RecordLogin(nil, req.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", err.Error())
				response.Forbidden(c, err.Error())
				return
			}
			if err.Error() != "账号已禁用" && !strings.HasPrefix(err.Error(), "账号已锁定") {
				userFailCount := h.recordUserFail(c.Request.Context(), req.Username)
				if userFailCount > 0 && userFailCount >= h.loginLockoutThreshold() && lookupUser != nil {
					lockUntil := time.Time{}
					var untilPtr *time.Time
					if dur := h.loginLockoutDuration(); dur > 0 {
						lockUntil = time.Now().Add(dur)
						untilPtr = &lockUntil
					}
					if lockErr := h.UserService.LockUntil(lookupUser.ID, untilPtr); lockErr == nil {
						data := LoginFailureData{
							LockMinutes: h.loginLockMinutes(),
						}
						if untilPtr != nil {
							data.LockUntil = untilPtr.Format("2006-01-02 15:04")
						}
						msg := h.lockedMessage(&model.User{LockUntil: untilPtr})
						h.clearLoginFail(c.Request.Context(), req.Username, c.ClientIP())
						h.clearUserFail(c.Request.Context(), req.Username)
						h.LogRepo.RecordLogin(&lookupUser.ID, lookupUser.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", msg)
						response.ErrData(c, http.StatusForbidden, 4003, msg, data)
						return
					}
				}
				remaining := h.loginLockoutThreshold() - userFailCount
				if remaining < 0 {
					remaining = 0
				}
				h.recordIPFailAndMaybeBan(c.Request.Context(), c.ClientIP())
				if lookupUser != nil {
					h.LogRepo.RecordLogin(&lookupUser.ID, lookupUser.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", err.Error())
				} else {
					h.LogRepo.RecordLogin(nil, req.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", err.Error())
				}
				response.ErrData(c, http.StatusUnauthorized, 4001, fmt.Sprintf("账号或密码错误，还可再试 %d 次", remaining), LoginFailureData{
					RemainingAttempts: remaining,
				})
				return
			}
			h.LogRepo.RecordLogin(nil, req.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", err.Error())
			response.Unauthorized(c, "登录失败")
			return
		}
	}

	// 登录控制规则：IP/时段/用户范围匹配 deny → 拒绝登录
	if h.LoginRuleRepo != nil {
		if allowed, hit := h.LoginRuleRepo.Evaluate(user.ID, c.ClientIP(), time.Now()); !allowed && hit != nil {
			msg := "已被访问策略「" + hit.Name + "」拒绝"
			h.LogRepo.RecordLogin(&user.ID, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", msg)
			response.Forbidden(c, msg)
			return
		}
	}

	sd, err := h.SessionMgr.Create(c.Request.Context(), user.ID.String(), user.Username, sessionDisplayName(user), c.ClientIP(), c.GetHeader("User-Agent"), user.IsStaff)
	if err != nil {
		response.ServerError(c, "创建会话失败")
		return
	}
	log.Printf("[session-debug] login: created session sid=%q user=%s", sd.SessionID, user.Username)
	h.setSSOCookie(c, sd)
	log.Printf("[session-debug] login: set cookie %s=%s (secure=%v, path=/)", session.CookieName, sd.SessionID, isHTTPSRequest(c))

	access, _ := h.TokenService.IssueAccessToken(user.Username, user.ID.String(), AdminClientID, user.Username, AdminDefaultScope, 0)
	refresh, err := h.TokenService.SaveRefreshToken(c.Request.Context(), user.ID.String(), AdminClientID, AdminDefaultScope, 0)
	if err != nil {
		response.ServerError(c, "签发刷新令牌失败")
		return
	}
	h.setAccessTokenCookie(c, access)

	h.LogRepo.RecordLogin(&user.ID, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), loginMethod, "success", "")
	h.clearLoginFail(c.Request.Context(), req.Username, c.ClientIP())
	h.clearUserFail(c.Request.Context(), req.Username)
	h.clearIPFail(c.Request.Context(), c.ClientIP())
	middleware.MarkActive(h.Store, user.ID.String())

	response.OK(c, LoginResponse{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int(h.TokenService.AccessTTL().Seconds()),
		User:         toUserInfoPublic(user),
		Permissions:  h.UserService.Permissions(user),
	})
}

// Logout 登出：清除 SSO Cookie + 删除服务端 Session
func (h *AuthHandler) Logout(c *gin.Context) {
	sid, _ := c.Cookie(session.CookieName)
	if sid != "" {
		_ = h.SessionMgr.Delete(c.Request.Context(), sid)
	}
	h.clearSSOCookies(c)
	response.OK(c, nil)
}

// Refresh 刷新 Token
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	rt, err := h.TokenService.LoadRefreshToken(c.Request.Context(), req.RefreshToken)
	if err != nil {
		response.Unauthorized(c, "刷新令牌已失效")
		return
	}
	uid, _ := uuid.Parse(rt.UserID)
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		response.Unauthorized(c, "用户不存在")
		return
	}
	// 无活动超时校验：系统设置 security.session_timeout 秒内没有"主动操作"
	// （前端 X-User-Action: 1 标记的请求）就拒绝 refresh，并吊销当前 refresh token。
	if timeout := h.sessionTimeout(); timeout > 0 {
		lastActive := middleware.LastActiveAt(h.Store, rt.UserID)
		// 从未活跃过的视为刚登录，跳过本次检查（Login 处已 MarkActive）
		if !lastActive.IsZero() && time.Since(lastActive) > timeout {
			_ = h.TokenService.DeleteRefreshToken(c.Request.Context(), req.RefreshToken)
			response.Unauthorized(c, "会话已超时，请重新登录")
			return
		}
	}
	_ = h.TokenService.DeleteRefreshToken(c.Request.Context(), req.RefreshToken)
	access, _ := h.TokenService.IssueAccessToken(user.Username, rt.UserID, rt.ClientID, user.Username, rt.Scope, 0)
	newRT, err := h.TokenService.SaveRefreshToken(c.Request.Context(), rt.UserID, rt.ClientID, rt.Scope, 0)
	if err != nil {
		response.ServerError(c, "签发刷新令牌失败")
		return
	}
	h.setAccessTokenCookie(c, access)
	response.OK(c, gin.H{
		"access_token":  access,
		"refresh_token": newRT,
		"expires_in":    int(h.TokenService.AccessTTL().Seconds()),
	})
}

// Profile 当前用户信息
func (h *AuthHandler) Profile(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid, err := uuid.Parse(userID.(string))
	if err != nil {
		response.Unauthorized(c, "未登录")
		return
	}
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		response.Unauthorized(c, "用户不存在")
		return
	}
	response.OK(c, gin.H{
		"user":        toUserInfoPublic(user),
		"permissions": h.UserService.Permissions(user),
	})
}

// UpdateProfile 当前用户自助更新昵称/邮箱/头像/职位
func (h *AuthHandler) UpdateProfile(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid, err := uuid.Parse(userID.(string))
	if err != nil {
		response.Unauthorized(c, "未登录")
		return
	}
	var in service.UpdateUserInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	// 自助接口禁止改动角色 / 启用状态 / 部门
	in.RoleIDs = nil
	in.IsActive = nil
	in.DepartmentID = nil
	u, err := h.UserService.Update(uid, in)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, gin.H{
		"user":        toUserInfoPublic(u),
		"permissions": h.UserService.Permissions(u),
	})
}

// UploadAvatar 当前用户自助上传头像
func (h *AuthHandler) UploadAvatar(c *gin.Context) {
	userID, _ := c.Get("user_id")
	uid, err := uuid.Parse(userID.(string))
	if err != nil {
		response.Unauthorized(c, "未登录")
		return
	}
	url, err := saveAvatarFile(c)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	avatar := url
	in := service.UpdateUserInput{Avatar: &avatar}
	u, err := h.UserService.Update(uid, in)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, gin.H{"url": url, "user": toUserInfoPublic(u)})
}

// ChangePassword 修改密码
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	var req struct {
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	userID, _ := c.Get("user_id")
	uid, _ := uuid.Parse(userID.(string))
	if err := h.UserService.ChangePassword(uid, req.OldPassword, req.NewPassword); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, nil)
}

// ForgotPassword 忘记密码：根据邮箱发送重置链接
// 安全考虑：无论邮箱是否存在都返回成功，避免账号枚举
func (h *AuthHandler) ForgotPassword(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "请输入有效邮箱")
		return
	}
	if h.Mailer == nil || !h.Mailer.Enabled() {
		response.BadRequest(c, "管理员未启用邮件功能，请联系管理员重置密码")
		return
	}

	email := strings.TrimSpace(req.Email)
	user, _ := h.UserService.GetByEmail(email)
	// 即使用户不存在也假装发邮件成功，避免被用来枚举注册邮箱
	if user != nil && user.IsActive && !user.IsLocked && user.Email != nil {
		go h.sendResetMail(user, email)
	}
	response.OK(c, gin.H{"message": "如果该邮箱已注册，重置链接已发送"})
}

func (h *AuthHandler) sendResetMail(user *model.User, email string) {
	token := utils.RandomString(48)
	payload := resetTokenPayload{UserID: user.ID.String(), Email: email}
	b, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := h.Store.Set(ctx, resetTokenPrefix+token, b, resetTokenTTL); err != nil {
		return
	}

	// 重置密码邮件链接前缀：smtp.reset_link_base（显式覆盖，极少用） > platform.site_url > oauth.issuer
	cfg, _ := h.Mailer.LoadConfig()
	base := cfg.ResetLinkBase
	if base == "" {
		base = h.effectiveIssuer()
	}
	link := fmt.Sprintf("%s/oauth/reset-password?token=%s", strings.TrimRight(base, "/"), token)

	// 主题：使用模板配置 + 可选前缀
	subject := cfg.ResetSubject
	if subject == "" {
		subject = "重置 OneAuth 密码"
	}
	if cfg.SubjectPrefix != "" {
		subject = cfg.SubjectPrefix + " " + subject
	}

	// 正文：管理员配置自定义模板时使用；否则使用默认模板
	greeting := cfg.ResetGreeting
	if greeting == "" {
		greeting = "Hello"
	}
	name := user.Nickname
	if name == "" {
		name = user.Username
	}
	var body string
	if cfg.ResetBody != "" {
		body = strings.ReplaceAll(cfg.ResetBody, "{{name}}", name)
		body = strings.ReplaceAll(body, "{{greeting}}", greeting)
		body = strings.ReplaceAll(body, "{{link}}", link)
	} else {
		body = fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; line-height: 1.6; color: #1d2c5b; padding: 20px;">
  <div style="max-width:560px; margin:auto; background:#fff; border-radius:12px; padding:32px; border:1px solid #eef0f5;">
    <h2 style="color:#1677ff; margin-top:0;">重置密码</h2>
    <p>%s <b>%s</b>，</p>
    <p>我们收到了重置您 OneAuth 账号密码的请求。请点击下面的按钮设置新密码：</p>
    <p style="text-align:center; margin:32px 0;">
      <a href="%s" style="display:inline-block; background:#1677ff; color:#fff; padding:12px 32px; border-radius:8px; text-decoration:none; font-weight:600;">重置密码</a>
    </p>
    <p style="font-size:13px; color:#6b7280;">如果按钮无法点击，请复制下面的链接到浏览器：</p>
    <p style="font-size:12px; color:#6b7280; word-break:break-all;">%s</p>
    <hr style="border:none; border-top:1px solid #eef0f5; margin:24px 0;">
    <p style="font-size:12px; color:#94a3b8;">链接 30 分钟内有效。如非本人操作请忽略本邮件。</p>
  </div>
</body>
</html>`, greeting, name, link, link)
	}

	_ = h.Mailer.Send([]string{email}, subject, body)
}

// VerifyResetToken 验证重置 token 是否有效，前端在重置密码页加载时调
func (h *AuthHandler) VerifyResetToken(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		response.BadRequest(c, "缺少 token")
		return
	}
	b, err := h.Store.Get(c.Request.Context(), resetTokenPrefix+token)
	if err != nil {
		response.BadRequest(c, "链接已过期或无效")
		return
	}
	var p resetTokenPayload
	_ = json.Unmarshal(b, &p)
	// 只暴露脱敏邮箱
	response.OK(c, gin.H{"email": maskEmail(p.Email)})
}

// ResetPassword 凭 token 重置密码
func (h *AuthHandler) ResetPassword(c *gin.Context) {
	var req struct {
		Token       string `json:"token" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	b, err := h.Store.Get(c.Request.Context(), resetTokenPrefix+req.Token)
	if err != nil {
		response.BadRequest(c, "链接已过期或无效")
		return
	}
	var p resetTokenPayload
	if err := json.Unmarshal(b, &p); err != nil {
		response.BadRequest(c, "链接已过期或无效")
		return
	}
	uid, err := uuid.Parse(p.UserID)
	if err != nil {
		response.BadRequest(c, "链接已过期或无效")
		return
	}
	if err := h.UserService.ResetPassword(uid, req.NewPassword); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	// 一次性：用完即删
	_ = h.Store.Del(c.Request.Context(), resetTokenPrefix+req.Token)
	h.LogRepo.RecordLogin(&uid, "", c.ClientIP(), c.GetHeader("User-Agent"), "password_reset", "success", "")
	response.OK(c, nil)
}

func maskEmail(email string) string {
	at := strings.Index(email, "@")
	if at <= 1 {
		return email
	}
	prefix := email[:at]
	if len(prefix) <= 2 {
		return prefix[:1] + "***" + email[at:]
	}
	return prefix[:2] + "***" + email[at:]
}

// ---------- captcha helpers ----------

// captchaFailWindow 失败计数滚动窗口；超过这段时间后计数自然过期
const captchaFailWindow = 10 * time.Minute

// sessionTimeout 系统设置 security.session_timeout 秒。0 / 未配置 = 禁用超时校验。
func (h *AuthHandler) sessionTimeout() time.Duration {
	if h.ConfigRepo == nil {
		return 0
	}
	v := h.ConfigRepo.Get("security", "session_timeout")
	if v == "" {
		return 0
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0
	}
	return time.Duration(n) * time.Second
}

func (h *AuthHandler) captchaEnabled() bool {
	if h.Captcha == nil || h.ConfigRepo == nil {
		return false
	}
	return h.ConfigRepo.Get("security", "captcha_enabled") == "true"
}

func (h *AuthHandler) captchaThreshold() int {
	if h.ConfigRepo == nil {
		return 3
	}
	v := h.ConfigRepo.Get("security", "captcha_threshold")
	if v == "" {
		return 3
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 3
	}
	return n
}

func (h *AuthHandler) loginLockoutThreshold() int {
	if h.ConfigRepo == nil {
		return 3
	}
	v := h.ConfigRepo.Get("security", "login_lockout_threshold")
	if v == "" {
		return 3
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 3
	}
	return n
}

func (h *AuthHandler) loginLockoutDuration() time.Duration {
	if h.ConfigRepo == nil {
		return 30 * time.Minute
	}
	v := h.ConfigRepo.Get("security", "login_lockout_duration")
	if v == "" {
		return 30 * time.Minute
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 30 * time.Minute
	}
	return time.Duration(n) * time.Second
}

// captchaRequired 当前 username/IP 组合是否需要 captcha。
// 阈值为 0 表示"每次登录都要"。
func (h *AuthHandler) captchaRequired(ctx context.Context, username, ip string) bool {
	if !h.captchaEnabled() {
		return false
	}
	threshold := h.captchaThreshold()
	if threshold == 0 {
		return true
	}
	count := h.loginFailCount(ctx, username, ip)
	return count >= threshold
}

func (h *AuthHandler) loginFailKey(username, ip string) string {
	return "loginfail:" + ip + ":" + username
}

func (h *AuthHandler) userFailKey(loginName string) string {
	return "userloginfail:" + strings.ToLower(strings.TrimSpace(loginName))
}

func (h *AuthHandler) loginFailCount(ctx context.Context, username, ip string) int {
	if h.Store == nil {
		return 0
	}
	v, err := h.Store.Get(ctx, h.loginFailKey(username, ip))
	if err != nil || len(v) == 0 {
		return 0
	}
	n, _ := strconv.Atoi(string(v))
	return n
}

func (h *AuthHandler) recordLoginFail(ctx context.Context, username, ip string) {
	if h.Store == nil {
		return
	}
	_, _ = h.Store.Incr(ctx, h.loginFailKey(username, ip), captchaFailWindow)
}

func (h *AuthHandler) clearLoginFail(ctx context.Context, username, ip string) {
	if h.Store == nil {
		return
	}
	_ = h.Store.Del(ctx, h.loginFailKey(username, ip))
}

func (h *AuthHandler) userFailCount(ctx context.Context, loginName string) int {
	if h.Store == nil {
		return 0
	}
	v, err := h.Store.Get(ctx, h.userFailKey(loginName))
	if err != nil || len(v) == 0 {
		return 0
	}
	n, _ := strconv.Atoi(string(v))
	return n
}

func (h *AuthHandler) recordUserFail(ctx context.Context, loginName string) int {
	if h.Store == nil {
		return 0
	}
	count, err := h.Store.Incr(ctx, h.userFailKey(loginName), captchaFailWindow)
	if err != nil {
		return 0
	}
	return int(count)
}

func (h *AuthHandler) clearUserFail(ctx context.Context, loginName string) {
	if h.Store == nil {
		return
	}
	_ = h.Store.Del(ctx, h.userFailKey(loginName))
}

func (h *AuthHandler) lockedMessage(u *model.User) string {
	if u != nil && u.LockUntil != nil && time.Now().Before(*u.LockUntil) {
		return fmt.Sprintf("账号已锁定，请于 %s 后重试", u.LockUntil.Format("2006-01-02 15:04"))
	}
	return "账号已锁定，请联系管理员解锁"
}

// ---------- IP auto-ban ----------

func (h *AuthHandler) ipBanEnabled() bool {
	if h.IPAccessRepo == nil || h.ConfigRepo == nil {
		return false
	}
	return h.ConfigRepo.Get("security", "ip_ban_enabled") == "true"
}

// ipBanThreshold 同一 IP 在 ipBanWindow 内失败几次后自动封禁；0 表示禁用。
func (h *AuthHandler) ipBanThreshold() int {
	if h.ConfigRepo == nil {
		return 20
	}
	v := h.ConfigRepo.Get("security", "ip_ban_threshold")
	if v == "" {
		return 20
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 20
	}
	return n
}

// ipBanDuration 自动封禁时长（秒）；0 表示永久。默认 1 小时。
func (h *AuthHandler) ipBanDuration() time.Duration {
	if h.ConfigRepo == nil {
		return time.Hour
	}
	v := h.ConfigRepo.Get("security", "ip_ban_duration")
	if v == "" {
		return time.Hour
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return time.Hour
	}
	return time.Duration(n) * time.Second
}

// ipBanWindow 失败计数滚动窗口；和 captchaFailWindow 区分（IP 维度更宽容）
const ipBanWindow = 30 * time.Minute

func (h *AuthHandler) ipFailKey(ip string) string { return "ipfail:" + ip }

func (h *AuthHandler) recordIPFailAndMaybeBan(ctx context.Context, ip string) {
	if !h.ipBanEnabled() || h.Store == nil {
		return
	}
	count, err := h.Store.Incr(ctx, h.ipFailKey(ip), ipBanWindow)
	if err != nil {
		return
	}
	threshold := h.ipBanThreshold()
	if int(count) < threshold {
		return
	}
	// 触发自动封禁
	dur := h.ipBanDuration()
	note := fmt.Sprintf("登录失败 %d 次自动封禁", count)
	if dur > 0 {
		note = fmt.Sprintf("%s（%s 解除）", note, time.Now().Add(dur).Format("2006-01-02 15:04"))
	} else {
		note = fmt.Sprintf("%s（永久）", note)
	}
	if err := h.IPAccessRepo.UpsertAutoBan(ip, note, dur); err == nil {
		// 同时清掉失败计数，避免封禁后还在累加
		_ = h.Store.Del(ctx, h.ipFailKey(ip))
	}
}

func (h *AuthHandler) clearIPFail(ctx context.Context, ip string) {
	if h.Store == nil {
		return
	}
	_ = h.Store.Del(ctx, h.ipFailKey(ip))
}

// CaptchaChallenge GET /api/v1/auth/captcha/challenge
func (h *AuthHandler) CaptchaChallenge(c *gin.Context) {
	if h.Captcha == nil || !h.captchaEnabled() {
		c.JSON(http.StatusOK, gin.H{"code": 4040, "message": "captcha disabled", "data": nil})
		return
	}
	ch, err := h.Captcha.Generate(c.Request.Context())
	if err != nil {
		response.ServerError(c, "captcha generate failed: "+err.Error())
		return
	}
	response.OK(c, ch)
}

// CaptchaVerify POST /api/v1/auth/captcha/verify  body={challenge_id, x, duration_ms}
// 通过返回 ticket，失败返回 400。
func (h *AuthHandler) CaptchaVerify(c *gin.Context) {
	if h.Captcha == nil {
		response.BadRequest(c, "captcha disabled")
		return
	}
	var req struct {
		ChallengeID string `json:"challenge_id"`
		X           int    `json:"x"`
		DurationMs  int    `json:"duration_ms"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	ticket, err := h.Captcha.Verify(c.Request.Context(), req.ChallengeID, req.X, req.DurationMs)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	response.OK(c, gin.H{"ticket": ticket})
}

// CaptchaStatus GET /api/v1/auth/captcha/status?username=xxx
// 让前端预先知道这次登录是否需要 captcha（避免多走一次 4090 401 来回）
func (h *AuthHandler) CaptchaStatus(c *gin.Context) {
	username := c.Query("username")
	required := h.captchaRequired(c.Request.Context(), username, c.ClientIP())
	failCount := h.loginFailCount(c.Request.Context(), username, c.ClientIP())
	remaining := h.loginLockoutThreshold() - failCount
	if remaining < 0 {
		remaining = 0
	}
	lockedUser, _ := h.UserService.FindLoginUser(username)
	locked := lockedUser != nil && lockedUser.IsLocked
	lockMinutes := 0
	lockUntil := ""
	if locked && lockedUser != nil && lockedUser.LockUntil != nil && time.Now().Before(*lockedUser.LockUntil) {
		lockMinutes = int(math.Ceil(time.Until(*lockedUser.LockUntil).Minutes()))
		lockUntil = lockedUser.LockUntil.Format("2006-01-02 15:04")
	}
	response.OK(c, gin.H{
		"enabled":            h.captchaEnabled(),
		"required":           required,
		"threshold":          h.captchaThreshold(),
		"failed_attempts":    failCount,
		"remaining_attempts": remaining,
		"locked":             locked,
		"lock_minutes":       lockMinutes,
		"lock_until":         lockUntil,
	})
}
