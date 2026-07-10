package repository

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/geoip"
	"sso-server/internal/model"
)

type LogRepository struct{ db *gorm.DB }

func NewLogRepository(db *gorm.DB) *LogRepository { return &LogRepository{db: db} }

type LoginLogView struct {
	model.LoginLog
	DisplayName string `gorm:"column:display_name" json:"display_name"`
}

type OperationLogView struct {
	model.OperationLog
	DisplayName  string `gorm:"column:display_name" json:"display_name"`
	ResourceName string `gorm:"column:resource_name" json:"resource_name"`
}

type AccessLogView struct {
	model.AccessLog
	DisplayName string `gorm:"column:display_name" json:"display_name"`
}

func (r *LogRepository) RecordLogin(userID *uuid.UUID, username, ip, ua, method, status, msg string) {
	if method == "" {
		method = "password"
	}
	prov, city, isp := geoip.Lookup(ip)
	log := &model.LoginLog{
		UserID:    userID,
		Username:  username,
		IPAddress: ip,
		Province:  prov,
		City:      city,
		ISP:       isp,
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

func (r *LogRepository) RecordOperation(userID *uuid.UUID, username, action, resourceType, resourceID, desc, output, ip string, statusCode int) {
	output = strings.TrimSpace(output)
	if output == "" {
		switch {
		case statusCode >= 200 && statusCode < 300:
			output = "ok"
		case statusCode > 0:
			output = http.StatusText(statusCode)
			if output == "" {
				output = strconv.Itoa(statusCode)
			}
		}
	}
	log := &model.OperationLog{
		UserID:       userID,
		Username:     username,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Description:  desc,
		Output:       output,
		IPAddress:    ip,
		Status:       statusCode,
		CreatedAt:    time.Now(),
	}
	go r.db.Create(log)
}

func (r *LogRepository) RecordAccess(userID *uuid.UUID, username, clientID, clientName, ip string) {
	prov, city, isp := geoip.Lookup(ip)
	log := &model.AccessLog{
		UserID:     userID,
		Username:   username,
		ClientID:   clientID,
		ClientName: clientName,
		IPAddress:  ip,
		Province:   prov,
		City:       city,
		ISP:        isp,
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

func (r *LogRepository) ListLoginLogs(q LogQuery) ([]LoginLogView, int64, error) {
	tx := r.db.Table("sso_login_log AS l").
		Select("l.*, COALESCE(NULLIF(u.nickname, ''), u.username, l.username) AS display_name").
		Joins("LEFT JOIN sso_user u ON u.id = l.user_id OR u.username = l.username")
	if q.Username != "" {
		tx = tx.Where("l.username LIKE ?", "%"+q.Username+"%")
	}
	if q.StartTime != nil {
		tx = tx.Where("l.created_at >= ?", q.StartTime)
	}
	if q.EndTime != nil {
		tx = tx.Where("l.created_at <= ?", q.EndTime)
	}
	if q.Status != "" {
		tx = tx.Where("l.status = ?", q.Status)
	}
	var total int64
	if err := tx.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, size := paginate(q.Page, q.PageSize)
	var items []LoginLogView
	err := tx.Order("l.created_at DESC").Limit(size).Offset((page - 1) * size).Scan(&items).Error
	return items, total, err
}

func (r *LogRepository) ListOperationLogs(q LogQuery) ([]OperationLogView, int64, error) {
	tx := r.db.Table("sso_operation_log AS l").
		Select(`
			l.*,
			COALESCE(NULLIF(u.nickname, ''), u.username, l.username) AS display_name,
			COALESCE(
				COALESCE(NULLIF(user_t.nickname, ''), user_t.username),
				role_t.name,
				dept_t.name,
				app_t.client_name,
				group_t.name
			) AS resource_name
		`).
		Joins("LEFT JOIN sso_user u ON u.id = l.user_id OR u.username = l.username").
		Joins("LEFT JOIN sso_user user_t ON l.resource_type = 'users' AND user_t.id = l.resource_id").
		Joins("LEFT JOIN sso_role role_t ON l.resource_type = 'roles' AND role_t.id = l.resource_id").
		Joins("LEFT JOIN sso_department dept_t ON l.resource_type = 'departments' AND dept_t.id = l.resource_id").
		Joins("LEFT JOIN sso_oauth2_client app_t ON l.resource_type = 'apps' AND app_t.id = l.resource_id").
		Joins("LEFT JOIN sso_user_group group_t ON l.resource_type IN ('user-groups','groups') AND group_t.id = l.resource_id")
	if q.Username != "" {
		tx = tx.Where("l.username LIKE ?", "%"+q.Username+"%")
	}
	if q.StartTime != nil {
		tx = tx.Where("l.created_at >= ?", q.StartTime)
	}
	if q.EndTime != nil {
		tx = tx.Where("l.created_at <= ?", q.EndTime)
	}
	if q.Status != "" {
		if code, err := strconv.Atoi(q.Status); err == nil {
			tx = tx.Where("l.status = ?", code)
		}
	}
	if q.Resource != "" {
		tx = tx.Where("l.resource_type LIKE ?", "%"+q.Resource+"%")
	}
	var total int64
	if err := tx.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, size := paginate(q.Page, q.PageSize)
	var items []OperationLogView
	err := tx.Order("l.created_at DESC").Limit(size).Offset((page - 1) * size).Scan(&items).Error
	return items, total, err
}

func (r *LogRepository) ListAccessLogs(q LogQuery) ([]AccessLogView, int64, error) {
	tx := r.db.Table("sso_access_log AS l").
		Select("l.*, COALESCE(NULLIF(u.nickname, ''), u.username, l.username) AS display_name").
		Joins("LEFT JOIN sso_user u ON u.id = l.user_id OR u.username = l.username")
	if q.Username != "" {
		tx = tx.Where("l.username LIKE ?", "%"+q.Username+"%")
	}
	if q.StartTime != nil {
		tx = tx.Where("l.created_at >= ?", q.StartTime)
	}
	if q.EndTime != nil {
		tx = tx.Where("l.created_at <= ?", q.EndTime)
	}
	if q.ClientID != "" {
		tx = tx.Where("l.client_id LIKE ?", "%"+q.ClientID+"%")
	}
	var total int64
	if err := tx.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, size := paginate(q.Page, q.PageSize)
	var items []AccessLogView
	err := tx.Order("l.created_at DESC").Limit(size).Offset((page - 1) * size).Scan(&items).Error
	return items, total, err
}

func pruneTableBefore(db *gorm.DB, table string, cutoff time.Time) {
	db.Exec("DELETE FROM "+table+" WHERE created_at < ?", cutoff)
}

// PruneLogsBefore 按表分别清理指定时间之前的日志。
func (r *LogRepository) PruneLogsBefore(loginBefore, operationBefore, accessBefore time.Time) {
	pruneTableBefore(r.db, "sso_login_log", loginBefore)
	pruneTableBefore(r.db, "sso_operation_log", operationBefore)
	pruneTableBefore(r.db, "sso_access_log", accessBefore)
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
	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
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
	LogoURL    string `json:"logo_url"`
	Count      int64  `json:"count"`
}

func (r *LogRepository) AppAccessDistribution(days int) ([]AppAccessCount, error) {
	// 按 client_id 聚合，client_name / logo_url 取客户端表里的最新值
	// （access_log 里写的是访问时的快照，后续改名 / 删除会让前端展示同名多条或残留已删应用）。
	// 隐藏：sso-admin 管理后台自身、已经删除的 client（c.id is null）。
	results := []AppAccessCount{}
	start := time.Now().AddDate(0, 0, -days)
	r.db.Table("sso_access_log AS a").
		Select(`a.client_id AS client_id,
			COALESCE(c.client_name, a.client_name) AS client_name,
			COALESCE(c.logo_url, '') AS logo_url,
			COUNT(*) AS count`).
		Joins("LEFT JOIN sso_oauth2_client AS c ON c.client_id = a.client_id").
		Where("a.created_at >= ? AND a.client_id <> ?", start, "sso-admin").
		Where("c.id IS NOT NULL").
		Group("a.client_id, c.client_name, a.client_name, c.logo_url").
		Order("count DESC").
		Limit(10).
		Scan(&results)
	return results, nil
}

// ── 仪表盘新增：流量趋势（支持天/周/月） ────────────────────────────────

// TrafficPoint 流量数据点
type TrafficPoint struct {
	Label       string `json:"label"`        // 时间标签："14:00" 或 "07-09"
	LoginCount  int64  `json:"login_count"`  // 成功登录次数
	AccessCount int64  `json:"access_count"` // 应用访问次数
}

// TrafficTrendByRange 根据 range 参数返回不同粒度的流量趋势。
// day:   过去 24 小时，按小时聚合，label="HH:00"
// week:  过去 7 天，按天聚合，label="MM-DD"
// month: 过去 30 天，按天聚合，label="MM-DD"
func (r *LogRepository) TrafficTrendByRange(rangeParam string) ([]TrafficPoint, error) {
	now := time.Now()

	switch rangeParam {
	case "week":
		return r.trafficTrendDaily(now, 7)
	case "month":
		return r.trafficTrendDaily(now, 30)
	default: // "day"
		return r.trafficTrendHourly(now)
	}
}

// trafficTrendHourly 按小时聚合今日 00:00 ~ 23:00
func (r *LogRepository) trafficTrendHourly(now time.Time) ([]TrafficPoint, error) {
	loc := now.Location()
	todayMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc) // 今日 00:00 本地时间

	type timeCount struct{ CreatedAt time.Time }
	var loginRows []timeCount
	r.db.Model(&model.LoginLog{}).Select("created_at").
		Where("created_at >= ? AND status = ?", todayMidnight, "success").Scan(&loginRows)
	var accessRows []timeCount
	r.db.Model(&model.AccessLog{}).Select("created_at").
		Where("created_at >= ?", todayMidnight).Scan(&accessRows)

	loginMap := make(map[string]int64)
	for _, row := range loginRows {
		loginMap[row.CreatedAt.In(loc).Format("15:00")]++
	}
	accessMap := make(map[string]int64)
	for _, row := range accessRows {
		accessMap[row.CreatedAt.In(loc).Format("15:00")]++
	}

	out := make([]TrafficPoint, 0, 24)
	for i := 0; i < 24; i++ {
		h := todayMidnight.Add(time.Duration(i) * time.Hour)
		key := h.Format("15:00")
		out = append(out, TrafficPoint{Label: key, LoginCount: loginMap[key], AccessCount: accessMap[key]})
	}
	return out, nil
}

// trafficTrendDaily 按天聚合最近 N 天
func (r *LogRepository) trafficTrendDaily(now time.Time, days int) ([]TrafficPoint, error) {
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	cutoff := today.AddDate(0, 0, -days+1)

	type timeCount struct{ CreatedAt time.Time }
	var loginRows []timeCount
	r.db.Model(&model.LoginLog{}).Select("created_at").
		Where("created_at >= ? AND status = ?", cutoff, "success").Scan(&loginRows)
	var accessRows []timeCount
	r.db.Model(&model.AccessLog{}).Select("created_at").
		Where("created_at >= ?", cutoff).Scan(&accessRows)

	loginMap := make(map[string]int64)
	for _, row := range loginRows {
		loginMap[row.CreatedAt.In(loc).Format("01-02")]++
	}
	accessMap := make(map[string]int64)
	for _, row := range accessRows {
		accessMap[row.CreatedAt.In(loc).Format("01-02")]++
	}

	out := make([]TrafficPoint, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := today.AddDate(0, 0, -i)
		key := d.Format("01-02")
		out = append(out, TrafficPoint{Label: key, LoginCount: loginMap[key], AccessCount: accessMap[key]})
	}
	return out, nil
}

// ── 仪表盘新增：实时安全风险预警 ─────────────────────────────────────────

// SecurityAlert 单条安全预警
type SecurityAlert struct {
	Type        string `json:"type"`         // failed_login / brute_force / unusual_location / user_locked / operation_failure
	Title       string `json:"title"`        // 简短标题
	Description string `json:"description"`  // 详细描述
	Severity    string `json:"severity"`     // high / medium / low
	Username    string `json:"username"`
	DisplayName string `json:"display_name"` // 用户姓名（来自 sso_user.nickname）
	IP          string `json:"ip"`
	CreatedAt   string `json:"created_at"`
	UnknownUser bool   `json:"unknown_user"` // 用户不在 sso_user 中
}

// RecentSecurityAlerts 返回最近的安全风险事件。
// 包含：失败登录(1h)、暴力破解(24h)、异地登录(24h)、用户锁定、操作失败(1h)。
func (r *LogRepository) RecentSecurityAlerts() ([]SecurityAlert, error) {
	now := time.Now()
	oneHourAgo := now.Add(-1 * time.Hour)
	oneDayAgo := now.Add(-24 * time.Hour)
	var alerts []SecurityAlert

	// 预加载系统用户集合（用于标记非系统用户 + 获取姓名）
	type userInfo struct {
		Username string
		Nickname string
	}
	var knownUsers []userInfo
	r.db.Table("sso_user").Select("username, nickname").Scan(&knownUsers)
	nicknameMap := make(map[string]string, len(knownUsers))
	for _, u := range knownUsers {
		nicknameMap[u.Username] = u.Nickname
	}
	isKnown := func(username string) bool {
		_, ok := nicknameMap[username]
		return ok
	}
	getDisplayName := func(username string) string {
		if nick, ok := nicknameMap[username]; ok && nick != "" {
			return nick
		}
		return username
	}

	// 1) 最近 1 小时失败登录（取最近 10 条）
	var failed []struct {
		Username  string
		IPAddress string
		Message   string
		CreatedAt time.Time
	}
	r.db.Model(&model.LoginLog{}).
		Select("username, ip_address, message, created_at").
		Where("created_at >= ? AND status = ?", oneHourAgo, "failure").
		Order("created_at DESC").
		Limit(10).
		Scan(&failed)
	for _, f := range failed {
		msg := f.Message
		if msg == "" {
			msg = "登录失败"
		}
		unknown := !isKnown(f.Username)
		displayName := getDisplayName(f.Username)
		title := "登录失败"
		desc := fmt.Sprintf("%s（%s）登录失败：%s (IP: %s)", displayName, f.Username, msg, f.IPAddress)
		if unknown {
			title = "登录失败（非系统用户）"
			desc = fmt.Sprintf("非系统账号 %s 尝试登录失败：%s (IP: %s)", f.Username, msg, f.IPAddress)
		}
		alerts = append(alerts, SecurityAlert{
			Type:        "failed_login",
			Title:       title,
			Description: desc,
			Severity:    "medium",
			Username:    f.Username,
			DisplayName: displayName,
			IP:          f.IPAddress,
			CreatedAt:   f.CreatedAt.Format("2006-01-02 15:04:05"),
			UnknownUser: unknown,
		})
	}

	// 2) 最近 24h 内失败 >= 3 次的账号（暴力破解嫌疑）
	type bruteItem struct {
		Username  string
		FailCount int64
		LastIP    string
		LastAt    time.Time
	}
	var brutes []bruteItem
	r.db.Raw(`
		SELECT username, COUNT(*) as fail_count,
		       MAX(ip_address) as last_ip, MAX(created_at) as last_at
		FROM sso_login_log
		WHERE created_at >= ? AND status = 'failure'
		GROUP BY username
		HAVING COUNT(*) >= 3
		ORDER BY fail_count DESC
		LIMIT 10
	`, oneDayAgo).Scan(&brutes)
	for _, b := range brutes {
		unknown := !isKnown(b.Username)
		displayName := getDisplayName(b.Username)
		title := "密码连续错误"
		desc := fmt.Sprintf("%s（%s）尝试登录连续失败 %d 次 (IP: %s)", displayName, b.Username, b.FailCount, b.LastIP)
		if unknown {
			title = "密码连续错误（非系统用户）"
			desc = fmt.Sprintf("非系统账号 %s 尝试登录连续失败 %d 次 (IP: %s)", b.Username, b.FailCount, b.LastIP)
		}
		alerts = append(alerts, SecurityAlert{
			Type:        "brute_force",
			Title:       title,
			Description: desc,
			Severity:    "high",
			Username:    b.Username,
			DisplayName: displayName,
			IP:          b.LastIP,
			CreatedAt:   b.LastAt.Format("2006-01-02 15:04:05"),
			UnknownUser: unknown,
		})
	}

	// 3) 最近 24h 内同一账号从不同省份登录（异地登录）
	// 用数据库无关的方式：先取所有成功登录记录，在 Go 中按 username 分组
	type locRaw struct {
		Username  string
		Province  string
		IPAddress string
		CreatedAt time.Time
	}
	var locRows []locRaw
	r.db.Model(&model.LoginLog{}).
		Select("username, province, ip_address, created_at").
		Where("created_at >= ? AND status = 'success' AND province <> ''", oneDayAgo).
		Order("created_at DESC").
		Limit(500).
		Scan(&locRows)

	// 按 username 分组，统计不同省份数
	type userLoc struct {
		provinces map[string]struct{}
		provList  []string
		lastIP    string
		lastAt    time.Time
	}
	userLocs := make(map[string]*userLoc)
	for _, row := range locRows {
		ul, ok := userLocs[row.Username]
		if !ok {
			ul = &userLoc{provinces: make(map[string]struct{})}
			userLocs[row.Username] = ul
		}
		if _, exists := ul.provinces[row.Province]; !exists {
			ul.provinces[row.Province] = struct{}{}
			ul.provList = append(ul.provList, row.Province)
		}
		if ul.lastAt.IsZero() || row.CreatedAt.After(ul.lastAt) {
			ul.lastAt = row.CreatedAt
			ul.lastIP = row.IPAddress
		}
	}
	for username, ul := range userLocs {
		if len(ul.provinces) >= 2 {
			unknown := !isKnown(username)
			displayName := getDisplayName(username)
			alerts = append(alerts, SecurityAlert{
				Type:        "unusual_location",
				Title:       "异地登录",
				Description: fmt.Sprintf("%s（%s）从多个地区登录 (%s) (IP: %s)", displayName, username, strings.Join(ul.provList, "、"), ul.lastIP),
				Severity:    "medium",
				Username:    username,
				DisplayName: displayName,
				IP:          ul.lastIP,
				CreatedAt:   ul.lastAt.Format("2006-01-02 15:04:05"),
				UnknownUser: unknown,
			})
		}
	}

	// 4) 当前被锁定的用户
	type lockedUser struct {
		Username  string
		Nickname  string
		LockUntil *time.Time
	}
	var lockedUsers []lockedUser
	r.db.Table("sso_user").
		Select("username, nickname, lock_until").
		Where("is_locked = ? AND is_active = ?", true, true).
		Scan(&lockedUsers)
	for _, lu := range lockedUsers {
		desc := fmt.Sprintf("用户 %s（%s）已被锁定", lu.Username, lu.Nickname)
		if lu.LockUntil != nil && lu.LockUntil.After(now) {
			desc = fmt.Sprintf("用户 %s（%s）已被临时锁定，至 %s", lu.Username, lu.Nickname, lu.LockUntil.Format("2006-01-02 15:04"))
		}
		alerts = append(alerts, SecurityAlert{
			Type:        "user_locked",
			Title:       "账号已锁定",
			Description: desc,
			Severity:    "high",
			Username:    lu.Username,
			CreatedAt:   now.Format("2006-01-02 15:04:05"),
		})
	}

	// 5) 最近 1 小时操作失败（status >= 400）
	type opFail struct {
		Username     string
		Action       string
		ResourceType string
		Description  string
		Status       int
		IPAddress    string
		CreatedAt    time.Time
	}
	var opFails []opFail
	r.db.Table("sso_operation_log").
		Select("username, action, resource_type, description, status, ip_address, created_at").
		Where("created_at >= ? AND status >= ?", oneHourAgo, 400).
		Order("created_at DESC").
		Limit(10).
		Scan(&opFails)
	for _, of := range opFails {
		unknown := !isKnown(of.Username)
		displayName := getDisplayName(of.Username)
		title := "操作失败"
		desc := fmt.Sprintf("%s（%s）执行 %s 失败 (HTTP %d, IP: %s)", displayName, of.Username, of.Action, of.Status, of.IPAddress)
		if unknown {
			title = "操作失败（非系统用户）"
			desc = fmt.Sprintf("非系统用户 %s 执行 %s 失败 (HTTP %d, IP: %s)", of.Username, of.Action, of.Status, of.IPAddress)
		}
		alerts = append(alerts, SecurityAlert{
			Type:        "operation_failure",
			Title:       title,
			Description: desc,
			Severity:    "medium",
			Username:    of.Username,
			DisplayName: displayName,
			IP:          of.IPAddress,
			CreatedAt:   of.CreatedAt.Format("2006-01-02 15:04:05"),
			UnknownUser: unknown,
		})
	}

	// 按时间倒序，取最近 6 条
	sort.Slice(alerts, func(i, j int) bool {
		return alerts[i].CreatedAt > alerts[j].CreatedAt
	})
	if len(alerts) > 6 {
		alerts = alerts[:6]
	}
	return alerts, nil
}

// ── 仪表盘新增：Top 登录用户 ─────────────────────────────────────────────

// UserLoginCount 用户登录次数统计
type UserLoginCount struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	LoginCount  int64  `json:"login_count"`
}

// TopLoginUsers 返回指定天数内登录次数最多的前 limit 个用户（仅包含 sso_user 中存在的用户）。
func (r *LogRepository) TopLoginUsers(days int, limit int) ([]UserLoginCount, error) {
	start := time.Now().AddDate(0, 0, -days)
	var results []UserLoginCount
	r.db.Table("sso_login_log AS l").
		Select("l.username, COALESCE(u.nickname, l.username) as display_name, COUNT(*) as login_count").
		Joins("INNER JOIN sso_user AS u ON u.username = l.username").
		Where("l.created_at >= ? AND l.status = ?", start, "success").
		Group("l.username, u.nickname").
		Order("login_count DESC").
		Limit(limit).
		Scan(&results)
	return results, nil
}
