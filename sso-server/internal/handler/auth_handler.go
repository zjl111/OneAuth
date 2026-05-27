package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/oauth"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/internal/session"
	"sso-server/pkg/response"
)

// AdminClientID 内置管理后台对应的 OAuth2 client_id
const AdminClientID = "sso-admin"

// AdminDefaultScope 管理后台登录默认 scope
const AdminDefaultScope = "openid profile email roles"

type AuthHandler struct {
	UserService  *service.UserService
	TokenService *oauth.TokenService
	SessionMgr   *session.Manager
	Store        oauth.Store
	LogRepo      *repository.LogRepository
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
