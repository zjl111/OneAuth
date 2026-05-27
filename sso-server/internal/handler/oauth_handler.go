package handler

import (
	"crypto/sha256"
	"encoding/base64"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/oauth"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/internal/session"
)

type OAuthHandler struct {
	AuthCodeStore *oauth.AuthCodeStore
	TokenService  *oauth.TokenService
	KeyManager    *oauth.KeyManager
	Store         oauth.Store
	UserService   *service.UserService
	ClientService *service.ClientService
	GrantRepo     *repository.GrantRepository
	LogRepo       *repository.LogRepository
	SessionMgr    *session.Manager
	Issuer        string
	FrontendBase  string
}

// --- helpers -------------------------------------------------------------

func (h *OAuthHandler) currentSession(c *gin.Context) *session.SessionData {
	sid, err := c.Cookie(session.CookieName)
	if err != nil {
		return nil
	}
	sd, err := h.SessionMgr.Get(c.Request.Context(), sid)
	if err != nil {
		return nil
	}
	return sd
}

func (h *OAuthHandler) clearSession(c *gin.Context) {
	secure := c.Request.TLS != nil
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(session.CookieName, "", -1, "/", "", secure, true)
}

func errorRedirect(c *gin.Context, redirectURI, err, desc, state string) {
	if redirectURI == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": err, "error_description": desc})
		return
	}
	q := url.Values{}
	q.Set("error", err)
	q.Set("error_description", desc)
	if state != "" {
		q.Set("state", state)
	}
	sep := "?"
	if strings.Contains(redirectURI, "?") {
		sep = "&"
	}
	c.Redirect(http.StatusFound, redirectURI+sep+q.Encode())
}

// Authorize 授权端点
func (h *OAuthHandler) Authorize(c *gin.Context) {
	clientID := c.Query("client_id")
	redirectURI := c.Query("redirect_uri")
	scope := c.DefaultQuery("scope", "openid")
	state := c.Query("state")
	nonce := c.Query("nonce")
	codeChallenge := c.Query("code_challenge")
	codeChallengeMethod := c.DefaultQuery("code_challenge_method", "S256")
	responseType := c.DefaultQuery("response_type", "code")

	if responseType != "code" {
		errorRedirect(c, redirectURI, "unsupported_response_type", "仅支持 response_type=code", state)
		return
	}

	client, err := h.ClientService.GetByClientID(clientID)
	if err != nil || !client.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_client", "error_description": "未知或已禁用的应用"})
		return
	}
	if !client.CheckRedirectURI(redirectURI) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_redirect_uri", "error_description": "回调地址未注册"})
		return
	}
	if client.IsPublic() && codeChallenge == "" {
		errorRedirect(c, redirectURI, "invalid_request", "公共客户端必须使用 PKCE", state)
		return
	}

	sd := h.currentSession(c)
	if sd == nil {
		loginURL := h.FrontendBase + "/oauth/login?" + url.Values{
			"return_to": []string{c.Request.URL.RequestURI()},
		}.Encode()
		c.Redirect(http.StatusFound, loginURL)
		return
	}

	userID := uuid.MustParse(sd.UserID)
	autoGrant := client.IsBuiltin || h.GrantRepo.Has(userID, clientID, scope)
	consented := c.Query("consent") == "1"

	if !autoGrant && !consented {
		consentURL := h.FrontendBase + "/oauth/consent?" + url.Values{
			"client_id":             []string{clientID},
			"redirect_uri":          []string{redirectURI},
			"scope":                 []string{scope},
			"state":                 []string{state},
			"nonce":                 []string{nonce},
			"code_challenge":        []string{codeChallenge},
			"code_challenge_method": []string{codeChallengeMethod},
		}.Encode()
		c.Redirect(http.StatusFound, consentURL)
		return
	}

	if consented && !client.IsBuiltin {
		h.GrantRepo.Grant(userID, clientID, scope)
	}

	code := h.AuthCodeStore.GenerateCode()
	h.AuthCodeStore.Save(c.Request.Context(), &oauth.AuthCodeData{
		Code:                code,
		ClientID:            clientID,
		RedirectURI:         redirectURI,
		Scope:               scope,
		UserID:              sd.UserID,
		Username:            sd.Username,
		Nonce:               nonce,
		CodeChallenge:       codeChallenge,
		CodeChallengeMethod: codeChallengeMethod,
		AuthTime:            sd.AuthTime.Unix(),
	})
	uid, _ := uuid.Parse(sd.UserID)
	h.LogRepo.RecordAccess(&uid, sd.Username, clientID, client.ClientName, c.ClientIP())

	loc := redirectURI
	sep := "?"
	if strings.Contains(loc, "?") {
		sep = "&"
	}
	loc += sep + "code=" + url.QueryEscape(code)
	if state != "" {
		loc += "&state=" + url.QueryEscape(state)
	}
	c.Redirect(http.StatusFound, loc)
}

