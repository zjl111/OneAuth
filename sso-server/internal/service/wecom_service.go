package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/password"
)

// WeComService 企业微信扫码 / 内置浏览器登录。
// 流程参考 https://developer.work.weixin.qq.com/document/path/91335：
//   1. 用户跳到 https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp&appid=...&agentid=...&redirect_uri=...&state=...
//   2. 企微回调到 redirect_uri?code=xxx&state=...
//   3. 后端拿 corp_secret 换 access_token（缓存 7200 秒）
//   4. access_token + code 调用 /cgi-bin/auth/getuserinfo 拿到 userid
//   5. 用 userid 找 / 建本地用户，签发 SSO Cookie + JWT
type WeComService struct {
	cfg      *repository.ConfigRepository
	userRepo *repository.UserRepository

	mu          sync.Mutex
	accessToken string
	expireAt    time.Time
}

func NewWeComService(cfg *repository.ConfigRepository, userRepo *repository.UserRepository) *WeComService {
	return &WeComService{cfg: cfg, userRepo: userRepo}
}

type wecomConfig struct {
	Enabled        bool
	CorpID         string
	AgentID        string
	Secret         string
	AutoCreateUser bool
}

func (s *WeComService) loadConfig() *wecomConfig {
	c := &wecomConfig{AutoCreateUser: true}
	if s.cfg == nil {
		return c
	}
	c.Enabled = s.cfg.Get("wecom", "enabled") == "true"
	c.CorpID = strings.TrimSpace(s.cfg.Get("wecom", "corp_id"))
	c.AgentID = strings.TrimSpace(s.cfg.Get("wecom", "agent_id"))
	c.Secret = s.cfg.Get("wecom", "secret")
	if s.cfg.Get("wecom", "auto_create_user") == "false" {
		c.AutoCreateUser = false
	}
	return c
}

func (s *WeComService) Enabled() bool {
	c := s.loadConfig()
	return c.Enabled && c.CorpID != "" && c.AgentID != "" && c.Secret != ""
}

// PublicConfig 暴露给前端 jssdk 用的非敏感字段（不含 secret）
func (s *WeComService) PublicConfig() struct {
	CorpID  string
	AgentID string
} {
	c := s.loadConfig()
	return struct {
		CorpID  string
		AgentID string
	}{CorpID: c.CorpID, AgentID: c.AgentID}
}

// AuthorizeURL 生成跳转到企业微信的 URL（前端登录页"使用企业微信登录"按钮的目标）
func (s *WeComService) AuthorizeURL(redirectURI, state string) (string, error) {
	c := s.loadConfig()
	if !s.Enabled() {
		return "", errors.New("企业微信登录未启用")
	}
	v := url.Values{}
	v.Set("login_type", "CorpApp")
	v.Set("appid", c.CorpID)
	v.Set("agentid", c.AgentID)
	v.Set("redirect_uri", redirectURI)
	v.Set("state", state)
	return "https://login.work.weixin.qq.com/wwlogin/sso/login?" + v.Encode(), nil
}

// getAccessToken 拿缓存或重新申请 access_token
func (s *WeComService) getAccessToken() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accessToken != "" && time.Now().Before(s.expireAt) {
		return s.accessToken, nil
	}
	c := s.loadConfig()
	if c.CorpID == "" || c.Secret == "" {
		return "", errors.New("企业微信 corp_id / secret 未配置")
	}
	resp, err := http.Get(fmt.Sprintf(
		"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=%s&corpsecret=%s",
		url.QueryEscape(c.CorpID), url.QueryEscape(c.Secret),
	))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var d struct {
		Errcode     int    `json:"errcode"`
		Errmsg      string `json:"errmsg"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return "", err
	}
	if d.Errcode != 0 {
		return "", fmt.Errorf("企业微信 gettoken 失败 %d: %s", d.Errcode, d.Errmsg)
	}
	s.accessToken = d.AccessToken
	s.expireAt = time.Now().Add(time.Duration(d.ExpiresIn-60) * time.Second)
	return s.accessToken, nil
}

// ResolveCode 用回调里的 code 拿到企业微信 userid
func (s *WeComService) ResolveCode(code string) (userid string, err error) {
	token, err := s.getAccessToken()
	if err != nil {
		return "", err
	}
	resp, err := http.Get(fmt.Sprintf(
		"https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=%s&code=%s",
		url.QueryEscape(token), url.QueryEscape(code),
	))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var d struct {
		Errcode int    `json:"errcode"`
		Errmsg  string `json:"errmsg"`
		UserID  string `json:"userid"`
		OpenID  string `json:"openid"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return "", err
	}
	if d.Errcode != 0 {
		return "", fmt.Errorf("企业微信 getuserinfo 失败 %d: %s", d.Errcode, d.Errmsg)
	}
	if d.UserID == "" {
		return "", errors.New("企业微信回调中未携带 userid，请确认应用可见范围包含该用户")
	}
	return d.UserID, nil
}

