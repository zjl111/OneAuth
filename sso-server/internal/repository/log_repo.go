package repository

import (
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/geoip"
	"sso-server/internal/model"
)

type LogRepository struct{ db *gorm.DB }

func NewLogRepository(db *gorm.DB) *LogRepository { return &LogRepository{db: db} }

func (r *LogRepository) RecordLogin(userID *uuid.UUID, username, ip, ua, method, status, msg string) {
	if method == "" {
		method = "password"
	}
	log := &model.LoginLog{
		UserID:    userID,
		Username:  username,
		IPAddress: ip,
		Province:  geoip.LookupProvince(ip),
		UserAgent: ua,
		Method:    method,
		Status:    status,
		Message:   msg,
		CreatedAt: time.Now(),
	}
	go r.db.Create(log)
}

// LoginMethodStat 登录方式分布（仪表盘排行）
type LoginMethodStat struct {
	Method string `json:"method"`
	Count  int64  `json:"count"`
}

// LoginMethodDistribution 返回近 days 天内成功登录按方式分组的次数（按 count 倒序）
func (r *LogRepository) LoginMethodDistribution(days int) ([]LoginMethodStat, error) {
	if days <= 0 {
		days = 30
	}
	start := time.Now().AddDate(0, 0, -days)
	var items []LoginMethodStat
	err := r.db.Model(&model.LoginLog{}).
		Where("created_at >= ? AND status = ?", start, "success").
		Select("COALESCE(NULLIF(method,''),'password') as method, COUNT(*) as count").
		Group("method").
		Order("count DESC").
		Scan(&items).Error
	return items, err
}

func (r *LogRepository) RecordOperation(userID *uuid.UUID, username, action, resourceType, resourceID, desc, ip string, statusCode int) {
	log := &model.OperationLog{
		UserID:       userID,
		Username:     username,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Description:  desc,
		IPAddress:    ip,
		Status:       statusCode,
		CreatedAt:    time.Now(),
	}
	go r.db.Create(log)
}

func (r *LogRepository) RecordAccess(userID *uuid.UUID, username, clientID, clientName, ip string) {
	log := &model.AccessLog{
		UserID:     userID,
		Username:   username,
		ClientID:   clientID,
		ClientName: clientName,
		IPAddress:  ip,
		Province:   geoip.LookupProvince(ip),
		CreatedAt:  time.Now(),
	}
	go r.db.Create(log)
}

// RegionStat 仪表盘"中国地图 TOP10 访问"统计
type RegionStat struct {
	Province string `json:"province"`
	Count    int64  `json:"count"`
}

// RegionTop10 返回近 days 天 (login_log 成功登录 ∪ access_log) 按 province 聚合 top10 省份。
// 口径：忽略空 province（本地/未知）。
func (r *LogRepository) RegionTop10(days int) ([]RegionStat, error) {
	if days <= 0 {
		days = 30
	}
	start := time.Now().AddDate(0, 0, -days)
	var items []RegionStat
	sql := `
SELECT province, SUM(c) AS count FROM (
  SELECT province, COUNT(*) AS c FROM sso_login_log
    WHERE created_at >= ? AND status = 'success' AND province <> '' GROUP BY province
  UNION ALL
  SELECT province, COUNT(*) AS c FROM sso_access_log
    WHERE created_at >= ? AND province <> '' GROUP BY province
) AS t
GROUP BY province
ORDER BY count DESC
LIMIT 10`
	err := r.db.Raw(sql, start, start).Scan(&items).Error
	return items, err
}

type LogQuery struct {
	Username  string
	Status    string
	ClientID  string // access_log 用：按应用 client_id 过滤
	Resource  string // operation_log 用：按 resource_type 过滤
	StartTime *time.Time
	EndTime   *time.Time
	Page      int
	PageSize  int
}

func paginate(page, size int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if size <= 0 {
		size = 20
	}
	return page, size
}

func (r *LogRepository) ListLoginLogs(q LogQuery) ([]model.LoginLog, int64, error) {
	tx := applyLogFilter(r.db.Model(&model.LoginLog{}), q)
	if q.Status != "" {
		tx = tx.Where("status = ?", q.Status)
	}
	var total int64
	tx.Count(&total)
	page, size := paginate(q.Page, q.PageSize)
	var items []model.LoginLog
	err := tx.Order("created_at DESC").Limit(size).Offset((page - 1) * size).Find(&items).Error
	return items, total, err
}

func (r *LogRepository) ListOperationLogs(q LogQuery) ([]model.OperationLog, int64, error) {
	tx := applyLogFilter(r.db.Model(&model.OperationLog{}), q)
	if q.Status != "" {
		if code, err := strconv.Atoi(q.Status); err == nil {
			tx = tx.Where("status = ?", code)
		}
	}
	if q.Resource != "" {
		tx = tx.Where("resource_type LIKE ?", "%"+q.Resource+"%")
	}
	var total int64
	tx.Count(&total)
	page, size := paginate(q.Page, q.PageSize)
	var items []model.OperationLog
	err := tx.Order("created_at DESC").Limit(size).Offset((page - 1) * size).Find(&items).Error
	return items, total, err
}