// Token 令牌端点
func (h *OAuthHandler) Token(c *gin.Context) {
	grantType := c.PostForm("grant_type")

	clientID, clientSecret, hasBasic := c.Request.BasicAuth()
	if !hasBasic {
		clientID = c.PostForm("client_id")
		clientSecret = c.PostForm("client_secret")
	}

	client, err := h.ClientService.GetByClientID(clientID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_client"})
		return
	}
	if !client.IsPublic() && !client.CheckSecret(clientSecret) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_client"})
		return
	}

	switch grantType {
	case "authorization_code":
		h.handleAuthCodeGrant(c, client)
	case "refresh_token":
		h.handleRefreshTokenGrant(c, client)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported_grant_type"})
	}
}

func (h *OAuthHandler) handleAuthCodeGrant(c *gin.Context, client *model.OAuth2Client) {
	code := c.PostForm("code")
	redirectURI := c.PostForm("redirect_uri")
	codeVerifier := c.PostForm("code_verifier")

	authCode, err := h.AuthCodeStore.Get(c.Request.Context(), code, client.ClientID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant", "error_description": err.Error()})
		return
	}
	_ = h.AuthCodeStore.Delete(c.Request.Context(), code)

	if authCode.RedirectURI != redirectURI {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant", "error_description": "redirect_uri mismatch"})
		return
	}

	if authCode.CodeChallenge != "" {
		if !verifyPKCE(codeVerifier, authCode.CodeChallenge, authCode.CodeChallengeMethod) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant", "error_description": "PKCE verification failed"})
			return
		}
	}

	uid, _ := uuid.Parse(authCode.UserID)
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant", "error_description": "user not found"})
		return
	}

	accessToken, err := h.TokenService.IssueAccessToken(authCode.UserID, client.ClientID, user.Username, authCode.Scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	refreshToken, err := h.TokenService.SaveRefreshToken(c.Request.Context(), authCode.UserID, client.ClientID, authCode.Scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	h.LogRepo.RecordLogin(&uid, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "oauth_code", "success", "client="+client.ClientID)

	resp := gin.H{
		"access_token":  accessToken,
		"token_type":    "Bearer",
		"expires_in":    int(h.TokenService.AccessTTL().Seconds()),
		"refresh_token": refreshToken,
		"scope":         authCode.Scope,
	}
	if strings.Contains(authCode.Scope, "openid") {
		info := userToInfo(user)
		idToken, err := h.TokenService.IssueIDToken(authCode.UserID, client.ClientID, authCode.Nonce, time.Unix(authCode.AuthTime, 0), info)
		if err == nil {
			resp["id_token"] = idToken
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (h *OAuthHandler) handleRefreshTokenGrant(c *gin.Context, client *model.OAuth2Client) {
	rt := c.PostForm("refresh_token")
	if rt == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	data, err := h.TokenService.LoadRefreshToken(c.Request.Context(), rt)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant", "error_description": "refresh token expired"})
		return
	}
	if data.ClientID != client.ClientID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant", "error_description": "client mismatch"})
		return
	}
	// 旋转：删除旧 token，签发新 token（如旧 token 已被并发交换则拒绝整个用户的所有 refresh）
	_ = h.TokenService.DeleteRefreshToken(c.Request.Context(), rt)

	uid, _ := uuid.Parse(data.UserID)
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_grant"})
		return
	}

	accessToken, _ := h.TokenService.IssueAccessToken(data.UserID, client.ClientID, user.Username, data.Scope)
	newRT, err := h.TokenService.SaveRefreshToken(c.Request.Context(), data.UserID, client.ClientID, data.Scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	h.LogRepo.RecordLogin(&uid, user.Username, c.ClientIP(), c.GetHeader("User-Agent"), "refresh_token", "success", "client="+client.ClientID)

	resp := gin.H{
		"access_token":  accessToken,
		"token_type":    "Bearer",
		"expires_in":    int(h.TokenService.AccessTTL().Seconds()),
		"refresh_token": newRT,
		"scope":         data.Scope,
	}
	if strings.Contains(data.Scope, "openid") {
		info := userToInfo(user)
		idToken, err := h.TokenService.IssueIDToken(data.UserID, client.ClientID, "", time.Now(), info)
		if err == nil {
			resp["id_token"] = idToken
		}
	}
	c.JSON(http.StatusOK, resp)
}

// UserInfo 用户信息端点
func (h *OAuthHandler) UserInfo(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}
	tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
	claims, err := h.TokenService.ValidateAccessToken(tokenStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token", "error_description": err.Error()})
		return
	}
	uid, err := uuid.Parse(claims.Subject)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}
	resp := gin.H{"sub": user.ID.String()}
	scopes := strings.Fields(claims.Scope)
	for _, s := range scopes {
		switch s {
		case "profile":
			resp["name"] = user.Nickname
			if resp["name"] == "" {
				resp["name"] = user.Username
			}
			resp["preferred_username"] = user.Username
			resp["picture"] = user.Avatar
		case "email":
			if user.Email != nil {
				resp["email"] = *user.Email
				resp["email_verified"] = true
			}
		case "phone":
			if user.Phone != nil {
				resp["phone_number"] = *user.Phone
			}
		case "roles":
			roles := []string{}
			for _, r := range user.Roles {
				roles = append(roles, r.Code)
			}
			resp["roles"] = roles
			resp["is_staff"] = user.IsStaff
		}
	}
	c.JSON(http.StatusOK, resp)
}