// fetchUserDetail 拿名字 / 邮箱（创建本地用户时填充）
type wecomUserDetail struct {
	Name   string `json:"name"`
	Email  string `json:"email"`
	Mobile string `json:"mobile"`
}

func (s *WeComService) fetchUserDetail(userid string) *wecomUserDetail {
	token, err := s.getAccessToken()
	if err != nil {
		return nil
	}
	resp, err := http.Get(fmt.Sprintf(
		"https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=%s&userid=%s",
		url.QueryEscape(token), url.QueryEscape(userid),
	))
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var d struct {
		Errcode int `json:"errcode"`
		wecomUserDetail
	}
	if json.Unmarshal(body, &d) != nil || d.Errcode != 0 {
		return nil
	}
	return &d.wecomUserDetail
}

// FindOrCreateUser 根据企业微信 userid 找本地账号；找不到时按 auto_create_user 决定是否创建
// 优先级：domain_account == userid → 本地匹配；其次 email；最后按 username=wecom_<userid> 新建
func (s *WeComService) FindOrCreateUser(userid string) (*model.User, error) {
	c := s.loadConfig()

	// 1. domain_account 字段（外部账号同步常用）
	var existing model.User
	if err := s.userRepo.DB().Where("domain_account = ?", userid).First(&existing).Error; err == nil {
		now := time.Now()
		existing.LastLogin = &now
		_ = s.userRepo.Update(&existing)
		return s.userRepo.GetByID(existing.ID)
	}

	// 2. 拿详情，再按 email / 自动创建
	detail := s.fetchUserDetail(userid)
	if detail != nil && detail.Email != "" {
		if u, err := s.userRepo.GetByEmail(detail.Email); err == nil && u != nil {
			// 顺手把 domain_account 写回，下次直接命中
			u.DomainAccount = userid
			now := time.Now()
			u.LastLogin = &now
			_ = s.userRepo.Update(u)
			return s.userRepo.GetByID(u.ID)
		}
	}

	if !c.AutoCreateUser {
		return nil, errors.New("当前用户尚未在 OneAuth 注册，请联系管理员")
	}

	username := "wecom_" + strings.ToLower(userid)
	randHash, _ := password.Hash(uuid.New().String())
	now := time.Now()
	u := &model.User{
		ID:            uuid.New(),
		Username:      username,
		Nickname:      pickName(detail, userid),
		PasswordHash:  randHash,
		DomainAccount: userid,
		UserType:      "wecom",
		HireStatus:    "active",
		IsActive:      true,
		LastLogin:     &now,
	}
	if detail != nil {
		if detail.Email != "" {
			e := detail.Email
			u.Email = &e
		}
		if detail.Mobile != "" {
			p := detail.Mobile
			u.Phone = &p
		}
	}
	if err := s.userRepo.Create(u); err != nil {
		return nil, fmt.Errorf("创建本地用户失败：%w", err)
	}
	return s.userRepo.GetByID(u.ID)
}

func pickName(d *wecomUserDetail, fallback string) string {
	if d != nil && d.Name != "" {
		return d.Name
	}
	return fallback
}
