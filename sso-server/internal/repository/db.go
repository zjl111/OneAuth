package repository

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"sso-server/internal/config"
	"sso-server/internal/geoip"
	"sso-server/internal/model"
)

func NewDB(cfg *config.Config) (*gorm.DB, error) {
	var dial gorm.Dialector
	switch cfg.App.Driver {
	case "postgres":
		dsn := fmt.Sprintf(
			"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=Asia/Shanghai",
			cfg.Database.Host, cfg.Database.Port, cfg.Database.User,
			cfg.Database.Password, cfg.Database.DBName, cfg.Database.SSLMode,
		)
		dial = postgres.Open(dsn)
	default:
		path := cfg.Database.SQLitePath
		if path == "" {
			path = "./data/sso.db"
		}
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return nil, err
		}
		dial = sqlite.Open(path)
	}

	logLevel := logger.Warn
	if cfg.App.Environment == "development" {
		logLevel = logger.Info
	}

	db, err := gorm.Open(dial, &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	})
	if err != nil {
		return nil, err
	}

	if cfg.App.Driver == "postgres" {
		sqlDB, _ := db.DB()
		sqlDB.SetMaxOpenConns(cfg.Database.MaxOpenConns)
		sqlDB.SetMaxIdleConns(cfg.Database.MaxIdleConns)
	}

	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&model.Department{},
		&model.User{},
		&model.Role{},
		&model.Permission{},
		&model.UserGroup{},
		&model.OAuth2Client{},
		&model.OAuth2Token{},
		&model.AuthorizationGrant{},
		&model.LoginLog{},
		&model.OperationLog{},
		&model.AccessLog{},
		&model.SystemConfig{},
		&model.Dictionary{},
		&model.IPAccess{},
		&model.LoginRule{},
		&model.AppGrant{},
		&model.AppMonitor{},
		&model.StatusProbe{},
		&model.StatusDaily{},
		&model.Incident{},
	); err != nil {
		return err
	}
	// 旧表的 NOT NULL 约束需要手动 drop（GORM AutoMigrate 不会主动放宽约束）
	// link 协议不需要 redirect_uris/grant_types/response_types
	for _, col := range []string{"redirect_uris", "grant_types", "response_types"} {
		db.Exec("ALTER TABLE sso_oauth2_client ALTER COLUMN " + col + " DROP NOT NULL")
	}
	runOnce(db, "backfill_health_check_urls_v1", func() { backfillHealthCheckURLs(db) })
	runOnce(db, "migrate_access_policy_v1", func() { migrateAccessPolicy(db) })
	return nil
}

// runOnce 用 sso_system_config 里的标志位防止启动时重复扫表。
// 第一次执行 fn 后写入 marker，之后启动直接跳过。
// 想强制重跑就 DELETE FROM sso_system_config WHERE category='_migration' AND key=<name>。
func runOnce(db *gorm.DB, name string, fn func()) {
	const cat = "_migration"
	var existing model.SystemConfig
	err := db.Where("category = ? AND key = ?", cat, name).First(&existing).Error
	if err == nil && existing.Value == "done" {
		return
	}
	fn()
	if err == gorm.ErrRecordNotFound {
		db.Create(&model.SystemConfig{Category: cat, Key: name, Value: "done", Description: "迁移完成标记"})
	} else {
		db.Model(&model.SystemConfig{}).
			Where("category = ? AND key = ?", cat, name).
			Update("value", "done")
	}
}

// migrateAccessPolicy 把旧的 grant_mode (public/user/group/org) 迁移到新的 access_policy (all/assigned/none)
// public         -> all
// user/group/org -> assigned
// 同时把已存在的 grants 应用关联保持不变；新建列 access_policy 默认 'all'
func migrateAccessPolicy(db *gorm.DB) {
	// 旧值映射：public -> all；其他视为 assigned
	db.Exec(`UPDATE sso_oauth2_client SET access_policy = 'all'
	         WHERE COALESCE(access_policy, '') = ''
	           AND COALESCE(grant_mode, '') IN ('', 'public')`)
	db.Exec(`UPDATE sso_oauth2_client SET access_policy = 'assigned'
	         WHERE COALESCE(access_policy, '') = ''
	           AND COALESCE(grant_mode, '') IN ('user', 'group', 'org')`)
}

