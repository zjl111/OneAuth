package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID           uuid.UUID      `gorm:"type:char(36);primaryKey" json:"id"`
	Username     string         `gorm:"size:150;uniqueIndex;not null" json:"username"`
	Nickname     string         `gorm:"size:150" json:"nickname"`
	Email        *string        `gorm:"size:254;uniqueIndex" json:"email"`
	Phone        *string        `gorm:"size:20;uniqueIndex" json:"phone"`
	PasswordHash string         `gorm:"size:256;not null" json:"-"`
	Avatar       string         `gorm:"size:512" json:"avatar"`
	Position     string         `gorm:"size:150" json:"position"`
	DepartmentID *uuid.UUID     `gorm:"type:char(36);index" json:"department_id"`
	IsActive     bool           `gorm:"default:true" json:"is_active"`
	IsStaff      bool           `gorm:"default:false" json:"is_staff"`
	IsLocked     bool           `gorm:"default:false" json:"is_locked"`
	LastLogin    *time.Time     `json:"last_login"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`

	Department *Department `gorm:"foreignKey:DepartmentID" json:"department,omitempty"`
	Roles      []Role      `gorm:"many2many:sso_user_roles;" json:"roles,omitempty"`
}

func (User) TableName() string { return "sso_user" }

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}

type Department struct {
	ID          uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	Name        string     `gorm:"size:255;not null" json:"name"`
	ParentID    *uuid.UUID `gorm:"type:char(36);index" json:"parent_id"`
	SortOrder   int        `gorm:"default:0" json:"sort_order"`
	LeaderID    *uuid.UUID `gorm:"type:char(36)" json:"leader_id"`
	Description string     `gorm:"type:text" json:"description"`
	CreatedAt   time.Time  `json:"created_at"`

	Children []*Department `gorm:"-" json:"children,omitempty"`
}

func (Department) TableName() string { return "sso_department" }

func (d *Department) BeforeCreate(tx *gorm.DB) error {
	if d.ID == uuid.Nil {
		d.ID = uuid.New()
	}
	return nil
}

type UserGroup struct {
	ID          uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	Description string    `gorm:"type:text" json:"description"`
	CreatedAt   time.Time `json:"created_at"`

	Members []User `gorm:"many2many:sso_user_group_members;" json:"members,omitempty"`
}

func (UserGroup) TableName() string { return "sso_user_group" }

func (g *UserGroup) BeforeCreate(tx *gorm.DB) error {
	if g.ID == uuid.Nil {
		g.ID = uuid.New()
	}
	return nil
}
