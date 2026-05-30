package repository

import (
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"sso-server/internal/model"
	"sso-server/pkg/password"
	"sso-server/pkg/utils"
)

// Seed 初始化基础数据（首次启动时执行）
func Seed(db *gorm.DB) error {
	if err := seedRoles(db); err != nil {
		return err
	}
	if err := seedPermissions(db); err != nil {
		return err
	}
	if err := seedAdminUser(db); err != nil {
		return err
	}
	if err := seedDepartments(db); err != nil {
		return err
	}
	if err := seedBuiltinClient(db); err != nil {
		return err
	}
	if err := seedDemoClients(db); err != nil {
		return err
	}
	if err := seedSystemConfigs(db); err != nil {
		return err
	}
	// 清掉历史可能写入的 sso-admin 监控记录（管理后台不参与健康监控）
	db.Where("client_id = ?", "sso-admin").Delete(&model.AppMonitor{})
	return nil
}

func seedRoles(db *gorm.DB) error {
	roles := []model.Role{
		{Name: "超级管理员", Code: "super_admin", Description: "拥有所有权限", IsBuiltin: true},
		{Name: "应用管理员", Code: "app_admin", Description: "管理应用和用户", IsBuiltin: true},
		{Name: "审计员", Code: "auditor", Description: "只能查看日志和仪表盘", IsBuiltin: true},
		{Name: "普通用户", Code: "user", Description: "查看个人信息和已授权应用", IsBuiltin: true},
	}
	for _, r := range roles {
		var existing model.Role
		if err := db.Where("code = ?", r.Code).First(&existing).Error; err == gorm.ErrRecordNotFound {
			if err := db.Create(&r).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func seedPermissions(db *gorm.DB) error {
	// 菜单
	menus := []model.Permission{
		{Name: "仪表盘", Code: "dashboard", Type: "menu", Path: "/admin/dashboard", Icon: "DashboardOutlined", SortOrder: 1},
		{Name: "用户管理", Code: "users", Type: "menu", Path: "/admin/users", Icon: "UserOutlined", SortOrder: 2},
		{Name: "组织机构", Code: "orgs", Type: "menu", Path: "/admin/orgs", Icon: "ApartmentOutlined", SortOrder: 3},
		{Name: "角色权限", Code: "roles", Type: "menu", Path: "/admin/roles", Icon: "SafetyOutlined", SortOrder: 4},
		{Name: "应用中心", Code: "apps", Type: "menu", Path: "/admin/apps", Icon: "AppstoreOutlined", SortOrder: 5},
		{Name: "访问控制", Code: "access", Type: "menu", Path: "/admin/access", Icon: "LockOutlined", SortOrder: 6},
		{Name: "配置管理", Code: "settings", Type: "menu", Path: "/admin/settings", Icon: "SettingOutlined", SortOrder: 7},
		{Name: "状态监控", Code: "monitor", Type: "menu", Path: "/admin/monitor", Icon: "MonitorOutlined", SortOrder: 8},
		{Name: "日志审计", Code: "logs", Type: "menu", Path: "/admin/logs", Icon: "FileTextOutlined", SortOrder: 9},
		{Name: "在线会话", Code: "sessions", Type: "menu", Path: "/admin/sessions", Icon: "TeamOutlined", SortOrder: 10},
	}
	for i := range menus {
		var existing model.Permission
		if err := db.Where("code = ?", menus[i].Code).First(&existing).Error; err == gorm.ErrRecordNotFound {
			if err := db.Create(&menus[i]).Error; err != nil {
				return err
			}
		} else {
			menus[i] = existing
		}
	}

	// 增删改查子权限（除了"仪表盘"和"在线会话"——这两个本质是只读视图）
	readOnlyMenus := map[string]bool{
		"dashboard": true,
		"logs":      true,
		"sessions":  true,
		"monitor":   true,
	}
	type subDef struct {
		Suffix, Label string
	}
	allSubs := []subDef{
		{"read", "查看"},
		{"create", "新建"},
		{"update", "修改"},
		{"delete", "删除"},
	}
	for _, menu := range menus {
		parentID := menu.ID
		subs := allSubs
		if readOnlyMenus[menu.Code] {
			subs = subs[:1] // 仅"查看"
		}
		for i, s := range subs {
			code := menu.Code + ":" + s.Suffix
			var existing model.Permission
			if err := db.Where("code = ?", code).First(&existing).Error; err == gorm.ErrRecordNotFound {
				p := model.Permission{
					Name:      menu.Name + "·" + s.Label,
					Code:      code,
					Type:      "button",
					ParentID:  &parentID,
					SortOrder: i + 1,
				}
				if err := db.Create(&p).Error; err != nil {
					return err
				}
			}
		}
	}

	// 把所有权限分配给 super_admin
	var super model.Role
	if err := db.Preload("Permissions").Where("code = ?", "super_admin").First(&super).Error; err != nil {
		return err
	}
	var allPerms []model.Permission
	if err := db.Find(&allPerms).Error; err != nil {
		return err
	}
	if len(super.Permissions) < len(allPerms) {
		if err := db.Model(&super).Association("Permissions").Replace(&allPerms); err != nil {
			return err
		}
	}
	return nil
}

func seedAdminUser(db *gorm.DB) error {
	var count int64
	db.Model(&model.User{}).Where("username = ?", "admin").Count(&count)
	if count > 0 {
		return nil
	}
	hash, _ := password.Hash("Admin@123456")
	email := "admin@example.com"
	admin := model.User{
		ID:           uuid.New(),
		Username:     "admin",
		Nickname:     "超级管理员",
		Email:        &email,
		PasswordHash: hash,
		IsActive:     true,
		IsStaff:      true,
	}
	if err := db.Create(&admin).Error; err != nil {
		return err
	}
	// 关联超级管理员角色
	var superRole model.Role
	if err := db.Where("code = ?", "super_admin").First(&superRole).Error; err == nil {
		db.Model(&admin).Association("Roles").Append(&superRole)
	}

	return nil
}

func seedDepartments(db *gorm.DB) error {
	var count int64
	db.Model(&model.Department{}).Count(&count)
	if count > 0 {
		return nil
	}
	root := model.Department{ID: uuid.New(), Name: "总公司", SortOrder: 1, Description: "根部门"}
	if err := db.Create(&root).Error; err != nil {
		return err
	}
	children := []model.Department{
		{ID: uuid.New(), Name: "技术中心", ParentID: &root.ID, SortOrder: 1},
		{ID: uuid.New(), Name: "市场部", ParentID: &root.ID, SortOrder: 2},
		{ID: uuid.New(), Name: "财务部", ParentID: &root.ID, SortOrder: 3},
		{ID: uuid.New(), Name: "人力资源", ParentID: &root.ID, SortOrder: 4},
	}
	for _, c := range children {
		if err := db.Create(&c).Error; err != nil {
			return err
		}
	}
	return nil
}

func seedBuiltinClient(db *gorm.DB) error {
	// 管理后台自身作为一个内置 SSO 客户端
	var count int64
	db.Model(&model.OAuth2Client{}).Where("client_id = ?", "sso-admin").Count(&count)
	if count > 0 {
		return nil
	}
	secret := utils.RandomString(48)
	hash, _ := bcrypt.GenerateFromPassword([]byte(secret), 12)
	client := model.OAuth2Client{
		ID:               uuid.New(),
		ClientID:         "sso-admin",
		ClientSecretHash: string(hash),
		ClientName:       "系统管理后台",
		ClientType:       "confidential",
		Description:      "OneAuth 内置管理后台",
		RedirectURIs:     model.StringSlice{"http://localhost:5173/admin", "http://localhost:8080/admin"},
		GrantTypes:       model.StringSlice{"authorization_code", "refresh_token"},
		ResponseTypes:    model.StringSlice{"code"},
		Scope:            "openid profile email roles",
		IsActive:         true,
		IsBuiltin:        true,
		HomeURL:          "/admin",
	}
	return db.Create(&client).Error
}

func seedDemoClients(db *gorm.DB) error {
	// 用 SystemConfig.platform.demo_apps_seeded 作为"曾经 seed 过"的标记。
	// 这样用户在管理界面删掉 demo 应用之后，重启 backend 不会再被 seed 回来。
	const markerCat, markerKey = "platform", "demo_apps_seeded"
	var marker model.SystemConfig
	if err := db.Where("category = ? AND key = ?", markerCat, markerKey).First(&marker).Error; err == nil && marker.Value == "true" {
		return nil
	}
	// 兼容老数据：标记不存在但仓库里已经有 demo-* 客户端，也认为已 seed，直接补标记
	var existing int64
	db.Model(&model.OAuth2Client{}).Where("client_id LIKE ?", "demo-%").Count(&existing)
	if existing > 0 {
		db.Save(&model.SystemConfig{Category: markerCat, Key: markerKey, Value: "true", Description: "demo 应用一次性 seed 标记，删除标记后下次启动会重新 seed"})
		return nil
	}
	demos := []struct {
		ID, Name, Desc, Logo, Home, Health string
	}{
		{"demo-oa", "OA 协同", "企业协同办公平台", "📋", "https://example.com/oa", "https://www.baidu.com"},
		{"demo-mail", "企业邮箱", "Exchange 邮件服务", "✉️", "https://example.com/mail", "https://www.qq.com"},
		{"demo-crm", "CRM", "客户关系管理", "👥", "https://example.com/crm", "https://www.bing.com"},
		{"demo-finance", "财务平台", "ERP 财务模块", "💰", "https://example.com/finance", "https://www.taobao.com"},
		{"demo-hr", "HR 系统", "人力资源管理", "🧑‍💼", "https://example.com/hr", "https://github.com"},
		{"demo-files", "文档云", "企业文档协作", "📁", "https://example.com/docs", "https://www.zhihu.com"},
		{"demo-devops", "DevOps", "ltdevOps 演示环境", "🛠️", "https://example.com/devops", "https://www.aliyun.com"},
		{"demo-bi", "数据洞察", "Jumpserver 演示环境", "📊", "https://example.com/bi", "https://www.example.com"},
	}
	for _, d := range demos {
		secret := utils.RandomString(48)
		hash, _ := bcrypt.GenerateFromPassword([]byte(secret), 12)
		client := model.OAuth2Client{
			ID:               uuid.New(),
			ClientID:         d.ID,
			ClientSecretHash: string(hash),
			ClientName:       d.Name,
			ClientType:       "confidential",
			Description:      d.Desc,
			RedirectURIs:     model.StringSlice{d.Home + "/callback"},
			GrantTypes:       model.StringSlice{"authorization_code", "refresh_token"},
			ResponseTypes:    model.StringSlice{"code"},
			Scope:            "openid profile email",
			LogoURL:          d.Logo,
			HomeURL:          d.Home,
			HealthCheckURL:   d.Health,
			IsActive:         true,
		}
		if err := db.Create(&client).Error; err != nil {
			return err
		}
		// 创建对应的监控配置
		monitor := model.AppMonitor{
			ClientID:       d.ID,
			Enabled:        true,
			HealthCheckURL: d.Health,
			TimeoutMs:      10000,
			DegradedMs:     2000,
			CurrentStatus:  model.StatusNoData,
		}
		db.Create(&monitor)
	}
	// 写入"已 seed"标记
	db.Save(&model.SystemConfig{Category: markerCat, Key: markerKey, Value: "true", Description: "demo 应用一次性 seed 标记，删除标记后下次启动会重新 seed"})
	return nil
}

func seedSystemConfigs(db *gorm.DB) error {
	configs := []model.SystemConfig{
		{Category: "platform", Key: "name", Value: "OneAuth", Description: "平台名称"},
		{Category: "platform", Key: "site_url", Value: "", Description: "当前站点 URL（生产环境必填，作为 OIDC Issuer 与回调链接基址；空时回退到 config.yaml 中的 oauth.issuer）"},
		{Category: "platform", Key: "logo", Value: "", Description: "平台 Logo"},
		{Category: "platform", Key: "theme_color", Value: "#1677ff", Description: "主题色"},
		{Category: "platform", Key: "hero_title", Value: "OneAuth", Description: "首页主标题（一般等于平台名）"},
		{Category: "platform", Key: "hero_subtitle", Value: "一键登录所有应用", Description: "首页副标题"},
		{Category: "platform", Key: "hero_description", Value: "OneAuth 是一个简单、安全、开源的 SSO 单点登录项目，让登录更简单，让管理更高效。", Description: "首页描述"},
		{Category: "security", Key: "session_timeout", Value: "7200", Description: "Session 超时秒数"},
		{Category: "security", Key: "password_min_length", Value: "8", Description: "密码最小长度"},
		{Category: "security", Key: "login_lockout_threshold", Value: "10", Description: "登录失败锁定阈值"},
		{Category: "security", Key: "login_lockout_duration", Value: "1800", Description: "锁定时长(秒)"},
		{Category: "monitor", Key: "interval", Value: "30", Description: "监控周期(秒)"},
		{Category: "monitor", Key: "public_status_page", Value: "true", Description: "状态页是否公开"},
		// OAuth2 / OIDC 协议参数 — 修改后重启服务生效
		{Category: "oauth", Key: "issuer", Value: "http://localhost:8080", Description: "Issuer URL（修改会让已签发的 JWT 全部失效，慎改）"},
		{Category: "oauth", Key: "access_token_ttl", Value: "3600", Description: "Access Token 有效期（秒）"},
		{Category: "oauth", Key: "refresh_token_ttl", Value: "2592000", Description: "Refresh Token 有效期（秒，默认 30 天）"},
		{Category: "oauth", Key: "auth_code_ttl", Value: "300", Description: "Authorization Code 有效期（秒，默认 5 分钟）"},
		{Category: "oauth", Key: "default_scope", Value: "openid profile email", Description: "新建应用的默认 Scope"},
		{Category: "oauth", Key: "supported_scopes", Value: "openid profile email phone roles", Description: "Discovery 公布的支持 Scope 列表"},
		{Category: "oauth", Key: "id_token_signing_alg", Value: "RS256", Description: "ID Token 签名算法（只读）"},
		{Category: "oauth", Key: "grant_types_supported", Value: "authorization_code,refresh_token", Description: "支持的授权类型（只读）"},
		{Category: "oauth", Key: "response_types_supported", Value: "code", Description: "支持的响应类型（只读）"},
		{Category: "oauth", Key: "pkce_required_for_public_clients", Value: "true", Description: "公共客户端是否强制 PKCE（只读）"},
		// SMTP 邮件配置 — 用于忘记密码 / 通知
		{Category: "smtp", Key: "enabled", Value: "false", Description: "是否启用 SMTP 邮件功能"},
		{Category: "smtp", Key: "host", Value: "", Description: "SMTP 服务器地址，例如 smtp.qq.com"},
		{Category: "smtp", Key: "port", Value: "465", Description: "SMTP 端口（465=SSL，587=STARTTLS，25=明文）"},
		{Category: "smtp", Key: "username", Value: "", Description: "SMTP 账号"},
		{Category: "smtp", Key: "password", Value: "", Description: "SMTP 授权码 / 密码（仅写入，不回显）"},
		{Category: "smtp", Key: "from_address", Value: "", Description: "发件邮箱地址（建议与账号一致）"},
		{Category: "smtp", Key: "from_name", Value: "OneAuth", Description: "发件人显示名称"},
		{Category: "smtp", Key: "use_tls", Value: "ssl", Description: "加密方式：ssl / starttls / none"},
		{Category: "smtp", Key: "reset_link_base", Value: "", Description: "重置密码链接前缀（留空则使用平台信息中的当前站点 URL）"},
		// LDAP / AD 对接配置 ——
		{Category: "ldap", Key: "enabled", Value: "false", Description: "是否启用 LDAP / AD 登录"},
		{Category: "ldap", Key: "url", Value: "", Description: "LDAP 服务器地址，例如 ldap://10.0.0.1:389 或 ldaps://ad.example.com:636"},
		{Category: "ldap", Key: "start_tls", Value: "false", Description: "是否使用 StartTLS（端口 389 时建议开启）"},
		{Category: "ldap", Key: "bind_dn", Value: "", Description: "管理员 Bind DN，例如 cn=admin,dc=example,dc=com"},
		{Category: "ldap", Key: "bind_password", Value: "", Description: "管理员 Bind 密码（保存后不再回显）"},
		{Category: "ldap", Key: "base_dn", Value: "", Description: "用户搜索基准 DN，例如 ou=users,dc=example,dc=com"},
		{Category: "ldap", Key: "user_filter", Value: "(&(objectClass=person)(|(uid=%s)(sAMAccountName=%s)(mail=%s)))", Description: "用户搜索过滤器，%s 会被替换为登录名"},
		{Category: "ldap", Key: "attr_username", Value: "sAMAccountName", Description: "LDAP 属性 -> 本地 username（AD 用 sAMAccountName，OpenLDAP 用 uid）"},
		{Category: "ldap", Key: "attr_email", Value: "mail", Description: "LDAP 属性 -> 本地 email"},
		{Category: "ldap", Key: "attr_displayname", Value: "displayName", Description: "LDAP 属性 -> 本地姓名"},
		{Category: "ldap", Key: "attr_phone", Value: "mobile", Description: "LDAP 属性 -> 本地手机号"},
		// 企业微信对接配置 ——
		{Category: "wecom", Key: "enabled", Value: "false", Description: "是否启用企业微信登录"},
		{Category: "wecom", Key: "corp_id", Value: "", Description: "企业微信 CorpID"},
		{Category: "wecom", Key: "agent_id", Value: "", Description: "应用 AgentID"},
		{Category: "wecom", Key: "secret", Value: "", Description: "应用 Secret（保存后不再回显）"},
		{Category: "wecom", Key: "auto_create_user", Value: "true", Description: "未注册用户首次扫码登录时自动创建本地账号"},
		{Category: "smtp", Key: "subject_prefix", Value: "", Description: "邮件主题前缀，会附加在所有邮件主题前（例如：[OneAuth]）"},
		{Category: "smtp", Key: "reset_subject", Value: "重置 OneAuth 密码", Description: "重置密码邮件主题"},
		{Category: "smtp", Key: "reset_greeting", Value: "Hello", Description: "重置密码邮件问候语"},
		{Category: "smtp", Key: "reset_body", Value: "", Description: "重置密码邮件正文（留空使用默认模板）"},
	}
	for _, c := range configs {
		c.UpdatedAt = time.Now()
		var existing model.SystemConfig
		if err := db.Where("category = ? AND key = ?", c.Category, c.Key).First(&existing).Error; err == gorm.ErrRecordNotFound {
			if err := db.Create(&c).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
