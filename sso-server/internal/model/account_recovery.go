package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// AccountRecoveryRule 账号回收规则 — 每个第三方应用配置一组 Go 脚本
type AccountRecoveryRule struct {
	ID             string     `gorm:"type:char(36);primaryKey" json:"id"`
	AppID          string     `gorm:"type:char(36);not null;index" json:"app_id"`
	AppName        string     `gorm:"type:varchar(128)" json:"app_name"`
	Enabled        bool       `gorm:"default:true" json:"enabled"`
	LastExecutedAt *time.Time `gorm:"type:datetime" json:"last_executed_at"`

	// 能力 1：获取全量用户脚本
	// 返回 JSON 数组，格式见 StandardUserDTO
	FetchUsersEnabled bool   `gorm:"default:true" json:"fetch_users_enabled"`
	FetchUsersScript  string `gorm:"type:text" json:"fetch_users_script"`

	// 能力 2：禁用指定用户脚本
	// 通过环境变量接收: RECOVERY_USERNAME, RECOVERY_EMAIL, RECOVERY_USER_ID
	DisableUserEnabled bool   `gorm:"default:true" json:"disable_user_enabled"`
	DisableUserScript  string `gorm:"type:text" json:"disable_user_script"`

	// 能力 3：删除指定用户脚本
	// 通过环境变量接收: RECOVERY_USERNAME, RECOVERY_EMAIL, RECOVERY_USER_ID
	DeleteUserEnabled bool   `gorm:"default:true" json:"delete_user_enabled"`
	DeleteUserScript  string `gorm:"type:text" json:"delete_user_script"`

	// 通用配置
	TimeoutSeconds int `gorm:"default:30" json:"timeout_seconds"`
	RetryCount     int `gorm:"default:3" json:"retry_count"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (AccountRecoveryRule) TableName() string {
	return "sso_account_recovery_rules"
}

func (r *AccountRecoveryRule) BeforeCreate(tx *gorm.DB) error {
	r.ID = uuid.New().String()
	return nil
}

// StandardUserDTO 获取全量用户脚本的标准返回格式
// 脚本必须返回符合此格式的 JSON 数组
type StandardUserDTO struct {
	UserID      string `json:"user_id"`      // 第三方系统用户ID（用于删除等操作）
	Username    string `json:"username"`     // 用户名（用于匹配SSO用户）
	DisplayName string `json:"display_name"` // 显示名称
	Email       string `json:"email"`        // 邮箱
	Status      string `json:"status"`       // 状态: active, locked, disabled, deleted
}

// ScriptResult 禁用/删除脚本的标准返回格式
type ScriptResult struct {
	Success bool   `json:"success"` // 是否成功
	Message string `json:"message"` // 结果消息
}

// AccountReconciliation 账号对账结果 — SSO 与第三方系统的交叉对比快照
type AccountReconciliation struct {
	ID                    string    `gorm:"type:char(36);primaryKey" json:"id"`
	RuleID                string    `gorm:"type:char(36);not null;index" json:"rule_id"`
	AppID                 string    `gorm:"type:char(36);not null;index" json:"app_id"`
	AppName               string    `gorm:"type:varchar(128)" json:"app_name"`
	Username              string    `gorm:"type:varchar(128);index" json:"username"`
	DisplayName           string    `gorm:"type:varchar(128)" json:"display_name"`
	Email                 string    `gorm:"type:varchar(256)" json:"email"`
	SSOStatus             string    `gorm:"type:varchar(32)" json:"sso_status"`               // active, locked, deleted
	ThirdPartyUserID      string    `gorm:"type:varchar(128)" json:"third_party_user_id"`     // 第三方系统用户ID
	ThirdPartyStatus      string    `gorm:"type:varchar(32)" json:"third_party_status"`       // active, locked, disabled, deleted, not_found
	ThirdPartyDisplayName string    `gorm:"type:varchar(128)" json:"third_party_display_name"` // 第三方系统的显示名称
	ThirdPartyEmail       string    `gorm:"type:varchar(256)" json:"third_party_email"`        // 第三方系统的邮箱
	AttributeMismatch     string    `gorm:"type:varchar(256)" json:"attribute_mismatch"`       // 不一致的属性，如 "display_name,email"
	ReconcileResult       string    `gorm:"type:varchar(32);index" json:"reconcile_result"`    // consistent, orphan, missing
	LastSyncedAt          time.Time `gorm:"type:datetime" json:"last_synced_at"`
	CreatedAt             time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (AccountReconciliation) TableName() string {
	return "sso_account_reconciliation"
}

func (r *AccountReconciliation) BeforeCreate(tx *gorm.DB) error {
	r.ID = uuid.New().String()
	return nil
}

// AccountRecoveryLog 账号回收执行日志
type AccountRecoveryLog struct {
	ID            string    `gorm:"type:char(36);primaryKey" json:"id"`
	RuleID        string    `gorm:"type:char(36);not null;index" json:"rule_id"`
	RuleName      string    `gorm:"type:varchar(128)" json:"rule_name"`
	AppName       string    `gorm:"type:varchar(128)" json:"app_name"`
	Username         string    `gorm:"type:varchar(128)" json:"username"`
	UserEmail        string    `gorm:"type:varchar(128)" json:"user_email"`
	ThirdPartyUserID string    `gorm:"type:varchar(128)" json:"third_party_user_id"`
	EventType        string    `gorm:"type:varchar(32)" json:"event_type"` // fetch, disable, delete, reconcile, test
	Status        string    `gorm:"type:varchar(32);not null" json:"status"` // success, failed, pending, retrying
	Stdout        string    `gorm:"type:text" json:"stdout"`
	Stderr        string    `gorm:"type:text" json:"stderr"`
	ErrorMessage  string    `gorm:"type:text" json:"error_message"`
	RetryCount    int       `gorm:"default:0" json:"retry_count"`
	ExecutionTime int       `gorm:"default:0" json:"execution_time"` // milliseconds
	TriggeredBy   string    `gorm:"type:varchar(128)" json:"triggered_by"`
	CreatedAt     time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (AccountRecoveryLog) TableName() string {
	return "sso_account_recovery_logs"
}

func (l *AccountRecoveryLog) BeforeCreate(tx *gorm.DB) error {
	l.ID = uuid.New().String()
	return nil
}
