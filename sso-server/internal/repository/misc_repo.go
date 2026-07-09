package repository

import (
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/config"
	"sso-server/internal/model"
)

// DepartmentRepository ----------------------------------
type DepartmentRepository struct{ db *gorm.DB }

func NewDepartmentRepository(db *gorm.DB) *DepartmentRepository {
	return &DepartmentRepository{db: db}
}

func (r *DepartmentRepository) DB() *gorm.DB { return r.db }

func (r *DepartmentRepository) ListAll() ([]model.Department, error) {
	var items []model.Department
	err := r.db.Order("sort_order").Find(&items).Error
	return items, err
}

func (r *DepartmentRepository) Create(d *model.Department) error { return r.db.Create(d).Error }
func (r *DepartmentRepository) Update(d *model.Department) error { return r.db.Save(d).Error }
func (r *DepartmentRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.Department{}, "id = ?", id).Error
}
func (r *DepartmentRepository) Get(id uuid.UUID) (*model.Department, error) {
	var d model.Department
	if err := r.db.First(&d, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

// RoleRepository ---------------------------------------
type RoleRepository struct{ db *gorm.DB }

func NewRoleRepository(db *gorm.DB) *RoleRepository { return &RoleRepository{db: db} }

func (r *RoleRepository) DB() *gorm.DB { return r.db }
func (r *RoleRepository) List() ([]model.Role, error) {
	var items []model.Role
	err := r.db.Preload("Permissions").Order("created_at").Find(&items).Error
	return items, err
}
func (r *RoleRepository) Create(role *model.Role) error { return r.db.Create(role).Error }
func (r *RoleRepository) Update(role *model.Role) error { return r.db.Save(role).Error }
func (r *RoleRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.Role{}, "id = ? AND is_builtin = false", id).Error
}
func (r *RoleRepository) Get(id uuid.UUID) (*model.Role, error) {
	var role model.Role
	if err := r.db.Preload("Permissions").First(&role, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &role, nil
}
func (r *RoleRepository) SetPermissions(roleID uuid.UUID, permIDs []uuid.UUID) error {
	var perms []model.Permission
	if err := r.db.Where("id IN ?", permIDs).Find(&perms).Error; err != nil {
		return err
	}
	role := &model.Role{ID: roleID}
	return r.db.Model(role).Association("Permissions").Replace(&perms)
}

// PermissionRepository --------------------------------
type PermissionRepository struct{ db *gorm.DB }

func NewPermissionRepository(db *gorm.DB) *PermissionRepository {
	return &PermissionRepository{db: db}
}

func (r *PermissionRepository) ListAll() ([]model.Permission, error) {
	var items []model.Permission
	err := r.db.Order("sort_order").Find(&items).Error
	return items, err
}

// ConfigRepository ----------------------------------
type ConfigRepository struct {
	db       *gorm.DB
	mu       sync.RWMutex
	siteURL  string // 缓存 platform.site_url，避免每次签发 token 都查 DB
	loaded   bool
}

func NewConfigRepository(db *gorm.DB) *ConfigRepository {
	return &ConfigRepository{db: db}
}

// Get 读取单个 config 的 value；不存在返回 ""
func (r *ConfigRepository) Get(category, key string) string {
	var c model.SystemConfig
	if err := r.db.Where("category = ? AND key = ?", category, key).First(&c).Error; err != nil {
		return ""
	}
	return c.Value
}

// SiteURL 返回当前 platform.site_url（带内存缓存）；空字符串表示未配置。
func (r *ConfigRepository) SiteURL() string {
	r.mu.RLock()
	if r.loaded {
		v := r.siteURL
		r.mu.RUnlock()
		return v
	}
	r.mu.RUnlock()

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.loaded {
		return r.siteURL
	}
	r.siteURL = r.Get("platform", "site_url")
	r.loaded = true
	return r.siteURL
}

// InvalidateSiteURL 在 Set 后让缓存失效
func (r *ConfigRepository) InvalidateSiteURL() {
	r.mu.Lock()
	r.loaded = false
	r.mu.Unlock()
}

func (r *ConfigRepository) ListAll() ([]model.SystemConfig, error) {
	var items []model.SystemConfig
	// 排除内部用的 category（约定以下划线开头，比如 _migration 这种迁移标记）
	err := r.db.Where("category NOT LIKE ?", "\\_%").
		Order("category, key").
		Find(&items).Error
	return items, err
}

func (r *ConfigRepository) GetByCategory(category string) ([]model.SystemConfig, error) {
	var items []model.SystemConfig
	err := r.db.Where("category = ?", category).Find(&items).Error
	return items, err
}

func (r *ConfigRepository) Set(category, key, value string) error {
	if category == "platform" && key == "site_url" {
		defer r.InvalidateSiteURL()
	}
	var c model.SystemConfig
	if err := r.db.Where("category = ? AND key = ?", category, key).First(&c).Error; err == gorm.ErrRecordNotFound {
		c = model.SystemConfig{Category: category, Key: key, Value: value}
		return r.db.Create(&c).Error
	}
	c.Value = value
	return r.db.Save(&c).Error
}

// ApplyOAuthOverrides 启动时把 DB 中 category=oauth 的可变项写回 cfg
// 注意：JWT 签名算法、grant_types 等"只读"项不会覆盖。
func ApplyOAuthOverrides(r *ConfigRepository, oauthCfg *config.OAuthConfig) {
	items, err := r.GetByCategory("oauth")
	if err != nil {
		return
	}
	for _, c := range items {
		switch c.Key {
		case "issuer":
			if c.Value != "" {
				oauthCfg.Issuer = c.Value
			}
		case "access_token_ttl":
			if v, err := strconv.Atoi(c.Value); err == nil && v > 0 {
				oauthCfg.AccessTokenTTL = v
			}
		case "refresh_token_ttl":
			if v, err := strconv.Atoi(c.Value); err == nil && v > 0 {
				oauthCfg.RefreshTokenTTL = v
			}
		case "auth_code_ttl":
			if v, err := strconv.Atoi(c.Value); err == nil && v > 0 {
				oauthCfg.AuthCodeTTL = v
			}
		case "session_ttl":
			if v, err := strconv.Atoi(c.Value); err == nil && v > 0 {
				oauthCfg.SessionTTL = v
			}
		}
	}
}

// DictionaryRepository ------------------------------
type DictionaryRepository struct{ db *gorm.DB }

func NewDictionaryRepository(db *gorm.DB) *DictionaryRepository {
	return &DictionaryRepository{db: db}
}
func (r *DictionaryRepository) List(category string) ([]model.Dictionary, error) {
	tx := r.db.Model(&model.Dictionary{})
	if category != "" {
		tx = tx.Where("category = ?", category)
	}
	var items []model.Dictionary
	err := tx.Order("category, sort_order").Find(&items).Error
	return items, err
}
func (r *DictionaryRepository) Create(d *model.Dictionary) error { return r.db.Create(d).Error }
func (r *DictionaryRepository) Update(d *model.Dictionary) error { return r.db.Save(d).Error }
func (r *DictionaryRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.Dictionary{}, "id = ?", id).Error
}

// IPAccessRepository --------------------------------
type IPAccessRepository struct{ db *gorm.DB }

func NewIPAccessRepository(db *gorm.DB) *IPAccessRepository {
	return &IPAccessRepository{db: db}
}
func (r *IPAccessRepository) List() ([]model.IPAccess, error) {
	var items []model.IPAccess
	err := r.db.Order("type, created_at DESC").Find(&items).Error
	return items, err
}
func (r *IPAccessRepository) Create(i *model.IPAccess) error { return r.db.Create(i).Error }
func (r *IPAccessRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.IPAccess{}, "id = ?", id).Error
}

