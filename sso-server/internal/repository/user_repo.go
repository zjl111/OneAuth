package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

type UserRepository struct{ db *gorm.DB }

func NewUserRepository(db *gorm.DB) *UserRepository { return &UserRepository{db: db} }

func (r *UserRepository) DB() *gorm.DB { return r.db }

func (r *UserRepository) Create(u *model.User) error { return r.db.Create(u).Error }

func (r *UserRepository) Update(u *model.User) error { return r.db.Save(u).Error }

func (r *UserRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.User{}, "id = ?", id).Error
}

func (r *UserRepository) GetByID(id uuid.UUID) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Department").Preload("Roles").First(&u, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByUsername(username string) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Roles").First(&u, "username = ?", username).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByEmail(email string) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Roles").First(&u, "email = ?", email).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByPhone(phone string) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Roles").First(&u, "phone = ?", phone).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

type UserQuery struct {
	Username      string
	Email         string
	Keyword       string
	DepartmentID  *uuid.UUID
	DepartmentIDs []uuid.UUID
	IsActive      *bool
	Page          int
	PageSize      int
	Ordering      string
}

func (r *UserRepository) List(q UserQuery) ([]model.User, int64, error) {
	tx := r.db.Model(&model.User{}).Preload("Department").Preload("Roles")
	if q.Username != "" {
		tx = tx.Where("username LIKE ?", "%"+q.Username+"%")
	}
	if q.Email != "" {
		tx = tx.Where("email LIKE ?", "%"+q.Email+"%")
	}
	if q.Keyword != "" {
		kw := "%" + q.Keyword + "%"
		tx = tx.Where("username LIKE ? OR nickname LIKE ? OR email LIKE ?", kw, kw, kw)
	}
	if len(q.DepartmentIDs) > 0 {
		tx = tx.Where("department_id IN ?", q.DepartmentIDs)
	} else if q.DepartmentID != nil {
		tx = tx.Where("department_id = ?", *q.DepartmentID)
	}
	if q.IsActive != nil {
		tx = tx.Where("is_active = ?", *q.IsActive)
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
	order := "created_at DESC"
	if q.Ordering != "" {
		order = q.Ordering
	}
	var users []model.User
	if err := tx.Order(order).Limit(q.PageSize).Offset((q.Page - 1) * q.PageSize).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func (r *UserRepository) SetRoles(userID uuid.UUID, roleIDs []uuid.UUID) error {
	user := &model.User{ID: userID}
	var roles []model.Role
	if err := r.db.Where("id IN ?", roleIDs).Find(&roles).Error; err != nil {
		return err
	}
	return r.db.Model(user).Association("Roles").Replace(&roles)
}

func (r *UserRepository) CountActive() (int64, error) {
	var c int64
	err := r.db.Model(&model.User{}).Where("is_active = ?", true).Count(&c).Error
	return c, err
}
