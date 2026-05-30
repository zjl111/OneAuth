package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

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
	sessionMgr := session.New(store, session.DefaultTTL)

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

	// services
	userService := service.NewUserService(userRepo)
	clientService := service.NewClientService(clientRepo, monitorRepo)
	ldapService := service.NewLDAPService(configRepo, userRepo)
	wecomService := service.NewWeComService(configRepo, userRepo)

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
	var scheduler *monitor.Scheduler
	if cfg.Monitor.Enabled {
		scheduler = monitor.New(monitorRepo, cfg.Monitor.IntervalSeconds)
		scheduler.Start(context.Background())
		log.Printf("[startup] monitor scheduler started (interval=%ds)", cfg.Monitor.IntervalSeconds)
	}

	// 日志保留 90 天，每小时清理一次
	go func() {
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for range t.C {
			logRepo.PruneOlderThan(90 * 24 * time.Hour)
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
			Mailer:        mailService,
			Issuer:        cfg.OAuth.Issuer,
			FrontendBase:  frontendBase,
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
		User: &handler.UserHandler{Service: userService},
		App:  &handler.AppHandler{Service: clientService},
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
		Config:     &handler.ConfigHandler{Repo: configRepo, DictRepo: dictRepo, Mailer: mailService, LDAP: ldapService},
		Access:     &handler.AccessHandler{Repo: ipRepo},
		Monitor:    &handler.MonitorHandler{Repo: monitorRepo, ClientRepo: clientRepo, ProbeFunc: probeFunc},
		Status:     &handler.StatusHandler{MonitorRepo: monitorRepo, ClientService: clientService},
		Site:       &handler.SiteHandler{ConfigRepo: configRepo, Mailer: mailService},
		Session:    &handler.SessionHandler{SessionMgr: sessionMgr},
		UserGroup:  &handler.UserGroupHandler{Repo: userGroupRepo},
		LoginRule:  &handler.LoginRuleHandler{Repo: loginRuleRepo},
		AppPerm:    &handler.AppPermHandler{GrantRepo: appGrantRepo, ClientRepo: clientRepo},
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
	log.Println("[shutdown] bye")
}
