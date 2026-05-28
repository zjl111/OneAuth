package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

type AppGrantRepository struct{ db *gorm.DB }

func (r *AppGrantRepository) DB() *gorm.DB { return r.db }

func NewAppGrantRepository(db *gorm.DB) *AppGrantRepository { return &AppGrantRepository{db: db} }

// ListByClient 列出某应用的所有授权
func (r *AppGrantRepository) ListByClient(clientID string) ([]model.AppGrant, error) {
	var items []model.AppGrant
	err := r.db.Where("client_id = ?", clientID).
		Order("principal_type, created_at").
		Find(&items).Error
	return items, err
}

// HasAnyGrant 判断某应用是否配置了任何授权（控制"白名单门"是否启用）
func (r *AppGrantRepository) HasAnyGrant(clientID string) (bool, error) {
	var n int64
	err := r.db.Model(&model.AppGrant{}).Where("client_id = ?", clientID).Count(&n).Error
	return n > 0, err
}

// UserAllowed 判断用户是否能访问该应用：
//   - 应用无任何授权 → 允许（默认开放）
//   - 否则：用户本身 / 用户的角色 / 用户的用户组 命中任一 grant → 允许
func (r *AppGrantRepository) UserAllowed(clientID string, userID uuid.UUID) (bool, error) {
	has, err := r.HasAnyGrant(clientID)
	if err != nil {
		return false, err
	}
	if !has {
		return true, nil
	}

	// 用户直接命中
	var n int64
	if err := r.db.Model(&model.AppGrant{}).
		Where("client_id = ? AND principal_type = 'user' AND principal_id = ?", clientID, userID).
		Count(&n).Error; err != nil {
		return false, err
	}
	if n > 0 {
		return true, nil
	}

	// 角色命中
	r.db.Raw(`SELECT COUNT(*) FROM sso_app_grant g
		JOIN sso_user_roles ur ON ur.role_id = g.principal_id
		WHERE g.client_id = ? AND g.principal_type = 'role' AND ur.user_id = ?`,
		clientID, userID).Scan(&n)
	if n > 0 {
		return true, nil
	}

	// 用户组命中
	r.db.Raw(`SELECT COUNT(*) FROM sso_app_grant g
		JOIN sso_user_group_members m ON m.user_group_id = g.principal_id
		WHERE g.client_id = ? AND g.principal_type = 'group' AND m.user_id = ?`,
		clientID, userID).Scan(&n)
	return n > 0, nil
}

// AllowedClientIDs 一次查出用户可访问的所有 client_id（用于门户列表过滤）
func (r *AppGrantRepository) AllowedClientIDs(userID uuid.UUID) (map[string]bool, error) {
	out := make(map[string]bool)
	rows, err := r.db.Raw(`
		SELECT DISTINCT client_id FROM sso_app_grant WHERE principal_type = 'user' AND principal_id = ?
		UNION
		SELECT DISTINCT g.client_id FROM sso_app_grant g
			JOIN sso_user_roles ur ON ur.role_id = g.principal_id
			WHERE g.principal_type = 'role' AND ur.user_id = ?
		UNION
		SELECT DISTINCT g.client_id FROM sso_app_grant g
			JOIN sso_user_group_members m ON m.user_group_id = g.principal_id
			WHERE g.principal_type = 'group' AND m.user_id = ?
	`, userID, userID, userID).Rows()
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid string
		_ = rows.Scan(&cid)
		out[cid] = true
	}
	return out, nil
}

// ClientsWithGrant 返回所有有授权配置的应用 client_id 集合（用于判断哪些应用是"白名单受限"的）
func (r *AppGrantRepository) ClientsWithGrant() (map[string]bool, error) {
	out := make(map[string]bool)
	var ids []string
	if err := r.db.Model(&model.AppGrant{}).Distinct("client_id").Pluck("client_id", &ids).Error; err != nil {
		return out, err
	}
	for _, c := range ids {
		out[c] = true
	}
	return out, nil
}

func (r *AppGrantRepository) Add(g *model.AppGrant) error {
	// 幂等：如果已经存在同样的三元组就跳过
	var existing model.AppGrant
	err := r.db.Where("client_id = ? AND principal_type = ? AND principal_id = ?",
		g.ClientID, g.PrincipalType, g.PrincipalID).First(&existing).Error
	if err == nil {
		*g = existing
		return nil
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	return r.db.Create(g).Error
}

func (r *AppGrantRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.AppGrant{}, "id = ?", id).Error
}

// SetGrants 全量替换某应用的授权列表
func (r *AppGrantRepository) SetGrants(clientID string, grants []model.AppGrant) error {
	tx := r.db.Begin()
	if err := tx.Where("client_id = ?", clientID).Delete(&model.AppGrant{}).Error; err != nil {
		tx.Rollback()
		return err
	}
	for i := range grants {
		grants[i].ClientID = clientID
		if err := tx.Create(&grants[i]).Error; err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit().Error
}