// BackfillLogRegion 在 geoip.Init 之后由 main 调用，重算所有缺 city 的日志行。
// 这条不走 runOnce 标记，因为 ip2region 库可能后续更新，下次启动如果检测到坏数据仍需修复。
// 用 LIMIT 200 防止启动时一次扫太多。
func BackfillLogRegion(db *gorm.DB) { backfillLogRegion(db) }

// backfillLogRegion 修复历史登录/访问日志的 province/city/isp。
// 历史问题：旧版本只写 province，但当时 geoip 把直辖市的城市名（如"郑州"）写到了 province 字段。
// 启动时跑一次：把所有 city='' 的行用当前 IP 重新解析一次，填齐三列。
func backfillLogRegion(db *gorm.DB) {
	type row struct {
		Table string
		ID    uint64
		IP    string
	}
	rows := []row{}
	// 包含两种坏数据：城市/运营商位完全没填，或第一轮回填把"移动/电信/CN"写进了 city/isp。
	badCondition := `ip_address <> '' AND (
		COALESCE(city,'') = ''
		OR city IN ('移动','中国移动','联通','中国联通','电信','中国电信','铁通','广电','教育网')
		OR isp IN ('CN','cn')
	)`
	// 每次启动最多处理 200 行；防止历史数据量大时拖慢启动。
	// 剩下的会在后续启动陆续处理掉。
	var login []model.LoginLog
	db.Select("id, ip_address").Where(badCondition).Limit(200).Find(&login)
	for _, l := range login {
		rows = append(rows, row{Table: "sso_login_log", ID: l.ID, IP: l.IPAddress})
	}
	var access []model.AccessLog
	db.Select("id, ip_address").Where(badCondition).Limit(200).Find(&access)
	for _, l := range access {
		rows = append(rows, row{Table: "sso_access_log", ID: l.ID, IP: l.IPAddress})
	}
	if len(rows) == 0 {
		return
	}
	updated := 0
	for _, r := range rows {
		p, c, isp := geoip.Lookup(r.IP)
		if p == "" && c == "" && isp == "" {
			continue
		}
		db.Table(r.Table).Where("id = ?", r.ID).Updates(map[string]any{
			"province": p,
			"city":     c,
			"isp":      isp,
		})
		updated++
	}
	if updated > 0 {
		fmt.Printf("[startup] backfilled region (province/city/isp) for %d log rows\n", updated)
	}
}

// backfillHealthCheckURLs 修复历史数据：把空的 health_check_url 用 login_url/home_url 兜底，
// 然后把客户端表的 health_check_url 同步到 sso_app_monitor 表中空的行。
// 用 ORM 写，避免 PostgreSQL 与 SQLite 的 UPDATE FROM 语法差异。
func backfillHealthCheckURLs(db *gorm.DB) {
	var clients []model.OAuth2Client
	db.Find(&clients)
	for _, c := range clients {
		if c.HealthCheckURL != "" {
			continue
		}
		hc := c.LoginURL
		if hc == "" {
			hc = c.HomeURL
		}
		if hc == "" {
			continue
		}
		db.Model(&model.OAuth2Client{}).Where("client_id = ?", c.ClientID).Update("health_check_url", hc)
	}
	// 监控表同步
	var monitors []model.AppMonitor
	db.Find(&monitors)
	for _, m := range monitors {
		if m.HealthCheckURL != "" {
			continue
		}
		var c model.OAuth2Client
		if err := db.Where("client_id = ?", m.ClientID).First(&c).Error; err != nil {
			continue
		}
		if c.HealthCheckURL == "" {
			continue
		}
		db.Model(&model.AppMonitor{}).Where("client_id = ?", m.ClientID).Update("health_check_url", c.HealthCheckURL)
	}
}
