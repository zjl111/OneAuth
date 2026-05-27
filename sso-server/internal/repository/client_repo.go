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

type ClientQuery struct {
	Name     string
	Page     int
	PageSize int
	OnlyActive bool
}

func (r *ClientRepository) List(q ClientQuery) ([]model.OAuth2Client, int64, error) {
	tx := r.db.Model(&model.OAuth2Client{})
	if q.Name != "" {
		tx = tx.Where("client_name LIKE ? OR client_id LIKE ?", "%"+q.Name+"%", "%"+q.Name+"%")
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
	if err := tx.Order("created_at DESC").Limit(q.PageSize).Offset((q.Page - 1) * q.PageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *ClientRepository) ListAll() ([]model.OAuth2Client, error) {
	var items []model.OAuth2Client
	if err := r.db.Where("is_active = ?", true).Order("created_at DESC").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *ClientRepository) Count() (int64, error) {
	var c int64
	err := r.db.Model(&model.OAuth2Client{}).Where("is_active = ?", true).Count(&c).Error
	return c, err
}