// IsBlackBanned 当前 IP 是否处于"黑名单 + 未过期"状态。
// 简化版：精确匹配 IP 字符串；CIDR 匹配交给中间件遍历做（条目少，O(n) 完全可接受）。
func (r *IPAccessRepository) IsBlackBanned(ip string) (bool, error) {
	var count int64
	now := time.Now()
	err := r.db.Model(&model.IPAccess{}).
		Where("type = ? AND ip = ? AND (expires_at IS NULL OR expires_at > ?)", "black", ip, now).
		Count(&count).Error
	return count > 0, err
}

// UpsertAutoBan 自动封禁：如果该 IP 已在黑名单则刷新过期时间，否则插入。
// note 形如 "登录失败超过 N 次自动封禁"；duration 0 表示永久。
func (r *IPAccessRepository) UpsertAutoBan(ip, note string, duration time.Duration) error {
	var existing model.IPAccess
	err := r.db.Where("type = ? AND ip = ?", "black", ip).First(&existing).Error
	if err == nil {
		// 已存在 → 刷新过期时间和备注（仅在自动封禁条目上更新）
		if !existing.AutoBan {
			return nil // 手动条目不动
		}
		updates := map[string]any{"note": note}
		if duration > 0 {
			t := time.Now().Add(duration)
			updates["expires_at"] = &t
		} else {
			updates["expires_at"] = nil
		}
		return r.db.Model(&existing).Updates(updates).Error
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	rec := &model.IPAccess{
		ID:      uuid.New(),
		Type:    "black",
		IP:      ip,
		Note:    note,
		AutoBan: true,
	}
	if duration > 0 {
		t := time.Now().Add(duration)
		rec.ExpiresAt = &t
	}
	return r.db.Create(rec).Error
}

// PurgeExpiredAutoBans 清掉过期的自动封禁条目；手动条目不受影响。
// 后台 goroutine 每分钟跑一次。
func (r *IPAccessRepository) PurgeExpiredAutoBans() (int64, error) {
	res := r.db.Where("auto_ban = ? AND expires_at IS NOT NULL AND expires_at <= ?", true, time.Now()).
		Delete(&model.IPAccess{})
	return res.RowsAffected, res.Error
}

// AuthorizationGrantRepository --------------------------
type GrantRepository struct{ db *gorm.DB }

func NewGrantRepository(db *gorm.DB) *GrantRepository { return &GrantRepository{db: db} }
func (r *GrantRepository) Has(userID uuid.UUID, clientID, scope string) bool {
	var c int64
	r.db.Model(&model.AuthorizationGrant{}).
		Where("user_id = ? AND client_id = ?", userID, clientID).
		Count(&c)
	return c > 0
}
func (r *GrantRepository) Grant(userID uuid.UUID, clientID, scope string) error {
	g := model.AuthorizationGrant{
		UserID:    userID,
		ClientID:  clientID,
		Scope:     scope,
	}
	var existing model.AuthorizationGrant
	if err := r.db.Where("user_id = ? AND client_id = ?", userID, clientID).First(&existing).Error; err == gorm.ErrRecordNotFound {
		return r.db.Create(&g).Error
	}
	existing.Scope = scope
	return r.db.Save(&existing).Error
}
func (r *GrantRepository) ListByUser(userID uuid.UUID) ([]model.AuthorizationGrant, error) {
	var items []model.AuthorizationGrant
	err := r.db.Where("user_id = ?", userID).Find(&items).Error
	return items, err
}
