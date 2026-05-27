package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SystemConfig struct {
	ID          uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Category    string    `gorm:"size:50;not null;uniqueIndex:idx_cat_key" json:"category"`
	Key         string    `gorm:"size:100;not null;uniqueIndex:idx_cat_key" json:"key"`
	Value       string    `gorm:"type:text" json:"value"`
	Description string    `gorm:"size:255" json:"description"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (SystemConfig) TableName() string { return "sso_system_config" }

func (s *SystemConfig) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}

type Dictionary struct {
	ID        uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Category  string    `gorm:"size:50;not null;index" json:"category"`
	Label     string    `gorm:"size:100;not null" json:"label"`
	Value     string    `gorm:"size:100;not null" json:"value"`
	SortOrder int       `gorm:"default:0" json:"sort_order"`
	IsActive  bool      `gorm:"default:true" json:"is_active"`
	CreatedAt time.Time `json:"created_at"`
}

func (Dictionary) TableName() string { return "sso_dictionary" }

func (d *Dictionary) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}

type IPAccess struct {
	ID        uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Type      string    `gorm:"size:10;not null" json:"type"` // black/white
	IP        string    `gorm:"size:64;not null" json:"ip"`   // CIDR or exact
	Note      string    `gorm:"size:255" json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

func (IPAccess) TableName() string { return "sso_ip_access" }

func (i *IPAccess) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
}
