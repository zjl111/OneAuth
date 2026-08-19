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

// DirectorySyncBuffer 同步缓冲表：每次执行同步（手动「同步用户」或凌晨定时任务）时，
// 把远端拉取的通讯录快照写入此表，供「用户导入」弹窗直接读取展示，避免每次打开都重新拉取远端。
// raw 字段保存远端原始 JSON，导入/落库时再解析还原，确保与真实同步逻辑使用完全一致的数据。
type DirectorySyncBuffer struct {
	ID         uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Provider   string    `gorm:"size:50;not null;index:idx_buf_provider" json:"provider"`
	ExternalID string    `gorm:"size:255;not null;uniqueIndex:idx_buf_ext" json:"external_id"`
	Username   string    `gorm:"size:255" json:"username"`
	Name       string    `gorm:"size:255" json:"name"`
	Email      string    `gorm:"size:255" json:"email"`
	Department string    `gorm:"size:255" json:"department"`
	Groups     string    `gorm:"type:text" json:"groups"` // 用户所属远端部门路径 JSON 数组
	Status     string    `gorm:"size:20" json:"status"`    // "create" 新建 | "update" 更新
	Exists     bool      `gorm:"default:false" json:"exists"`
	// UsernameEdited/EmailEdited 记录用户手动编辑过的值（空=未编辑）。
	// 「同步用户」(pull) 重建缓冲时保留这两个字段，避免覆盖用户的手动编辑；
	// 导入时优先用这些编辑值落库。
	UsernameEdited string `gorm:"size:255" json:"-"`
	EmailEdited    string `gorm:"size:255" json:"-"`
	Raw            string    `gorm:"type:text" json:"-"` // 远端原始记录 JSON，落库时解析
	FetchedAt  time.Time `json:"fetched_at"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func (DirectorySyncBuffer) TableName() string { return "sso_directory_sync_buffer" }

func (b *DirectorySyncBuffer) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}
