package repository

import (
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

type UserGroupRepository struct{ db *gorm.DB }

func NewUserGroupRepository(db *gorm.DB) *UserGroupRepository { return &UserGroupRepository{db: db} }

func (r *UserGroupRepository) DB() *gorm.DB { return r.db }

func (r *UserGroupRepository) List() ([]model.UserGroup, error) {
	var items []model.UserGroup
	err := r.db.Order("created_at DESC").Find(&items).Error
	return items, err
}

// ListWithCount 列表 + 每个组的成员数（避免 N+1）
type UserGroupWithCount struct {
	model.UserGroup
	MemberCount int64 `json:"member_count"`
}

func (r *UserGroupRepository) ListWithCount() ([]UserGroupWithCount, error) {
	var groups []model.UserGroup
	if err := r.db.Order("created_at DESC").Find(&groups).Error; err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return []UserGroupWithCount{}, nil
	}
	type row struct {
		UserGroupID uuid.UUID
		Cnt         int64
	}
	var rows []row
	r.db.Table("sso_user_group_members").
		Select("user_group_id, COUNT(*) as cnt").
		Group("user_group_id").
		Scan(&rows)
	cntMap := make(map[uuid.UUID]int64, len(rows))
	for _, x := range rows {
		cntMap[x.UserGroupID] = x.Cnt
	}
	out := make([]UserGroupWithCount, 0, len(groups))
	for _, g := range groups {
		out = append(out, UserGroupWithCount{UserGroup: g, MemberCount: cntMap[g.ID]})
	}
	return out, nil
}

func (r *UserGroupRepository) Get(id uuid.UUID) (*model.UserGroup, error) {
	var g model.UserGroup
	if err := r.db.First(&g, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &g, nil
}

func (r *UserGroupRepository) Create(g *model.UserGroup) error { return r.db.Create(g).Error }

func (r *UserGroupRepository) Update(g *model.UserGroup) error {
	return r.db.Model(g).Updates(map[string]any{
		"name":        g.Name,
		"description": g.Description,
	}).Error
}

func (r *UserGroupRepository) Delete(id uuid.UUID) error {
	// 解绑成员关系（GORM many2many 不会自动级联），再删组
	if err := r.db.Exec("DELETE FROM sso_user_group_members WHERE user_group_id = ?", id).Error; err != nil {
		return err
	}
	return r.db.Delete(&model.UserGroup{}, "id = ?", id).Error
}

// ListMembers 拉取组的全部成员（含部门 / 角色 preload）
func (r *UserGroupRepository) ListMembers(id uuid.UUID) ([]model.User, error) {
	var g model.UserGroup
	err := r.db.Preload("Members.Department").Preload("Members.Roles").
		Preload("Members", func(tx *gorm.DB) *gorm.DB {
			return tx.Order("sso_user.created_at DESC")
		}).
		First(&g, "id = ?", id).Error
	if err != nil {
		return nil, err
	}
	return g.Members, nil
}

// SetMembers 全量重置组成员列表
func (r *UserGroupRepository) SetMembers(id uuid.UUID, userIDs []uuid.UUID) error {
	group := &model.UserGroup{ID: id}
	var users []model.User
	if len(userIDs) > 0 {
		if err := r.db.Where("id IN ?", userIDs).Find(&users).Error; err != nil {
			return err
		}
	}
	return r.db.Model(group).Association("Members").Replace(&users)
}
