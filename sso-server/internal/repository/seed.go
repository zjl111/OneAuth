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

	// 创建一个示例普通用户
	uhash, _ := password.Hash("User@123456")
	uemail := "zhang.li@example.com"
	user := model.User{
		ID:           uuid.New(),
		Username:     "zhang.li",
		Nickname:     "张丽",
		Email:        &uemail,
		PasswordHash: uhash,
		IsActive:     true,
		IsStaff:      false,
	}
	if err := db.Create(&user).Error; err != nil {
		return err
	}
	var userRole model.Role
	if err := db.Where("code = ?", "user").First(&userRole).Error; err == nil {
		db.Model(&user).Association("Roles").Append(&userRole)
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
	var count int64
	db.Model(&model.OAuth2Client{}).Where("client_id LIKE ?", "demo-%").Count(&count)
	if count > 0 {
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
	return nil
}

func seedSystemConfigs(db *gorm.DB) error {
	configs := []model.SystemConfig{
		{Category: "platform", Key: "name", Value: "OneAuth", Description: "平台名称"},
		{Category: "platform", Key: "logo", Value: "", Description: "平台 Logo"},
		{Category: "platform", Key: "theme_color", Value: "#1677ff", Description: "主题色"},
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
