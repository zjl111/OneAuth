package service

import (
	"crypto/tls"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/password"
)

// LDAPService 负责按 SystemConfig.ldap.* 与外部目录服务交互。
// 它不替代主认证流程：先尝试本地密码，本地失败后才查 LDAP；
// LDAP bind 成功的用户若本地不存在，会按属性映射自动创建（user_type=ldap）。
type LDAPService struct {
	cfg      *repository.ConfigRepository
	userRepo *repository.UserRepository
}

func NewLDAPService(cfg *repository.ConfigRepository, userRepo *repository.UserRepository) *LDAPService {
	return &LDAPService{cfg: cfg, userRepo: userRepo}
}

type ldapConfig struct {
	Enabled         bool
	URL             string
	StartTLS        bool
	BindDN          string
	BindPassword    string
	BaseDN          string
	UserFilter      string
	AttrUsername    string
	AttrEmail       string
	AttrDisplayName string
	AttrPhone       string
}

func (s *LDAPService) loadConfig() *ldapConfig {
	c := &ldapConfig{
		UserFilter:      "(&(objectClass=person)(|(uid=%s)(sAMAccountName=%s)(mail=%s)))",
		AttrUsername:    "sAMAccountName",
		AttrEmail:       "mail",
		AttrDisplayName: "displayName",
		AttrPhone:       "mobile",
	}
	if s.cfg == nil {
		return c
	}
	c.Enabled = s.cfg.Get("ldap", "enabled") == "true"
	c.URL = strings.TrimSpace(s.cfg.Get("ldap", "url"))
	c.StartTLS = s.cfg.Get("ldap", "start_tls") == "true"
	c.BindDN = strings.TrimSpace(s.cfg.Get("ldap", "bind_dn"))
	c.BindPassword = s.cfg.Get("ldap", "bind_password")
	c.BaseDN = strings.TrimSpace(s.cfg.Get("ldap", "base_dn"))
	if v := s.cfg.Get("ldap", "user_filter"); v != "" {
		c.UserFilter = v
	}
	if v := s.cfg.Get("ldap", "attr_username"); v != "" {
		c.AttrUsername = v
	}
	if v := s.cfg.Get("ldap", "attr_email"); v != "" {
		c.AttrEmail = v
	}
	if v := s.cfg.Get("ldap", "attr_displayname"); v != "" {
		c.AttrDisplayName = v
	}
	if v := s.cfg.Get("ldap", "attr_phone"); v != "" {
		c.AttrPhone = v
	}
	return c
}

func (s *LDAPService) Enabled() bool {
	c := s.loadConfig()
	return c.Enabled && c.URL != "" && c.BaseDN != ""
}

// TestConnection 仅验证 bind / 搜索可达，不做用户认证
func (s *LDAPService) TestConnection() error {
	c := s.loadConfig()
	if c.URL == "" || c.BaseDN == "" {
		return errors.New("LDAP URL / Base DN 未配置")
	}
	conn, err := dial(c)
	if err != nil {
		return err
	}
	defer conn.Close()
	if c.BindDN != "" {
		if err := conn.Bind(c.BindDN, c.BindPassword); err != nil {
			return fmt.Errorf("管理员 bind 失败：%w", err)
		}
	}
	// 试搜一个不会命中的过滤器，确认 BaseDN 合法
	_, err = conn.Search(ldap.NewSearchRequest(
		c.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		1, 5, false,
		"(objectClass=*)", []string{"dn"}, nil,
	))
	if err != nil {
		return fmt.Errorf("搜索 BaseDN 失败：%w", err)
	}
	return nil
}

