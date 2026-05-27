package model

// AppStatus 应用监控状态。仅用于 sso_app_monitor.current_status
// 与 sso_app_status_probe.status / sso_app_status_daily.worst_status 字段。
const (
	StatusUp          = "up"
	StatusDegraded    = "degraded"
	StatusDown        = "down"
	StatusMaintenance = "maintenance"
	StatusNoData      = "no_data"
)

// ClientType 应用类型
const (
	ClientTypeConfidential = "confidential"
	ClientTypePublic       = "public"
)
