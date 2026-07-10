package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

type ClientRepository struct{ db *gorm.DB }

func NewClientRepository(db *gorm.DB) *ClientRepository { return &ClientRepository{db: db} }

func (r *ClientRepository) DB() *gorm.DB { return r.db }

func (r *ClientRepository) Create(c *model.OAuth2Client) error { return r.db.Create(c).Error }
func (r *ClientRepository) Update(c *model.OAuth2Client) error { return r.db.Save(c).Error }
func (r *ClientRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.OAuth2Client{}, "id = ? AND is_builtin = false", id).Error
}

func (r *ClientRepository) GetByID(id uuid.UUID) (*model.OAuth2Client, error) {
	var c model.OAuth2Client
	if err := r.db.First(&c, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *ClientRepository) GetByClientID(clientID string) (*model.OAuth2Client, error) {
	var c model.OAuth2Client
	if err := r.db.First(&c, "client_id = ?", clientID).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

// FindByCASService 按 cas_service 精确匹配（取第一个），用于 CAS /login?service= 路由
func (r *ClientRepository) FindByCASService(service string) (*model.OAuth2Client, error) {
	var c model.OAuth2Client
	if err := r.db.First(&c, "protocol = ? AND is_active = ? AND cas_service = ?", "cas", true, service).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

type ClientQuery struct {
	Name       string
	Page       int
	PageSize   int
	OnlyActive bool
}

func (r *ClientRepository) List(q ClientQuery) ([]model.OAuth2Client, int64, error) {
	tx := r.db.Model(&model.OAuth2Client{})
	if q.Name != "" {
		tx = tx.Where("client_name LIKE ? OR client_id LIKE ? OR category LIKE ?", "%"+q.Name+"%", "%"+q.Name+"%", "%"+q.Name+"%")
	}
	if q.OnlyActive {
		tx = tx.Where("is_active = ?", true)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if q.Page <= 0 {
		q.Page = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	var items []model.OAuth2Client
	if err := tx.Order("CASE WHEN client_id = 'sso-admin' THEN 1 ELSE 0 END ASC, sort_order ASC, created_at DESC").
		Limit(q.PageSize).
		Offset((q.Page - 1) * q.PageSize).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *ClientRepository) ListAll() ([]model.OAuth2Client, error) {
	var items []model.OAuth2Client
	if err := r.db.Where("is_active = ?", true).
		Order("CASE WHEN client_id = 'sso-admin' THEN 1 ELSE 0 END ASC, sort_order ASC, created_at DESC").
		Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

// DistinctCategories 返回所有非空分类（去重、排序）
func (r *ClientRepository) DistinctCategories() ([]string, error) {
	var categories []string
	err := r.db.Model(&model.OAuth2Client{}).
		Where("category IS NOT NULL AND category != ''").
		Distinct("category").
		Order("category ASC").
		Pluck("category", &categories).Error
	return categories, err
}

// SortItem 批量排序用的 id + sort_order 对
type SortItem struct {
	ID        uuid.UUID
	SortOrder int
}

// UpdateSortOrders 批量更新应用排序值
func (r *ClientRepository) UpdateSortOrders(items []SortItem) error {
	if len(items) == 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, item := range items {
			if err := tx.Model(&model.OAuth2Client{}).
				Where("id = ?", item.ID).
				Update("sort_order", item.SortOrder).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *ClientRepository) Count() (int64, error) {
	var c int64
	err := r.db.Model(&model.OAuth2Client{}).Where("is_active = ?", true).Count(&c).Error
	return c, err
}
