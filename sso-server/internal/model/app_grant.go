package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AppGrant 应用授权：谁（用户/角色/用户组）能访问哪个 OAuth 应用。
// 没有任何 AppGrant 记录的应用 = 所有人可见（向后兼容现状）；
// 一旦应用有了 grant 记录，仅命中的 principal 能访问。
type AppGrant struct {
	ID           uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	ClientID     string    `gorm:"size:128;not null;index" json:"client_id"`     // OAuth2Client.client_id
	PrincipalType string   `gorm:"size:20;not null;index" json:"principal_type"` // user | role | group
	PrincipalID   uuid.UUID `gorm:"type:char(36);not null;index" json:"principal_id"`
	CreatedAt    time.Time `json:"created_at"`
}

func (AppGrant) TableName() string { return "sso_app_grant" }

func (g *AppGrant) BeforeCreate(tx *gorm.DB) error {
	if g.ID == uuid.Nil {
		g.ID = uuid.New()
	}
	return nil
}
