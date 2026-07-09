package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type DirectorySyncBinding struct {
	ID           uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Provider     string    `gorm:"size:50;not null;uniqueIndex:idx_dir_binding" json:"provider"`
	ExternalType string    `gorm:"size:30;not null;uniqueIndex:idx_dir_binding" json:"external_type"`
	ExternalID   string    `gorm:"size:255;not null;uniqueIndex:idx_dir_binding" json:"external_id"`
	LocalID      uuid.UUID `gorm:"type:char(36);not null;index" json:"local_id"`
	RemotePath   string    `gorm:"size:1024" json:"remote_path"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (DirectorySyncBinding) TableName() string { return "sso_directory_sync_binding" }

func (b *DirectorySyncBinding) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}

type DirectorySyncLog struct {
	ID                 uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	Provider           string     `gorm:"size:50;not null;index" json:"provider"`
	Status             string     `gorm:"size:20;not null;index" json:"status"`
	DryRun             bool       `gorm:"default:false" json:"dry_run"`
	StartedAt          time.Time  `json:"started_at"`
	FinishedAt         *time.Time `json:"finished_at"`
	DepartmentCreated  int        `json:"department_created"`
	DepartmentMatched  int        `json:"department_matched"`
	UserCreated        int        `json:"user_created"`
	UserUpdated        int        `json:"user_updated"`
	UserDisabled       int        `json:"user_disabled"`
	UserSkipped        int        `json:"user_skipped"`
	Message            string     `gorm:"type:text" json:"message"`
	Details            string     `gorm:"type:text" json:"details"`
	CreatedAt          time.Time  `json:"created_at"`
}

func (DirectorySyncLog) TableName() string { return "sso_directory_sync_log" }

func (l *DirectorySyncLog) BeforeCreate(tx *gorm.DB) error {
	if l.ID == uuid.Nil {
		l.ID = uuid.New()
	}
	if l.StartedAt.IsZero() {
		l.StartedAt = time.Now()
	}
	return nil
}
