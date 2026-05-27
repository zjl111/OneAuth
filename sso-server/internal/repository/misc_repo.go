package repository

import (
	"strconv"

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
type ConfigRepository struct{ db *gorm.DB }

func NewConfigRepository(db *gorm.DB) *ConfigRepository {
	return &ConfigRepository{db: db}
}

func (r *ConfigRepository) ListAll() ([]model.SystemConfig, error) {
	var items []model.SystemConfig
	err := r.db.Order("category, key").Find(&items).Error
	return items, err
}

func (r *ConfigRepository) GetByCategory(category string) ([]model.SystemConfig, error) {
	var items []model.SystemConfig
	err := r.db.Where("category = ?", category).Find(&items).Error
	return items, err
}

func (r *ConfigRepository) Set(category, key, value string) error {
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
