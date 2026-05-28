package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

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
	TokenService  *oauth.TokenService
	SessionMgr    *session.Manager
	Store         oauth.Store
	LogRepo       *repository.LogRepository
	LoginRuleRepo *repository.LoginRuleRepository
	Mailer        *mailer.Mailer
	Issuer        string
	FrontendBase  string
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
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	Remember bool   `json:"remember"`
}

type LoginResponse struct {
	AccessToken  string         `json:"access_token"`
	RefreshToken string         `json:"refresh_token"`
	ExpiresIn    int            `json:"expires_in"`
	User         UserInfoPublic `json:"user"`
	Permissions  []string       `json:"permissions"`
}

type UserInfoPublic struct {
	ID       string   `json:"id"`
	Username string   `json:"username"`
	Nickname string   `json:"nickname"`
	Email    string   `json:"email"`
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
	return UserInfoPublic{
		ID:       u.ID.String(),
		Username: u.Username,
		Nickname: u.Nickname,
		Email:    email,
		Avatar:   u.Avatar,
		IsStaff:  u.IsStaff,
		IsActive: u.IsActive,
		Roles:    roles,
	}
}

func (h *AuthHandler) setSSOCookie(c *gin.Context, sd *session.SessionData) {
	secure := c.Request.TLS != nil
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(session.CookieName, sd.SessionID, int(h.SessionMgr.TTL().Seconds()), "/", "", secure, true)
}

// Login 管理后台/SPA 登录（产出 JWT + 设置 SSO Cookie）
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	user, err := h.UserService.Authenticate(req.Username, req.Password)
	if err != nil {
		h.LogRepo.RecordLogin(nil, req.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "failure", err.Error())
		response.Unauthorized(c, err.Error())
		return
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

	sd, err := h.SessionMgr.Create(c.Request.Context(), user.ID.String(), user.Username, c.ClientIP(), c.GetHeader("User-Agent"), user.IsStaff)
	if err != nil {
		response.ServerError(c, "创建会话失败")
		return
	}
	h.setSSOCookie(c, sd)

	access, _ := h.TokenService.IssueAccessToken(user.ID.String(), AdminClientID, user.Username, AdminDefaultScope)
	refresh, err := h.TokenService.SaveRefreshToken(c.Request.Context(), user.ID.String(), AdminClientID, AdminDefaultScope)
	if err != nil {
		response.ServerError(c, "签发刷新令牌失败")
		return
	}

	h.LogRepo.RecordLogin(&user.ID, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "password", "success", "")

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
	secure := c.Request.TLS != nil
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(session.CookieName, "", -1, "/", "", secure, true)
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
	_ = h.TokenService.DeleteRefreshToken(c.Request.Context(), req.RefreshToken)
	access, _ := h.TokenService.IssueAccessToken(rt.UserID, rt.ClientID, user.Username, rt.Scope)
	newRT, err := h.TokenService.SaveRefreshToken(c.Request.Context(), rt.UserID, rt.ClientID, rt.Scope)
	if err != nil {
		response.ServerError(c, "签发刷新令牌失败")
		return
	}
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

	cfg, _ := h.Mailer.LoadConfig()
	base := cfg.ResetLinkBase
	if base == "" {
		if h.FrontendBase != "" {
			base = h.FrontendBase
		} else {
			base = h.Issuer
		}
	}
	link := fmt.Sprintf("%s/oauth/reset-password?token=%s", strings.TrimRight(base, "/"), token)

	subject := "重置 OneAuth 密码"
	body := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; line-height: 1.6; color: #1d2c5b; padding: 20px;">
  <div style="max-width:560px; margin:auto; background:#fff; border-radius:12px; padding:32px; border:1px solid #eef0f5;">
    <h2 style="color:#1677ff; margin-top:0;">重置密码</h2>
    <p>您好 <b>%s</b>，</p>
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
</html>`, user.Nickname, link, link)

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