// Discovery OIDC 发现端点
func (h *OAuthHandler) Discovery(c *gin.Context) {
	c.Header("Cache-Control", "max-age=86400")
	c.Header("Access-Control-Allow-Origin", "*")
	c.JSON(http.StatusOK, gin.H{
		"issuer":                                h.Issuer,
		"authorization_endpoint":                h.Issuer + "/oauth/authorize",
		"token_endpoint":                        h.Issuer + "/oauth/token",
		"userinfo_endpoint":                     h.Issuer + "/oauth/userinfo",
		"jwks_uri":                              h.Issuer + "/oauth/jwks.json",
		"end_session_endpoint":                  h.Issuer + "/oauth/end_session",
		"revocation_endpoint":                   h.Issuer + "/oauth/revoke",
		"scopes_supported":                      []string{"openid", "profile", "email", "phone", "roles"},
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"},
		"claims_supported": []string{
			"sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "acr", "amr",
			"name", "preferred_username", "email", "email_verified", "phone_number", "roles", "is_staff",
		},
		"code_challenge_methods_supported": []string{"S256"},
	})
}

// JWKS 公钥端点
func (h *OAuthHandler) JWKS(c *gin.Context) {
	c.Header("Cache-Control", "max-age=86400")
	c.Header("Access-Control-Allow-Origin", "*")
	pub := h.KeyManager.PublicKey()
	c.JSON(http.StatusOK, gin.H{
		"keys": []gin.H{{
			"kty": "RSA",
			"use": "sig",
			"alg": "RS256",
			"kid": h.KeyManager.KID(),
			"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
		}},
	})
}

// Revoke 撤销端点
func (h *OAuthHandler) Revoke(c *gin.Context) {
	token := c.PostForm("token")
	if token == "" {
		c.Status(http.StatusOK)
		return
	}
	// 不透明 refresh token 直接删除映射
	_ = h.Store.Del(c.Request.Context(), "refresh:"+token)
	// JWT access token 按 jti 加入黑名单（ValidateAccessToken 会检查）
	if claims, err := h.TokenService.ValidateAccessToken(token); err == nil && claims.ID != "" {
		_ = h.TokenService.RevokeJTI(c.Request.Context(), claims.ID)
	}
	c.Status(http.StatusOK)
}

// EndSession 登出端点
func (h *OAuthHandler) EndSession(c *gin.Context) {
	sd := h.currentSession(c)
	if sd != nil {
		_ = h.SessionMgr.Delete(c.Request.Context(), sd.SessionID)
	}
	h.clearSession(c)
	postLogout := c.Query("post_logout_redirect_uri")
	if postLogout == "" {
		postLogout = h.FrontendBase + "/oauth/login"
	}
	c.Redirect(http.StatusFound, postLogout)
}

// --- helpers -----------------------------------

func verifyPKCE(verifier, challenge, method string) bool {
	if method != "S256" {
		return false
	}
	h := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(h[:])
	return computed == challenge
}

func userToInfo(user *model.User) *oauth.UserInfo {
	info := &oauth.UserInfo{IsStaff: user.IsStaff}
	if user.Nickname != "" {
		info.Name = user.Nickname
	} else {
		info.Name = user.Username
	}
	if user.Email != nil {
		info.Email = *user.Email
	}
	if user.Phone != nil {
		info.Phone = *user.Phone
	}
	for _, r := range user.Roles {
		info.Roles = append(info.Roles, r.Code)
	}
	return info
}