// Authenticate 用 LDAP 验证用户名+密码，成功时返回本地 User（不存在则创建）。
// LDAP 未启用或未配置时返回 (nil, nil) — 调用方据此决定要不要"用户名或密码错误"。
func (s *LDAPService) Authenticate(login, plain string) (*model.User, error) {
	c := s.loadConfig()
	if !c.Enabled || c.URL == "" || c.BaseDN == "" {
		return nil, nil
	}
	conn, err := dial(c)
	if err != nil {
		return nil, fmt.Errorf("连接 LDAP 失败：%w", err)
	}
	defer conn.Close()

	// Step 1: 管理员 bind 后搜索目标用户的 DN（也可走匿名搜索）
	if c.BindDN != "" {
		if err := conn.Bind(c.BindDN, c.BindPassword); err != nil {
			return nil, fmt.Errorf("管理员 bind 失败：%w", err)
		}
	}
	filter := expandFilter(c.UserFilter, login)
	attrs := []string{"dn", c.AttrUsername, c.AttrEmail, c.AttrDisplayName, c.AttrPhone}
	res, err := conn.Search(ldap.NewSearchRequest(
		c.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases,
		2, 5, false,
		filter, attrs, nil,
	))
	if err != nil {
		return nil, fmt.Errorf("LDAP 搜索失败：%w", err)
	}
	if len(res.Entries) == 0 {
		return nil, errors.New("LDAP 中未找到该用户")
	}
	if len(res.Entries) > 1 {
		return nil, errors.New("LDAP 中匹配到多个用户，请收紧 user_filter")
	}
	entry := res.Entries[0]

	// Step 2: 用用户自身的 DN 试 bind —— 这才是真正的密码校验
	if err := conn.Bind(entry.DN, plain); err != nil {
		return nil, errors.New("用户名或密码错误")
	}

	// Step 3: 找/建本地账号
	username := strings.ToLower(entry.GetAttributeValue(c.AttrUsername))
	if username == "" {
		username = strings.ToLower(login)
	}
	email := entry.GetAttributeValue(c.AttrEmail)
	displayName := entry.GetAttributeValue(c.AttrDisplayName)
	phone := entry.GetAttributeValue(c.AttrPhone)

	u, err := s.userRepo.GetByUsername(username)
	if err == nil && u != nil {
		// 同步可变属性（不要在每次登录都覆盖，给本地编辑留余地：只补空字段）
		dirty := false
		if u.Nickname == "" && displayName != "" {
			u.Nickname = displayName
			dirty = true
		}
		if (u.Email == nil || *u.Email == "") && email != "" {
			e := email
			u.Email = &e
			dirty = true
		}
		if (u.Phone == nil || *u.Phone == "") && phone != "" {
			p := phone
			u.Phone = &p
			dirty = true
		}
		now := time.Now()
		u.LastLogin = &now
		if dirty {
			_ = s.userRepo.Update(u)
		} else {
			// 即便 dirty=false 也要更新 last_login
			_ = s.userRepo.Update(u)
		}
		return s.userRepo.GetByID(u.ID)
	}

	// 不存在则创建（密码字段写一个随机 hash，让本地密码登录走不通，强制走 LDAP）
	randHash, _ := password.Hash(uuid.New().String())
	now := time.Now()
	newUser := &model.User{
		ID:           uuid.New(),
		Username:     username,
		Nickname:     displayName,
		PasswordHash: randHash,
		UserType:     "ldap",
		HireStatus:   "active",
		IsActive:     true,
		LastLogin:    &now,
	}
	if email != "" {
		newUser.Email = &email
	}
	if phone != "" {
		newUser.Phone = &phone
	}
	if err := s.userRepo.Create(newUser); err != nil {
		return nil, fmt.Errorf("创建本地用户失败：%w", err)
	}
	return s.userRepo.GetByID(newUser.ID)
}

// expandFilter 将 user_filter 里的所有 %s 都替换为转义后的 login
func expandFilter(filter, login string) string {
	safe := ldap.EscapeFilter(login)
	return strings.ReplaceAll(filter, "%s", safe)
}

func dial(c *ldapConfig) (*ldap.Conn, error) {
	url := c.URL
	var conn *ldap.Conn
	var err error
	if strings.HasPrefix(url, "ldaps://") {
		conn, err = ldap.DialURL(url, ldap.DialWithTLSConfig(&tls.Config{InsecureSkipVerify: true}))
	} else {
		conn, err = ldap.DialURL(url)
	}
	if err != nil {
		return nil, err
	}
	if c.StartTLS && !strings.HasPrefix(url, "ldaps://") {
		if err := conn.StartTLS(&tls.Config{InsecureSkipVerify: true}); err != nil {
			conn.Close()
			return nil, fmt.Errorf("StartTLS 失败：%w", err)
		}
	}
	return conn, nil
}
