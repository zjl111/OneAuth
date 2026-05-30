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
	return nil
}
