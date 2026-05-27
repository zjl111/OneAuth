package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AppMonitor struct {
	ID              uuid.UUID  `gorm:"type:char(36);primaryKey" json:"id"`
	ClientID        string     `gorm:"size:128;uniqueIndex;not null" json:"client_id"`
	Enabled         bool       `gorm:"default:true" json:"enabled"`
	HealthCheckURL  string     `gorm:"size:512" json:"health_check_url"`
	TimeoutMs       int        `gorm:"default:10000" json:"timeout_ms"`
	DegradedMs      int        `gorm:"default:2000" json:"degraded_ms"`
	Maintenance     bool       `gorm:"default:false" json:"maintenance"`
	MaintenanceNote string     `gorm:"size:500" json:"maintenance_note"`
	CurrentStatus   string     `gorm:"size:20;default:'no_data'" json:"current_status"`
	LastProbedAt    *time.Time `json:"last_probed_at"`
	LastResponseMs  int        `gorm:"default:0" json:"last_response_ms"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (AppMonitor) TableName() string { return "sso_app_monitor" }

func (m *AppMonitor) BeforeCreate(tx *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	return nil
}

type StatusProbe struct {
	ID           uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	ClientID     string    `gorm:"size:128;not null;index:idx_probe_client_time,priority:1" json:"client_id"`
	Status       string    `gorm:"size:20;not null" json:"status"`
	ResponseMs   int       `json:"response_ms"`
	HTTPCode     int       `json:"http_code"`
	ErrorMessage string    `gorm:"size:500" json:"error_message"`
	ProbedAt     time.Time `gorm:"not null;index:idx_probe_client_time,priority:2" json:"probed_at"`
}

func (StatusProbe) TableName() string { return "sso_app_status_probe" }

type StatusDaily struct {
	ID            uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	ClientID      string    `gorm:"size:128;not null;uniqueIndex:idx_daily_client_date,priority:1" json:"client_id"`
	Date          time.Time `gorm:"type:date;not null;uniqueIndex:idx_daily_client_date,priority:2" json:"date"`
	TotalProbes   int       `gorm:"default:0" json:"total_probes"`
	SuccessProbes int       `gorm:"default:0" json:"success_probes"`
	AvgResponseMs int       `json:"avg_response_ms"`
	MaxResponseMs int       `json:"max_response_ms"`
	WorstStatus   string    `gorm:"size:20;default:'up'" json:"worst_status"`
}

func (StatusDaily) TableName() string { return "sso_app_status_daily" }

type Incident struct {
	ID         uint64     `gorm:"primaryKey;autoIncrement" json:"id"`
	ClientID   string     `gorm:"size:128;not null;index" json:"client_id"`
	Status     string     `gorm:"size:20;not null" json:"status"` // ongoing/resolved
	StartedAt  time.Time  `gorm:"not null;index" json:"started_at"`
	ResolvedAt *time.Time `json:"resolved_at"`
	DurationS  int        `json:"duration_s"`
	Cause      string     `gorm:"size:500" json:"cause"`
}

func (Incident) TableName() string { return "sso_app_incident" }
