package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Role struct {
	ID          uuid.UUID    `gorm:"type:char(36);primaryKey" json:"id"`
	Name        string       `gorm:"size:100;not null" json:"name"`
	Code        string       `gorm:"size:100;uniqueIndex;not null" json:"code"`
	Description string       `gorm:"size:500" json:"description"`
	IsBuiltin   bool         `gorm:"default:false" json:"is_builtin"`
	CreatedAt   time.Time    `json:"created_at"`
	Permissions []Permission `gorm:"many2many:sso_role_permissions;" json:"permissions,omitempty"`
}

func (Role) TableName() string { return "sso_role" }

func (r *Role) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

type Permission struct {
	ID        uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	Name      string     `gorm:"size:100;not null" json:"name"`
	Code      string     `gorm:"size:100;uniqueIndex;not null" json:"code"`
	Type      string     `gorm:"size:20;not null" json:"type"` // menu/button/api
	ParentID  *uuid.UUID `gorm:"type:char(36);index" json:"parent_id"`
	Path      string     `gorm:"size:255" json:"path"`
	Method    string     `gorm:"size:10" json:"method"`
	SortOrder int        `gorm:"default:0" json:"sort_order"`
	Icon      string     `gorm:"size:100" json:"icon"`

	Children []*Permission `gorm:"-" json:"children,omitempty"`
}

func (Permission) TableName() string { return "sso_permission" }

func (p *Permission) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}
