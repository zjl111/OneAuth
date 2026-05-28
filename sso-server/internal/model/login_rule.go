package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LoginRule 用户登录控制规则。
//
// 评估语义：按 Priority 升序遍历所有 Enabled=true 的规则，匹配当前登录上下文
// (user, ip, weekday, hour) 时，规则的 Action 决定结果（accept / deny），并立即返回。
// 全部规则都不匹配 → 默认放行（accept）。
type LoginRule struct {
	ID        uuid.UUID `gorm:"type:char(36);primaryKey" json:"id"`
	Name      string    `gorm:"size:255;not null" json:"name"`
	Priority  int       `gorm:"default:50;index" json:"priority"` // 数字越小越优先
	Enabled   bool      `gorm:"default:true;index" json:"enabled"`

	// 用户范围 user_scope: all | specific
	// 当 specific 时 UserIDs 不能空
	UserScope string      `gorm:"size:20;default:'all'" json:"user_scope"`
	UserIDs   StringSlice `gorm:"type:text" json:"user_ids"` // 复用现成的 JSON 数组类型存 uuid 字符串

	// IP / CIDR 列表；包含 "*" 表示匹配所有
	IPs StringSlice `gorm:"type:text" json:"ips"`

	// 时段位图：7 天 × 24 小时 = 168 位；用 '0'/'1' 字符串存储；
	// 索引 = weekday*24 + hour，weekday 0=周一 … 6=周日；全 '0' 视为匹配所有时段
	TimeMask string `gorm:"size:200" json:"time_mask"`

	Action string `gorm:"size:20;not null;default:'deny'" json:"action"` // accept | deny

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (LoginRule) TableName() string { return "sso_login_rule" }

func (r *LoginRule) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}
