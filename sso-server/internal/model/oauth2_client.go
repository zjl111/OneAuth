package model

import (
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type OAuth2Client struct {
	ID               uuid.UUID   `gorm:"type:char(36);primaryKey" json:"id"`
	ClientID         string      `gorm:"size:128;uniqueIndex;not null" json:"client_id"`
	ClientSecretHash string      `gorm:"size:256;not null" json:"-"`
	ClientName       string      `gorm:"size:255;not null" json:"client_name"`
	ClientType       string      `gorm:"size:20;not null;default:'confidential'" json:"client_type"`
	Protocol         string      `gorm:"size:20;not null;default:'oidc'" json:"protocol"` // oidc / oauth2 / saml / cas / link
	ProtocolVersion  string      `gorm:"size:40" json:"protocol_version"`                 // 协议版本，如 OpenID_Connect_v1.0 / OAuth_v2.0 / SAML_v2.0 / CAS_v3.0
	Description      string      `gorm:"type:text" json:"description"`

	// === 通用：基本信息 ===
	LogoURL        string `gorm:"size:512" json:"logo_url"`
	HomeURL        string `gorm:"size:512" json:"home_url"`
	LoginURL       string `gorm:"size:512" json:"login_url"`
	IsActive       bool   `gorm:"default:true" json:"is_active"`
	IsBuiltin      bool   `gorm:"default:false" json:"is_builtin"`
	HealthCheckURL string `gorm:"size:512" json:"health_check_url"`

	// === OAuth 2.0 / OIDC 协议配置 ===
	// link 协议不需要这些字段，故放宽为可空（旧库 not null 约束需配合 ALTER 处理）
	RedirectURIs    StringSlice `gorm:"type:text" json:"redirect_uris"`
	GrantTypes      StringSlice `gorm:"type:text" json:"grant_types"`
	ResponseTypes   StringSlice `gorm:"type:text" json:"response_types"`
	Scope           string      `gorm:"size:512;default:'openid profile email'" json:"scope"`
	SubjectType     string      `gorm:"size:30;default:'username'" json:"subject_type"` // username / user_id / email / mobile
	RequirePKCE     bool        `gorm:"default:false" json:"require_pkce"`
	RequireConsent  bool        `gorm:"default:false" json:"require_consent"` // true=强制 false=自动
	AccessTokenTTL    int  `gorm:"default:3600" json:"access_token_ttl"`
	RefreshTokenTTL   int  `gorm:"default:604800" json:"refresh_token_ttl"`
	IDTokenTTL        int  `gorm:"default:3600" json:"id_token_ttl"`
	// 默认 false（GORM 零值陷阱）；service 层会把缺省值显式置 true。
	IssueRefreshToken bool `json:"issue_refresh_token"`

	// === OIDC 额外字段（仅 protocol=oidc 生效） ===
	OIDCIssuer            string `gorm:"size:255" json:"oidc_issuer"`
	OIDCAudience          string `gorm:"size:255" json:"oidc_audience"`
	OIDCIDTokenSigningAlg string `gorm:"size:20" json:"oidc_id_token_signing_alg"` // RS256 / RS384 / RS512 / HS256 / HS384 / HS512
	OIDCUserInfoResponse  string `gorm:"size:30" json:"oidc_userinfo_response"`    // NORMAL / SIGNING / ENCRYPTION / SIGNING_ENCRYPTION
	// 决定 id_token / /userinfo 下发哪些用户字段；空数组表示全发
	OIDCClaims StringSlice `gorm:"type:text" json:"oidc_claims"`

	// === SAML 2.0 协议配置（仅 protocol=saml 生效） ===
	SAMLEntityID            string `gorm:"size:512" json:"saml_entity_id"`
	SAMLACSURL              string `gorm:"size:512" json:"saml_acs_url"`
	SAMLAudience            string `gorm:"size:512" json:"saml_audience"`
	SAMLIssuer              string `gorm:"size:512" json:"saml_issuer"`
	SAMLBinding             string `gorm:"size:30" json:"saml_binding"`         // Redirect-Post / Post-Post / IdpInit-Post
	SAMLNameIDFormat        string `gorm:"size:60" json:"saml_nameid_format"`   // unspecified / persistent / transient / emailAddress / ...
	SAMLNameIDConvert       string `gorm:"size:20" json:"saml_nameid_convert"`  // original / uppercase / lowercase
	SAMLSignatureAlgorithm  string `gorm:"size:30" json:"saml_signature_algorithm"`
	SAMLDigestAlgorithm     string `gorm:"size:30" json:"saml_digest_algorithm"`
	SAMLEncrypted           bool   `gorm:"default:false" json:"saml_encrypted"`
	SAMLValiditySeconds     int    `gorm:"default:300" json:"saml_validity_seconds"`
	SAMLCertificate         string `gorm:"type:text" json:"saml_certificate"` // PEM 证书内容

	// === CAS 协议配置（仅 protocol=cas 生效） ===
	CASService        string `gorm:"size:512" json:"cas_service"`
	CASCallbackURL    string `gorm:"size:512" json:"cas_callback_url"`
	CASUserAttribute  string `gorm:"size:30" json:"cas_user_attribute"` // username / user_id / email / mobile
	CASExpiresSeconds int    `gorm:"default:300" json:"cas_expires_seconds"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (OAuth2Client) TableName() string { return "sso_oauth2_client" }

func (c *OAuth2Client) BeforeCreate(tx *gorm.DB) error {
	if c.ID == uuid.Nil {
		c.ID = uuid.New()
	}
	return nil
}

func (c *OAuth2Client) CheckSecret(secret string) bool {
	return bcrypt.CompareHashAndPassword([]byte(c.ClientSecretHash), []byte(secret)) == nil
}

func (c *OAuth2Client) CheckRedirectURI(uri string) bool {
	for _, u := range c.RedirectURIs {
		if u == uri {
			return true
		}
	}
	return false
}

func (c *OAuth2Client) IsPublic() bool {
	return c.ClientType == "public"
}

type OAuth2Token struct {
	ID           uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	TokenType    string    `gorm:"size:40;default:'Bearer'" json:"token_type"`
	AccessToken  string    `gorm:"size:2048;uniqueIndex;not null" json:"-"`
	RefreshToken string    `gorm:"size:512;uniqueIndex" json:"-"`
	ClientID     string    `gorm:"size:128;index;not null" json:"client_id"`
	UserID       uuid.UUID `gorm:"type:char(36);index;not null" json:"user_id"`
	Scope        string    `gorm:"size:512" json:"scope"`
	IssuedAt     time.Time `json:"issued_at"`
	ExpiresAt    time.Time `gorm:"index" json:"expires_at"`
	Revoked      bool      `gorm:"default:false" json:"revoked"`
}

func (OAuth2Token) TableName() string { return "sso_oauth2_token" }

func (t *OAuth2Token) BeforeCreate(tx *gorm.DB) error {
	if t.ID == uuid.Nil {
		t.ID = uuid.New()
	}
	return nil
}

// AuthorizationGrant 记录已授权的应用（跳过同意页）
type AuthorizationGrant struct {
	ID        uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	UserID    uuid.UUID `gorm:"type:char(36);uniqueIndex:idx_user_client;not null" json:"user_id"`
	ClientID  string    `gorm:"size:128;uniqueIndex:idx_user_client;not null" json:"client_id"`
	Scope     string    `gorm:"size:512" json:"scope"`
	GrantedAt time.Time `json:"granted_at"`
}

func (AuthorizationGrant) TableName() string { return "sso_auth_grant" }

func (g *AuthorizationGrant) BeforeCreate(tx *gorm.DB) error {
	if g.ID == uuid.Nil {
		g.ID = uuid.New()
	}
	return nil
}
