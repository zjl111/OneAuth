package repository

import (
	"time"

	"gorm.io/gorm"

	"sso-server/internal/model"
)

type MonitorRepository struct{ db *gorm.DB }

func NewMonitorRepository(db *gorm.DB) *MonitorRepository { return &MonitorRepository{db: db} }

func (r *MonitorRepository) DB() *gorm.DB { return r.db }

func (r *MonitorRepository) Upsert(m *model.AppMonitor) error {
	var existing model.AppMonitor
	if err := r.db.Where("client_id = ?", m.ClientID).First(&existing).Error; err == gorm.ErrRecordNotFound {
		return r.db.Create(m).Error
	}
	existing.Enabled = m.Enabled
	existing.HealthCheckURL = m.HealthCheckURL
	if m.TimeoutMs > 0 {
		existing.TimeoutMs = m.TimeoutMs
	}
	if m.DegradedMs > 0 {
		existing.DegradedMs = m.DegradedMs
	}
	return r.db.Save(&existing).Error
}

// DeleteByClientID 在删除 OAuth2Client 时一起清理它的监控数据
func (r *MonitorRepository) DeleteByClientID(clientID string) error {
	tx := r.db.Begin()
	tx.Where("client_id = ?", clientID).Delete(&model.AppMonitor{})
	tx.Where("client_id = ?", clientID).Delete(&model.StatusProbe{})
	tx.Where("client_id = ?", clientID).Delete(&model.StatusDaily{})
	tx.Where("client_id = ?", clientID).Delete(&model.Incident{})
	return tx.Commit().Error
}

func (r *MonitorRepository) UpdateHealthURL(clientID, url string) error {
	return r.db.Model(&model.AppMonitor{}).
		Where("client_id = ?", clientID).
		Update("health_check_url", url).Error
}

func (r *MonitorRepository) Get(clientID string) (*model.AppMonitor, error) {
	var m model.AppMonitor
	if err := r.db.Where("client_id = ?", clientID).First(&m).Error; err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *MonitorRepository) ListEnabled() ([]model.AppMonitor, error) {
	var items []model.AppMonitor
	err := r.db.Where("enabled = ? AND maintenance = ?", true, false).Find(&items).Error
	return items, err
}

func (r *MonitorRepository) ListAll() ([]model.AppMonitor, error) {
	var items []model.AppMonitor
	err := r.db.Order("client_id").Find(&items).Error
	return items, err
}

func (r *MonitorRepository) SetMaintenance(clientID string, on bool, note string) error {
	return r.db.Model(&model.AppMonitor{}).
		Where("client_id = ?", clientID).
		Updates(map[string]interface{}{
			"maintenance":      on,
			"maintenance_note": note,
		}).Error
}

func (r *MonitorRepository) UpdateStatus(clientID, status string, responseMs int) error {
	now := time.Now()
	return r.db.Model(&model.AppMonitor{}).
		Where("client_id = ?", clientID).
		Updates(map[string]interface{}{
			"current_status":   status,
			"last_probed_at":   now,
			"last_response_ms": responseMs,
		}).Error
}

func (r *MonitorRepository) RecordProbe(p *model.StatusProbe) error {
	return r.db.Create(p).Error
}

func (r *MonitorRepository) UpsertDaily(clientID string, date time.Time, status string, responseMs int) error {
	day := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, time.UTC)
	var daily model.StatusDaily
	err := r.db.Where("client_id = ? AND date = ?", clientID, day).First(&daily).Error
	success := 0
	if status == model.StatusUp || status == model.StatusDegraded {
		success = 1
	}
	if err == gorm.ErrRecordNotFound {
		daily = model.StatusDaily{
			ClientID:      clientID,
			Date:          day,
			TotalProbes:   1,
			SuccessProbes: success,
			AvgResponseMs: responseMs,
			MaxResponseMs: responseMs,
			WorstStatus:   status,
		}
		return r.db.Create(&daily).Error
	}
	daily.TotalProbes++
	daily.SuccessProbes += success
	if daily.TotalProbes > 0 {
		daily.AvgResponseMs = (daily.AvgResponseMs*(daily.TotalProbes-1) + responseMs) / daily.TotalProbes
	}
	if responseMs > daily.MaxResponseMs {
		daily.MaxResponseMs = responseMs
	}
	if worseStatus(status, daily.WorstStatus) {
		daily.WorstStatus = status
	}
	return r.db.Save(&daily).Error
}

func worseStatus(a, b string) bool {
	rank := map[string]int{
		model.StatusUp:          0,
		model.StatusMaintenance: 1,
		model.StatusDegraded:    2,
		model.StatusDown:        3,
		model.StatusNoData:      -1,
	}
	return rank[a] > rank[b]
}

