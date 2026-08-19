package service

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/password"
)

type UserService struct {
	repo       *repository.UserRepository
	configRepo *repository.ConfigRepository
}

func NewUserService(r *repository.UserRepository, cfg *repository.ConfigRepository) *UserService {
	return &UserService{repo: r, configRepo: cfg}
}

// staffRoleCodes 决定哪些角色 code 触发 is_staff=true。
// 业务规则：is_staff 不再是用户可勾选字段，由所选角色自动派生。
// 当前只有"超级管理员"才自动获得管理后台访问权限；其他管理类角色（app_admin/auditor）
// 通过权限授权进入，而不是 is_staff。
var staffRoleCodes = map[string]bool{
	"super_admin": true,
}

var ErrUserProtected = errors.New("管理员用户不可删除")

func (s *UserService) passwordPolicy() (minLen int, requireUpper, requireLower, requireDigit, requireSpecial bool) {
	minLen = 8
	requireUpper = true
	requireLower = true
	requireDigit = true
	requireSpecial = true
	if s.configRepo == nil {
		return
	}
	if v := s.configRepo.Get("security", "password_min_length"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			minLen = n
		}
	}
	getBool := func(key string, fallback bool) bool {
		v := s.configRepo.Get("security", key)
		if v == "" {
			return fallback
		}
		return v == "true"
	}
	requireUpper = getBool("password_require_uppercase", true)
	requireLower = getBool("password_require_lowercase", true)
	requireDigit = getBool("password_require_digit", true)
	requireSpecial = getBool("password_require_special", true)
	return
}

func (s *UserService) validatePasswordPolicy(p string) error {
	minLen, requireUpper, requireLower, requireDigit, requireSpecial := s.passwordPolicy()
	if len(p) < minLen {
		return fmt.Errorf("密码长度至少 %d 位", minLen)
	}
	var hasUpper, hasLower, hasDigit, hasSpecial bool
	for _, r := range p {
		switch {
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsDigit(r):
			hasDigit = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			hasSpecial = true
		}
	}
	missing := make([]string, 0, 4)
	if requireUpper && !hasUpper {
		missing = append(missing, "大写字母")
	}
	if requireLower && !hasLower {
		missing = append(missing, "小写字母")
	}
	if requireDigit && !hasDigit {
		missing = append(missing, "数字")
	}
	if requireSpecial && !hasSpecial {
		missing = append(missing, "特殊字符")
	}
	if len(missing) > 0 {
		return errors.New("密码必须包含" + strings.Join(missing, "、"))
	}
	return nil
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
	Username      string      `json:"username" binding:"required"`
	Nickname      string      `json:"nickname"`
	Email         string      `json:"email"`
	Phone         string      `json:"phone"`
	Password      string      `json:"password" binding:"required"`
	Avatar        string      `json:"avatar"`
	Gender        string      `json:"gender"`
	EmployeeNo    string      `json:"employee_no"`
	DomainAccount string      `json:"domain_account"`
	UserSource    string      `json:"user_source"`
	HireStatus    string      `json:"hire_status"`
	SortOrder     int         `json:"sort_order"`
	DepartmentID  *uuid.UUID  `json:"department_id"`
	IsActive      *bool       `json:"is_active"`
	RoleIDs       []uuid.UUID `json:"role_ids"`
}

