package model

import (
	"time"

	"github.com/google/uuid"
)

type LoginLog struct {
	ID        uint64     `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID    *uuid.UUID `gorm:"type:char(36)" json:"user_id"`
	Username  string     `gorm:"size:150;not null;index" json:"username"`
	IPAddress string     `gorm:"size:45;not null" json:"ip_address"`
	Location  string     `gorm:"size:255" json:"location"`
	UserAgent string     `gorm:"size:512" json:"user_agent"`
	Browser   string     `gorm:"size:50" json:"browser"`
	OS        string     `gorm:"size:50" json:"os"`
	Method    string     `gorm:"size:30;index" json:"method"` // password / oauth_code / refresh_token / ...
	Status    string     `gorm:"size:20;not null;index" json:"status"`
	Message   string     `gorm:"size:255" json:"message"`
	CreatedAt time.Time  `gorm:"index" json:"created_at"`
}

func (LoginLog) TableName() string { return "sso_login_log" }

type OperationLog struct {
	ID           uint64     `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID       *uuid.UUID `gorm:"type:char(36)" json:"user_id"`
	Username     string     `gorm:"size:150" json:"username"`
	Action       string     `gorm:"size:50;not null" json:"action"`
	ResourceType string     `gorm:"size:50" json:"resource_type"`
	ResourceID   string     `gorm:"size:128" json:"resource_id"`
	Description  string     `gorm:"size:512" json:"description"`
	IPAddress    string     `gorm:"size:45" json:"ip_address"`
	Status       int        `gorm:"default:200" json:"status"`
	CreatedAt    time.Time  `gorm:"index" json:"created_at"`
}

func (OperationLog) TableName() string { return "sso_operation_log" }

type AccessLog struct {
	ID         uint64     `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID     *uuid.UUID `gorm:"type:char(36)" json:"user_id"`
	Username   string     `gorm:"size:150" json:"username"`
	ClientID   string     `gorm:"size:128" json:"client_id"`
	ClientName string     `gorm:"size:255" json:"client_name"`
	IPAddress  string     `gorm:"size:45" json:"ip_address"`
	CreatedAt  time.Time  `gorm:"index" json:"created_at"`
}

func (AccessLog) TableName() string { return "sso_access_log" }