// DailyRecords 返回过去 days 天的记录，按日期升序，缺失天用 no_data 占位
func (r *MonitorRepository) DailyRecords(clientID string, days int) []model.StatusDaily {
	end := time.Now().Truncate(24 * time.Hour)
	start := end.AddDate(0, 0, -days+1)
	var rows []model.StatusDaily
	r.db.Where("client_id = ? AND date >= ? AND date <= ?", clientID, start, end).
		Order("date ASC").
		Find(&rows)
	byDate := make(map[string]model.StatusDaily)
	for _, r := range rows {
		byDate[r.Date.Format("2006-01-02")] = r
	}
	result := make([]model.StatusDaily, 0, days)
	for i := 0; i < days; i++ {
		d := start.AddDate(0, 0, i)
		key := d.Format("2006-01-02")
		if v, ok := byDate[key]; ok {
			result = append(result, v)
		} else {
			result = append(result, model.StatusDaily{
				ClientID:    clientID,
				Date:        d,
				WorstStatus: model.StatusNoData,
			})
		}
	}
	return result
}

// WindowMetrics 计算最近 window 时间窗口内的可用性和平均响应（单位：小时）
func (r *MonitorRepository) WindowMetrics(clientID string, hours int) (availability float64, avgRespMs int) {
	since := time.Now().Add(-time.Duration(hours) * time.Hour)
	type agg struct {
		Total int
		Up    int
		Avg   float64
	}
	var a agg
	r.db.Model(&model.StatusProbe{}).
		Where("client_id = ? AND probed_at >= ?", clientID, since).
		Select("COUNT(*) as total, SUM(CASE WHEN status IN ('up','degraded') THEN 1 ELSE 0 END) as up, AVG(response_ms) as avg").
		Scan(&a)
	if a.Total == 0 {
		return 100, 0
	}
	return float64(a.Up) / float64(a.Total) * 100, int(a.Avg)
}

// WindowMetricsBatch 一次性返回所有 client 在指定窗口内的聚合，避免 N+1。
type WindowAgg struct {
	ClientID string
	Total    int
	Up       int
	Avg      float64
}

func (r *MonitorRepository) WindowMetricsBatch(hours int) map[string]WindowAgg {
	since := time.Now().Add(-time.Duration(hours) * time.Hour)
	var rows []WindowAgg
	r.db.Model(&model.StatusProbe{}).
		Where("probed_at >= ?", since).
		Select(`client_id,
			COUNT(*) as total,
			SUM(CASE WHEN status IN ('up','degraded') THEN 1 ELSE 0 END) as up,
			AVG(response_ms) as avg`).
		Group("client_id").
		Scan(&rows)
	out := make(map[string]WindowAgg, len(rows))
	for _, r := range rows {
		out[r.ClientID] = r
	}
	return out
}

// DailyRecordsBatch 一次拉取所有 client 过去 days 天的聚合，按 client_id 分桶；调用方负责填补缺失日。
func (r *MonitorRepository) DailyRecordsBatch(days int) map[string][]model.StatusDaily {
	end := time.Now().Truncate(24 * time.Hour)
	start := end.AddDate(0, 0, -days+1)
	var rows []model.StatusDaily
	r.db.Where("date >= ? AND date <= ?", start, end).
		Order("client_id, date ASC").
		Find(&rows)
	out := make(map[string][]model.StatusDaily)
	for _, r := range rows {
		out[r.ClientID] = append(out[r.ClientID], r)
	}
	return out
}

func (r *MonitorRepository) ListIncidents(clientID string, page, pageSize int) ([]model.Incident, int64, error) {
	tx := r.db.Model(&model.Incident{})
	if clientID != "" {
		tx = tx.Where("client_id = ?", clientID)
	}
	var total int64
	tx.Count(&total)
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	var items []model.Incident
	err := tx.Order("started_at DESC").Limit(pageSize).Offset((page - 1) * pageSize).Find(&items).Error
	return items, total, err
}

func (r *MonitorRepository) OpenIncident(clientID, cause string) error {
	// 检查是否已有正在进行的故障
	var existing model.Incident
	err := r.db.Where("client_id = ? AND status = ?", clientID, "ongoing").First(&existing).Error
	if err == nil {
		return nil
	}
	return r.db.Create(&model.Incident{
		ClientID:  clientID,
		Status:    "ongoing",
		StartedAt: time.Now(),
		Cause:     cause,
	}).Error
}

func (r *MonitorRepository) CloseIncident(clientID string) error {
	var existing model.Incident
	err := r.db.Where("client_id = ? AND status = ?", clientID, "ongoing").First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return nil
	}
	now := time.Now()
	existing.Status = "resolved"
	existing.ResolvedAt = &now
	existing.DurationS = int(now.Sub(existing.StartedAt).Seconds())
	return r.db.Save(&existing).Error
}

func (r *MonitorRepository) CountDown() (int64, error) {
	var c int64
	err := r.db.Model(&model.AppMonitor{}).Where("current_status = ?", model.StatusDown).Count(&c).Error
	return c, err
}

func (r *MonitorRepository) PruneProbes(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan)
	return r.db.Where("probed_at < ?", cutoff).Delete(&model.StatusProbe{}).Error
}
