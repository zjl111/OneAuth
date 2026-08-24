package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
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
	groupRepo *repository.UserGroupRepository

	mu          sync.Mutex
	accessToken string
	expireAt    time.Time
}

func NewWeComService(cfg *repository.ConfigRepository, userRepo *repository.UserRepository, groupRepo *repository.UserGroupRepository) *WeComService {
	return &WeComService{cfg: cfg, userRepo: userRepo, groupRepo: groupRepo}
}

type wecomConfig struct {
	Enabled        bool
	Verified       bool
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
	c.Verified = s.cfg.Get("wecom", "verified") == "true"
	c.CorpID = strings.TrimSpace(s.cfg.Get("wecom", "corp_id"))
	c.AgentID = strings.TrimSpace(s.cfg.Get("wecom", "agent_id"))
	c.Secret = s.cfg.Get("wecom", "secret")
	if s.cfg.Get("wecom", "auto_create_user") == "false" {
		c.AutoCreateUser = false
	}
	return c
}

// Enabled 企业微信登录是否真正可用：开关打开 + 已通过配置校验 + 关键字段齐全。
// 仅开关打开但未经校验（verified=false）时视为不可用，避免误启用错误配置。
func (s *WeComService) Enabled() bool {
	c := s.loadConfig()
	return c.Enabled && c.Verified && c.CorpID != "" && c.AgentID != "" && c.Secret != ""
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

// AuthorizeURLOAuth2 生成企业微信「OAuth2 网页授权」链接（企业自建应用版）。
// 用于「企业微信内置浏览器点击应用 → 自动登录」场景，对应官方文档
// https://developer.work.weixin.qq.com/document/path/91120#构造企业oauth2链接 ：
//
//	https://open.weixin.qq.com/connect/oauth2/authorize?appid=CORPID&redirect_uri=..&response_type=code&scope=snsapi_base&agentid=AGENTID&state=STATE#wechat_redirect
//
// 与 AuthorizeURL（JSSDK 扫码登录，login.work.weixin.qq.com）是两条独立链路：
// 二者最终都回调到同一个 redirect_uri（/oauth/wecom/callback），由 Callback 统一消费
// code + state。此方法不影响扫码登录，仅供「企微内置自动登录」使用。
// 注意：redirect_uri 必须与企微后台「网页授权回调域」一致，且该端点已做 URL 编码。
func (s *WeComService) AuthorizeURLOAuth2(redirectURI, state string) (string, error) {
	c := s.loadConfig()
	if !s.Enabled() {
		return "", errors.New("企业微信登录未启用")
	}
	v := url.Values{}
	v.Set("appid", c.CorpID)
	v.Set("redirect_uri", redirectURI) // url.Values.Encode 会自动对值做 URL 编码
	v.Set("response_type", "code")
	v.Set("scope", "snsapi_base") // 静默授权：可拿 UserId，无需用户手动确认
	v.Set("agentid", c.AgentID)
	if state != "" {
		v.Set("state", state)
	}
	// #wechat_redirect：企业微信内置浏览器判断是否带上身份信息的固定标识，必须保留在 query 之后。
	return "https://open.weixin.qq.com/connect/oauth2/authorize?" + v.Encode() + "#wechat_redirect", nil
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

// Verify 校验企业微信凭据（corp_id + secret）是否有效：向企微申请一次 access_token，
// 成功即说明配置正确。corp_id / secret 传空时回退使用已保存配置，
// 便于"保存后 secret 留空不修改"的场景再次校验。
// 注意：此处只验证基础凭据，不消费/缓存 token。
func (s *WeComService) Verify(corpID, secret string) error {
	corpID = strings.TrimSpace(corpID)
	secret = strings.TrimSpace(secret)
	if corpID == "" {
		corpID = strings.TrimSpace(s.cfg.Get("wecom", "corp_id"))
	}
	if secret == "" {
		secret = s.cfg.Get("wecom", "secret")
	}
	if corpID == "" || secret == "" {
		return errors.New("请先填写 CorpID 与应用 Secret 后再校验")
	}
	resp, err := http.Get(fmt.Sprintf(
		"https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=%s&corpsecret=%s",
		url.QueryEscape(corpID), url.QueryEscape(secret),
	))
	if err != nil {
		return fmt.Errorf("请求企业微信失败: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var d struct {
		Errcode     int    `json:"errcode"`
		Errmsg      string `json:"errmsg"`
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return fmt.Errorf("解析企业微信响应失败: %w", err)
	}
	if d.Errcode != 0 {
		return fmt.Errorf("企业微信校验失败(%d): %s", d.Errcode, d.Errmsg)
	}
	return nil
}

// ResolveCode 用回调里的 code 拿到企业微信 userid
// 对齐 Cordys OAuthUserService.getWeComUser：
//   1. getuserinfo 拿到 userid / openid / user_ticket；
//   2. 有 user_ticket 时调 getuserdetail（POST，敏感字段需授权），否则用 user/get。
func (s *WeComService) ResolveCode(code string) (userid string, userTicket string, err error) {
	token, err := s.getAccessToken()
	if err != nil {
		return "", "", err
	}
	resp, err := http.Get(fmt.Sprintf(
		"https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=%s&code=%s",
		url.QueryEscape(token), url.QueryEscape(code),
	))
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var d struct {
		Errcode    int    `json:"errcode"`
		Errmsg     string `json:"errmsg"`
		UserID     string `json:"userid"`
		OpenID     string `json:"openid"`
		UserTicket string `json:"user_ticket"`
	}
	if err := json.Unmarshal(body, &d); err != nil {
		return "", "", err
	}
	if d.Errcode != 0 {
		return "", "", fmt.Errorf("企业微信 getuserinfo 失败 %d: %s", d.Errcode, d.Errmsg)
	}
	if d.UserID == "" {
		// 外部联系人（非应用成员）：getuserinfo 不返回 userid，返回 openid。
		// 这类用户不在本企业通讯录内，无法建立本地账号，明确报错。
		return "", "", errors.New("企业微信回调中未携带 userid，请确认应用可见范围包含该用户")
	}
	return d.UserID, d.UserTicket, nil
}

// wecomUserDetail 企业微信成员详情（user/get 与 getuserdetail 的字段并集）
type wecomUserDetail struct {
	Name           string `json:"name"`
	Email          string `json:"email"`
	Mobile         string `json:"mobile"`
	BizMail        string `json:"biz_mail"` // 企业邮箱（getuserdetail 授权后才返回），优先于 email
	Department     []int  `json:"department"`      // 所属企微部门 ID 列表（数字）
	MainDepartment int    `json:"main_department"` // 主部门企微部门 ID（数字）
}

// fetchUserDetail 拿详情：对齐 Cordys——有 user_ticket 时走 getuserdetail（POST，拿敏感字段），
// 否则回退 user/get（GET）。bizMail（企业邮箱）优先于 email。
func (s *WeComService) fetchUserDetail(userid, userTicket string) *wecomUserDetail {
	token, err := s.getAccessToken()
	if err != nil {
		return nil
	}
	// 有 user_ticket 时走 getuserdetail（POST 敏感字段，需用户授权），否则回退 user/get。
	if userTicket != "" {
		reqBody, _ := json.Marshal(map[string]string{"user_ticket": userTicket})
		resp, err := http.Post(
			fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/auth/getuserdetail?access_token=%s", url.QueryEscape(token)),
			"application/json", strings.NewReader(string(reqBody)),
		)
		if err == nil {
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			var d struct {
				Errcode int `json:"errcode"`
				Errmsg  string `json:"errmsg"`
				wecomUserDetail
			}
			if json.Unmarshal(body, &d) == nil && d.Errcode == 0 {
				detail := d.wecomUserDetail
				// getuserdetail 不返回 email 常规字段，若 bizMail 非空则补到 email 位置。
				if detail.BizMail != "" && detail.Email == "" {
					detail.Email = detail.BizMail
				}
				return &detail
			}
		}
	}
	// 回退 user/get（GET）拿常规字段。
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
	detail := d.wecomUserDetail
	if detail.BizMail != "" && detail.Email == "" {
		detail.Email = detail.BizMail
	}
	return &detail
}

// findBindingProvider 登录匹配用的 binding provider：
// 与目录同步同源（directory_sync.platform_type），默认 DirectoryProviderWeComAttendance。
// 二者引用同一常量，保证扫码登录的 userid 与同步建立的 binding 始终指向同一 provider。
// 企业微信语义下默认 provider 即 wecom_attendance（企微考勤桥接），登录与同步天然统一。
func (s *WeComService) findBindingProvider() string {
	def := DirectoryProviderWeComAttendance
	if s.cfg != nil {
		if v := strings.TrimSpace(s.cfg.Get("directory_sync", "platform_type")); v != "" {
			return v
		}
	}
	return def
}

// FindOrCreateUser 根据企业微信 userid 找本地账号；找不到时按 auto_create_user 决定是否创建。
// 匹配优先级（对齐 Cordys 显式绑定语义）：
//  1. sso_directory_sync_binding（userid→local_id，同步/手动绑定建立的权威映射）
//  2. domain_account == userid（历史兜底）
//  3. email 匹配
//  4. 自动建号（建号后回写 binding + domain_account，闭环）
// userTicket 用于走 getuserdetail 拿敏感字段（bizMail 等），可为空。
func (s *WeComService) FindOrCreateUser(userid, userTicket string) (*model.User, error) {
	c := s.loadConfig()

	// 提前拉取企微成员详情：供各分支补全部门（按企微部门 ID 反查）与默认用户组。
	// 失败（如接口不可用）时 detail 为 nil，部门补全会被安全跳过，不影响登录主流程。
	detail := s.fetchUserDetail(userid, userTicket)

	// 1. binding 表（权威）：userid → 本地用户
	provider := s.findBindingProvider()
	var binding model.DirectorySyncBinding
	if err := s.userRepo.DB().
		Where("provider = ? AND external_type = ? AND external_id = ?", provider, "user", userid).
		First(&binding).Error; err == nil {
		if u, err := s.userRepo.GetByID(binding.LocalID); err == nil && u != nil {
			if isWeComDeparted(detail) {
				return s.handleDepartedUser(u)
			}
			now := time.Now()
			u.LastLogin = &now
			_ = s.userRepo.Update(u)
			// 已存在用户：补全部门（本地无部门时）与默认用户组（对齐目录同步建号行为）
			s.backfillWeComUser(u, detail)
			return s.userRepo.GetByID(u.ID)
		}
	}

	// 2. domain_account 字段（外部账号同步常用，历史兜底）
	var existing model.User
	if err := s.userRepo.DB().Where("domain_account = ?", userid).First(&existing).Error; err == nil {
		if isWeComDeparted(detail) {
			return s.handleDepartedUser(&existing)
		}
		now := time.Now()
		existing.LastLogin = &now
		_ = s.userRepo.Update(&existing)
		// 补建 binding，下次直接走权威路径
		_ = s.upsertUserBinding(userid, existing.ID)
		// 已存在用户：补全部门（本地无部门时）与默认用户组
		s.backfillWeComUser(&existing, detail)
		return s.userRepo.GetByID(existing.ID)
	}

	// 3. 拿详情，再按 email 匹配（detail 已在函数开头拉取）
	if detail != nil && detail.Email != "" {
		if u, err := s.userRepo.GetByEmail(detail.Email); err == nil && u != nil {
			if isWeComDeparted(detail) {
				return s.handleDepartedUser(u)
			}
			// 顺手把 domain_account 写回 + 补建 binding，下次直接命中
			u.DomainAccount = userid
			now := time.Now()
			u.LastLogin = &now
			_ = s.userRepo.Update(u)
			_ = s.upsertUserBinding(userid, u.ID)
			// 已存在用户：补全部门（本地无部门时）与默认用户组
			s.backfillWeComUser(u, detail)
			return s.userRepo.GetByID(u.ID)
		}
	}

	if !c.AutoCreateUser {
		return nil, errors.New("当前用户尚未在 OneAuth 注册，请联系管理员")
	}

	// 企微已离职账号（姓名含「（已离职）」）：禁止在 SSO 自动创建。
	if isWeComDeparted(detail) {
		return nil, errors.New("该企微账号已标记为离职，禁止创建 SSO 账号")
	}

	// 4. 自动建号：复用 directory_sync 的 username/email 策略（用户此前选择的策略与邮件后缀），
	//    与「目录同步」「用户导入」保持一致的建号风格，不再硬编码 wecom_ 前缀。
	//    sourceUsername 取远端 userid（企微约定为姓名拼音 CamelCase，如 TianZhongYa）。
	dscfg := s.loadDirectorySyncConfig()
	sourceUsername := strings.ToLower(strings.TrimSpace(userid))
	nickname := pickName(detail, userid)

	username := normalizeUsernameBase(dscfg.UsernameStrategy, sourceUsername, nickname)
	if username == "" {
		username = "user"
	}
	for i := 2; valueTaken(s.userRepo.DB(), "username", username, uuid.Nil); i++ {
		username = username + strconv.Itoa(i)
	}

	randHash, _ := password.Hash(uuid.New().String())
	now := time.Now()
	// 部门：用企微返回的部门 ID（优先主部门）反查本地部门，填 DepartmentID；
	// 本地无对应部门（未做企微通讯录同步）时留空，不填脏数据。
	deptID := s.resolveDepartmentByWeComID(detail)
	u := &model.User{
		ID:            uuid.New(),
		Username:      username,
		Nickname:      nickname,
		PasswordHash:  randHash,
		DomainAccount: userid,
		UserSource:    "platform",
		HireStatus:    "active",
		IsActive:      true,
		LastLogin:     &now,
		DepartmentID:  deptID,
	}
	// 邮箱：优先按 directory_sync 的 email_strategy + email_domain 生成（如 given.surName@domain）；
	//    生成失败（缺姓名/后缀）时回退到远端邮箱（bizMail/email），保持旧行为。
	if genEmail := generateEmail(dscfg, sourceUsername, nickname, "", "", detailEmail(detail)); genEmail != "" {
		u.Email = &genEmail
	} else if detail != nil && detail.Email != "" {
		e := detail.Email
		u.Email = &e
	}
	if detail != nil && detail.Mobile != "" {
		p := detail.Mobile
		u.Phone = &p
	}
	if err := s.userRepo.Create(u); err != nil {
		return nil, fmt.Errorf("创建本地用户失败：%w", err)
	}
	// 建号后回写 binding，闭环
	_ = s.upsertUserBinding(userid, u.ID)
	// 加入目录同步配置的默认用户组（与目录同步建号行为一致；未配置则无操作）
	s.assignDefaultGroupsToUser(u.ID)
	return s.userRepo.GetByID(u.ID)
}

// loadDirectorySyncConfig 读取 directory_sync 的用户名/邮箱策略配置（仅取建号相关三字段），
// 用于 wecom 登录自动建号时与「目录同步」保持相同的命名风格。
// 当策略/域名为空时按默认 smart_pinyin + 无邮箱策略处理（generateEmail 返回空，走远端邮箱兜底）。
// 同时读取 default_group_ids，使扫码建号与目录同步建号一样纳入默认用户组。
func (s *WeComService) loadDirectorySyncConfig() DirectorySyncConfig {
	cfg := DirectorySyncConfig{UsernameStrategy: "smart_pinyin"}
	if s.cfg == nil {
		return cfg
	}
	if v := strings.TrimSpace(s.cfg.Get("directory_sync", "username_strategy")); v != "" {
		cfg.UsernameStrategy = v
	}
	cfg.EmailStrategy = strings.TrimSpace(s.cfg.Get("directory_sync", "email_strategy"))
	cfg.EmailDomain = strings.TrimSpace(s.cfg.Get("directory_sync", "email_domain"))
	if raw := strings.TrimSpace(s.cfg.Get("directory_sync", "department_mappings")); raw != "" {
		var maps []DepartmentMapping
		if err := json.Unmarshal([]byte(raw), &maps); err == nil {
			cfg.DepartmentMappings = maps
		}
	}
	if raw := strings.TrimSpace(s.cfg.Get("directory_sync", "default_group_ids")); raw != "" {
		var ids []string
		if err := json.Unmarshal([]byte(raw), &ids); err == nil {
			cfg.DefaultGroupIDs = ids
		}
	}
	return cfg
}

// detailEmail 取企微用户详情的邮箱字段（bizMail 优先于 email，二者都为空则返回空串）。
func detailEmail(d *wecomUserDetail) string {
	if d == nil {
		return ""
	}
	if d.Email != "" {
		return d.Email
	}
	return d.BizMail
}

// resolveDepartmentByWeComID 用企微返回的部门 ID（优先主部门 main_department，否则第一个）
// 在 directory_sync 已配置的部门匹配（department_mappings）中查找对应的本地部门 ID 并返回。
// 直接复用已有的「远端部门 ID -> 本地部门」匹配数据，不另建映射机制；
// 仅匹配 Include=true 的匹配项，与同步建号行为一致；无匹配（未做匹配/未勾选）时返回 nil，避免填脏数据。
func (s *WeComService) resolveDepartmentByWeComID(detail *wecomUserDetail) *uuid.UUID {
	if detail == nil || len(detail.Department) == 0 {
		return nil
	}
	pick := detail.MainDepartment
	if pick == 0 {
		pick = detail.Department[0]
	}
	ext := strconv.Itoa(pick)
	cfg := s.loadDirectorySyncConfig()
	for _, m := range cfg.DepartmentMappings {
		if !m.Include {
			continue
		}
		if strings.TrimSpace(m.RemoteExternalID) != ext {
			continue
		}
		if id, err := uuid.Parse(strings.TrimSpace(m.LocalDepartmentID)); err == nil {
			return &id
		}
	}
	return nil
}

// isDepartedName 判断一个姓名是否标记为已离职：企微对未删除但已离职的成员，
// 会在姓名后追加「（已离职）」标识（兼容全角/半角括号两种写法）。
// 供企微扫码与目录同步导入共用，统一拦截已离职账号，避免其在 SSO 自动创建。
func isDepartedName(name string) bool {
	if name == "" {
		return false
	}
	n := strings.ReplaceAll(name, "（", "(")
	n = strings.ReplaceAll(n, "）", ")")
	return strings.Contains(n, "(已离职)")
}

// isWeComDeparted 由企微成员详情判断是否已离职（姓名含「（已离职）」）。
func isWeComDeparted(detail *wecomUserDetail) bool {
	if detail == nil {
		return false
	}
	return isDepartedName(detail.Name)
}

// handleDepartedUser 企微已离职账号的统一收尾：已存在则按目录同步的"删除逻辑"禁用
// （IsActive=false、HireStatus=resigned、IsLocked=true、LockReason=source_missing，表示已删除），
// 并返回错误阻止本次登录/建号。
func (s *WeComService) handleDepartedUser(u *model.User) (*model.User, error) {
	if u != nil {
		u.IsActive = false
		u.HireStatus = "resigned"
		u.IsLocked = true
		u.LockReason = "source_missing"
		_ = s.userRepo.Update(u)
	}
	return nil, errors.New("该企微账号已标记为离职，账号已禁用")
}

// backfillWeComUser 已存在用户（绑定/domain/email 命中）的扫码登录补全：
//   - 部门：本地无部门时按企微部门 ID 补填（不覆盖已有部门）；
//   - 默认用户组：幂等加入 directory_sync 配置的默认用户组。
//
// 仅补全"缺失项"，不修改用户其它字段，符合"身份目录用户主表不随意变动"的红线。
func (s *WeComService) backfillWeComUser(u *model.User, detail *wecomUserDetail) {
	if u != nil && u.DepartmentID == nil {
		if d := s.resolveDepartmentByWeComID(detail); d != nil {
			u.DepartmentID = d
			_ = s.userRepo.Update(u)
		}
	}
	s.assignDefaultGroupsToUser(u.ID)
}

// assignDefaultGroupsToUser 把用户加入 directory_sync 配置的默认用户组（DefaultGroupIDs）。
// 采用追加成员（INSERT IGNORE / ON CONFLICT DO NOTHING），幂等且不会移除用户已有的其它组成员关系；
// 组不存在或配置为空时为无操作。逻辑与目录同步 applyRemoteUser 的 assignDefaultGroups 对齐。
func (s *WeComService) assignDefaultGroupsToUser(userID uuid.UUID) {
	if s.groupRepo == nil {
		return
	}
	cfg := s.loadDirectorySyncConfig()
	if len(cfg.DefaultGroupIDs) == 0 {
		return
	}
	for _, raw := range cfg.DefaultGroupIDs {
		gid, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			continue
		}
		if _, err := s.groupRepo.Get(gid); err != nil {
			continue
		}
		_ = s.groupRepo.AddMember(gid, userID)
	}
}

// upsertUserBinding 在 sso_directory_sync_binding 建立/更新「企微 userid → 本地用户」映射（external_type=user）。
func (s *WeComService) upsertUserBinding(userid string, localID uuid.UUID) error {
	provider := s.findBindingProvider()
	var b model.DirectorySyncBinding
	err := s.userRepo.DB().
		Where("provider = ? AND external_type = ? AND external_id = ?", provider, "user", userid).
		First(&b).Error
	if err == nil {
		b.LocalID = localID
		return s.userRepo.DB().Save(&b).Error
	}
	return s.userRepo.DB().Create(&model.DirectorySyncBinding{
		Provider:     provider,
		ExternalType: "user",
		ExternalID:   userid,
		LocalID:      localID,
	}).Error
}

// BindWeCom 手动绑定/解绑：把 localID 用户绑定到企微 userid（userid 为空则解绑）。
// 同时回写 user.DomainAccount，保证登录兜底路径一致。
func (s *WeComService) BindWeCom(localID uuid.UUID, userid string) error {
	provider := s.findBindingProvider()
	if strings.TrimSpace(userid) == "" {
		// 解绑：删除该用户在 provider 下的 user binding，并清空 domain_account
		res := s.userRepo.DB().
			Where("provider = ? AND external_type = ? AND local_id = ?", provider, "user", localID).
			Delete(&model.DirectorySyncBinding{})
		if res.Error != nil {
			return res.Error
		}
		var u model.User
		if err := s.userRepo.DB().First(&u, "id = ?", localID).Error; err == nil {
			u.DomainAccount = ""
			_ = s.userRepo.Update(&u)
		}
		return nil
	}
	// 绑定：唯一约束 (provider, external_type, external_id)，若该 userid 已绑他人需先移走
	// 先删掉该 userid 指向其它用户的旧 binding（保留同一条），再写当前用户
	_ = s.userRepo.DB().
		Where("provider = ? AND external_type = ? AND external_id = ? AND local_id <> ?",
			provider, "user", userid, localID).
		Delete(&model.DirectorySyncBinding{}).Error
	if err := s.upsertUserBinding(userid, localID); err != nil {
		return err
	}
	// 回写 domain_account
	var u model.User
	if err := s.userRepo.DB().First(&u, "id = ?", localID).Error; err == nil {
		u.DomainAccount = userid
		_ = s.userRepo.Update(&u)
	}
	return nil
}

// GetWeComBinding 查询某用户当前绑定的企微 userid（无绑定返回空串）。
func (s *WeComService) GetWeComBinding(localID uuid.UUID) (string, error) {
	provider := s.findBindingProvider()
	var b model.DirectorySyncBinding
	if err := s.userRepo.DB().
		Where("provider = ? AND external_type = ? AND local_id = ?", provider, "user", localID).
		Order("updated_at DESC").First(&b).Error; err != nil {
		return "", nil // 无绑定
	}
	return b.ExternalID, nil
}

func pickName(d *wecomUserDetail, fallback string) string {
	if d != nil && d.Name != "" {
		return d.Name
	}
	return fallback
}
