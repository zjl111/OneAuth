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
	backfillHealthCheckURLs(db)
	return nil
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
