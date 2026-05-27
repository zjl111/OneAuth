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
	keyManager *KeyManager
	store      Store
	issuer     string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

type AccessTokenClaims struct {
	jwt.RegisteredClaims
	Scope    string `json:"scope,omitempty"`
	ClientID string `json:"client_id,omitempty"`
	Username string `json:"username,omitempty"`
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

// SaveRefreshToken 签发并持久化一个 refresh token，返回 token 串
func (ts *TokenService) SaveRefreshToken(ctx context.Context, userID, clientID, scope string) (string, error) {
	token := ts.IssueOpaqueToken()
	data := RefreshTokenData{Token: token, UserID: userID, ClientID: clientID, Scope: scope}
	b, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	if err := ts.store.Set(ctx, refreshPrefix+token, b, ts.refreshTTL); err != nil {
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

func (ts *TokenService) Issuer() string             { return ts.issuer }
func (ts *TokenService) AccessTTL() time.Duration   { return ts.accessTTL }
func (ts *TokenService) RefreshTTL() time.Duration  { return ts.refreshTTL }
func (ts *TokenService) KeyManager() *KeyManager    { return ts.keyManager }

func (ts *TokenService) IssueAccessToken(userID, clientID, username, scope string) (string, error) {
	now := time.Now()
	claims := AccessTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    ts.issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{clientID},
			ExpiresAt: jwt.NewNumericDate(now.Add(ts.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
		Scope:    scope,
		ClientID: clientID,
		Username: username,
		Type:     "access",
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = ts.keyManager.KID()
	return token.SignedString(ts.keyManager.PrivateKey())
}

func (ts *TokenService) IssueIDToken(userID, clientID, nonce string, authTime time.Time, info *UserInfo) (string, error) {
	now := time.Now()
	claims := IDTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    ts.issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{clientID},
			ExpiresAt: jwt.NewNumericDate(now.Add(ts.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(now),
			ID:        uuid.New().String(),
		},
		Nonce:    nonce,
		AuthTime: authTime.Unix(),
		Acr:      "0",
		Amr:      []string{"pwd"},
	}
	if info != nil {
		claims.Name = info.Name
		claims.Email = info.Email
		claims.Phone = info.Phone
		claims.Roles = info.Roles
		claims.IsStaff = info.IsStaff
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = ts.keyManager.KID()
	return token.SignedString(ts.keyManager.PrivateKey())
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