func (s *UserService) Create(in CreateUserInput) (*model.User, error) {
	if err := s.validatePasswordPolicy(in.Password); err != nil {
		return nil, err
	}
	hash, err := password.Hash(in.Password)
	if err != nil {
		return nil, err
	}
	u := &model.User{
		ID:            uuid.New(),
		Username:      in.Username,
		Nickname:      in.Nickname,
		PasswordHash:  hash,
		Avatar:        in.Avatar,
		Gender:        in.Gender,
		EmployeeNo:    in.EmployeeNo,
		DomainAccount: in.DomainAccount,
		UserSource:    defaultStr(in.UserSource, "local"),
		HireStatus:    defaultStr(in.HireStatus, "active"),
		SortOrder:     in.SortOrder,
		DepartmentID:  in.DepartmentID,
		IsStaff:       s.deriveIsStaff(in.RoleIDs),
		IsActive:      true,
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
	// 创建前预检：精确告诉用户是哪一项重复
	if _, err := s.repo.GetByUsername(in.Username); err == nil {
		return nil, errors.New("登录账号 " + in.Username + " 已存在")
	}
	if in.Email != "" {
		if _, err := s.repo.GetByEmail(in.Email); err == nil {
			return nil, errors.New("邮箱 " + in.Email + " 已被其他用户使用")
		}
	}
	if in.Phone != "" {
		if _, err := s.repo.GetByPhone(in.Phone); err == nil {
			return nil, errors.New("手机号 " + in.Phone + " 已被其他用户使用")
		}
	}
	if err := s.repo.Create(u); err != nil {
		if strings.Contains(err.Error(), "UNIQUE") || strings.Contains(err.Error(), "duplicate") {
			return nil, errors.New("登录账号 / 邮箱 / 手机号已存在")
		}
		return nil, err
	}
	if len(in.RoleIDs) > 0 {
		s.repo.SetRoles(u.ID, in.RoleIDs)
	}
	return s.repo.GetByID(u.ID)
}

type UpdateUserInput struct {
	Username      *string     `json:"username"`
	Nickname      *string     `json:"nickname"`
	Email         *string     `json:"email"`
	Phone         *string     `json:"phone"`
	Avatar        *string     `json:"avatar"`
	Position      *string     `json:"position"`
	Gender        *string     `json:"gender"`
	EmployeeNo    *string     `json:"employee_no"`
	DomainAccount *string     `json:"domain_account"`
	UserSource    *string     `json:"user_source"`
	HireStatus    *string     `json:"hire_status"`
	SortOrder     *int        `json:"sort_order"`
	DepartmentID  *uuid.UUID  `json:"department_id"`
	IsActive      *bool       `json:"is_active"`
	RoleIDs       []uuid.UUID `json:"role_ids"`
	GroupIDs      []uuid.UUID `json:"group_ids"`
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
		newEmail := strings.TrimSpace(*in.Email)
		// 邮箱唯一性校验（避免与其它用户重复，触发 DB 唯一索引报错）
		if newEmail != "" {
			if existing, err := s.repo.GetByEmail(newEmail); err == nil && existing.ID != u.ID {
				return nil, errors.New("邮箱 " + newEmail + " 已存在")
			}
		}
		if newEmail == "" {
			u.Email = nil
		} else {
			u.Email = &newEmail
		}
	}
	// 登录账号：仅平台（同步）用户允许修改；本地用户保持"创建后不可更改"。
	// 改过后置 ProfileManuallyEdited=true，后续目录同步不再覆盖其账号/邮箱。
	if in.Username != nil && u.UserSource == "platform" {
		newUsername := strings.TrimSpace(*in.Username)
		if newUsername != u.Username {
			if existing, err := s.repo.GetByUsername(newUsername); err == nil && existing.ID != u.ID {
				return nil, errors.New("登录账号 " + newUsername + " 已存在")
			}
			u.Username = newUsername
			u.ProfileManuallyEdited = true
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
		// 关键：清掉预加载的 Department 关联对象。
		// User 模型上 `Department *Department gorm:"foreignKey:DepartmentID"` 是 belongs-to，
		// db.Save 会用 u.Department.ID 反向同步 u.DepartmentID —— 即使我们改了 u.DepartmentID，
		// 只要 u.Department 还指向旧部门对象（从 GetByID 的 Preload 来的），保存后就会被覆盖回旧值。
		// 这就是用户报告的"变更部门不生效"的根因。
		u.Department = nil
	}
	if in.Avatar != nil {
		u.Avatar = *in.Avatar
	}
	if in.Position != nil {
		u.Position = *in.Position
	}
	if in.Gender != nil {
		u.Gender = *in.Gender
	}
	if in.EmployeeNo != nil {
		u.EmployeeNo = *in.EmployeeNo
	}
	if in.DomainAccount != nil {
		u.DomainAccount = *in.DomainAccount
	}
	if in.UserSource != nil {
		u.UserSource = *in.UserSource
	}
	if in.HireStatus != nil {
		u.HireStatus = *in.HireStatus
	}
	if in.SortOrder != nil {
		u.SortOrder = *in.SortOrder
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
	if in.GroupIDs != nil {
		s.repo.SetGroups(u.ID, in.GroupIDs)
	}
	return s.repo.GetByID(u.ID)
}

func (s *UserService) Delete(id uuid.UUID) error {
	u, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if u.Username == "admin" {
		return ErrUserProtected
	}
	return s.repo.Delete(id)
}

func (s *UserService) GetByID(id uuid.UUID) (*model.User, error) { return s.repo.GetByID(id) }

func (s *UserService) GetByUsername(username string) (*model.User, error) {
	return s.repo.GetByUsername(username)
}

func (s *UserService) GetByEmail(email string) (*model.User, error) { return s.repo.GetByEmail(email) }

// FindLoginUser 按账号或邮箱查找登录用户。
// 若用户处于“临时锁定”且锁定时间已过，则在这里顺手解锁，避免已过期的锁一直影响登录。
func (s *UserService) FindLoginUser(loginName string) (*model.User, error) {
	u, err := s.repo.GetByUsername(loginName)
	if err == gorm.ErrRecordNotFound {
		u, err = s.repo.GetByEmail(loginName)
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
	}
	if err != nil {
		return nil, err
	}
	if u.IsLocked && u.LockUntil != nil && time.Now().After(*u.LockUntil) {
		u.IsLocked = false
		u.LockUntil = nil
		u.LockReason = ""
		if err := s.repo.Update(u); err != nil {
			return nil, err
		}
	}
	return u, nil
}

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
		if u.LockUntil != nil {
			if time.Now().After(*u.LockUntil) {
				u.IsLocked = false
				u.LockUntil = nil
				u.LockReason = ""
				if err := s.repo.Update(u); err != nil {
					return nil, err
				}
			} else {
				return nil, errors.New(fmt.Sprintf("账号已锁定，请于 %s 后重试", u.LockUntil.Format("2006-01-02 15:04")))
			}
		} else {
			// 永久锁定：附带原因
			if reasonText := LockReasonText(u.LockReason); reasonText != "" {
				return nil, errors.New("账号已锁定：" + reasonText + "，请联系管理员解锁")
			}
			return nil, errors.New("账号已锁定，请联系管理员解锁")
		}
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
	if err := s.validatePasswordPolicy(newPlain); err != nil {
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
	if err := s.validatePasswordPolicy(newPlain); err != nil {
		return err
	}
	return s.ResetPassword(id, newPlain)
}

func (s *UserService) Lock(id uuid.UUID, lock bool, reason string) error {
	u, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	u.IsLocked = lock
	if lock {
		u.LockReason = reason
	} else {
		u.LockReason = ""
	}
	u.LockUntil = nil
	return s.repo.Update(u)
}

func (s *UserService) LockUntil(id uuid.UUID, until *time.Time, reason string) error {
	u, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	u.IsLocked = true
	u.LockUntil = until
	u.LockReason = reason
	return s.repo.Update(u)
}

// LockReasonText 返回锁定原因的可读中文描述
func LockReasonText(reason string) string {
	switch reason {
	case "inactivity":
		return "超过30天未登录，系统自动锁定"
	case "login_failure":
		return "登录失败次数过多，被自动锁定"
	case "wecom_missing":
		return "企业微信同步时账号不存在，被自动锁定"
	case "source_missing":
		return "同步用户的来源不存在"
	case "manual":
		return "管理员手动锁定"
	default:
		return ""
	}
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
