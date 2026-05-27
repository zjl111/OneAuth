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
	Description      string      `gorm:"type:text" json:"description"`
	RedirectURIs     StringSlice `gorm:"type:text;not null" json:"redirect_uris"`
	GrantTypes       StringSlice `gorm:"type:text;not null" json:"grant_types"`
	ResponseTypes    StringSlice `gorm:"type:text;not null" json:"response_types"`
	Scope            string      `gorm:"size:512;default:'openid profile email'" json:"scope"`
	LogoURL          string      `gorm:"size:512" json:"logo_url"`
	HomeURL          string      `gorm:"size:512" json:"home_url"`
	IsActive         bool        `gorm:"default:true" json:"is_active"`
	IsBuiltin        bool        `gorm:"default:false" json:"is_builtin"`
	HealthCheckURL   string      `gorm:"size:512" json:"health_check_url"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
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