func (r *LogRepository) ListAccessLogs(q LogQuery) ([]model.AccessLog, int64, error) {
	tx := applyLogFilter(r.db.Model(&model.AccessLog{}), q)
	if q.ClientID != "" {
		tx = tx.Where("client_id LIKE ?", "%"+q.ClientID+"%")
	}
	var total int64
	tx.Count(&total)
	page, size := paginate(q.Page, q.PageSize)
	var items []model.AccessLog
	err := tx.Order("created_at DESC").Limit(size).Offset((page - 1) * size).Find(&items).Error
	return items, total, err
}

// applyLogFilter 应用用户名 / 时间窗口。status 只在 login_log 上是文本，operation_log 是整型，
// access_log 没有该列——交由 caller 自己决定如何处理。
func applyLogFilter(tx *gorm.DB, q LogQuery) *gorm.DB {
	if q.Username != "" {
		tx = tx.Where("username LIKE ?", "%"+q.Username+"%")
	}
	if q.StartTime != nil {
		tx = tx.Where("created_at >= ?", q.StartTime)
	}
	if q.EndTime != nil {
		tx = tx.Where("created_at <= ?", q.EndTime)
	}
	return tx
}

// PruneOlderThan 清理超过保留期的日志（用于定时任务）
func (r *LogRepository) PruneOlderThan(d time.Duration) {
	cutoff := time.Now().Add(-d)
	r.db.Where("created_at < ?", cutoff).Delete(&model.LoginLog{})
	r.db.Where("created_at < ?", cutoff).Delete(&model.OperationLog{})
	r.db.Where("created_at < ?", cutoff).Delete(&model.AccessLog{})
}

// CountActiveUsersWithin 返回过去 d 时间内有成功登录或应用访问记录的去重用户数。
// 口径：sso_login_log(status='success') ∪ sso_access_log，按 user_id 去重。
func (r *LogRepository) CountActiveUsersWithin(d time.Duration) (int64, error) {
	cutoff := time.Now().Add(-d)
	var n int64
	// 用 UNION DISTINCT；SQLite 和 Postgres 都支持
	sql := `
SELECT COUNT(*) FROM (
  SELECT DISTINCT user_id FROM sso_login_log
    WHERE user_id IS NOT NULL AND status = 'success' AND created_at >= ?
  UNION
  SELECT DISTINCT user_id FROM sso_access_log
    WHERE user_id IS NOT NULL AND created_at >= ?
) AS t`
	err := r.db.Raw(sql, cutoff, cutoff).Scan(&n).Error
	return n, err
}

func (r *LogRepository) CountLoginsToday() (int64, error) {
	var c int64
	today := time.Now().Truncate(24 * time.Hour)
	err := r.db.Model(&model.LoginLog{}).
		Where("created_at >= ? AND status = ?", today, "success").
		Count(&c).Error
	return c, err
}

type DailyLoginCount struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
}

func (r *LogRepository) LoginTrend(days int) ([]DailyLoginCount, error) {
	results := []DailyLoginCount{}
	start := time.Now().AddDate(0, 0, -days+1).Truncate(24 * time.Hour)
	rows, err := r.db.Model(&model.LoginLog{}).
		Where("created_at >= ? AND status = ?", start, "success").
		Select("date(created_at) as date, COUNT(*) as count").
		Group("date(created_at)").
		Order("date").
		Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var d DailyLoginCount
		var dateVal interface{}
		if err := rows.Scan(&dateVal, &d.Count); err != nil {
			continue
		}
		switch v := dateVal.(type) {
		case time.Time:
			d.Date = v.Format("2006-01-02")
		case string:
			if len(v) >= 10 {
				d.Date = v[:10]
			} else {
				d.Date = v
			}
		case []byte:
			s := string(v)
			if len(s) >= 10 {
				d.Date = s[:10]
			} else {
				d.Date = s
			}
		default:
			d.Date = fmt.Sprintf("%v", v)
		}
		if d.Date == "" {
			continue
		}
		results = append(results, d)
	}
	return results, nil
}

type AppAccessCount struct {
	ClientID   string `json:"client_id"`
	ClientName string `json:"client_name"`
	Count      int64  `json:"count"`
}

func (r *LogRepository) AppAccessDistribution(days int) ([]AppAccessCount, error) {
	// 按 client_id 聚合，client_name 取客户端表里的最新值（access_log 里写的是访问时的快照，
	// 后续改名/删除会让前端展示同名多条或残留已删应用）。
	// 隐藏：sso-admin 管理后台自身、已经删除的 client（c.id is null）。
	results := []AppAccessCount{}
	start := time.Now().AddDate(0, 0, -days)
	r.db.Table("sso_access_log AS a").
		Select("a.client_id AS client_id, COALESCE(c.client_name, a.client_name) AS client_name, COUNT(*) AS count").
		Joins("LEFT JOIN sso_oauth2_client AS c ON c.client_id = a.client_id").
		Where("a.created_at >= ? AND a.client_id <> ?", start, "sso-admin").
		Where("c.id IS NOT NULL").
		Group("a.client_id, COALESCE(c.client_name, a.client_name)").
		Order("count DESC").
		Limit(10).
		Scan(&results)
	return results, nil
}
