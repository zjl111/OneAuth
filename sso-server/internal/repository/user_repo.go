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
	// 物理删除：先清掉 many2many 关联表 sso_user_roles 里这个 user 的所有行，
	// 以及 sso_user_group_members 里的成员关系，
	// 再删用户本身。否则 user 删后角色关联行就成了孤儿（虽然没 FK 报错也无害，
	// 但留垃圾，下次 SetRoles 的 Replace 也认不出来）。
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("DELETE FROM sso_user_roles WHERE user_id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM sso_user_group_members WHERE user_id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&model.User{}, "id = ?", id).Error
	})
}

func (r *UserRepository) GetByID(id uuid.UUID) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Department").Preload("Roles").Preload("Groups").First(&u, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByUsername(username string) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Roles").Preload("Groups").First(&u, "username = ?", username).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByEmail(email string) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Roles").Preload("Groups").First(&u, "email = ?", email).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) GetByPhone(phone string) (*model.User, error) {
	var u model.User
	if err := r.db.Preload("Roles").Preload("Groups").First(&u, "phone = ?", phone).Error; err != nil {
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
	RoleID        *uuid.UUID
	RoleCode      string // 特殊处理：code="user" 表示筛选无角色的普通用户
	GroupID       *uuid.UUID
	Status        string // "active" | "locked" | "disabled"
	Page          int
	PageSize      int
	Ordering      string
}

func (r *UserRepository) List(q UserQuery) ([]model.User, int64, error) {
	tx := r.db.Model(&model.User{}).Preload("Department").Preload("Roles").Preload("Groups")
	if q.Username != "" {
		tx = tx.Where("username LIKE ?", "%"+q.Username+"%")
	}
	if q.Email != "" {
		tx = tx.Where("email LIKE ?", "%"+q.Email+"%")
	}
	if q.Keyword != "" {
		kw := "%" + q.Keyword + "%"
		tx = tx.Where(
			"username LIKE ? OR nickname LIKE ? OR email LIKE ? OR phone LIKE ?",
			kw, kw, kw, kw,
		)
	}
	if len(q.DepartmentIDs) > 0 {
		tx = tx.Where("department_id IN ?", q.DepartmentIDs)
	} else if q.DepartmentID != nil {
		tx = tx.Where("department_id = ?", *q.DepartmentID)
	}
	if q.IsActive != nil {
		tx = tx.Where("is_active = ?", *q.IsActive)
	}
	if q.RoleID != nil {
		if q.RoleCode == "user" {
			// 普通用户：筛选没有角色的用户
			tx = tx.Where("NOT EXISTS (SELECT 1 FROM sso_user_roles WHERE sso_user_roles.user_id = sso_user.id)")
		} else {
			tx = tx.Joins("JOIN sso_user_roles ON sso_user_roles.user_id = sso_user.id").
				Where("sso_user_roles.role_id = ?", *q.RoleID)
		}
	}
	if q.GroupID != nil {
		tx = tx.Joins("JOIN sso_user_group_members ON sso_user_group_members.user_id = sso_user.id").
			Where("sso_user_group_members.user_group_id = ?", *q.GroupID)
	}
	switch q.Status {
	case "active":
		tx = tx.Where("is_active = ? AND is_locked = ?", true, false)
	case "locked":
		tx = tx.Where("is_locked = ?", true)
	case "disabled":
		tx = tx.Where("is_active = ?", false)
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

func (r *UserRepository) SetGroups(userID uuid.UUID, groupIDs []uuid.UUID) error {
	user := &model.User{ID: userID}
	var groups []model.UserGroup
	if err := r.db.Where("id IN ?", groupIDs).Find(&groups).Error; err != nil {
		return err
	}
	return r.db.Model(user).Association("Groups").Replace(&groups)
}

func (r *UserRepository) CountActive() (int64, error) {
	var c int64
	err := r.db.Model(&model.User{}).Where("is_active = ?", true).Count(&c).Error
	return c, err
}
