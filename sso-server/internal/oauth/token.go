package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"sso-server/pkg/utils"
)

type TokenService struct {
	keyManager     *KeyManager
	store          Store
	issuer         string
	accessTTL      time.Duration
	refreshTTL     time.Duration
	issuerResolver func() string // 可选：优先返回的 issuer（用于 SystemConfig.platform.site_url）；返回空时回退 ts.issuer
}

type AccessTokenClaims struct {
	jwt.RegisteredClaims
	Scope    string `json:"scope,omitempty"`
	ClientID string `json:"client_id,omitempty"`
	Username string `json:"username,omitempty"`
	UID      string `json:"uid,omitempty"` // 永远为用户 UUID；与 `sub`（按客户端 subject_type 决定）分离
	Type     string `json:"typ,omitempty"`
}

type IDTokenClaims struct {
	jwt.RegisteredClaims
	Nonce    string   `json:"nonce,omitempty"`
	AuthTime int64    `json:"auth_time,omitempty"`
	Acr      string   `json:"acr,omitempty"`
	Amr      []string `json:"amr,omitempty"`
	Name     string   `json:"name,omitempty"`
	Email    string   `json:"email,omitempty"`
	Phone    string   `json:"phone_number,omitempty"`
	Roles    []string `json:"roles,omitempty"`
	IsStaff  bool     `json:"is_staff,omitempty"`
}

type UserInfo struct {
	Name    string
	Email   string
	Phone   string
	Roles   []string
	IsStaff bool
}

func NewTokenService(km *KeyManager, store Store, issuer string, accessTTL, refreshTTL time.Duration) *TokenService {
	return &TokenService{
		keyManager: km,
		store:      store,
		issuer:     issuer,
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
	}
}

const (
	revokedPrefix = "revoked:jti:"
	refreshPrefix = "refresh:"
)

// RefreshTokenData refresh token 的存储载荷
type RefreshTokenData struct {
	Token    string `json:"token"`
	UserID   string `json:"user_id"`
	ClientID string `json:"client_id"`
	Scope    string `json:"scope"`
}

// SaveRefreshToken 签发并持久化一个 refresh token，返回 token 串。
// ttl<=0 时回退到全局默认 refreshTTL。
func (ts *TokenService) SaveRefreshToken(ctx context.Context, userID, clientID, scope string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = ts.refreshTTL
	}
	token := ts.IssueOpaqueToken()
	data := RefreshTokenData{Token: token, UserID: userID, ClientID: clientID, Scope: scope}
	b, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	if err := ts.store.Set(ctx, refreshPrefix+token, b, ttl); err != nil {
		return "", err
	}
	return token, nil
}

