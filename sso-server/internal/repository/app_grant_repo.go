package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

// AppGrantRepository 应用授权仓储。
//
// 应用的可见性由 sso_oauth2_client.access_policy 决定：
//   all      -> 所有登录用户可见
//   assigned -> 显式指定（user/group/org 任意混选，写入 sso_app_grant）
//   none     -> 暂不授权（仅 super_admin 兜底可见）
//
// principal_type 取值：user | group | org
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

// UserAllowed 判断用户是否能访问该应用。
// 调用方需事先拿到 client.GrantMode：
//   public -> 直接放行（不调用本函数）
//   user/group/org -> 查 sso_app_grant 表
func (r *AppGrantRepository) UserAllowed(clientID string, userID uuid.UUID) (bool, error) {
	// user 直接命中
	var n int64
	if err := r.db.Model(&model.AppGrant{}).
		Where("client_id = ? AND principal_type = 'user' AND principal_id = ?", clientID, userID).
		Count(&n).Error; err != nil {
		return false, err
	}
	if n > 0 {
		return true, nil
	}

	// group 命中：用户在某个授权用户组里
	r.db.Raw(`SELECT COUNT(*) FROM sso_app_grant g
		JOIN sso_user_group_members m ON m.user_group_id = g.principal_id
		WHERE g.client_id = ? AND g.principal_type = 'group' AND m.user_id = ?`,
		clientID, userID).Scan(&n)
	if n > 0 {
		return true, nil
	}

	// org 命中：用户的部门在授权部门列表里
	r.db.Raw(`SELECT COUNT(*) FROM sso_app_grant g
		JOIN sso_user u ON u.department_id = g.principal_id
		WHERE g.client_id = ? AND g.principal_type = 'org' AND u.id = ?`,
		clientID, userID).Scan(&n)
	return n > 0, nil
}

// AllowedClientIDs 一次查出用户可访问的所有 client_id（用户/用户组/组织三条管道并集）
func (r *AppGrantRepository) AllowedClientIDs(userID uuid.UUID) (map[string]bool, error) {
	out := make(map[string]bool)
	rows, err := r.db.Raw(`
		SELECT DISTINCT client_id FROM sso_app_grant
			WHERE principal_type = 'user' AND principal_id = ?
		UNION
		SELECT DISTINCT g.client_id FROM sso_app_grant g
			JOIN sso_user_group_members m ON m.user_group_id = g.principal_id
			WHERE g.principal_type = 'group' AND m.user_id = ?
		UNION
		SELECT DISTINCT g.client_id FROM sso_app_grant g
			JOIN sso_user u ON u.department_id = g.principal_id
			WHERE g.principal_type = 'org' AND u.id = ?
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

// SetGrants 全量替换某应用的授权列表（事务）
func (r *AppGrantRepository) SetGrants(clientID string, grants []model.AppGrant) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("client_id = ?", clientID).Delete(&model.AppGrant{}).Error; err != nil {
			return err
		}
		for i := range grants {
			grants[i].ClientID = clientID
			grants[i].ID = uuid.Nil // BeforeCreate 会重新生成
			if err := tx.Create(&grants[i]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// DeleteByClient 应用删除时一并清掉所有 grant
func (r *AppGrantRepository) DeleteByClient(clientID string) error {
	return r.db.Where("client_id = ?", clientID).Delete(&model.AppGrant{}).Error
}
