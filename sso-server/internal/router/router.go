package router

import (
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"sso-server/internal/config"
	"sso-server/internal/handler"
	"sso-server/internal/middleware"
	"sso-server/internal/oauth"
	"sso-server/internal/service"
)

type Handlers struct {
	OAuth      *handler.OAuthHandler
	Auth       *handler.AuthHandler
	User       *handler.UserHandler
	App        *handler.AppHandler
	Dashboard  *handler.DashboardHandler
	Portal     *handler.PortalHandler
	Department *handler.DepartmentHandler
	Role       *handler.RoleHandler
	Log        *handler.LogHandler
	Config     *handler.ConfigHandler
	Access     *handler.AccessHandler
	Monitor    *handler.MonitorHandler
	Status     *handler.StatusHandler
	Site       *handler.SiteHandler
	Session    *handler.SessionHandler
	UserGroup  *handler.UserGroupHandler
	LoginRule  *handler.LoginRuleHandler
	AppPerm    *handler.AppPermHandler
	WeCom      *handler.WeComHandler
	CAS        *handler.CASHandler
}

func Setup(cfg *config.Config, ts *oauth.TokenService, userSvc *service.UserService, h *Handlers) *gin.Engine {
	if cfg.App.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(gin.Logger())
	r.Use(middleware.RequestID())
	r.Use(middleware.SecurityHeaders())

	// CORS
	corsCfg := cors.Config{
		AllowOrigins:     cfg.CORS.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Request-ID"},
		ExposeHeaders:    []string{"X-Request-ID"},
		AllowCredentials: cfg.CORS.AllowCredentials,
		MaxAge:           12 * time.Hour,
	}
	if len(corsCfg.AllowOrigins) == 0 {
		corsCfg.AllowAllOrigins = true
		corsCfg.AllowCredentials = false
	}
	r.Use(cors.New(corsCfg))

	// health
	r.GET("/api/v1/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "time": time.Now()})
	})

	// 静态资源（用户上传的 logo 等）
	r.Static("/uploads", "./data/uploads")

	// OIDC 公共端点
	r.GET("/.well-known/openid-configuration", h.OAuth.Discovery)
	r.GET("/oauth/jwks.json", h.OAuth.JWKS)

	// CAS 2.0/3.0 协议端点
	if h.CAS != nil {
		casGroup := r.Group("/cas")
		{
			casGroup.GET("/login", h.CAS.Login)
			casGroup.GET("/logout", h.CAS.Logout)
			casGroup.GET("/serviceValidate", h.CAS.ServiceValidate)
			casGroup.GET("/proxyValidate", h.CAS.ServiceValidate) // V2 别名
			casGroup.GET("/p3/serviceValidate", h.CAS.P3ServiceValidate)
			casGroup.GET("/p3/proxyValidate", h.CAS.P3ServiceValidate) // V3 别名
		}
	}

	// OAuth2 端点
	oauthGroup := r.Group("/oauth")
	{
		oauthGroup.GET("/authorize", h.OAuth.Authorize)
		oauthGroup.POST("/authorize", h.OAuth.Authorize)
		oauthGroup.POST("/token", h.OAuth.Token)
		oauthGroup.GET("/userinfo", h.OAuth.UserInfo)
		oauthGroup.POST("/userinfo", h.OAuth.UserInfo)
		oauthGroup.POST("/revoke", h.OAuth.Revoke)
		oauthGroup.GET("/end_session", h.OAuth.EndSession)
		oauthGroup.POST("/end_session", h.OAuth.EndSession)
		// 企业微信扫码登录入口（前端按钮点击 → 跳企微 → 回调）
		if h.WeCom != nil {
			oauthGroup.GET("/wecom/login", h.WeCom.Login)
			oauthGroup.GET("/wecom/callback", h.WeCom.Callback)
		}
	}

	api := r.Group("/api/v1")

	// 公开端点（登录、刷新、站点品牌）
	api.GET("/site", h.Site.Info)
	if h.WeCom != nil {
		api.GET("/auth/wecom/status", h.WeCom.Status)
		api.GET("/auth/wecom/qr-config", h.WeCom.QRConfig)
	}
	api.POST("/auth/login", h.Auth.Login)
	api.POST("/auth/logout", h.Auth.Logout)
	api.POST("/auth/refresh", h.Auth.Refresh)
	api.POST("/auth/forgot-password", h.Auth.ForgotPassword)
	api.GET("/auth/reset-password/verify", h.Auth.VerifyResetToken)
	api.POST("/auth/reset-password", h.Auth.ResetPassword)

	// 状态页公开 API
	statusGroup := r.Group("/api/status")
	{
		statusGroup.GET("/overview", h.Status.Overview)
		statusGroup.GET("/apps/:client_id/timeline", h.Status.Timeline)
		statusGroup.GET("/apps/:client_id/windows", h.Status.Windows)
	}

	// 需要登录
	authed := api.Group("")
	authed.Use(middleware.JWTAuth(ts, userSvc))
	authed.Use(middleware.Audit(h.Log.Repo))
	{
		authed.GET("/auth/profile", h.Auth.Profile)
		authed.PUT("/auth/profile", h.Auth.UpdateProfile)
		authed.POST("/auth/avatar", h.Auth.UploadAvatar)
		authed.POST("/auth/change-password", h.Auth.ChangePassword)

		// 普通用户门户
		authed.GET("/portal/apps", h.Portal.Apps)
	}

	// 管理后台 API
	admin := api.Group("")
	admin.Use(middleware.JWTAuth(ts, userSvc))
	admin.Use(middleware.RequireStaff())
	admin.Use(middleware.Audit(h.Log.Repo))
	{
		// 用户管理
		admin.GET("/users", h.User.List)
		admin.POST("/users", h.User.Create)
		admin.GET("/users/:id", h.User.Detail)
		admin.PUT("/users/:id", h.User.Update)
		admin.DELETE("/users/:id", h.User.Delete)
		admin.POST("/users/:id/reset-password", h.User.ResetPassword)
		admin.POST("/users/:id/lock", h.User.Lock)
		admin.PUT("/users/:id/roles", h.User.SetRoles)
		admin.POST("/users/:id/avatar", h.User.UploadAvatar)

		// 用户组
		admin.GET("/user-groups", h.UserGroup.List)
		admin.POST("/user-groups", h.UserGroup.Create)
		admin.PUT("/user-groups/:id", h.UserGroup.Update)
		admin.DELETE("/user-groups/:id", h.UserGroup.Delete)
		admin.GET("/user-groups/:id/members", h.UserGroup.Members)
		admin.PUT("/user-groups/:id/members", h.UserGroup.SetMembers)

		// 部门
		admin.GET("/departments/tree", h.Department.Tree)
		admin.GET("/departments", h.Department.List)
		admin.POST("/departments", h.Department.Create)
		admin.PUT("/departments/:id", h.Department.Update)
		admin.DELETE("/departments/:id", h.Department.Delete)

		// 角色与权限
		admin.GET("/roles", h.Role.List)
		admin.POST("/roles", h.Role.Create)
		admin.PUT("/roles/:id", h.Role.Update)
		admin.DELETE("/roles/:id", h.Role.Delete)
		admin.PUT("/roles/:id/permissions", h.Role.SetPermissions)
		admin.GET("/permissions/tree", h.Role.PermissionTree)

		// 应用授权
		admin.GET("/app-perms/apps", h.AppPerm.ListApps)
		admin.GET("/app-perms/apps/:client_id/grants", h.AppPerm.ListGrants)
		admin.PUT("/app-perms/apps/:client_id/grants", h.AppPerm.SetGrants)

		// 应用管理
		admin.GET("/apps", h.App.List)
		admin.POST("/apps", h.App.Create)
		admin.GET("/apps/:id", h.App.Detail)
		admin.PUT("/apps/:id", h.App.Update)
		admin.DELETE("/apps/:id", h.App.Delete)
		admin.POST("/apps/:id/rotate-secret", h.App.RotateSecret)
		admin.POST("/apps/:id/toggle-status", h.App.ToggleStatus)

		// 仪表盘
		admin.GET("/dashboard/stats", h.Dashboard.Stats)
		admin.GET("/dashboard/login-trends", h.Dashboard.LoginTrends)
		admin.GET("/dashboard/app-distribution", h.Dashboard.AppDistribution)
		admin.GET("/dashboard/recent-operations", h.Dashboard.RecentOperations)
		admin.GET("/dashboard/login-methods", h.Dashboard.LoginMethods)
		admin.GET("/dashboard/region-top10", h.Dashboard.RegionTop10)

		// 日志
		admin.GET("/logs/login", h.Log.Login)
		admin.GET("/logs/operation", h.Log.Operation)
		admin.GET("/logs/access", h.Log.Access)

		// 配置
		admin.GET("/configs", h.Config.List)
		admin.PUT("/configs", h.Config.Set)
		admin.POST("/configs/upload-logo", h.Config.UploadLogo)
		admin.POST("/configs/upload-image", h.Config.UploadImage)
		admin.POST("/configs/test-smtp", h.Config.TestSMTP)
		admin.POST("/configs/test-ldap", h.Config.TestLDAP)
		admin.GET("/configs/:category", h.Config.ByCategory)
		admin.GET("/dictionaries", h.Config.ListDict)
		admin.POST("/dictionaries", h.Config.CreateDict)
		admin.PUT("/dictionaries/:id", h.Config.UpdateDict)
		admin.DELETE("/dictionaries/:id", h.Config.DeleteDict)

		// 访问控制
		admin.GET("/access/ip", h.Access.List)
		admin.POST("/access/ip", h.Access.Create)
		admin.DELETE("/access/ip/:id", h.Access.Delete)
		// 用户登录控制规则
		admin.GET("/access/login-rules", h.LoginRule.List)
		admin.POST("/access/login-rules", h.LoginRule.Create)
		admin.PUT("/access/login-rules/:id", h.LoginRule.Update)
		admin.DELETE("/access/login-rules/:id", h.LoginRule.Delete)
		admin.POST("/access/login-rules/:id/toggle", h.LoginRule.Toggle)

		// 监控
		admin.GET("/monitor/apps", h.Monitor.List)
		admin.GET("/monitor/apps/:client_id", h.Monitor.Get)
		admin.PUT("/monitor/apps/:client_id/config", h.Monitor.Update)
		admin.POST("/monitor/apps/:client_id/probe", h.Monitor.Probe)
		admin.POST("/monitor/apps/:client_id/maintenance", h.Monitor.SetMaintenance)
		admin.DELETE("/monitor/apps/:client_id", h.Monitor.Delete)
		admin.POST("/monitor/apps/batch-delete", h.Monitor.BatchDelete)
		admin.POST("/monitor/apps/sync", h.Monitor.Sync)
		admin.GET("/monitor/apps/:client_id/incidents", h.Monitor.Incidents)
		admin.GET("/monitor/global", h.Monitor.Global)

		// 在线会话
		admin.GET("/sessions", h.Session.List)
		admin.GET("/sessions/count", h.Session.Count)
		admin.DELETE("/sessions/:sid", h.Session.Kick)
	}

	return r
}
