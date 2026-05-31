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
	AppGrantRepo  *repository.AppGrantRepository
	LogRepo       *repository.LogRepository
	ConfigRepo    *repository.ConfigRepository
	SessionMgr    *session.Manager
	Issuer        string // 兜底 issuer（config.yaml 配置）
	FrontendBase  string
}

// effectiveIssuer 返回有效 issuer：SystemConfig.platform.site_url 优先，否则用配置文件兜底
func (h *OAuthHandler) effectiveIssuer() string {
	if h.ConfigRepo != nil {
		if v := h.ConfigRepo.SiteURL(); v != "" {
			return v
		}
	}
	return h.Issuer
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
		loginURL := h.FrontendBase + "/?" + url.Values{
			"return_to": []string{c.Request.URL.RequestURI()},
		}.Encode()
		c.Redirect(http.StatusFound, loginURL)
		return
	}

	userID := uuid.MustParse(sd.UserID)

	// 应用访问授权门：grant_mode=public 直接放行；其他模式查 sso_app_grant 表
	if h.AppGrantRepo != nil && !client.IsBuiltin && client.GrantMode != "" && client.GrantMode != "public" {
		allowed, _ := h.AppGrantRepo.UserAllowed(clientID, userID)
		if !allowed {
			errorRedirect(c, redirectURI, "access_denied", "您没有权限访问该应用", state)
			return
		}
	}

	// require_consent=false：不弹同意页（内置应用或客户端自助声明跳过）；
	// require_consent=true：每次都弹，除非本次已 consent=1 回投。
	autoGrant := client.IsBuiltin || !client.RequireConsent || h.GrantRepo.Has(userID, clientID, scope)
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

	sub := resolveSubject(user, client.SubjectType)
	accessTTL := time.Duration(client.AccessTokenTTL) * time.Second
	idTTL := time.Duration(client.IDTokenTTL) * time.Second
	refreshTTL := time.Duration(client.RefreshTokenTTL) * time.Second
	accessToken, err := h.TokenService.IssueAccessToken(sub, authCode.UserID, client.ClientID, user.Username, authCode.Scope, accessTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	// 应用通过 OAuth code 换 token —— 属于"应用访问"，记 access_log
	h.LogRepo.RecordAccess(&uid, user.Username, client.ClientID, client.ClientName, c.ClientIP())

	expiresIn := client.AccessTokenTTL
	if expiresIn <= 0 {
		expiresIn = int(h.TokenService.AccessTTL().Seconds())
	}
	resp := gin.H{
		"access_token": accessToken,
		"token_type":   "Bearer",
		"expires_in":   expiresIn,
		"scope":        authCode.Scope,
	}
	if client.IssueRefreshToken {
		refreshToken, err := h.TokenService.SaveRefreshToken(c.Request.Context(), authCode.UserID, client.ClientID, authCode.Scope, refreshTTL)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
			return
		}
		resp["refresh_token"] = refreshToken
	}
	if strings.Contains(authCode.Scope, "openid") {
		info := userToInfo(user)
		idToken, err := h.TokenService.IssueIDToken(sub, authCode.UserID, client.ClientID, authCode.Nonce, time.Unix(authCode.AuthTime, 0), info, idTTL, buildIDTokenOptions(client))
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

	sub := resolveSubject(user, client.SubjectType)
	accessTTL := time.Duration(client.AccessTokenTTL) * time.Second
	idTTL := time.Duration(client.IDTokenTTL) * time.Second
	refreshTTL := time.Duration(client.RefreshTokenTTL) * time.Second
	accessToken, _ := h.TokenService.IssueAccessToken(sub, data.UserID, client.ClientID, user.Username, data.Scope, accessTTL)
	newRT, err := h.TokenService.SaveRefreshToken(c.Request.Context(), data.UserID, client.ClientID, data.Scope, refreshTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	// 应用方 refresh_token —— 同样属于"应用访问"
	h.LogRepo.RecordAccess(&uid, user.Username, client.ClientID, client.ClientName, c.ClientIP())

	expiresIn := client.AccessTokenTTL
	if expiresIn <= 0 {
		expiresIn = int(h.TokenService.AccessTTL().Seconds())
	}
	resp := gin.H{
		"access_token":  accessToken,
		"token_type":    "Bearer",
		"expires_in":    expiresIn,
		"refresh_token": newRT,
		"scope":         data.Scope,
	}
	if strings.Contains(data.Scope, "openid") {
		info := userToInfo(user)
		idToken, err := h.TokenService.IssueIDToken(sub, data.UserID, client.ClientID, "", time.Now(), info, idTTL, buildIDTokenOptions(client))
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
	// 优先使用 UID（永远是 UUID）；兼容旧 token 时回退 Subject
	uidStr := claims.UID
	if uidStr == "" {
		uidStr = claims.Subject
	}
	uid, err := uuid.Parse(uidStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_token"})
		return
	}

	// 找到对应客户端，决定响应格式 / claims 白名单
	var client *model.OAuth2Client
	if claims.ClientID != "" {
		client, _ = h.ClientService.GetByClientID(claims.ClientID)
	}
	allow := map[string]bool{}
	hasWhitelist := false
	if client != nil && len(client.OIDCClaims) > 0 {
		hasWhitelist = true
		for _, k := range client.OIDCClaims {
			allow[k] = true
		}
	}
	pick := func(key string) bool { return !hasWhitelist || allow[key] }

	// sub claim 按 client.SubjectType 选择（与 access/id_token 一致）
	subType := ""
	if client != nil {
		subType = client.SubjectType
	}
	resp := gin.H{"sub": resolveSubject(user, subType)}

	scopes := strings.Fields(claims.Scope)
	for _, s := range scopes {
		switch s {
		case "profile":
			if pick("name") {
				if user.Nickname != "" {
					resp["name"] = user.Nickname
				} else {
					resp["name"] = user.Username
				}
			}
			resp["preferred_username"] = user.Username
			if user.Avatar != "" {
				resp["picture"] = user.Avatar
			}
		case "email":
			if pick("email") && user.Email != nil {
				resp["email"] = *user.Email
				resp["email_verified"] = true
			}
		case "phone":
			if pick("phone") && user.Phone != nil {
				resp["phone_number"] = *user.Phone
			}
		case "roles":
			if pick("roles") {
				roles := []string{}
				for _, r := range user.Roles {
					roles = append(roles, r.Code)
				}
				resp["roles"] = roles
			}
			if pick("is_staff") {
				resp["is_staff"] = user.IsStaff
			}
		}
	}

	// 按 client.OIDCUserInfoResponse 决定输出格式
	format := "NORMAL"
	if client != nil && client.OIDCUserInfoResponse != "" {
		format = client.OIDCUserInfoResponse
	}
	switch format {
	case "SIGNING", "ENCRYPTION", "SIGNING_ENCRYPTION":
		// 这三种都用 JWT 输出。ENCRYPTION/SIGNING_ENCRYPTION 暂未实现 JWE，
		// 安全降级为 SIGNING（带 Warning 头），不阻塞接入。
		issuer := h.effectiveIssuer()
		aud := claims.ClientID
		if client != nil {
			if client.OIDCIssuer != "" {
				issuer = client.OIDCIssuer
			}
			if client.OIDCAudience != "" {
				aud = client.OIDCAudience
			}
		}
		alg := ""
		if client != nil {
			alg = client.OIDCIDTokenSigningAlg
		}
		jwtStr, err := h.TokenService.IssueUserInfoJWT(resp, issuer, aud, alg, h.TokenService.AccessTTL())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
			return
		}
		if format != "SIGNING" {
			c.Header("Warning", `199 - "encryption_not_implemented: falling back to SIGNING"`)
		}
		c.Header("Content-Type", "application/jwt")
		c.String(http.StatusOK, jwtStr)
	default:
		c.JSON(http.StatusOK, resp)
	}
}

// Discovery OIDC 发现端点 —— 改 site_url 后要快速生效，故只缓存 5 分钟
func (h *OAuthHandler) Discovery(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=300")
	c.Header("Access-Control-Allow-Origin", "*")
	iss := h.effectiveIssuer()
	c.JSON(http.StatusOK, gin.H{
		"issuer":                                iss,
		"authorization_endpoint":                iss + "/oauth/authorize",
		"token_endpoint":                        iss + "/oauth/token",
		"userinfo_endpoint":                     iss + "/oauth/userinfo",
		"jwks_uri":                              iss + "/oauth/jwks.json",
		"end_session_endpoint":                  iss + "/oauth/end_session",
		"revocation_endpoint":                   iss + "/oauth/revoke",
		"scopes_supported":                      []string{"openid", "profile", "email", "phone", "roles"},
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256", "RS384", "RS512"},
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
		postLogout = h.FrontendBase + "/"
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

// buildIDTokenOptions 从 client 字段构造 id_token 签发选项；空字段保持库默认。
func buildIDTokenOptions(client *model.OAuth2Client) *oauth.IDTokenOptions {
	return &oauth.IDTokenOptions{
		Issuer:      client.OIDCIssuer,
		Audience:    client.OIDCAudience,
		SigningAlg:  client.OIDCIDTokenSigningAlg,
		AllowClaims: []string(client.OIDCClaims),
	}
}

// resolveSubject 按客户端配置选择 JWT `sub` claim 用哪个用户字段；
// 若选项对应的用户字段为空，回退到稳定的 UUID，确保 sub 永不为空。
func resolveSubject(user *model.User, subjectType string) string {
	switch subjectType {
	case "user_id":
		return user.ID.String()
	case "email":
		if user.Email != nil && *user.Email != "" {
			return *user.Email
		}
		return user.ID.String()
	case "mobile":
		if user.Phone != nil && *user.Phone != "" {
			return *user.Phone
		}
		return user.ID.String()
	case "username":
		fallthrough
	default:
		return user.Username
	}
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