// LoadRefreshToken 查询；同时不在此处删除（rotate 由调用方掌控顺序）
func (ts *TokenService) LoadRefreshToken(ctx context.Context, token string) (*RefreshTokenData, error) {
	b, err := ts.store.Get(ctx, refreshPrefix+token)
	if err != nil {
		return nil, err
	}
	var d RefreshTokenData
	if err := json.Unmarshal(b, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

// DeleteRefreshToken 撤销一个 refresh token
func (ts *TokenService) DeleteRefreshToken(ctx context.Context, token string) error {
	return ts.store.Del(ctx, refreshPrefix+token)
}

// RevokeJTI 撤销指定 jti 的 Access Token（黑名单 TTL 等于 Token 剩余有效期上界）
func (ts *TokenService) RevokeJTI(ctx context.Context, jti string) error {
	return ts.store.Set(ctx, revokedPrefix+jti, []byte("1"), ts.accessTTL)
}

// SetIssuerResolver 注入一个动态 issuer 解析器；resolver 返回非空字符串时优先采用。
func (ts *TokenService) SetIssuerResolver(fn func() string) { ts.issuerResolver = fn }

// Issuer 返回有效 issuer：优先 resolver，回退构造时的静态值
func (ts *TokenService) Issuer() string {
	if ts.issuerResolver != nil {
		if v := ts.issuerResolver(); v != "" {
			return v
		}
	}
	return ts.issuer
}
func (ts *TokenService) AccessTTL() time.Duration   { return ts.accessTTL }
func (ts *TokenService) RefreshTTL() time.Duration  { return ts.refreshTTL }
func (ts *TokenService) KeyManager() *KeyManager    { return ts.keyManager }

// IssueAccessToken 签发 access token。ttl<=0 时回退到全局默认 accessTTL。
func (ts *TokenService) IssueAccessToken(subject, userID, clientID, username, scope string, ttl time.Duration) (string, error) {
	if subject == "" {
		subject = userID
	}
	if ttl <= 0 {
		ttl = ts.accessTTL
	}
	now := time.Now()
	claims := AccessTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    ts.Issuer(),
			Subject:   subject,
			Audience:  jwt.ClaimStrings{clientID},
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
		Scope:    scope,
		ClientID: clientID,
		Username: username,
		UID:      userID,
		Type:     "access",
	}
	return ts.signJWT(claims, jwt.SigningMethodRS256)
}

// IDTokenOptions 控制 id_token 签发的 client 级行为
type IDTokenOptions struct {
	Issuer       string   // 空则用全局 issuer
	Audience     string   // 空则用 clientID
	SigningAlg   string   // 空 / RS256 / RS384 / RS512
	AllowClaims  []string // 空 = 全部下发；否则按白名单过滤
}

func pickRSAlg(alg string) jwt.SigningMethod {
	switch alg {
	case "RS384":
		return jwt.SigningMethodRS384
	case "RS512":
		return jwt.SigningMethodRS512
	default:
		return jwt.SigningMethodRS256
	}
}

// signJWT 用统一 helper 加 kid 头并签名
func (ts *TokenService) signJWT(claims jwt.Claims, method jwt.SigningMethod) (string, error) {
	tok := jwt.NewWithClaims(method, claims)
	tok.Header["kid"] = ts.keyManager.KID()
	return tok.SignedString(ts.keyManager.PrivateKey())
}

// IssueUserInfoJWT 把任意 claims map 打包成签名 JWT 返回（用于 /userinfo 的 SIGNING 响应格式）
func (ts *TokenService) IssueUserInfoJWT(claims map[string]any, issuer, audience, alg string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = ts.accessTTL
	}
	if issuer == "" {
		issuer = ts.Issuer()
	}
	now := time.Now()
	mc := jwt.MapClaims{}
	for k, v := range claims {
		mc[k] = v
	}
	mc["iss"] = issuer
	if audience != "" {
		mc["aud"] = audience
	}
	mc["iat"] = now.Unix()
	mc["exp"] = now.Add(ttl).Unix()
	mc["jti"] = uuid.New().String()
	return ts.signJWT(mc, pickRSAlg(alg))
}

// IssueIDToken 签发 id token。ttl<=0 时回退到全局默认 accessTTL；opt 可按 client 覆盖 iss/aud/alg 与 claims 白名单。
func (ts *TokenService) IssueIDToken(subject, userID, clientID, nonce string, authTime time.Time, info *UserInfo, ttl time.Duration, opt *IDTokenOptions) (string, error) {
	if subject == "" {
		subject = userID
	}
	if ttl <= 0 {
		ttl = ts.accessTTL
	}
	now := time.Now()
	issuer := ts.Issuer()
	aud := clientID
	var method jwt.SigningMethod = jwt.SigningMethodRS256
	var allow map[string]bool
	if opt != nil {
		if opt.Issuer != "" {
			issuer = opt.Issuer
		}
		if opt.Audience != "" {
			aud = opt.Audience
		}
		method = pickRSAlg(opt.SigningAlg)
		if len(opt.AllowClaims) > 0 {
			allow = map[string]bool{}
			for _, c := range opt.AllowClaims {
				allow[c] = true
			}
		}
	}

	claims := IDTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    issuer,
			Subject:   subject,
			Audience:  jwt.ClaimStrings{aud},
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
		Nonce:    nonce,
		AuthTime: authTime.Unix(),
		Acr:      "0",
		Amr:      []string{"pwd"},
	}
	if info != nil {
		// allow==nil 表示全发；非空则按白名单
		pick := func(key string) bool { return allow == nil || allow[key] }
		if pick("name") {
			claims.Name = info.Name
		}
		if pick("email") {
			claims.Email = info.Email
		}
		if pick("phone") {
			claims.Phone = info.Phone
		}
		if pick("roles") {
			claims.Roles = info.Roles
		}
		if pick("is_staff") {
			claims.IsStaff = info.IsStaff
		}
	}
	return ts.signJWT(claims, method)
}

func (ts *TokenService) IssueOpaqueToken() string {
	return utils.RandomString(64)
}

func (ts *TokenService) ValidateAccessToken(tokenStr string) (*AccessTokenClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &AccessTokenClaims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return ts.keyManager.PublicKey(), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*AccessTokenClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}
	if claims.ID != "" && ts.store != nil {
		if _, err := ts.store.Get(context.Background(), revokedPrefix+claims.ID); err == nil {
			return nil, fmt.Errorf("token revoked")
		}
	}
	return claims, nil
}
