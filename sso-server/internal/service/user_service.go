package service

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/password"
)

type UserService struct {
	repo *repository.UserRepository
}

func NewUserService(r *repository.UserRepository) *UserService {
	return &UserService{repo: r}
}

// staffRoleCodes 决定哪些角色 code 触发 is_staff=true。
// 业务规则：is_staff 不再是用户可勾选字段，由所选角色自动派生。
// 当前只有"超级管理员"才自动获得管理后台访问权限；其他管理类角色（app_admin/auditor）
// 通过权限授权进入，而不是 is_staff。
var staffRoleCodes = map[string]bool{
	"super_admin": true,
}

// deriveIsStaff 根据 roleIDs 查询角色 code，命中 staffRoleCodes 则返回 true。
func (s *UserService) deriveIsStaff(roleIDs []uuid.UUID) bool {
	if len(roleIDs) == 0 {
		return false
	}
	var roles []model.Role
	if err := s.repo.DB().Where("id IN ?", roleIDs).Find(&roles).Error; err != nil {
		return false
	}
	for _, r := range roles {
		if staffRoleCodes[r.Code] {
			return true
		}
	}
	return false
}

type CreateUserInput struct {
	Username     string      `json:"username" binding:"required"`
	Nickname     string      `json:"nickname"`
	Email        string      `json:"email"`
	Phone        string      `json:"phone"`
	Password     string      `json:"password" binding:"required"`
	DepartmentID *uuid.UUID  `json:"department_id"`
	IsActive     *bool       `json:"is_active"`
	RoleIDs      []uuid.UUID `json:"role_ids"`
}

func (s *UserService) Create(in CreateUserInput) (*model.User, error) {
	if err := password.Validate(in.Password); err != nil {
		return nil, err
	}
	hash, err := password.Hash(in.Password)
	if err != nil {
		return nil, err
	}
	u := &model.User{
		ID:           uuid.New(),
		Username:     in.Username,
		Nickname:     in.Nickname,
		PasswordHash: hash,
		DepartmentID: in.DepartmentID,
		IsStaff:      s.deriveIsStaff(in.RoleIDs),
		IsActive:     true,
	}
	if in.Email != "" {
		u.Email = &in.Email
	}
	if in.Phone != "" {
		u.Phone = &in.Phone
	}
	if in.IsActive != nil {
		u.IsActive = *in.IsActive
	}
	if err := s.repo.Create(u); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
			return nil, errors.New("用户名/邮箱/手机号已存在")
		}
		return nil, err
	}
	if len(in.RoleIDs) > 0 {
		s.repo.SetRoles(u.ID, in.RoleIDs)
	}
	return s.repo.GetByID(u.ID)
}

type UpdateUserInput struct {
	Nickname     *string     `json:"nickname"`
	Email        *string     `json:"email"`
	Phone        *string     `json:"phone"`
	Avatar       *string     `json:"avatar"`
	Position     *string     `json:"position"`
	DepartmentID *uuid.UUID  `json:"department_id"`
	IsActive     *bool       `json:"is_active"`
	RoleIDs      []uuid.UUID `json:"role_ids"`
}

func (s *UserService) Update(id uuid.UUID, in UpdateUserInput) (*model.User, error) {
	u, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if in.Nickname != nil {
		u.Nickname = *in.Nickname
	}
	if in.Email != nil {
		if *in.Email == "" {
			u.Email = nil
		} else {
			u.Email = in.Email
		}
	}
	if in.Phone != nil {
		if *in.Phone == "" {
			u.Phone = nil
		} else {
			u.Phone = in.Phone
		}
	}
	if in.DepartmentID != nil {
		if *in.DepartmentID == uuid.Nil {
			// 哨兵：显式清空部门
			u.DepartmentID = nil
		} else {
			u.DepartmentID = in.DepartmentID
		}
	}
	if in.Avatar != nil {
		u.Avatar = *in.Avatar
	}
	if in.Position != nil {
		u.Position = *in.Position
	}
	if in.IsActive != nil {
		u.IsActive = *in.IsActive
	}
	if in.RoleIDs != nil {
		u.IsStaff = s.deriveIsStaff(in.RoleIDs)
	}
	if err := s.repo.Update(u); err != nil {
		return nil, err
	}
	if in.RoleIDs != nil {
		s.repo.SetRoles(u.ID, in.RoleIDs)
	}
	return s.repo.GetByID(u.ID)
}

func (s *UserService) Delete(id uuid.UUID) error { return s.repo.Delete(id) }

func (s *UserService) GetByID(id uuid.UUID) (*model.User, error) { return s.repo.GetByID(id) }

func (s *UserService) GetByEmail(email string) (*model.User, error) { return s.repo.GetByEmail(email) }

func (s *UserService) List(q repository.UserQuery) ([]model.User, int64, error) {
	return s.repo.List(q)
}

func (s *UserService) Authenticate(username, plain string) (*model.User, error) {
	u, err := s.repo.GetByUsername(username)
	if err == gorm.ErrRecordNotFound {
		// 尝试邮箱
		u, err = s.repo.GetByEmail(username)
		if err == gorm.ErrRecordNotFound {
			return nil, errors.New("用户名或密码错误")
		}
	}
	if err != nil {
		return nil, err
	}
	if !u.IsActive {
		return nil, errors.New("账号已禁用")
	}
	if u.IsLocked {
		return nil, errors.New("账号已锁定")
	}
	if !password.Verify(u.PasswordHash, plain) {
		return nil, errors.New("用户名或密码错误")
	}
	now := time.Now()
	u.LastLogin = &now
	s.repo.Update(u)
	return s.repo.GetByID(u.ID)
}

func (s *UserService) ResetPassword(id uuid.UUID, newPlain string) error {
	if err := password.Validate(newPlain); err != nil {
		return err
	}
	hash, err := password.Hash(newPlain)
	if err != nil {
		return err
	}
	u, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	u.PasswordHash = hash
	return s.repo.Update(u)
}

func (s *UserService) ChangePassword(id uuid.UUID, oldPlain, newPlain string) error {
	u, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if !password.Verify(u.PasswordHash, oldPlain) {
		return errors.New("原密码错误")
	}
	return s.ResetPassword(id, newPlain)
}

func (s *UserService) Lock(id uuid.UUID, lock bool) error {
	u, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	u.IsLocked = lock
	return s.repo.Update(u)
}

func (s *UserService) Permissions(u *model.User) []string {
	if u == nil {
		return nil
	}
	// super_admin 拥有所有
	for _, r := range u.Roles {
		if r.Code == "super_admin" {
			return []string{"*"}
		}
	}
	// 这里简单将角色 code 也作为权限标识返回
	perms := []string{}
	roleCodes := []string{}
	for _, r := range u.Roles {
		roleCodes = append(roleCodes, r.Code)
	}
	if len(roleCodes) > 0 {
		// 加载关联权限
		db := s.repo.DB()
		var ps []model.Permission
		db.Joins("JOIN sso_role_permissions rp ON rp.permission_id = sso_permission.id").
			Joins("JOIN sso_role r ON r.id = rp.role_id").
			Where("r.code IN ?", roleCodes).
			Distinct("sso_permission.code").
			Find(&ps)
		for _, p := range ps {
			perms = append(perms, p.Code)
		}
	}
	if u.IsStaff && len(perms) == 0 {
		// 兜底：管理员至少能看仪表盘
		perms = append(perms, "dashboard")
	}
	return perms
}
