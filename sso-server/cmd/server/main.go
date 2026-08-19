package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"sso-server/internal/captcha"
	"sso-server/internal/config"
	"sso-server/internal/geoip"
	"sso-server/internal/handler"
	"sso-server/internal/model"
	"sso-server/internal/monitor"
	"sso-server/internal/oauth"
	"sso-server/internal/repository"
	"sso-server/internal/router"
	"sso-server/internal/service"
	"sso-server/internal/session"
	"sso-server/pkg/crypto"
	"sso-server/pkg/mailer"
)

func main() {
	configPath := flag.String("config", "", "config file path")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	log.Printf("[startup] OneAuth SSO server starting (env=%s, driver=%s)", cfg.App.Environment, cfg.App.Driver)

	db, err := repository.NewDB(cfg)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	if err := repository.AutoMigrate(db); err != nil {
		log.Fatalf("migrate db: %v", err)
	}
	if err := repository.Seed(db); err != nil {
		log.Fatalf("seed db: %v", err)
	}

	// DB 中的 oauth.* 系统配置覆盖 yaml 默认值（重启生效）
	configRepo := repository.NewConfigRepository(db)
	repository.ApplyOAuthOverrides(configRepo, &cfg.OAuth)
	log.Println("[startup] database ready")

	// 初始化 IP -> 省份 离线库（找不到文件时降级为空字符串）
	if err := geoip.Init("./data/ip2region.xdb"); err != nil {
		log.Printf("[startup] geoip init skipped: %v", err)
	}
	// 回填历史日志的 province/city/isp（依赖 geoip）
	repository.BackfillLogRegion(db)

	mailService := mailer.New(configRepo)

	// Store: Redis 或内存
	var store oauth.Store
	if cfg.Redis.Enabled {
		rdb := redis.NewClient(&redis.Options{
			Addr:     cfg.Redis.Addr,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
		})
		if err := rdb.Ping(context.Background()).Err(); err != nil {
			log.Fatalf("redis ping: %v", err)
		}
		store = oauth.NewRedisStore(rdb)
		log.Println("[startup] redis store ready")
	} else {
		store = oauth.NewMemoryStore()
		log.Println("[startup] in-memory store ready (dev mode)")
	}

	keyManager, err := oauth.NewKeyManager(cfg.OAuth.KeysDir)
	if err != nil {
		log.Fatalf("init key manager: %v", err)
	}
	log.Printf("[startup] RSA keys ready (kid=%s)", keyManager.KID())

	tokenService := oauth.NewTokenService(
		keyManager, store, cfg.OAuth.Issuer,
		time.Duration(cfg.OAuth.AccessTokenTTL)*time.Second,
		time.Duration(cfg.OAuth.RefreshTokenTTL)*time.Second,
	)
	// 让 token 签发时优先使用 SystemConfig.platform.site_url 作为 issuer
	tokenService.SetIssuerResolver(func() string { return configRepo.SiteURL() })
	authCodeStore := oauth.NewAuthCodeStore(store, time.Duration(cfg.OAuth.AuthCodeTTL)*time.Second)
	sessionTTL := time.Duration(cfg.OAuth.SessionTTL) * time.Second
	sessionMgr := session.New(store, sessionTTL)

	// repositories
	userRepo := repository.NewUserRepository(db)
	clientRepo := repository.NewClientRepository(db)
	logRepo := repository.NewLogRepository(db)
	monitorRepo := repository.NewMonitorRepository(db)
	deptRepo := repository.NewDepartmentRepository(db)
	roleRepo := repository.NewRoleRepository(db)
	permRepo := repository.NewPermissionRepository(db)
	dictRepo := repository.NewDictionaryRepository(db)
	ipRepo := repository.NewIPAccessRepository(db)
	grantRepo := repository.NewGrantRepository(db)
	userGroupRepo := repository.NewUserGroupRepository(db)
	loginRuleRepo := repository.NewLoginRuleRepository(db)
	appGrantRepo := repository.NewAppGrantRepository(db)
	accountRecoveryRepo := repository.NewAccountRecoveryRepository(db)

	// services
	// 目录同步的 Secret 落库前加密：密钥由 app.secret_key 派生；缺失时降级为明文并告警，不阻断启动。
	secretCipher, err := crypto.NewSecretCipher(cfg.App.SecretKey)
	if err != nil {
		log.Printf("WARN: app.secret_key 未配置，目录同步密钥将以明文存储: %v", err)
	}
	userService := service.NewUserService(userRepo, configRepo)
	clientService := service.NewClientService(clientRepo, monitorRepo, appGrantRepo)
	ldapService := service.NewLDAPService(configRepo, userRepo)
	wecomService := service.NewWeComService(configRepo, userRepo)
	directorySyncService := service.NewDirectorySyncService(configRepo, userRepo, deptRepo, userGroupRepo, secretCipher, cfg.Security.DefaultPassword)

	// 启动时把所有应用同步到监控表，避免内置/历史应用缺监控
	if allClients, err := clientRepo.ListAll(); err == nil {
		for _, cl := range allClients {
			if _, e := monitorRepo.Get(cl.ClientID); e == nil {
				continue
			}
			_ = monitorRepo.Upsert(&model.AppMonitor{
				ClientID:       cl.ClientID,
				Enabled:        cl.HealthCheckURL != "",
				HealthCheckURL: cl.HealthCheckURL,
				TimeoutMs:      10000,
				DegradedMs:     2000,
				CurrentStatus:  model.StatusNoData,
			})
		}
	}

	// monitor scheduler
	// 优先读 DB monitor.interval（用户通过系统设置改的）；DB 没设时回退到 yaml
	var scheduler *monitor.Scheduler
	if cfg.Monitor.Enabled {
		intervalSec := cfg.Monitor.IntervalSeconds
		if v := configRepo.Get("monitor", "interval"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				intervalSec = n
			}
		}
		scheduler = monitor.New(monitorRepo, intervalSec)
		scheduler.Start(context.Background())
		log.Printf("[startup] monitor scheduler started (interval=%ds)", intervalSec)
	}

	// 用户自动锁定调度器：超过 N 天未登录的用户自动锁定（admin 除外）
	userLockScheduler := monitor.NewUserLockScheduler(db, 30)
	if v := configRepo.Get("security", "user_inactive_days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			userLockScheduler.SetInactiveDays(n)
		}
	}
	userLockScheduler.Start(context.Background())

	// 目录同步定时调度器：每日凌晨 2:00 执行完整同步，受「启用同步」开关控制
	directorySyncScheduler := service.NewDirectorySyncScheduler(directorySyncService)
	directorySyncScheduler.Start(context.Background())

	// 日志清理：按系统配置中的保留天数，每小时清理一次
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		retentionDays := func(key string, fallback int) int {
			v := configRepo.Get("logs", key)
			if v == "" {
				return fallback
			}
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				return n
			}
			return fallback
		}
		for range t.C {
			now := time.Now()
			loginDays := retentionDays("login_retention_days", 180)
			operationDays := retentionDays("operation_retention_days", 180)
			accessDays := retentionDays("access_retention_days", 180)
			logRepo.PruneLogsBefore(
				now.AddDate(0, 0, -loginDays),
				now.AddDate(0, 0, -operationDays),
				now.AddDate(0, 0, -accessDays),
			)
		}
	}()

	// 自动 IP 封禁条目的过期清理：每分钟扫一次，过期的就从黑名单里删掉
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for range t.C {
			ipRepo.PurgeExpiredAutoBans()
		}
	}()

	probeFunc := func(clientID string) {
		if scheduler != nil {
			scheduler.ProbeByClientID(clientID)
		}
	}

	// 前端 SPA 基地址：开发模式指向 Vite 端口；生产模式（Nginx 反代）为空（同域路径跳转）
	frontendBase := cfg.OAuth.FrontendURL

	// handlers
	handlers := &router.Handlers{
		OAuth: &handler.OAuthHandler{
			AuthCodeStore: authCodeStore,
			TokenService:  tokenService,
			KeyManager:    keyManager,
			Store:         store,
			UserService:   userService,
			ClientService: clientService,
			GrantRepo:     grantRepo,
			AppGrantRepo:  appGrantRepo,
			LogRepo:       logRepo,
			ConfigRepo:    configRepo,
			SessionMgr:    sessionMgr,
			Issuer:        cfg.OAuth.Issuer,
			FrontendBase:  frontendBase,
		},
		Auth: &handler.AuthHandler{
			UserService:   userService,
			LDAPService:   ldapService,
			TokenService:  tokenService,
			SessionMgr:    sessionMgr,
			Store:         store,
			LogRepo:       logRepo,
			LoginRuleRepo: loginRuleRepo,
			ConfigRepo:    configRepo,
			IPAccessRepo:  ipRepo,
			Mailer:        mailService,
			Captcha: captcha.New(store, func() string {
				return configRepo.Get("security", "captcha_unsplash_key")
			}),
			Issuer:       cfg.OAuth.Issuer,
			FrontendBase: frontendBase,
		},
		WeCom: &handler.WeComHandler{
			WeCom:        wecomService,
			UserService:  userService,
			TokenService: tokenService,
			SessionMgr:   sessionMgr,
			ConfigRepo:   configRepo,
			LogRepo:      logRepo,
			Issuer:       cfg.OAuth.Issuer,
			FrontendBase: frontendBase,
		},
		User: &handler.UserHandler{
			Service:       userService,
			ImportService: service.NewUserImportService(userService, deptRepo, roleRepo, userGroupRepo),
			DeptRepo:      deptRepo,
			RoleRepo:      roleRepo,
		},
		App: &handler.AppHandler{Service: clientService},
		Dashboard: &handler.DashboardHandler{
			UserRepo: userRepo, ClientRepo: clientRepo,
			LogRepo: logRepo, MonitorRepo: monitorRepo,
			SessionMgr: sessionMgr,
		},
		Portal: &handler.PortalHandler{
			UserService:   userService,
			ClientService: clientService,
			GrantRepo:     grantRepo,
			AppGrantRepo:  appGrantRepo,
		},
		Department: &handler.DepartmentHandler{Repo: deptRepo},
		Role:       &handler.RoleHandler{Repo: roleRepo, PermRepo: permRepo},
		Log:        &handler.LogHandler{Repo: logRepo},
		Config: &handler.ConfigHandler{
			Repo: configRepo, DictRepo: dictRepo, Mailer: mailService, LDAP: ldapService,
			OnConfigChange: func(category, key, value string) {
				if category == "monitor" && key == "interval" && scheduler != nil {
					if n, err := strconv.Atoi(value); err == nil && n > 0 {
						scheduler.SetInterval(n)
					}
				}
				if category == "security" && key == "user_inactive_days" {
					if n, err := strconv.Atoi(value); err == nil && n > 0 {
						userLockScheduler.SetInactiveDays(n)
					}
				}
			},
		},
		Access:  &handler.AccessHandler{Repo: ipRepo},
		Monitor: &handler.MonitorHandler{Repo: monitorRepo, ClientRepo: clientRepo, ProbeFunc: probeFunc},
		Status: &handler.StatusHandler{
			MonitorRepo:   monitorRepo,
			ClientService: clientService,
			IntervalSeconds: func() int {
				if scheduler == nil {
					return 0
				}
				return int(scheduler.Interval().Seconds())
			},
		},
		Site:      &handler.SiteHandler{ConfigRepo: configRepo, Mailer: mailService},
		Session:   &handler.SessionHandler{SessionMgr: sessionMgr},
		UserGroup: &handler.UserGroupHandler{Repo: userGroupRepo},
		LoginRule: &handler.LoginRuleHandler{Repo: loginRuleRepo},
		DirectorySync: &handler.DirectorySyncHandler{Service: directorySyncService},
		CAS: &handler.CASHandler{
			Store:         store,
			TokenService:  tokenService,
			SessionMgr:    sessionMgr,
			ClientService: clientService,
			UserService:   userService,
			GrantRepo:     grantRepo,
			AppGrantRepo:  appGrantRepo,
			LogRepo:       logRepo,
			FrontendBase:  frontendBase,
		},
		SAML: &handler.SAMLHandler{
			KeyManager:    keyManager,
			Store:         store,
			TokenService:  tokenService,
			SessionMgr:    sessionMgr,
			ClientService: clientService,
			UserService:   userService,
			AppGrantRepo:  appGrantRepo,
			LogRepo:       logRepo,
			ConfigRepo:    configRepo,
			FrontendBase:  frontendBase,
			Issuer:        cfg.OAuth.Issuer,
		},
		AccountRecovery: &handler.AccountRecoveryHandler{
			Repo:       accountRecoveryRepo,
			ClientRepo: clientRepo,
			UserRepo:   userRepo,
			ConfigRepo: configRepo,
		},
	}

	r := router.Setup(cfg, tokenService, userService, handlers)

	addr := fmt.Sprintf("%s:%d", cfg.App.Host, cfg.App.Port)
	log.Printf("[startup] HTTP server listening on %s", addr)
	log.Printf("[startup] Default admin: admin / Admin@123456")
	log.Printf("[startup] Default user:  jinli / User@123456")

	srv := startServer(r, addr)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("[shutdown] received signal, shutting down...")
	if scheduler != nil {
		scheduler.Stop()
	}
	userLockScheduler.Stop()
	directorySyncScheduler.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Println("[shutdown] bye")
}
