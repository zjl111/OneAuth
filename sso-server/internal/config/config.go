package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	App      AppConfig      `mapstructure:"app"`
	Database DatabaseConfig `mapstructure:"database"`
	Redis    RedisConfig    `mapstructure:"redis"`
	OAuth    OAuthConfig    `mapstructure:"oauth"`
	CORS     CORSConfig     `mapstructure:"cors"`
	Monitor  MonitorConfig  `mapstructure:"monitor"`
	Status   StatusConfig   `mapstructure:"status"`
}

type AppConfig struct {
	SecretKey   string `mapstructure:"secret_key"`
	Environment string `mapstructure:"environment"`
	Host        string `mapstructure:"host"`
	Port        int    `mapstructure:"port"`
	Driver      string `mapstructure:"driver"`
}

type DatabaseConfig struct {
	Host         string `mapstructure:"host"`
	Port         int    `mapstructure:"port"`
	User         string `mapstructure:"user"`
	Password     string `mapstructure:"password"`
	DBName       string `mapstructure:"dbname"`
	SSLMode      string `mapstructure:"sslmode"`
	MaxOpenConns int    `mapstructure:"max_open_conns"`
	MaxIdleConns int    `mapstructure:"max_idle_conns"`
	SQLitePath   string `mapstructure:"sqlite_path"`
}

type RedisConfig struct {
	Enabled  bool   `mapstructure:"enabled"`
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

type OAuthConfig struct {
	Issuer          string `mapstructure:"issuer"`
	AccessTokenTTL  int    `mapstructure:"access_token_ttl"`
	RefreshTokenTTL int    `mapstructure:"refresh_token_ttl"`
	AuthCodeTTL     int    `mapstructure:"auth_code_ttl"`
	KeysDir         string `mapstructure:"keys_dir"`
	FrontendURL     string `mapstructure:"frontend_url"`
}

type CORSConfig struct {
	AllowedOrigins   []string `mapstructure:"allowed_origins"`
	AllowCredentials bool     `mapstructure:"allow_credentials"`
}

type MonitorConfig struct {
	Enabled           bool `mapstructure:"enabled"`
	IntervalSeconds   int  `mapstructure:"interval_seconds"`
	DefaultTimeoutMs  int  `mapstructure:"default_timeout_ms"`
	DefaultDegradedMs int  `mapstructure:"default_degraded_ms"`
	RetentionDays     int  `mapstructure:"retention_days"`
}

type StatusConfig struct {
	Public bool `mapstructure:"public"`
}

func Load(path string) (*Config, error) {
	v := viper.New()
	if path != "" {
		v.SetConfigFile(path)
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath("./configs")
		v.AddConfigPath(".")
	}

	v.AutomaticEnv()
	v.SetEnvPrefix("SSO")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("read config: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	// 简单环境变量覆盖
	if v := os.Getenv("SSO_ISSUER"); v != "" {
		cfg.OAuth.Issuer = v
	}
	if v := os.Getenv("SSO_DB_HOST"); v != "" {
		cfg.Database.Host = v
	}
	if v := os.Getenv("SSO_DB_USER"); v != "" {
		cfg.Database.User = v
	}
	if v := os.Getenv("SSO_DB_PASSWORD"); v != "" {
		cfg.Database.Password = v
	}
	if v := os.Getenv("SSO_DB_NAME"); v != "" {
		cfg.Database.DBName = v
	}
	if v := os.Getenv("SSO_REDIS_ADDR"); v != "" {
		cfg.Redis.Addr = v
		cfg.Redis.Enabled = true
	}
	if v := os.Getenv("SSO_REDIS_PASSWORD"); v != "" {
		cfg.Redis.Password = v
	}

	return &cfg, nil
}
