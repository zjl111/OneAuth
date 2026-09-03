package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/crypto"
	"sso-server/pkg/password"
)

const DirectoryProviderWeComAttendance = "wecom_attendance"

// DirectoryProviderWeCom 企业微信通讯录：直接走企业微信 API，复用全局 wecom 配置，
// 无需第三方平台地址与 API Key。
const DirectoryProviderWeCom = "wecom"

// defaultPasswordFallback 当配置未显式设置默认密码（security.default_password 为空）时，
// 新建平台账号使用的兜底默认密码。固定值，避免每次同步都生成不可登录的随机密码。
const defaultPasswordFallback = "OneAuth@2026"

type DirectorySyncService struct {
	configRepo   *repository.ConfigRepository
	userRepo     *repository.UserRepository
	deptRepo     *repository.DepartmentRepository
	groupRepo    *repository.UserGroupRepository
	db           *gorm.DB
	client       *http.Client
	secretCipher *crypto.SecretCipher
	// defaultPassword 新建账号的默认密码；为空时回退到固定兜底密码（OneAuth@2026）。
	defaultPassword string
	// WeCom 企业微信通讯录拉取（仅 platform_type=wecom 时使用）。
	WeCom *WeComService
}

func NewDirectorySyncService(configRepo *repository.ConfigRepository, userRepo *repository.UserRepository, deptRepo *repository.DepartmentRepository, groupRepo *repository.UserGroupRepository, secretCipher *crypto.SecretCipher, defaultPassword string, wecom *WeComService) *DirectorySyncService {
	return &DirectorySyncService{
		configRepo:      configRepo,
		userRepo:        userRepo,
		deptRepo:        deptRepo,
		groupRepo:       groupRepo,
		db:              userRepo.DB(),
		client:          &http.Client{Timeout: 20 * time.Second},
		secretCipher:    secretCipher,
		defaultPassword: strings.TrimSpace(defaultPassword),
		WeCom:           wecom,
	}
}

// encryptSecret 仅当明文非空时加密后返回；密文/空值原样处理。
func (s *DirectorySyncService) encryptSecret(plain string) (string, error) {
	if s.secretCipher == nil {
		return strings.TrimSpace(plain), nil
	}
	return s.secretCipher.EncryptSecret(plain)
}

// decryptSecret 解密存储值；若未加密（历史明文）原样返回。
func (s *DirectorySyncService) decryptSecret(stored string) (string, error) {
	if s.secretCipher == nil {
		return stored, nil
	}
	return s.secretCipher.DecryptSecret(stored)
}

type DirectorySyncConfig struct {
	Enabled                 bool                `json:"enabled"`
	PlatformType            string              `json:"platform_type"`
	BaseURL                 string              `json:"base_url"`
	APIKey                  string              `json:"api_key,omitempty"`
	APIKeySet               bool                `json:"api_key_set"`
	SelectedDepartmentPaths []string            `json:"selected_department_paths"`
	StripPrefix             string              `json:"strip_prefix"`
	MountDepartmentID       string              `json:"mount_department_id"`
	DeactivateMissing       bool                `json:"deactivate_missing"`
	UsernameStrategy        string              `json:"username_strategy"`
	EmailStrategy           string              `json:"email_strategy"`
	EmailDomain             string              `json:"email_domain"`
	FieldMapping            map[string]string   `json:"field_mapping"`
	MappingMode             bool                `json:"mapping_mode"`
	DepartmentMappings      []DepartmentMapping `json:"department_mappings"`
	// DefaultGroupIDs 同步导入的用户自动加入的用户组（按组 ID）。为空则不自动加组。
	DefaultGroupIDs []string `json:"default_group_ids"`
}

// DepartmentMapping 部门手动匹配：将某一个远端部门一对一映射到本地部门。
// 启用 MappingMode 后，同步不再按路径自动创建部门，也不修改本地部门。
//   - 常规匹配：local_department_id 指向本地已存在的部门；
//   - 按需新建匹配：create_local=true 且 new_dept_name 非空，表示「待创建部门」，
//     仅在同步时确实有用户归属于该部门才真正新建，避免产生空部门。
//
// 仅把已勾选（include=true 且上述二者其一成立）的远端部门下的用户同步到对应本地部门。
type DepartmentMapping struct {
	RemoteExternalID  string `json:"remote_external_id"`
	RemotePath        string `json:"remote_path"`
	RemoteName        string `json:"remote_name"`
	LocalDepartmentID string `json:"local_department_id"`
	CreateLocal       bool   `json:"create_local"`
	NewDeptName       string `json:"new_dept_name"`
	NewDeptParentID   string `json:"new_dept_parent_id"`
	Include           bool   `json:"include"`
}

// mappingTarget 表示一个远端路径解析后的目标部门。
type mappingTarget struct {
	kind      string     // "existing" 已存在本地部门；"create" 待创建部门（按需）
	localID   uuid.UUID  // existing 时有效
	name      string     // create 时有效：新部门名称
	parentID  *uuid.UUID // create 时有效：新部门上级部门（nil 表示根目录）
	remoteKey string     // 触发创建的远端路径（用于部门绑定记录）
	createdID *uuid.UUID // 懒创建后缓存的真实部门 ID
}

type DirectoryDepartment struct {
	ExternalID string                `json:"external_id"`
	ID         string                `json:"id"`
	Name       string                `json:"name"`
	Path       string                `json:"path"`
	ParentPath string                `json:"parent_path"`
	Children   []DirectoryDepartment `json:"children,omitempty"`
}

type DirectorySyncSummary struct {
	DryRun            bool              `json:"dry_run"`
	Status            string            `json:"status"`
	DepartmentCreated int               `json:"department_created"`
	DepartmentMatched int               `json:"department_matched"`
	UserCreated       int               `json:"user_created"`
	UserUpdated       int               `json:"user_updated"`
	UserDisabled      int               `json:"user_disabled"`
	UserSkipped       int               `json:"user_skipped"`
	UserFailed        int               `json:"user_failed"`
	Message           string            `json:"message"`
	Details           []string          `json:"details"`
	UserDetails       []UserSyncDetail  `json:"user_details"`
	MappingPreview    []SyncPreviewDept `json:"mapping_preview"`
}

// UserSyncDetail 为同步结果中的逐用户明细，供管理端查看跳过、禁用和失败对象及原因。
type UserSyncDetail struct {
	Type       string `json:"type"` // skipped | disabled | failed
	Name       string `json:"name"`
	Username   string `json:"username"`
	ExternalID string `json:"external_id,omitempty"`
	Reason     string `json:"reason"`
}

type DirectorySyncResetResult struct {
	DepartmentsDeleted int `json:"departments_deleted"`
	UsersMoved         int `json:"users_moved"`
	BindingsDeleted    int `json:"bindings_deleted"`
}

// SyncPreviewUser 预览树中的单个用户节点。
type SyncPreviewUser struct {
	Name           string `json:"name"`
	Username       string `json:"username"`        // 将落库的真实用户名（经策略换算，全小写）
	SourceUsername string `json:"source_username"` // 远端原始账号（大小写原样，供对照）
	Email          string `json:"email"`
	Status         string `json:"status"` // "create" 新建 | "update" 更新
}

// SyncPreviewDept 预览树中的部门节点（含子部门与直属用户），用于「我选中部门的全部待同步用户」树形展示。
type SyncPreviewDept struct {
	RemotePath string            `json:"remote_path"`
	RemoteName string            `json:"remote_name"`
	UserCount  int               `json:"user_count"`
	Users      []SyncPreviewUser `json:"users"`
	Children   []SyncPreviewDept `json:"children"`
}

// UserImportPreviewItem 是「用户导入」表格中的一行，对应一个将被同步的远端用户。
type UserImportPreviewItem struct {
	ExternalID     string   `json:"external_id"`
	Status         string   `json:"status"`   // "create" 新建 | "update" 更新
	Username       string   `json:"username"` // 将落库的真实用户名（经策略换算，全小写）
	Name           string   `json:"name"`
	Email          string   `json:"email"`
	SourceUsername string   `json:"source_username"` // 远端原始账号（如企微 userid），未经策略换算，供对照
	Groups         []string `json:"groups"`          // 用户所属远端部门路径（用户组/部门，仅作来源追溯）
	Department     string   `json:"department"`      // 解析后将要落库的本地部门名称（所见即所得）
	Exists         bool     `json:"exists"`          // 是否已存在于本地系统
}

// UserImportPreview 是「用户导入」弹框的分页预览结果。
type UserImportPreview struct {
	SyncAt          string                  `json:"sync_at"`
	Progress        int                     `json:"progress"` // 0-100，拉取未完成时显示进度
	Total           int                     `json:"total"`
	Page            int                     `json:"page"`
	PageSize        int                     `json:"page_size"`
	DefaultPassword string                  `json:"default_password"`
	Users           []UserImportPreviewItem `json:"users"`
}

type directorySnapshot struct {
	Departments []map[string]any `json:"departments"`
	Users       []map[string]any `json:"users"`
}

func defaultDirectoryFieldMapping() map[string]string {
	return map[string]string{
		"external_id":      "externalId",
		"username":         "userId",
		"nickname":         "userName",
		"email":            "email",
		"given_name":       "givenName",
		"surname":          "surname",
		"phone":            "phone",
		"position":         "position",
		"department_path":  "departmentPath",
		"department_paths": "departmentPaths",
		"active":           "isActive",
	}
}

func (s *DirectorySyncService) LoadConfig(maskSecret bool) DirectorySyncConfig {
	cfg := DirectorySyncConfig{
		PlatformType:      DirectoryProviderWeComAttendance,
		DeactivateMissing: true,
		UsernameStrategy:  "smart_pinyin",
		FieldMapping:      defaultDirectoryFieldMapping(),
	}
	if s.configRepo == nil {
		return cfg
	}
	cfg.Enabled = s.configRepo.Get("directory_sync", "enabled") == "true"
	if v := strings.TrimSpace(s.configRepo.Get("directory_sync", "platform_type")); v != "" {
		cfg.PlatformType = v
	}
	cfg.BaseURL = strings.TrimSpace(s.configRepo.Get("directory_sync", "base_url"))
	if raw := s.configRepo.Get("directory_sync", "api_key"); raw != "" {
		cfg.APIKeySet = true
		if !maskSecret {
			if dec, err := s.decryptSecret(raw); err == nil {
				cfg.APIKey = dec
			}
		}
	}
	if raw := s.configRepo.Get("directory_sync", "selected_department_paths"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &cfg.SelectedDepartmentPaths)
	}
	cfg.StripPrefix = strings.TrimSpace(s.configRepo.Get("directory_sync", "strip_prefix"))
	cfg.MountDepartmentID = strings.TrimSpace(s.configRepo.Get("directory_sync", "mount_department_id"))
	if v := s.configRepo.Get("directory_sync", "deactivate_missing"); v != "" {
		cfg.DeactivateMissing = v == "true"
	}
	if v := strings.TrimSpace(s.configRepo.Get("directory_sync", "username_strategy")); v != "" {
		cfg.UsernameStrategy = v
	}
	if v := strings.TrimSpace(s.configRepo.Get("directory_sync", "email_strategy")); v != "" {
		cfg.EmailStrategy = v
	}
	cfg.EmailDomain = strings.TrimSpace(s.configRepo.Get("directory_sync", "email_domain"))
	if raw := s.configRepo.Get("directory_sync", "field_mapping"); raw != "" {
		m := defaultDirectoryFieldMapping()
		var incoming map[string]string
		if json.Unmarshal([]byte(raw), &incoming) == nil {
			for k, v := range incoming {
				if strings.TrimSpace(v) != "" {
					m[k] = strings.TrimSpace(v)
				}
			}
		}
		cfg.FieldMapping = m
	}
	if v := s.configRepo.Get("directory_sync", "mapping_mode"); v != "" {
		cfg.MappingMode = v == "true"
	}
	if raw := s.configRepo.Get("directory_sync", "department_mappings"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &cfg.DepartmentMappings)
	}
	if raw := s.configRepo.Get("directory_sync", "default_group_ids"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &cfg.DefaultGroupIDs)
	}
	return cfg
}

func (s *DirectorySyncService) SaveConfig(in DirectorySyncConfig) error {
	if s.configRepo == nil {
		return errors.New("配置仓库未初始化")
	}
	if strings.TrimSpace(in.PlatformType) == "" {
		in.PlatformType = DirectoryProviderWeComAttendance
	}
	if strings.TrimSpace(in.UsernameStrategy) == "" {
		in.UsernameStrategy = "smart_pinyin"
	}
	if in.FieldMapping == nil {
		in.FieldMapping = defaultDirectoryFieldMapping()
	}
	if strings.TrimSpace(in.EmailStrategy) != "" && strings.TrimSpace(in.EmailDomain) == "" {
		return errors.New("邮箱策略已启用，请先填写邮箱域名")
	}
	// 在写入新配置**之前**捕获旧平台类型：下面 items 会把 platform_type 覆盖为新值，
	// 若之后再 Get 只会读到新值，无法判断是否发生了平台切换。
	oldPlatform := strings.TrimSpace(s.configRepo.Get("directory_sync", "platform_type"))
	selected, _ := json.Marshal(in.SelectedDepartmentPaths)
	mapping, _ := json.Marshal(in.FieldMapping)
	mappings, _ := json.Marshal(in.DepartmentMappings)
	defaultGroups, _ := json.Marshal(in.DefaultGroupIDs)
	items := map[string]string{
		"enabled":                   strconv.FormatBool(in.Enabled),
		"platform_type":             strings.TrimSpace(in.PlatformType),
		"base_url":                  strings.TrimRight(strings.TrimSpace(in.BaseURL), "/"),
		"selected_department_paths": string(selected),
		"strip_prefix":              trimSlashes(in.StripPrefix),
		"mount_department_id":       strings.TrimSpace(in.MountDepartmentID),
		"deactivate_missing":        strconv.FormatBool(in.DeactivateMissing),
		"username_strategy":         strings.TrimSpace(in.UsernameStrategy),
		"email_strategy":            strings.TrimSpace(in.EmailStrategy),
		"email_domain":              strings.TrimSpace(in.EmailDomain),
		"field_mapping":             string(mapping),
		"mapping_mode":              strconv.FormatBool(in.MappingMode),
		"department_mappings":       string(mappings),
		"default_group_ids":         string(defaultGroups),
	}
	for k, v := range items {
		if err := s.configRepo.Set("directory_sync", k, v); err != nil {
			return err
		}
	}
	if strings.TrimSpace(in.APIKey) != "" {
		enc, err := s.encryptSecret(in.APIKey)
		if err != nil {
			return fmt.Errorf("加密 api_key 失败: %w", err)
		}
		if err := s.configRepo.Set("directory_sync", "api_key", enc); err != nil {
			return err
		}
	}

	// 平台类型切换：检测到 platform_type 从旧值变为新值（且两者都非空、确实变化），
	// 清理旧平台「用户导入」缓冲预览表（sso_directory_sync_buffer）中该旧 provider 的行，
	// 让切换后重新拉取新平台快照、刷新导入预览。
	// ⚠️ 身份目录的用户主表 sso_user 及其任何关联（角色/组成员/绑定）一律不动——
	// 用户明确要求：用户表无论如何不能乱动，切换平台只清缓冲预览数据。
	// 注意：oldPlatform 必须在写入前捕获（见上方），否则会读到已被覆盖的新值。
	newPlatform := strings.TrimSpace(in.PlatformType)
	if newPlatform != "" && oldPlatform != "" && newPlatform != oldPlatform {
		removed, err := s.cleanupPlatformBuffer(oldPlatform)
		if err != nil {
			return fmt.Errorf("切换同步平台失败：清理旧平台[%s]同步缓冲出错: %w", oldPlatform, err)
		}
		log.Printf("[dir-sync] 同步平台由 %s 切换为 %s，已删除旧平台导入缓冲 %d 条（身份目录用户表未改动）", oldPlatform, newPlatform, removed)
	}
	return nil
}

// cleanupPlatformBuffer 仅删除旧平台在「用户导入」缓冲预览表 sso_directory_sync_buffer 中
// 的缓冲行（同步平台切换时调用）。
// ⚠️ 本方法严格只操作缓冲表，绝不触碰身份目录的用户主表 sso_user，也不动
// 用户角色 / 用户组成员 / 同步绑定 等任何用户关联数据——这些属于"用户表"，
// 用户明确要求无论如何不能乱动。
// 切换平台后，下一次「同步用户」会按新平台重新拉取快照并重建缓冲表。
func (s *DirectorySyncService) cleanupPlatformBuffer(oldProvider string) (int, error) {
	var removed int
	err := s.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Where("provider = ?", oldProvider).Delete(&model.DirectorySyncBuffer{})
		if res.Error != nil {
			return res.Error
		}
		removed = int(res.RowsAffected)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return removed, nil
}

// ResetManagedDepartments 清理当前同步源自动创建的本地组织，供管理员重新映射。
// 只删除带有目录同步标记的部门，手工创建/手工选中的本地组织不会被删除。
// 删除前先把用户和非同步子部门移到挂载组织，避免产生新的孤儿数据。
func (s *DirectorySyncService) ResetManagedDepartments() (*DirectorySyncResetResult, error) {
	cfg := s.LoadConfig(false)
	provider := strings.TrimSpace(cfg.PlatformType)
	if provider == "" {
		return nil, errors.New("请先配置同步平台")
	}
	result := &DirectorySyncResetResult{}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		managedDescriptions := []string{
			"third-party directory sync",
			"enterprise wecom directory sync",
			"enterprise directory mapped subtree sync",
			"directory sync on-demand",
		}
		var managed []model.Department
		if err := tx.Where("description IN ?", managedDescriptions).Find(&managed).Error; err != nil {
			return err
		}
		managedIDs := make([]uuid.UUID, 0, len(managed))
		managedSet := make(map[uuid.UUID]bool, len(managed))
		for _, dept := range managed {
			managedIDs = append(managedIDs, dept.ID)
			managedSet[dept.ID] = true
		}

		var fallbackID *uuid.UUID
		if mountID, err := parseOptionalUUID(cfg.MountDepartmentID); err == nil && mountID != nil && !managedSet[*mountID] {
			var count int64
			if err := tx.Model(&model.Department{}).Where("id = ?", *mountID).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				fallbackID = mountID
			}
		}
		if len(managedIDs) > 0 {
			var fallbackValue any
			if fallbackID != nil {
				fallbackValue = *fallbackID
			}
			res := tx.Model(&model.User{}).Where("department_id IN ?", managedIDs).Update("department_id", fallbackValue)
			if res.Error != nil {
				return res.Error
			}
			result.UsersMoved = int(res.RowsAffected)
			// 保留手工建立的子部门，只把它们从待删除的同步父部门下移出。
			if err := tx.Model(&model.Department{}).
				Where("parent_id IN ? AND (description NOT IN ? OR description IS NULL)", managedIDs, managedDescriptions).
				Update("parent_id", fallbackValue).Error; err != nil {
				return err
			}
			res = tx.Delete(&model.Department{}, "id IN ?", managedIDs)
			if res.Error != nil {
				return res.Error
			}
			result.DepartmentsDeleted = int(res.RowsAffected)
		}

		res := tx.Where("provider = ? AND external_type = ?", provider, "department").
			Delete(&model.DirectorySyncBinding{})
		if res.Error != nil {
			return res.Error
		}
		result.BindingsDeleted = int(res.RowsAffected)
		if err := tx.Where("provider = ?", provider).Delete(&model.DirectorySyncBuffer{}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// 清空旧映射，迫使管理员在新组织树上重新确认锚点。
	if err := s.configRepo.Set("directory_sync", "department_mappings", "[]"); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *DirectorySyncService) FetchDepartments() ([]DirectoryDepartment, error) {
	cfg := s.LoadConfig(false)
	if cfg.PlatformType == DirectoryProviderWeCom {
		// 企业微信通讯录：部门匹配只需部门树，不要在此逐部门拉取成员。
		return s.WeCom.FetchDirectoryDepartments()
	}
	if err := validateDirectoryConfig(cfg, false); err != nil {
		return nil, err
	}
	var resp struct {
		Success bool                  `json:"success"`
		Message string                `json:"message"`
		Data    []DirectoryDepartment `json:"data"`
	}
	if err := s.getJSON(cfg, "/api/public/sso/directory/departments", nil, &resp); err != nil {
		return nil, err
	}
	if !resp.Success {
		if resp.Message == "" {
			resp.Message = "第三方平台返回失败"
		}
		return nil, errors.New(resp.Message)
	}
	return resp.Data, nil
}

func (s *DirectorySyncService) Sync(dryRun bool) (*DirectorySyncSummary, error) {
	cfg := s.LoadConfig(false)
	if err := validateDirectoryConfig(cfg, true); err != nil {
		return nil, err
	}
	summary := &DirectorySyncSummary{DryRun: dryRun, Status: "success"}
	logRow := &model.DirectorySyncLog{
		Provider:  cfg.PlatformType,
		Status:    "running",
		DryRun:    dryRun,
		StartedAt: time.Now(),
	}
	if err := s.db.Create(logRow).Error; err != nil {
		return nil, err
	}

	snap, err := s.fetchCombinedSnapshot(cfg)
	if err != nil {
		summary.Status = "failed"
		summary.Message = err.Error()
		s.finishLog(logRow, summary)
		return summary, err
	}

	// 持久化到缓冲表，供「用户导入」弹窗展示，无需重复拉取远端。
	// 缓冲写入失败不阻断本次同步。
	if err := s.storeSnapshot(snap, cfg); err != nil {
		log.Printf("[dir-sync] 写入缓冲表失败(不影响本次同步): %v", err)
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		return s.applySnapshot(tx, cfg, snap, dryRun, summary, nil)
	})
	if err != nil {
		summary.Status = "failed"
		summary.Message = err.Error()
	} else {
		summary.Message = "同步完成"
	}
	s.finishLog(logRow, summary)
	if err != nil {
		return summary, err
	}
	return summary, nil
}

// SyncUsers 完整的目录同步（拉取远端 → 写入缓冲表 → 应用到用户）。
// 供每日凌晨 2 点的定时任务调用（自动创建/更新/禁用用户）。
func (s *DirectorySyncService) SyncUsers() (*DirectorySyncSummary, error) {
	return s.Sync(false)
}

// Pull 仅拉取远端通讯录并写入缓冲表，刷新「用户导入」预览，不创建/修改/禁用任何用户。
// 供手动「同步用户」按钮调用；真正建号由「导入选中/导入全部」（ImportUsers）负责。
func (s *DirectorySyncService) Pull() (*DirectorySyncSummary, error) {
	cfg := s.LoadConfig(false)
	if err := validateDirectoryConfig(cfg, true); err != nil {
		return nil, err
	}
	summary := &DirectorySyncSummary{DryRun: false, Status: "success"}
	logRow := &model.DirectorySyncLog{
		Provider:  cfg.PlatformType,
		Status:    "running",
		DryRun:    false,
		StartedAt: time.Now(),
	}
	if err := s.db.Create(logRow).Error; err != nil {
		return nil, err
	}
	snap, err := s.fetchCombinedSnapshot(cfg)
	if err != nil {
		summary.Status = "failed"
		summary.Message = err.Error()
		s.finishLog(logRow, summary)
		return summary, err
	}
	// 只写缓冲表刷新预览；不 applySnapshot（不创建/更新/禁用用户，不加默认组）。
	if err := s.storeSnapshot(snap, cfg); err != nil {
		summary.Status = "failed"
		summary.Message = "拉取成功但写入缓冲失败: " + err.Error()
		s.finishLog(logRow, summary)
		return summary, err
	}
	summary.Message = "拉取完成，已刷新可导入的通讯录（仅拉取，未创建/修改用户）"
	s.finishLog(logRow, summary)
	return summary, nil
}

// storeSnapshot 把远端快照写入缓冲表（sso_directory_sync_buffer）。
// 仅保存「处于同步范围内」的用户（能解析到本地部门者），其余忽略，与真正同步落库的范围保持一致。
// 写入策略：先按 provider 清空旧缓冲，再批量插入本次快照，保证缓冲表始终反映最近一次同步结果。
func (s *DirectorySyncService) storeSnapshot(snap *directorySnapshot, cfg DirectorySyncConfig) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		mountID, err := parseOptionalUUID(cfg.MountDepartmentID)
		if err != nil {
			return err
		}
		var deptResolver map[string]*mappingTarget
		if cfg.MappingMode {
			deptResolver, err = s.ensureMappedDepartmentSubtrees(tx, cfg, snap, false, nil)
			if err != nil {
				return err
			}
		} else {
			// 手动「同步用户」只走 Pull -> storeSnapshot。自动组织模式下必须在
			// 生成预览缓冲前先创建/更新远端组织树，否则新部署或删除旧部门后，
			// resolveUserDepartment 找不到末级部门，所有用户都会回退到挂载根组织。
			pathIndex, err := s.ensureAutomaticDepartments(tx, cfg, snap, mountID)
			if err != nil {
				return err
			}
			deptResolver = make(map[string]*mappingTarget, len(pathIndex))
			for k, v := range pathIndex {
				deptResolver[k] = &mappingTarget{kind: "existing", localID: v}
			}
		}

		// 删除旧缓冲前，先读出用户手动编辑过的值（username/email），重建时保留，
		// 避免「同步用户」(pull) 覆盖用户的手动编辑。
		var oldBufs []model.DirectorySyncBuffer
		if err := tx.Where("provider = ?", cfg.PlatformType).Find(&oldBufs).Error; err != nil {
			return err
		}
		editedUsernames := make(map[string]string, len(oldBufs))
		editedEmails := make(map[string]string, len(oldBufs))
		for _, o := range oldBufs {
			if o.UsernameEdited != "" {
				editedUsernames[o.ExternalID] = o.UsernameEdited
			}
			if o.EmailEdited != "" {
				editedEmails[o.ExternalID] = o.EmailEdited
			}
		}

		rows := make([]model.DirectorySyncBuffer, 0, len(snap.Users))
		seenExt := make(map[string]struct{})
		for _, remote := range snap.Users {
			externalID := getStringAny(remote, cfg.FieldMapping["external_id"])
			if externalID == "" {
				externalID = firstNonEmpty(getStringAny(remote, "externalId"), getStringAny(remote, "userId"))
			}
			if externalID == "" {
				continue
			}
			// 同 provider 内 external_id 去重兜底：缓冲表唯一约束为 (provider, external_id)，
			// 若快照里出现同一 external_id 两次（远端重复返回/去重遗漏），此处拦住避免 2067。
			if _, dup := seenExt[externalID]; dup {
				continue
			}
			seenExt[externalID] = struct{}{}
			// 仅保留处于同步范围内（能解析到本地部门）的用户
			deptID := s.resolveUserDepartment(tx, cfg, remote, deptResolver, mountID, true, nil)
			if deptID == nil {
				continue
			}
			item, ok := s.computePreviewItem(tx, cfg, remote, externalID, deptID)
			if !ok {
				continue
			}
			raw, _ := json.Marshal(remote)
			groupsJSON, _ := json.Marshal(item.Groups)
			// 用户手动编辑过的字段优先保留（不被远端计算值覆盖）
			username, usernameEdited := item.Username, editedUsernames[externalID]
			if usernameEdited != "" {
				username = usernameEdited
			}
			email, emailEdited := item.Email, editedEmails[externalID]
			if emailEdited != "" {
				email = emailEdited
			}
			rows = append(rows, model.DirectorySyncBuffer{
				Provider:       cfg.PlatformType,
				ExternalID:     externalID,
				Username:       username,
				Name:           item.Name,
				Email:          email,
				SourceUsername: item.SourceUsername,
				Department:     item.Department,
				Groups:         string(groupsJSON),
				Status:         item.Status,
				Exists:         item.Exists,
				UsernameEdited: usernameEdited,
				EmailEdited:    emailEdited,
				Raw:            string(raw),
				FetchedAt:      time.Now(),
			})
		}

		if err := tx.Where("provider = ?", cfg.PlatformType).Delete(&model.DirectorySyncBuffer{}).Error; err != nil {
			return err
		}
		if len(rows) > 0 {
			if err := tx.CreateInBatches(&rows, 200).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// computePreviewItem 计算单个远端用户在本地落库时的展示信息（用户名/姓名/邮箱/部门/状态/是否已存在）。
// 与 UserImportPreview 的逐用户解析逻辑保持一致，供 storeSnapshot 与（必要时）缓冲读取复用。
func (s *DirectorySyncService) computePreviewItem(tx *gorm.DB, cfg DirectorySyncConfig, remote map[string]any, externalID string, deptID *uuid.UUID) (*UserImportPreviewItem, bool) {
	deptName := ""
	var d model.Department
	if err := tx.First(&d, "id = ?", *deptID).Error; err == nil {
		deptName = s.departmentDisplayPath(tx, d.ID)
	}
	nickname := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["nickname"]), externalID)
	sourceUsername := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["username"]), externalID)
	rawEmail := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["email"]))
	givenName := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["given_name"]))
	surname := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["surname"]))
	displayEmail := s.resolvePreviewEmail(cfg, sourceUsername, rawEmail, nickname, givenName, surname)
	previewUser := s.buildPreviewUser(tx, cfg, remote, externalID, displayEmail, sourceUsername)

	groups := getStringListAny(remote, cfg.FieldMapping["department_paths"])
	if len(groups) == 0 {
		if p := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["department_path"])); p != "" {
			groups = []string{p}
		}
	}
	item := &UserImportPreviewItem{
		ExternalID:     externalID,
		Status:         previewUser.Status,
		Username:       previewUser.Username,
		Name:           nickname,
		Email:          displayEmail,
		SourceUsername: sourceUsername,
		Groups:         groups,
		Department:     deptName,
		Exists:         previewUser.Status == "update",
	}
	return item, true
}

// ImportUsers 按用户勾选的 external_id 列表导入用户。externalIDs 为空表示导入全部待同步用户。
// 与 Sync 的区别：仅处理白名单内的用户，且不触发"禁用远端缺失用户"（避免影响未勾选的人）。
// ImportUsers 基于缓冲表导入用户（不再重复拉取远端）。
// externalIDs 为空表示导入全部缓冲用户；非空表示只导入勾选的 external_id。
// 仅处理缓冲表内的用户，且不会触发「禁用远端缺失用户」（避免影响未勾选的人）。
func (s *DirectorySyncService) ImportUsers(externalIDs []string, groupIDs []string) (*DirectorySyncSummary, error) {
	cfg := s.LoadConfig(false)
	if err := validateDirectoryConfig(cfg, true); err != nil {
		return nil, err
	}
	summary := &DirectorySyncSummary{DryRun: false, Status: "success"}
	logRow := &model.DirectorySyncLog{
		Provider:  cfg.PlatformType,
		Status:    "running",
		DryRun:    false,
		StartedAt: time.Now(),
	}
	if err := s.db.Create(logRow).Error; err != nil {
		return nil, err
	}

	// 从缓冲表读取待导入数据，不再重复拉取远端。
	var rows []model.DirectorySyncBuffer
	q := s.db.Where("provider = ?", cfg.PlatformType)
	if len(externalIDs) > 0 {
		q = q.Where("external_id IN ?", externalIDs)
	}
	if err := q.Find(&rows).Error; err != nil {
		summary.Status = "failed"
		summary.Message = err.Error()
		s.finishLog(logRow, summary)
		return summary, err
	}
	if len(rows) == 0 {
		summary.Status = "failed"
		summary.Message = "缓冲表中没有可导入的用户，请先点击「同步用户」拉取远端通讯录"
		s.finishLog(logRow, summary)
		return summary, fmt.Errorf("缓冲表为空，请先同步用户")
	}

	var whitelist map[string]bool
	if len(externalIDs) > 0 {
		whitelist = make(map[string]bool, len(externalIDs))
		for _, id := range externalIDs {
			whitelist[id] = true
		}
	}

	mountID, err := parseOptionalUUID(cfg.MountDepartmentID)
	if err != nil {
		summary.Status = "failed"
		summary.Message = err.Error()
		s.finishLog(logRow, summary)
		return summary, err
	}
	for _, r := range rows {
		if whitelist != nil && !whitelist[r.ExternalID] {
			continue
		}
		userSummary := &DirectorySyncSummary{}
		err := s.db.Transaction(func(tx *gorm.DB) error {
			var remote map[string]any
			if err := json.Unmarshal([]byte(r.Raw), &remote); err != nil {
				return fmt.Errorf("解析缓冲记录失败: %w", err)
			}
			var deptResolver map[string]*mappingTarget
			if cfg.MappingMode {
				userSnap := &directorySnapshot{Users: []map[string]any{remote}}
				deptResolver, err = s.ensureMappedDepartmentSubtrees(tx, cfg, userSnap, false, userSummary)
				if err != nil {
					return err
				}
			} else {
				pathIndex, err := s.buildDepartmentPathIndex(tx, mountID)
				if err != nil {
					return err
				}
				deptResolver = make(map[string]*mappingTarget, len(pathIndex))
				for k, v := range pathIndex {
					deptResolver[k] = &mappingTarget{kind: "existing", localID: v}
				}
			}
			return s.applyRemoteUser(tx, cfg, remote, deptResolver, mountID, false, userSummary, make(map[string]bool), r.Username, r.EmailEdited, groupIDs)
		})
		if err != nil {
			summary.UserFailed++
			name := strings.TrimSpace(r.Name)
			if name == "" {
				name = r.Username
			}
			summary.Details = append(summary.Details, fmt.Sprintf("%s（%s / %s）: %v", name, r.Username, r.ExternalID, err))
			summary.UserDetails = append(summary.UserDetails, UserSyncDetail{
				Type: "failed", Name: name, Username: r.Username, ExternalID: r.ExternalID, Reason: err.Error(),
			})
			continue
		}
		mergeDirectorySyncSummary(summary, userSummary)
	}
	if summary.UserFailed > 0 {
		if summary.UserCreated+summary.UserUpdated+summary.UserSkipped > 0 {
			summary.Status = "partial_success"
			summary.Message = fmt.Sprintf("导入完成，%d 位用户失败", summary.UserFailed)
		} else {
			summary.Status = "failed"
			summary.Message = fmt.Sprintf("导入失败，共 %d 位用户失败", summary.UserFailed)
		}
	} else {
		summary.Message = "导入完成"
	}
	s.finishLog(logRow, summary)
	return summary, nil
}

// UserImportPreview 读取缓冲表（sso_directory_sync_buffer）构建「用户导入」表格预览数据。
// 不再拉取远端，直接展示最近一次同步（手动「同步用户」或定时任务）写入的快照，
// 因此打开「用户导入」弹窗本身不会触发任何同步操作。
// keyword 支持对用户名/姓名/邮箱/外部 ID 模糊过滤；按 external_id 排序保证分页稳定。
func (s *DirectorySyncService) UserImportPreview(keyword string, page, pageSize int) (*UserImportPreview, error) {
	cfg := s.LoadConfig(false)
	if cfg.PlatformType == "" {
		return nil, fmt.Errorf("尚未配置同步平台类型")
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 15
	}
	if pageSize > 200 {
		pageSize = 200
	}

	kw := strings.ToLower(strings.TrimSpace(keyword))
	var rows []model.DirectorySyncBuffer
	q := s.db.Where("provider = ?", cfg.PlatformType)
	if kw != "" {
		like := "%" + kw + "%"
		q = q.Where("external_id LIKE ? OR username LIKE ? OR name LIKE ? OR email LIKE ? OR source_username LIKE ?", like, like, like, like, like)
	}
	if err := q.Order("external_id asc").Find(&rows).Error; err != nil {
		return nil, err
	}

	items := make([]UserImportPreviewItem, 0, len(rows))
	for _, r := range rows {
		var groups []string
		_ = json.Unmarshal([]byte(r.Groups), &groups)
		items = append(items, UserImportPreviewItem{
			ExternalID:     r.ExternalID,
			Status:         r.Status,
			Username:       r.Username,
			Name:           r.Name,
			Email:          r.Email,
			SourceUsername: r.SourceUsername,
			Groups:         groups,
			Department:     r.Department,
			Exists:         r.Exists,
		})
	}

	total := len(items)
	start := (page - 1) * pageSize
	end := start + pageSize
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}
	pageItems := make([]UserImportPreviewItem, 0)
	if start < total {
		pageItems = items[start:end]
	}

	// 同步时间取缓冲表最新的 fetched_at
	syncAt := ""
	if len(rows) > 0 {
		var latestStr string
		s.db.Model(&model.DirectorySyncBuffer{}).
			Where("provider = ?", cfg.PlatformType).
			Select("MAX(fetched_at) as latest").
			Row().Scan(&latestStr)
		if latestStr != "" {
			if t, err := time.Parse("2006-01-02 15:04:05.999999-07:00", latestStr); err == nil {
				syncAt = t.Format("2006-01-02 15:04:05")
			} else if t, err := time.Parse(time.RFC3339Nano, latestStr); err == nil {
				syncAt = t.Format("2006-01-02 15:04:05")
			} else {
				syncAt = latestStr
			}
		}
	}

	return &UserImportPreview{
		SyncAt:          syncAt,
		Progress:        100,
		Total:           total,
		Page:            page,
		PageSize:        pageSize,
		DefaultPassword: firstNonEmpty(s.defaultPassword, defaultPasswordFallback),
		Users:           pageItems,
	}, nil
}

func mergeDirectorySyncSummary(dst, src *DirectorySyncSummary) {
	dst.DepartmentCreated += src.DepartmentCreated
	dst.DepartmentMatched += src.DepartmentMatched
	dst.UserCreated += src.UserCreated
	dst.UserUpdated += src.UserUpdated
	dst.UserDisabled += src.UserDisabled
	dst.UserSkipped += src.UserSkipped
	dst.UserFailed += src.UserFailed
	dst.Details = append(dst.Details, src.Details...)
	dst.UserDetails = append(dst.UserDetails, src.UserDetails...)
}

// departmentDisplayPath 返回从本地根组织到目标部门的完整路径，
// 用于导入前「部门（落库）」所见即所得预览。
func (s *DirectorySyncService) departmentDisplayPath(tx *gorm.DB, id uuid.UUID) string {
	var depts []model.Department
	if err := tx.Find(&depts).Error; err != nil {
		return ""
	}
	byID := make(map[uuid.UUID]model.Department, len(depts))
	for _, dept := range depts {
		byID[dept.ID] = dept
	}
	path, ok := departmentRelativePath(id, nil, byID)
	if !ok {
		return ""
	}
	return path
}

func (s *DirectorySyncService) LatestLogs(limit int) ([]model.DirectorySyncLog, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	var logs []model.DirectorySyncLog
	err := s.db.Order("started_at DESC").Limit(limit).Find(&logs).Error
	return logs, err
}

// mappingRoots 计算手动匹配模式下需要拉取的远端根路径：取所有 include=true 的部门路径，
// 并剔除被其祖先已覆盖的重复路径（如已选父部门则不再单独选子部门），避免重复拉取。
func mappingRoots(cfg DirectorySyncConfig) []string {
	seen := map[string]bool{}
	for _, m := range cfg.DepartmentMappings {
		if !m.Include || strings.TrimSpace(m.RemotePath) == "" {
			continue
		}
		rp := strings.TrimSpace(m.RemotePath)
		dup := false
		for parent := range seen {
			if rp == parent || strings.HasPrefix(rp, parent+"/") {
				dup = true
				break
			}
		}
		if !dup {
			for existing := range seen {
				if existing == rp || strings.HasPrefix(existing, rp+"/") {
					delete(seen, existing)
				}
			}
			seen[rp] = true
		}
	}
	out := make([]string, 0, len(seen))
	for rp := range seen {
		out = append(out, rp)
	}
	sort.Strings(out)
	return out
}

// fetchSnapshotForRoots 按给定根路径集合向第三方平台拉取部门与用户快照并合并去重。
func (s *DirectorySyncService) fetchSnapshotForRoots(cfg DirectorySyncConfig, roots []string) (*directorySnapshot, error) {
	deptByID := make(map[string]map[string]any)
	userByID := make(map[string]map[string]any)
	for _, root := range roots {
		q := url.Values{}
		root = strings.TrimSpace(root)
		if root != "" {
			q.Set("root_path", root)
		}
		var resp struct {
			Success     bool             `json:"success"`
			Message     string           `json:"message"`
			Departments []map[string]any `json:"departments"`
			Users       []map[string]any `json:"users"`
		}
		if err := s.getJSON(cfg, "/api/public/sso/directory/snapshot", q, &resp); err != nil {
			return nil, err
		}
		if !resp.Success {
			if resp.Message == "" {
				resp.Message = "第三方平台返回失败"
			}
			return nil, errors.New(resp.Message)
		}
		for _, dept := range resp.Departments {
			id := firstNonEmpty(getStringAny(dept, "externalId"), getStringAny(dept, "external_id"), "path:"+getStringAny(dept, "path"))
			if id != "" {
				deptByID[id] = dept
			}
		}
		for _, user := range resp.Users {
			id := firstNonEmpty(
				getStringAny(user, cfg.FieldMapping["external_id"]),
				getStringAny(user, "externalId"),
				getStringAny(user, "userId"),
			)
			if id != "" {
				userByID[id] = user
			}
		}
	}
	snap := &directorySnapshot{}
	for _, dept := range deptByID {
		snap.Departments = append(snap.Departments, dept)
	}
	for _, user := range userByID {
		snap.Users = append(snap.Users, user)
	}
	return snap, nil
}

func (s *DirectorySyncService) fetchCombinedSnapshot(cfg DirectorySyncConfig) (*directorySnapshot, error) {
	// 企业微信通讯录：直接走企业微信 API 拉取部门树与用户，复用导入流水线
	if cfg.PlatformType == DirectoryProviderWeCom {
		if s.WeCom == nil {
			return nil, errors.New("企业微信通讯录服务未初始化")
		}
		depts, users, err := s.WeCom.FetchDirectorySnapshot()
		if err != nil {
			return nil, err
		}
		snap := &directorySnapshot{Departments: flattenDirectoryDepartments(depts), Users: users}
		roots := cfg.SelectedDepartmentPaths
		if cfg.MappingMode {
			if mapped := mappingRoots(cfg); len(mapped) > 0 {
				roots = mapped
			}
		}
		return filterDirectorySnapshot(snap, roots), nil
	}
	// 手动部门匹配模式：只拉取已勾选匹配的远端部门（含其下级），
	// 避免把整个公司的用户都拉回来，再产生大量无关的“跳过”记录。
	roots := cfg.SelectedDepartmentPaths
	if cfg.MappingMode {
		if mr := mappingRoots(cfg); len(mr) > 0 {
			roots = mr
		}
	}
	if len(roots) == 0 {
		roots = []string{""}
	}
	snap, err := s.fetchSnapshotForRoots(cfg, roots)
	if err != nil {
		return nil, err
	}
	// 兜底：按勾选部门拉取却一个用户都没回来（远端 root_path 不支持子树过滤等异常），
	// 回退为全量拉取，确保不会漏同步。
	if cfg.MappingMode && len(snap.Users) == 0 && !(len(roots) == 1 && roots[0] == "") {
		if full, err2 := s.fetchSnapshotForRoots(cfg, []string{""}); err2 == nil {
			snap = full
		}
	}
	return snap, nil
}

func (s *DirectorySyncService) getJSON(cfg DirectorySyncConfig, path string, q url.Values, out any) error {
	base := strings.TrimRight(cfg.BaseURL, "/")
	if base == "" {
		return errors.New("第三方平台地址未配置")
	}
	reqURL := base + path
	if len(q) > 0 {
		reqURL += "?" + q.Encode()
	}
	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-OneAuth-Api-Key", cfg.APIKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("第三方平台请求失败: HTTP %d %s", resp.StatusCode, string(body))
	}
	return json.Unmarshal(body, out)
}

// whitelist 为非 nil 时，仅同步其中列出的 external_id 用户（部分导入）；为 nil 表示全量导入。
func (s *DirectorySyncService) applySnapshot(tx *gorm.DB, cfg DirectorySyncConfig, snap *directorySnapshot, dryRun bool, summary *DirectorySyncSummary, whitelist map[string]bool) error {
	mountID, err := parseOptionalUUID(cfg.MountDepartmentID)
	if err != nil {
		return err
	}

	var deptResolver map[string]*mappingTarget
	if cfg.MappingMode {
		// 手动模式只决定选中远端根部门挂载到本地哪里；
		// 根下子部门仍按企微完整路径自动创建。
		deptResolver, err = s.ensureMappedDepartmentSubtrees(tx, cfg, snap, dryRun, summary)
		if err != nil {
			return err
		}
	} else {
		// 自动模式下，拉取缓冲时就同步组织树。这样首次使用无需先手工
		// 创建部门，缓冲中的用户也能立即解析到新创建的最末级部门。
		pathIndex, err := s.ensureAutomaticDepartments(tx, cfg, snap, mountID)
		if err != nil {
			return err
		}
		deptResolver = make(map[string]*mappingTarget, len(pathIndex))
		for k, v := range pathIndex {
			deptResolver[k] = &mappingTarget{kind: "existing", localID: v}
		}
	}

	if cfg.MappingMode {
		// 仅处理已勾选匹配且本地已存在的远端部门：建立绑定，不创建、不覆盖本地部门。
		// 待创建部门（create）在用户处理阶段、确认有用户归属时才新建，避免产生空部门。
		for _, remote := range snap.Departments {
			rp := getStringAny(remote, "path")
			if rp == "" {
				continue
			}
			t, ok := deptResolver[localDepartmentPath(rp, cfg.StripPrefix)]
			if !ok || t.kind != "existing" {
				continue
			}
			summary.DepartmentMatched++
			if !dryRun {
				_ = s.upsertBinding(tx, cfg.PlatformType, "department", "path:"+rp, t.localID, rp)
			}
		}
	} else {
		deptPaths := collectRemoteDepartmentPaths(snap, cfg)
		sort.Slice(deptPaths, func(i, j int) bool {
			di, dj := pathDepth(deptPaths[i]), pathDepth(deptPaths[j])
			if di == dj {
				return deptPaths[i] < deptPaths[j]
			}
			return di < dj
		})

		for _, localPath := range deptPaths {
			if localPath == "" {
				continue
			}
			remoteID := "path:" + localPath
			var localID *uuid.UUID
			if t, ok := deptResolver[localPath]; ok && t.kind == "existing" {
				id := t.localID
				localID = &id
			}
			if localID == nil {
				if binding, err := s.getBinding(tx, cfg.PlatformType, "department", remoteID); err == nil {
					id := binding.LocalID
					localID = &id
				}
			}
			if localID != nil {
				summary.DepartmentMatched++
				if !dryRun {
					_ = s.upsertBinding(tx, cfg.PlatformType, "department", remoteID, *localID, localPath)
				}
				continue
			}
			summary.DepartmentCreated++
			if dryRun {
				continue
			}
			parentID := mountID
			if parent := parentPath(localPath); parent != "" {
				if t, ok := deptResolver[parent]; ok && t.kind == "existing" {
					id := t.localID
					parentID = &id
				}
			}
			dept := &model.Department{
				Name:        leafName(localPath),
				ParentID:    parentID,
				Description: "third-party directory sync",
			}
			if err := tx.Create(dept).Error; err != nil {
				return err
			}
			id := dept.ID
			deptResolver[localPath] = &mappingTarget{kind: "existing", localID: id}
			if err := s.upsertBinding(tx, cfg.PlatformType, "department", remoteID, id, localPath); err != nil {
				return err
			}
		}
	}

	seenUserIDs := make(map[string]bool)
	previewUsers := make(map[string][]SyncPreviewUser)
	for _, remote := range snap.Users {
		// 部分导入：白名单之外、未被勾选的用户直接跳过，不参与落库与结果树
		if wlExt := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["external_id"]), getStringAny(remote, "externalId"), getStringAny(remote, "userId")); wlExt != "" && whitelist != nil && !whitelist[wlExt] {
			continue
		}
		if cfg.MappingMode {
			deptID := s.resolveUserDepartment(tx, cfg, remote, deptResolver, mountID, dryRun, summary)
			if deptID == nil {
				// 手动匹配模式：未勾选部门下的用户完全忽略——不同步、不计入跳过、不列出。
				continue
			}
			// 记录到预览树：按用户真实远端部门归类（便于树形展示「选中部门下的全部用户」）
			externalID := getStringAny(remote, cfg.FieldMapping["external_id"])
			email := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["email"]))
			sourceUsername := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["username"]), externalID)
			actualDept := ""
			if ps := getStringListAny(remote, cfg.FieldMapping["department_paths"]); len(ps) > 0 {
				actualDept = ps[0]
			} else {
				actualDept = strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["department_path"]))
			}
			if actualDept == "" {
				actualDept = "（无部门）"
			}
			previewUsers[actualDept] = append(previewUsers[actualDept], s.buildPreviewUser(tx, cfg, remote, externalID, email, sourceUsername))
		}
		if err := s.applyRemoteUser(tx, cfg, remote, deptResolver, mountID, dryRun, summary, seenUserIDs, "", "", nil); err != nil {
			summary.UserSkipped++
			summary.Details = append(summary.Details, err.Error())
			externalID := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["external_id"]), getStringAny(remote, "externalId"))
			username := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["username"]), externalID)
			name := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["nickname"]), username)
			summary.UserDetails = append(summary.UserDetails, UserSyncDetail{
				Type: "skipped", Name: name, Username: username, ExternalID: externalID, Reason: err.Error(),
			})
		}
	}
	if cfg.MappingMode {
		log.Printf("[DEBUG] buildPreviewTree input: mappingMode=%v snapUsers=%d previewUsers=%d", cfg.MappingMode, len(snap.Users), len(previewUsers))
		for p, us := range previewUsers {
			log.Printf("[DEBUG] previewUsers key=%q count=%d", p, len(us))
		}
		summary.MappingPreview = s.buildPreviewTree(snap, cfg, previewUsers)
	}
	if cfg.DeactivateMissing && whitelist == nil {
		if err := s.disableMissingUsers(tx, cfg, dryRun, summary); err != nil {
			return err
		}
	}
	return nil
}

// ensureAutomaticDepartments 将远端部门树按层级同步到指定本地挂载部门下。
// 企微部门 ID 作为稳定绑定键：远端改名/移动时更新同一个本地部门，不重复创建。
func (s *DirectorySyncService) ensureAutomaticDepartments(tx *gorm.DB, cfg DirectorySyncConfig, snap *directorySnapshot, mountID *uuid.UUID) (map[string]uuid.UUID, error) {
	index, err := s.buildDepartmentPathIndex(tx, mountID)
	if err != nil {
		return nil, err
	}
	remoteByPath := make(map[string]map[string]any)
	for _, dept := range snap.Departments {
		path := localDepartmentPath(firstNonEmpty(getStringAny(dept, "path"), getStringAny(dept, "departmentPath")), cfg.StripPrefix)
		if path != "" {
			remoteByPath[path] = dept
		}
	}
	paths := collectRemoteDepartmentPaths(snap, cfg)
	sort.Slice(paths, func(i, j int) bool {
		di, dj := pathDepth(paths[i]), pathDepth(paths[j])
		if di == dj {
			return paths[i] < paths[j]
		}
		return di < dj
	})
	for _, path := range paths {
		if path == "" {
			continue
		}
		parentID := mountID
		if parent := parentPath(path); parent != "" {
			if id, ok := index[parent]; ok {
				pid := id
				parentID = &pid
			}
		}
		remote := remoteByPath[path]
		externalID := strings.TrimSpace(firstNonEmpty(getStringAny(remote, "external_id"), getStringAny(remote, "id")))
		bindingKey := "path:" + path
		if externalID != "" {
			bindingKey = "id:" + externalID
		}

		var dept *model.Department
		if binding, bindErr := s.getBinding(tx, cfg.PlatformType, "department", bindingKey); bindErr == nil {
			var bound model.Department
			if getErr := tx.First(&bound, "id = ?", binding.LocalID).Error; getErr == nil {
				dept = &bound
			}
		}
		if dept == nil {
			if id, ok := index[path]; ok {
				var existing model.Department
				if getErr := tx.First(&existing, "id = ?", id).Error; getErr == nil {
					dept = &existing
				}
			}
		}
		if dept == nil {
			created := &model.Department{Name: leafName(path), ParentID: parentID, Description: "enterprise wecom directory sync"}
			if err := tx.Create(created).Error; err != nil {
				return nil, err
			}
			dept = created
		} else {
			// 绑定后可跟随远端改名和父部门调整。
			dept.Name = leafName(path)
			dept.ParentID = parentID
			dept.Description = "enterprise wecom directory sync"
			if err := tx.Save(dept).Error; err != nil {
				return nil, err
			}
		}
		index[path] = dept.ID
		if err := s.upsertBinding(tx, cfg.PlatformType, "department", bindingKey, dept.ID, path); err != nil {
			return nil, err
		}
	}
	return index, nil
}

func flattenDirectoryDepartments(tree []DirectoryDepartment) []map[string]any {
	out := make([]map[string]any, 0)
	var walk func([]DirectoryDepartment)
	walk = func(items []DirectoryDepartment) {
		for _, dept := range items {
			out = append(out, map[string]any{
				"external_id": dept.ExternalID,
				"id":          dept.ID,
				"name":        dept.Name,
				"path":        dept.Path,
				"parent_path": dept.ParentPath,
			})
			walk(dept.Children)
		}
	}
	walk(tree)
	return out
}

func filterDirectorySnapshot(snap *directorySnapshot, roots []string) *directorySnapshot {
	cleanRoots := make([]string, 0, len(roots))
	for _, root := range roots {
		root = "/" + strings.Trim(strings.TrimSpace(root), "/")
		if root != "/" {
			cleanRoots = append(cleanRoots, root)
		}
	}
	if len(cleanRoots) == 0 {
		return snap
	}
	inScope := func(path string) bool {
		path = "/" + strings.Trim(strings.TrimSpace(path), "/")
		for _, root := range cleanRoots {
			if path == root || strings.HasPrefix(path, root+"/") {
				return true
			}
		}
		return false
	}
	filtered := &directorySnapshot{}
	for _, dept := range snap.Departments {
		if inScope(firstNonEmpty(getStringAny(dept, "path"), getStringAny(dept, "departmentPath"))) {
			filtered.Departments = append(filtered.Departments, dept)
		}
	}
	for _, user := range snap.Users {
		primary := getStringAny(user, "departmentPath")
		if inScope(primary) {
			// 用户可能兼任多个区域的部门。选择北区同步时，仅保留北区范围内的
			// departmentPaths，避免因兼职关系顺带在 OneAuth 创建范围外的南区/总部组织。
			copyUser := make(map[string]any, len(user))
			for key, value := range user {
				copyUser[key] = value
			}
			paths := getStringListAny(user, "departmentPaths")
			inScopePaths := make([]string, 0, len(paths))
			for _, path := range paths {
				if inScope(path) {
					inScopePaths = append(inScopePaths, path)
				}
			}
			copyUser["departmentPaths"] = inScopePaths
			filtered.Users = append(filtered.Users, copyUser)
		}
	}
	return filtered
}

// buildMappingResolver 将已勾选的部门匹配转换为 "裁剪后的远端路径 -> 目标部门" 映射。
// 目标可能是本地已存在部门（existing），也可能是「按需新建」的待创建部门（create，
// 仅在同步到真正归属该部门的用户时才创建，避免产生空部门）。
// 同一 (新部门名, 上级) 组合会被去重为同一个待创建目标，便于父子远端部门共用。
func (s *DirectorySyncService) buildMappingResolver(tx *gorm.DB, cfg DirectorySyncConfig) (map[string]*mappingTarget, error) {
	var localDepts []model.Department
	if err := tx.Find(&localDepts).Error; err != nil {
		return nil, err
	}
	localByID := make(map[uuid.UUID]bool, len(localDepts))
	for _, d := range localDepts {
		localByID[d.ID] = true
	}
	createKey := func(parent, name string) string { return parent + "\x00" + name }
	createTargets := make(map[string]*mappingTarget)
	getCreateTarget := func(parent, name string) *mappingTarget {
		k := createKey(parent, name)
		if t, ok := createTargets[k]; ok {
			return t
		}
		pid, _ := parseOptionalUUID(parent)
		t := &mappingTarget{kind: "create", name: strings.TrimSpace(name), parentID: pid}
		createTargets[k] = t
		return t
	}
	out := make(map[string]*mappingTarget)
	for _, m := range cfg.DepartmentMappings {
		if !m.Include || strings.TrimSpace(m.RemotePath) == "" {
			continue
		}
		key := localDepartmentPath(m.RemotePath, cfg.StripPrefix)
		if key == "" {
			continue
		}
		if m.CreateLocal && strings.TrimSpace(m.NewDeptName) != "" {
			t := getCreateTarget(m.NewDeptParentID, m.NewDeptName)
			if t.remoteKey == "" {
				t.remoteKey = key
			}
			out[key] = t
		} else if strings.TrimSpace(m.LocalDepartmentID) != "" {
			id, err := uuid.Parse(strings.TrimSpace(m.LocalDepartmentID))
			if err != nil {
				return nil, fmt.Errorf("部门匹配中存在无效本地部门 ID：%s", m.LocalDepartmentID)
			}
			if !localByID[id] {
				return nil, fmt.Errorf("部门匹配中引用的本地部门不存在（可能已被删除）：%s", m.LocalDepartmentID)
			}
			out[key] = &mappingTarget{kind: "existing", localID: id}
		}
	}
	return out, nil
}

// ensureMappedDepartmentSubtrees 实现「手动根映射 + 子树自动同步」：
// 管理员只需指定北区/南区等远端根部门在 OneAuth 的挂载位置，
// 其下销售部、小组、团队仍按企微路径自动创建，并返回精确路径解析器。
func (s *DirectorySyncService) ensureMappedDepartmentSubtrees(tx *gorm.DB, cfg DirectorySyncConfig, snap *directorySnapshot, dryRun bool, summary *DirectorySyncSummary) (map[string]*mappingTarget, error) {
	roots, err := s.buildMappingResolver(tx, cfg)
	if err != nil {
		return nil, err
	}
	resolved := make(map[string]*mappingTarget)
	rootIDs := make(map[string]uuid.UUID)
	for path, target := range roots {
		id := s.ensureTargetDept(tx, cfg, target, dryRun, summary)
		if id == nil {
			return nil, fmt.Errorf("无法解析手动映射部门：%s", path)
		}
		rootIDs[path] = *id
		resolved[path] = &mappingTarget{kind: "existing", localID: *id}
		if summary != nil && target.kind == "existing" {
			summary.DepartmentMatched++
		}
		if !dryRun {
			_ = s.upsertBinding(tx, cfg.PlatformType, "department", "mapped:path:"+path, *id, path)
		}
	}

	paths := collectRemoteDepartmentPaths(snap, cfg)
	sort.Slice(paths, func(i, j int) bool {
		if pathDepth(paths[i]) == pathDepth(paths[j]) {
			return paths[i] < paths[j]
		}
		return pathDepth(paths[i]) < pathDepth(paths[j])
	})
	for _, path := range paths {
		var bestRoot string
		for root := range rootIDs {
			if path == root || strings.HasPrefix(path, root+"/") {
				if len(root) > len(bestRoot) {
					bestRoot = root
				}
			}
		}
		if bestRoot == "" || path == bestRoot {
			continue
		}
		parentID := rootIDs[bestRoot]
		currentPath := bestRoot
		relative := strings.TrimPrefix(path, bestRoot+"/")
		for _, name := range strings.Split(relative, "/") {
			name = strings.TrimSpace(name)
			if name == "" {
				continue
			}
			currentPath += "/" + name
			if existing, ok := resolved[currentPath]; ok {
				parentID = existing.localID
				continue
			}
			id, created, err := s.findOrCreateMappedChild(tx, parentID, name, dryRun)
			if err != nil {
				return nil, err
			}
			if summary != nil {
				if created {
					summary.DepartmentCreated++
				} else {
					summary.DepartmentMatched++
				}
			}
			parentID = id
			resolved[currentPath] = &mappingTarget{kind: "existing", localID: id}
			if !dryRun {
				_ = s.upsertBinding(tx, cfg.PlatformType, "department", "mapped:path:"+currentPath, id, currentPath)
			}
		}
	}
	return resolved, nil
}

func (s *DirectorySyncService) findOrCreateMappedChild(tx *gorm.DB, parentID uuid.UUID, name string, dryRun bool) (uuid.UUID, bool, error) {
	var dept model.Department
	if err := tx.Where("name = ? AND parent_id = ?", name, parentID).First(&dept).Error; err == nil {
		return dept.ID, false, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return uuid.Nil, false, err
	}
	if dryRun {
		return uuid.New(), true, nil
	}
	dept = model.Department{
		Name:        name,
		ParentID:    &parentID,
		Description: "enterprise directory mapped subtree sync",
	}
	if err := tx.Create(&dept).Error; err != nil {
		return uuid.Nil, false, err
	}
	return dept.ID, true, nil
}

// overrideUsername 非空时表示用户手动编辑过用户名：仅当与「自然落库用户名」不同才覆盖，
// 否则保持原有策略逻辑（未编辑的用户行为完全不变）。完整同步传 ""，ImportUsers 传缓冲表 username。
func (s *DirectorySyncService) applyRemoteUser(tx *gorm.DB, cfg DirectorySyncConfig, remote map[string]any, resolver map[string]*mappingTarget, mountID *uuid.UUID, dryRun bool, summary *DirectorySyncSummary, seen map[string]bool, overrideUsername, overrideEmail string, groupIDs []string) error {
	externalID := getStringAny(remote, cfg.FieldMapping["external_id"])
	if externalID == "" {
		return errors.New("跳过用户：缺少 external_id")
	}
	seen[externalID] = true

	nickname := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["nickname"]), externalID)
	sourceUsername := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["username"]), externalID)
	rawEmail := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["email"]))
	givenName := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["given_name"]))
	surname := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["surname"]))
	// 远端有邮箱则用于"是否已存在用户"的判定；邮箱策略只在远端无邮箱时生成。
	email := rawEmail
	phone := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["phone"]))
	position := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["position"]))
	active := getBoolAny(remote, cfg.FieldMapping["active"], true)
	deptID := s.resolveUserDepartment(tx, cfg, remote, resolver, mountID, dryRun, summary)

	var user *model.User
	if binding, err := s.getBinding(tx, cfg.PlatformType, "user", externalID); err == nil {
		if u, err := s.getUserByID(tx, binding.LocalID); err == nil {
			user = u
		}
	}
	if user == nil {
		if u, err := s.getUserByDomainAccount(tx, externalID); err == nil {
			user = u
		}
	}
	if user == nil && email != "" {
		if u, err := s.getUserByEmail(tx, email); err == nil {
			user = u
		}
	}
	if user == nil {
		if u, err := s.getUserByUsername(tx, strings.ToLower(sourceUsername)); err == nil {
			user = u
		}
	}

	// 企微已离职账号（姓名含「（已离职）」）：不创建新账号；已存在的按删除逻辑禁用（表示已删除）。
	if isDepartedName(nickname) {
		summary.UserSkipped++
		summary.UserDetails = append(summary.UserDetails, UserSyncDetail{
			Type: "skipped", Name: nickname, Username: sourceUsername, ExternalID: externalID,
			Reason: "远端账号已标记离职；不存在的本地账号不再创建，已存在账号将禁用",
		})
		if user != nil && !dryRun {
			user.IsActive = false
			user.HireStatus = "resigned"
			user.IsLocked = true
			user.LockReason = "source_missing"
			if err := tx.Save(user).Error; err != nil {
				return fmt.Errorf("禁用已离职用户 %s 失败: %w", nickname, err)
			}
		}
		return nil
	}

	if user == nil {
		summary.UserCreated++
		if dryRun {
			return nil
		}
		username := s.generateUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, uuid.Nil)
		// 仅当 override 与「自然落库用户名」不同（即用户手动编辑过）时才覆盖，未编辑用户行为不变。
		if overrideUsername != "" && overrideUsername != username {
			username = s.resolveImportUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, uuid.Nil, overrideUsername)
		}
		// 新建账号：优先使用配置里的默认密码（security.default_password），
		// 未配置时回退到固定兜底密码（OneAuth@2026），仍可直接登录，无需逐个重置。
		plainPassword := s.defaultPassword
		if plainPassword == "" {
			plainPassword = defaultPasswordFallback
		}
		hash, _ := password.Hash(plainPassword)
		user = &model.User{
			ID:            uuid.New(),
			Username:      username,
			Nickname:      nickname,
			PasswordHash:  hash,
			Position:      position,
			DomainAccount: externalID,
			UserSource:    "platform",
			HireStatus:    hireStatus(active),
			DepartmentID:  deptID,
			IsActive:      active,
		}
		if overrideEmail != "" {
			// 用户手动编辑过邮箱：用编辑值（替代远端邮箱/邮箱策略），避免重名。
			if !valueTaken(tx, "email", overrideEmail, uuid.Nil) {
				user.Email = &overrideEmail
			}
		} else {
			if email != "" && !valueTaken(tx, "email", email, uuid.Nil) {
				user.Email = &email
			}
			if assignEmail := s.resolveAssignEmail(tx, cfg, sourceUsername, rawEmail, nickname, givenName, surname, uuid.Nil); assignEmail != nil {
				user.Email = assignEmail
			}
		}
		if phone != "" && !valueTaken(tx, "phone", phone, uuid.Nil) {
			user.Phone = &phone
		}
		if err := tx.Create(user).Error; err != nil {
			return fmt.Errorf("创建用户 %s 失败: %w", nickname, err)
		}
		if err := s.assignGroups(tx, cfg, user.ID, groupIDs); err != nil {
			return err
		}
		return s.upsertBinding(tx, cfg.PlatformType, "user", externalID, user.ID, "")
	}

	summary.UserUpdated++
	if dryRun {
		return nil
	}
	user.Nickname = nickname
	user.Position = position
	user.DomainAccount = externalID
	user.HireStatus = hireStatus(active)
	user.IsActive = active
	user.DepartmentID = deptID
	user.Department = nil
	// 已存在用户：邮箱以 sso 已存为准，同步不覆盖（SSO primary）——
	// 同步只负责新增用户的邮箱、以及缺失用户的禁用；已存在用户的邮箱保持不变，
	// 避免把管理员已经手动调整过的邮箱改回远端的值。
	// 登录账号：
	//   - override 与「自然落库用户名」不同（用户手动编辑过）→ 覆盖为编辑值（已存在用户也改）；
	//   - 否则保持原逻辑：管理员手动编辑过则保留，否则按需规整。
	if overrideUsername != "" {
		natural := s.effectiveUsername(tx, cfg, "update", user, sourceUsername, nickname)
		if overrideUsername != natural {
			user.Username = s.resolveImportUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, user.ID, overrideUsername)
		} else if !user.ProfileManuallyEdited {
			if shouldNormalizeExistingUsername(user.Username, sourceUsername) {
				user.Username = s.generateUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, user.ID)
			} else {
				user.Username = strings.ToLower(user.Username)
			}
		}
	} else if !user.ProfileManuallyEdited {
		if shouldNormalizeExistingUsername(user.Username, sourceUsername) {
			user.Username = s.generateUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, user.ID)
		} else {
			user.Username = strings.ToLower(user.Username)
		}
	}
	// 邮箱：
	//   - 用户手动编辑过邮箱（overrideEmail 非空）→ 覆盖（已存在也改），避免重名；
	//   - 否则保持现有（邮箱以 sso 为主，同步不覆盖）。
	if overrideEmail != "" {
		if !valueTaken(tx, "email", overrideEmail, user.ID) {
			user.Email = &overrideEmail
		}
	}
	if phone == "" {
		user.Phone = nil
	} else if !valueTaken(tx, "phone", phone, user.ID) {
		user.Phone = &phone
	}
	if err := tx.Save(user).Error; err != nil {
		return fmt.Errorf("更新用户 %s 失败: %w", nickname, err)
	}
	if err := s.assignGroups(tx, cfg, user.ID, groupIDs); err != nil {
		return err
	}
	return s.upsertBinding(tx, cfg.PlatformType, "user", externalID, user.ID, "")
}

// assignDefaultGroups 将同步用户加入配置里指定的默认用户组。
// 采用「追加成员」方式（INSERT OR IGNORE / ON CONFLICT DO NOTHING），不会移除用户已有的其它组成员关系；
// 仅当组确实存在时才追加，避免产生孤儿成员关系。
// assignGroups 将用户加入指定用户组；若 groupIDs 为空则回退到配置中的默认用户组。
func (s *DirectorySyncService) assignGroups(tx *gorm.DB, cfg DirectorySyncConfig, userID uuid.UUID, groupIDs []string) error {
	ids := groupIDs
	if len(ids) == 0 {
		ids = cfg.DefaultGroupIDs
	}
	if s.groupRepo == nil || len(ids) == 0 {
		return nil
	}
	for _, raw := range ids {
		gid, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			continue
		}
		exists, err := userGroupExistsTx(tx, gid)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if err := s.groupRepo.AddMemberTx(tx, gid, userID); err != nil {
			return err
		}
	}
	return nil
}

func (s *DirectorySyncService) assignDefaultGroups(tx *gorm.DB, cfg DirectorySyncConfig, userID uuid.UUID) error {
	if s.groupRepo == nil || len(cfg.DefaultGroupIDs) == 0 {
		return nil
	}
	for _, raw := range cfg.DefaultGroupIDs {
		gid, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			continue
		}
		exists, err := userGroupExistsTx(tx, gid)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if err := s.groupRepo.AddMemberTx(tx, gid, userID); err != nil {
			return err
		}
	}
	return nil
}

// userGroupExistsTx 必须使用导入事务的 tx 查询。SQLite 连接池只有一个连接，
// 若在事务内改用 repository 持有的根 DB 查询，会等待第二个连接并形成自锁，
// 最终让导入和其他需要数据库的登录请求全部卡住。
func userGroupExistsTx(tx *gorm.DB, id uuid.UUID) (bool, error) {
	var count int64
	if err := tx.Model(&model.UserGroup{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *DirectorySyncService) resolveUserDepartment(tx *gorm.DB, cfg DirectorySyncConfig, remote map[string]any, resolver map[string]*mappingTarget, mountID *uuid.UUID, dryRun bool, summary *DirectorySyncSummary) *uuid.UUID {
	// 企微用户可同时隶属多个部门，但在 OneAuth 只有一个主部门。
	// department_path 是上游根据 main_department 计算的主部门路径，必须优先；
	// department_paths 仅作为主部门缺失时的兼职/多部门兜底。
	paths := make([]string, 0)
	primary := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["department_path"]))
	if primary != "" {
		paths = append(paths, primary)
	}
	for _, path := range getStringListAny(remote, cfg.FieldMapping["department_paths"]) {
		path = strings.TrimSpace(path)
		if path != "" && path != primary {
			paths = append(paths, path)
		}
	}
	for _, p := range paths {
		localPath := localDepartmentPath(p, cfg.StripPrefix)
		if localPath == "" {
			continue
		}
		// 精确匹配优先
		if t, ok := resolver[localPath]; ok {
			if id := s.ensureTargetDept(tx, cfg, t, dryRun, summary); id != nil {
				return id
			}
		}
		// 手动部门匹配模式下，父部门映射覆盖其下所有子部门/小组/团队
		if cfg.MappingMode {
			var bestKey string
			var bestTarget *mappingTarget
			for key, t := range resolver {
				if key == "" {
					continue
				}
				if key == localPath || strings.HasPrefix(localPath, key+"/") {
					if len(key) > len(bestKey) {
						bestKey = key
						bestTarget = t
					}
				}
			}
			if bestTarget != nil {
				if id := s.ensureTargetDept(tx, cfg, bestTarget, dryRun, summary); id != nil {
					return id
				}
			}
		}
	}
	if cfg.MappingMode {
		// 匹配模式下，仅当用户部门确实被匹配到本地部门才同步，未匹配的跳过
		return nil
	}
	return mountID
}

// ensureTargetDept 将目标部门解析为真实本地部门 ID。
//   - existing：直接返回已存在部门 ID；
//   - create：仅在确有用户归属（被调用）时才懒创建，并缓存 ID，
//     从而不会为没有用户的待创建部门生成空部门。
func (s *DirectorySyncService) ensureTargetDept(tx *gorm.DB, cfg DirectorySyncConfig, t *mappingTarget, dryRun bool, summary *DirectorySyncSummary) *uuid.UUID {
	if t == nil {
		return nil
	}
	if t.kind == "existing" {
		id := t.localID
		return &id
	}
	if strings.TrimSpace(t.name) == "" {
		return nil
	}
	if t.createdID != nil {
		return t.createdID
	}
	parentStr := ""
	if t.parentID != nil {
		var count int64
		if err := tx.Model(&model.Department{}).Where("id = ?", *t.parentID).Count(&count).Error; err != nil {
			return nil
		}
		if count == 0 {
			// 旧映射可能保存了已删除的上级部门 ID。优先回退到当前
			// 配置的挂载组织；挂载组织也无效时才建到根目录，绝不再造孤儿树。
			fallback, _ := parseOptionalUUID(cfg.MountDepartmentID)
			if fallback != nil {
				if err := tx.Model(&model.Department{}).Where("id = ?", *fallback).Count(&count).Error; err != nil {
					return nil
				}
			}
			if fallback != nil && count > 0 {
				t.parentID = fallback
			} else {
				t.parentID = nil
			}
		}
	}
	if t.parentID != nil {
		parentStr = t.parentID.String()
	}
	extID := "newdept:" + cfg.PlatformType + ":" + parentStr + ":" + t.name
	if binding, err := s.getBinding(tx, cfg.PlatformType, "department", extID); err == nil {
		// 本地部门可能已被管理员删除，而旧版本未同步清理目录绑定。
		// 不能盲目复用 binding.local_id，否则新建子部门会挂在不存在的
		// “幽灵父部门”下，最终导致用户导入预览的部门路径为空。
		var count int64
		if err := tx.Model(&model.Department{}).Where("id = ?", binding.LocalID).Count(&count).Error; err != nil {
			return nil
		}
		if count > 0 {
			id := binding.LocalID
			t.createdID = &id
			return t.createdID
		}
		// 失效绑定就地自愈：删除后继续走下方的真实部门创建逻辑。
		if err := tx.Delete(&model.DirectorySyncBinding{}, "id = ?", binding.ID).Error; err != nil {
			return nil
		}
	}
	if summary != nil {
		summary.DepartmentCreated++
	}
	if dryRun {
		dummy := uuid.New()
		t.createdID = &dummy
		return t.createdID
	}
	dept := &model.Department{
		Name:        t.name,
		ParentID:    t.parentID,
		Description: "directory sync on-demand",
	}
	if err := tx.Create(dept).Error; err != nil {
		return nil
	}
	t.createdID = &dept.ID
	_ = s.upsertBinding(tx, cfg.PlatformType, "department", extID, dept.ID, t.remoteKey)
	return t.createdID
}

// buildPreviewUser 生成预览树中的用户节点，并判定其将「新建」还是「更新」。
func (s *DirectorySyncService) buildPreviewUser(tx *gorm.DB, cfg DirectorySyncConfig, remote map[string]any, externalID, email, sourceUsername string) SyncPreviewUser {
	nick := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["nickname"]), externalID)
	user := s.findExistingUserForPreview(tx, cfg, remote, externalID, email, sourceUsername)
	status := "create"
	if user != nil {
		status = "update"
	}
	eff := s.effectiveUsername(tx, cfg, status, user, sourceUsername, nick)
	return SyncPreviewUser{Name: nick, Username: eff, SourceUsername: sourceUsername, Email: email, Status: status}
}

// findExistingUserForPreview 复刻 applyRemoteUser 的查找链（binding→domain→email→username），
// 用于预览阶段判定用户是否已存在并拿到其当前用户名。
func (s *DirectorySyncService) findExistingUserForPreview(tx *gorm.DB, cfg DirectorySyncConfig, remote map[string]any, externalID, email, sourceUsername string) *model.User {
	if binding, err := s.getBinding(tx, cfg.PlatformType, "user", externalID); err == nil {
		if u, err := s.getUserByID(tx, binding.LocalID); err == nil {
			return u
		}
	}
	if u, err := s.getUserByDomainAccount(tx, externalID); err == nil {
		return u
	}
	if email != "" {
		if u, err := s.getUserByEmail(tx, email); err == nil {
			return u
		}
	}
	if u, err := s.getUserByUsername(tx, strings.ToLower(sourceUsername)); err == nil {
		return u
	}
	return nil
}

// effectiveUsername 计算用户"将落库"的用户名，逻辑与 applyRemoteUser 完全一致：
// 新建 → 按策略生成（含去重序号）；已存在 → 仅在需要规范化时重新生成，否则保持（兜底 ToLower）。
func (s *DirectorySyncService) effectiveUsername(tx *gorm.DB, cfg DirectorySyncConfig, status string, user *model.User, sourceUsername, nickname string) string {
	if status == "create" || user == nil {
		return s.generateUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, uuid.Nil)
	}
	if shouldNormalizeExistingUsername(user.Username, sourceUsername) {
		return s.generateUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, user.ID)
	}
	return strings.ToLower(user.Username)
}

// inSelectedSubtree 判断某远端部门路径是否落在任一已勾选匹配部门的子树内。
func inSelectedSubtree(p string, roots map[string]bool) bool {
	if roots[p] {
		return true
	}
	for root := range roots {
		if strings.HasPrefix(p, root+"/") {
			return true
		}
	}
	return false
}

// buildPreviewTree 由快照部门 + 用户映射构造「选中部门 → 用户」的树形预览。
// 未勾选部门（及其用户）完全不进入结果。
func (s *DirectorySyncService) buildPreviewTree(snap *directorySnapshot, cfg DirectorySyncConfig, previewUsers map[string][]SyncPreviewUser) []SyncPreviewDept {
	roots := make(map[string]bool)
	for _, m := range cfg.DepartmentMappings {
		if !m.Include || strings.TrimSpace(m.RemotePath) == "" {
			continue
		}
		if strings.TrimSpace(m.LocalDepartmentID) != "" || (m.CreateLocal && strings.TrimSpace(m.NewDeptName) != "") {
			roots[m.RemotePath] = true
		}
	}
	log.Printf("[DEBUG] buildPreviewTree roots=%v previewUsers=%d snapDepts=%d", roots, len(previewUsers), len(snap.Departments))

	nodes := make(map[string]*SyncPreviewDept)
	addNode := func(p string) *SyncPreviewDept {
		if n, ok := nodes[p]; ok {
			// 快照部门已创建过节点，但创建时 Users 为空；
			// 必须把真正归属该部门的用户回填进去，否则树里永远显示 0 用户。
			n.Users = previewUsers[p]
			return n
		}
		n := &SyncPreviewDept{RemotePath: p, RemoteName: leafName(p), Users: previewUsers[p]}
		nodes[p] = n
		return n
	}
	// 1) 选中子树内的快照部门
	for _, d := range snap.Departments {
		p := getStringAny(d, "path")
		if p == "" || !inSelectedSubtree(p, roots) {
			continue
		}
		n := addNode(p)
		n.RemoteName = firstNonEmpty(getStringAny(d, "name"), leafName(p))
	}
	// 2) 补上仅含用户、但快照部门列表里缺失的部门路径，并保证祖先链存在
	for p := range previewUsers {
		cur := p
		for cur != "" {
			addNode(cur)
			parent := parentPath(cur)
			if parent == cur {
				break
			}
			cur = parent
		}
	}
	// 3) 建立父子关系
	var tree []SyncPreviewDept
	for p, n := range nodes {
		parent := parentPath(p)
		if parent != "" {
			if pn, ok := nodes[parent]; ok && pn != n {
				pn.Children = append(pn.Children, *n)
				continue
			}
		}
		tree = append(tree, *n)
	}
	// 4) 排序 + 递归统计用户数
	var sortRec func(n *SyncPreviewDept)
	sortRec = func(n *SyncPreviewDept) {
		sort.Slice(n.Children, func(i, j int) bool { return n.Children[i].RemotePath < n.Children[j].RemotePath })
		for i := range n.Children {
			sortRec(&n.Children[i])
		}
	}
	for i := range tree {
		sortRec(&tree[i])
	}
	var calc func(n *SyncPreviewDept) int
	calc = func(n *SyncPreviewDept) int {
		c := len(n.Users)
		for i := range n.Children {
			c += calc(&n.Children[i])
		}
		n.UserCount = c
		return c
	}
	for i := range tree {
		calc(&tree[i])
	}
	treeJSON, _ := json.Marshal(tree)
	if len(treeJSON) > 2000 {
		treeJSON = treeJSON[:2000]
	}
	log.Printf("[DEBUG] buildPreviewTree output tree=%s", treeJSON)
	return tree
}

// disableMissingUsers 对「平台来源(user_source=platform)」的用户执行缺失禁用：
// 若其外部账号不在最近一次同步的远端缓冲里（远端已删除/离职），自动禁用并标记
// 原因「同步用户的来源不存在」。不依赖 binding 表，因此无 user binding 的用户
// （如历史数据遗漏绑定）也能被正确识别；本地创建的账号不参与，保持原有状态不变。
func (s *DirectorySyncService) disableMissingUsers(tx *gorm.DB, cfg DirectorySyncConfig, dryRun bool, summary *DirectorySyncSummary) error {
	// 远端“仍存在”的标识集合：缓冲表 = 最近一次同步拉回的全部远端用户
	extIDs := make(map[string]bool)
	usernames := make(map[string]bool)
	emails := make(map[string]bool)
	var buffers []model.DirectorySyncBuffer
	if err := tx.Where("provider = ?", cfg.PlatformType).Find(&buffers).Error; err != nil {
		return err
	}
	for _, b := range buffers {
		if b.ExternalID != "" {
			extIDs[b.ExternalID] = true
		}
		if b.Username != "" {
			usernames[b.Username] = true
		}
		if b.Email != "" {
			emails[b.Email] = true
		}
	}

	// 遍历所有「平台来源」的用户（而非仅遍历 binding）
	var users []model.User
	if err := tx.Where("user_source = ?", "platform").Find(&users).Error; err != nil {
		return err
	}
	for i := range users {
		u := &users[i]
		// 已是离职禁用状态，跳过，避免重复计数/写入
		if !u.IsActive && u.HireStatus == "resigned" {
			continue
		}
		// 判定远端是否仍存在：优先 external_id（经由 binding）；
		// 无 binding 或未命中则退用 username/email 匹配远端缓冲。
		remoteExists := false
		var binding model.DirectorySyncBinding
		if err := tx.Where("provider = ? AND external_type = ? AND local_id = ?", cfg.PlatformType, "user", u.ID).First(&binding).Error; err == nil && binding.ExternalID != "" {
			remoteExists = extIDs[binding.ExternalID]
		}
		if !remoteExists && u.Username != "" {
			remoteExists = usernames[u.Username]
		}
		if u.Email != nil && *u.Email != "" && !remoteExists {
			remoteExists = emails[*u.Email]
		}
		if remoteExists {
			continue
		}
		summary.UserDisabled++
		summary.UserDetails = append(summary.UserDetails, UserSyncDetail{
			Type: "disabled", Name: u.Nickname, Username: u.Username,
			Reason: "最近一次远端通讯录中已不存在该用户，按配置自动禁用",
		})
		if dryRun {
			continue
		}
		u.IsActive = false
		u.HireStatus = "resigned"
		u.IsLocked = true
		u.LockReason = "source_missing"
		if err := tx.Save(u).Error; err != nil {
			return err
		}
	}
	return nil
}

func (s *DirectorySyncService) finishLog(logRow *model.DirectorySyncLog, summary *DirectorySyncSummary) {
	now := time.Now()
	logRow.Status = summary.Status
	logRow.FinishedAt = &now
	logRow.DepartmentCreated = summary.DepartmentCreated
	logRow.DepartmentMatched = summary.DepartmentMatched
	logRow.UserCreated = summary.UserCreated
	logRow.UserUpdated = summary.UserUpdated
	logRow.UserDisabled = summary.UserDisabled
	logRow.UserSkipped = summary.UserSkipped
	logRow.Message = summary.Message
	if details, err := json.Marshal(summary.Details); err == nil {
		logRow.Details = string(details)
	}
	_ = s.db.Save(logRow).Error
}

func (s *DirectorySyncService) buildDepartmentPathIndex(tx *gorm.DB, mountID *uuid.UUID) (map[string]uuid.UUID, error) {
	var depts []model.Department
	if err := tx.Order("sort_order").Find(&depts).Error; err != nil {
		return nil, err
	}
	byID := make(map[uuid.UUID]model.Department, len(depts))
	for _, dept := range depts {
		byID[dept.ID] = dept
	}
	out := make(map[string]uuid.UUID)
	for _, dept := range depts {
		path, ok := departmentRelativePath(dept.ID, mountID, byID)
		if ok && path != "" {
			out[path] = dept.ID
		}
	}
	return out, nil
}

func departmentRelativePath(id uuid.UUID, mountID *uuid.UUID, byID map[uuid.UUID]model.Department) (string, bool) {
	var parts []string
	cursor := id
	visited := map[uuid.UUID]bool{}
	for {
		if visited[cursor] {
			return "", false
		}
		visited[cursor] = true
		dept, ok := byID[cursor]
		if !ok {
			return "", false
		}
		if mountID != nil && dept.ID == *mountID {
			break
		}
		parts = append([]string{dept.Name}, parts...)
		if dept.ParentID == nil {
			if mountID != nil {
				return "", false
			}
			break
		}
		cursor = *dept.ParentID
	}
	return strings.Join(parts, "/"), true
}

func collectRemoteDepartmentPaths(snap *directorySnapshot, cfg DirectorySyncConfig) []string {
	paths := make(map[string]bool)
	add := func(path string) {
		path = localDepartmentPath(path, cfg.StripPrefix)
		for path != "" {
			paths[path] = true
			path = parentPath(path)
		}
	}
	for _, dept := range snap.Departments {
		add(firstNonEmpty(getStringAny(dept, "path"), getStringAny(dept, "departmentPath")))
	}
	for _, user := range snap.Users {
		for _, p := range getStringListAny(user, cfg.FieldMapping["department_paths"]) {
			add(p)
		}
		add(getStringAny(user, cfg.FieldMapping["department_path"]))
	}
	out := make([]string, 0, len(paths))
	for p := range paths {
		out = append(out, p)
	}
	return out
}

func (s *DirectorySyncService) getBinding(tx *gorm.DB, provider, externalType, externalID string) (*model.DirectorySyncBinding, error) {
	var binding model.DirectorySyncBinding
	err := tx.Where("provider = ? AND external_type = ? AND external_id = ?", provider, externalType, externalID).First(&binding).Error
	return &binding, err
}

func (s *DirectorySyncService) upsertBinding(tx *gorm.DB, provider, externalType, externalID string, localID uuid.UUID, remotePath string) error {
	binding, err := s.getBinding(tx, provider, externalType, externalID)
	if err == nil {
		binding.LocalID = localID
		binding.RemotePath = remotePath
		return tx.Save(binding).Error
	}
	binding = &model.DirectorySyncBinding{
		Provider:     provider,
		ExternalType: externalType,
		ExternalID:   externalID,
		LocalID:      localID,
		RemotePath:   remotePath,
	}
	return tx.Create(binding).Error
}

func (s *DirectorySyncService) getUserByID(tx *gorm.DB, id uuid.UUID) (*model.User, error) {
	var user model.User
	err := tx.First(&user, "id = ?", id).Error
	return &user, err
}

func (s *DirectorySyncService) getUserByDomainAccount(tx *gorm.DB, domainAccount string) (*model.User, error) {
	var user model.User
	err := tx.First(&user, "domain_account = ?", domainAccount).Error
	return &user, err
}

func (s *DirectorySyncService) getUserByEmail(tx *gorm.DB, email string) (*model.User, error) {
	var user model.User
	err := tx.First(&user, "email = ?", email).Error
	return &user, err
}

func (s *DirectorySyncService) getUserByUsername(tx *gorm.DB, username string) (*model.User, error) {
	var user model.User
	err := tx.First(&user, "username = ?", username).Error
	return &user, err
}

func valueTaken(tx *gorm.DB, field, value string, currentID uuid.UUID) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	var count int64
	q := tx.Model(&model.User{}).Where(field+" = ?", value)
	if currentID != uuid.Nil {
		q = q.Where("id <> ?", currentID)
	}
	return q.Count(&count).Error == nil && count > 0
}

func (s *DirectorySyncService) generateUsername(tx *gorm.DB, strategy, sourceUsername, nickname string, currentID uuid.UUID) string {
	base := normalizeUsernameBase(strategy, sourceUsername, nickname)
	if base == "" {
		base = "user"
	}
	candidate := base
	for i := 2; valueTaken(tx, "username", candidate, currentID); i++ {
		candidate = base + strconv.Itoa(i)
	}
	return candidate
}

// resolveImportUsername 计算导入时的最终用户名：
//   - override 为空：按策略生成（与完整同步一致）；
//   - override 非空（用户手动编辑过）：sanitize 后使用，并对重名做唯一性兜底（追加数字）。
func (s *DirectorySyncService) resolveImportUsername(tx *gorm.DB, strategy, sourceUsername, nickname string, currentID uuid.UUID, override string) string {
	target := sanitizeUsername(override)
	if target == "" {
		return s.generateUsername(tx, strategy, sourceUsername, nickname, currentID)
	}
	for i := 2; valueTaken(tx, "username", target, currentID); i++ {
		target = target + strconv.Itoa(i)
	}
	return target
}

// bufferConflictInfo 编辑用户名/邮箱时与已存在用户冲突的信息，供前端弹窗让用户选择处理方式。
type bufferConflictInfo struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
}

// editBufferFieldResult 编辑用户名/邮箱结果：无冲突时已写回编辑值；冲突时不写回、返回冲突信息。
type editBufferFieldResult struct {
	Value    string              `json:"-"`
	Conflict *bufferConflictInfo `json:"conflict,omitempty"`
}

// EditBufferUsername 供前端「用户导入」预览行内编辑用户名：
// 写回缓冲表，导入时按该用户名落库。
// 若编辑后的用户名与已存在用户冲突，则**不写回**、返回冲突信息，由前端弹窗让用户选择
// 「关联到已有用户」或「重命名加序号」，避免静默给同一人建两个账号 / 撞名。
func (s *DirectorySyncService) EditBufferField(externalID, field, value string) (*editBufferFieldResult, error) {
	cfg := s.LoadConfig(false)
	if cfg.PlatformType == "" {
		return nil, errors.New("尚未配置同步平台类型")
	}
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return nil, errors.New("external_id 不能为空")
	}
	var row model.DirectorySyncBuffer
	if err := s.db.Where("provider = ? AND external_id = ?", cfg.PlatformType, externalID).First(&row).Error; err != nil {
		return nil, errors.New("缓冲记录不存在，请先点击「同步用户」拉取远端通讯录")
	}

	switch field {
	case "username":
		target := sanitizeUsername(value)
		if target == "" {
			return nil, errors.New("用户名不能为空或仅含非法字符")
		}
		if valueTaken(s.db, "username", target, uuid.Nil) {
			return &editBufferFieldResult{Value: target, Conflict: s.fillUserConflictInfo(s.db, target, "")}, nil
		}
		if err := s.db.Model(&row).Updates(model.DirectorySyncBuffer{Username: target, UsernameEdited: target}).Error; err != nil {
			return nil, err
		}
		return &editBufferFieldResult{Value: target, Conflict: nil}, nil
	case "email":
		target := sanitizeEmail(value)
		if target == "" || !isValidEmail(target) {
			return nil, errors.New("邮箱格式不正确")
		}
		if valueTaken(s.db, "email", target, uuid.Nil) {
			return &editBufferFieldResult{Value: target, Conflict: s.fillUserConflictInfo(s.db, "", target)}, nil
		}
		if err := s.db.Model(&row).Updates(model.DirectorySyncBuffer{Email: target, EmailEdited: target}).Error; err != nil {
			return nil, err
		}
		return &editBufferFieldResult{Value: target, Conflict: nil}, nil
	default:
		return nil, errors.New("不支持的字段类型")
	}
}

// ResolveBufferConflict 处理用户名/邮箱冲突的两种选择：
// field: "username" 或 "email"
//   - "link"：建立绑定（该 external_id → 冲突用户）。导入时该账号会被判定为「已存在」、
//     更新该用户而非新建，预览标记为已存在——从根本上避免同一人两个账号 / 撞名。
//     同时将缓冲行的 username/email 更新为冲突用户的值。
//   - "rename"：基于用户想改的目标值追加序号（唯一性兜底）写回，导入时新建该值账号。
//     对用户名追加序号到 username 字段；对邮箱追加序号到 email local part。
//
// 返回最终落库/显示的值（username 或 email）。
func (s *DirectorySyncService) ResolveBufferConflict(externalID, field, action, conflictUserID, value string) (string, error) {
	cfg := s.LoadConfig(false)
	if cfg.PlatformType == "" {
		return "", errors.New("尚未配置同步平台类型")
	}
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return "", errors.New("external_id 不能为空")
	}
	var row model.DirectorySyncBuffer
	if err := s.db.Where("provider = ? AND external_id = ?", cfg.PlatformType, externalID).First(&row).Error; err != nil {
		return "", errors.New("缓冲记录不存在")
	}
	switch action {
	case "link":
		var u model.User
		if err := s.db.First(&u, "id = ?", conflictUserID).Error; err != nil {
			return "", errors.New("冲突用户不存在")
		}
		// 建立绑定：导入时该 external_id 通过 binding 更新该已存在用户，不再新建。
		if err := s.upsertBinding(s.db, cfg.PlatformType, "user", externalID, u.ID, ""); err != nil {
			return "", err
		}
		// 更新缓冲行：显示已存在用户的 username/email，并标记为已存在（导入时走更新分支）。
		updates := model.DirectorySyncBuffer{Exists: true}
		switch field {
		case "username":
			updates.Username = u.Username
		case "email":
			if u.Email != nil {
				updates.Email = *u.Email
			}
		}
		if err := s.db.Model(&row).Updates(updates).Error; err != nil {
			return "", err
		}
		switch field {
		case "username":
			return u.Username, nil
		case "email":
			if u.Email != nil {
				return *u.Email, nil
			}
			return "", nil
		default:
			return "", errors.New("不支持的字段类型")
		}
	case "rename":
		if field == "username" {
			target := sanitizeUsername(value)
			if target == "" {
				target = sanitizeUsername(row.Username)
			}
			if target == "" {
				target = "user"
			}
			for i := 2; valueTaken(s.db, "username", target, uuid.Nil); i++ {
				target = target + strconv.Itoa(i)
			}
			if err := s.db.Model(&row).Updates(model.DirectorySyncBuffer{Username: target, UsernameEdited: target}).Error; err != nil {
				return "", err
			}
			return target, nil
		} else if field == "email" {
			target := sanitizeEmail(value)
			if target == "" || !isValidEmail(target) {
				// 回退到缓冲中已有邮箱
				target = sanitizeEmail(row.Email)
			}
			if target == "" || !isValidEmail(target) {
				return "", errors.New("邮箱格式不正确")
			}
			at := strings.LastIndex(target, "@")
			local, domain := target[:at], target[at:]
			for i := 2; valueTaken(s.db, "email", local+strconv.Itoa(i)+domain, uuid.Nil); i++ {
				target = local + strconv.Itoa(i) + domain
			}
			if err := s.db.Model(&row).Updates(model.DirectorySyncBuffer{Email: target, EmailEdited: target}).Error; err != nil {
				return "", err
			}
			return target, nil
		}
		return "", errors.New("不支持的字段类型")
	default:
		return "", errors.New("未知的冲突处理动作")
	}
}

// fillUserConflictInfo 根据 username 或 email 查找冲突用户，填充冲突信息。
func (s *DirectorySyncService) fillUserConflictInfo(db *gorm.DB, username, email string) *bufferConflictInfo {
	if username != "" {
		if u, err := s.getUserByUsername(db, username); err == nil {
			return s.userConflictInfo(u)
		}
	}
	if email != "" {
		if u, err := s.getUserByEmail(db, email); err == nil {
			return s.userConflictInfo(u)
		}
	}
	return &bufferConflictInfo{}
}

func (s *DirectorySyncService) userConflictInfo(u *model.User) *bufferConflictInfo {
	return &bufferConflictInfo{
		UserID:   u.ID.String(),
		Username: u.Username,
		Name:     u.Nickname,
		Email:    derefString(u.Email),
		Phone:    derefString(u.Phone),
	}
}

// sanitizeEmail 规整邮箱：去首尾空白、小写。
func sanitizeEmail(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return value
}

// isValidEmail 基础邮箱格式校验（非空、含 @ 且 @ 不在首尾、域名含点）。
func isValidEmail(value string) bool {
	v := strings.TrimSpace(value)
	at := strings.LastIndex(v, "@")
	return at > 0 && at < len(v)-1 && strings.Contains(v[at+1:], ".")
}

// derefString 安全解引用 *string，nil 返回空串。
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// isLatin 判断字符串是否仅含 ASCII 字母/数字（即已是拼音或英文，无需再转）。
func isLatin(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for _, r := range s {
		if r > unicode.MaxASCII || (!unicode.IsLetter(r) && !unicode.IsDigit(r)) {
			return false
		}
	}
	return true
}

func normalizeUsernameBase(strategy, sourceUsername, nickname string) string {
	source := strings.ToLower(strings.TrimSpace(sourceUsername))
	switch strategy {
	case "source_lower":
		return sanitizeUsername(source)
	case "pinyin", "smart_pinyin", "":
		// 远端 username 通常已是姓名拼音，直接使用；非拉丁时回退到拉丁昵称或数字占位。
		// 不再用逐字中文→拼音表反解（易漏字且需手工维护）。
		if source != "" && isLatin(source) {
			return sanitizeUsername(source)
		}
		if n := strings.ToLower(strings.TrimSpace(nickname)); n != "" && isLatin(n) {
			return sanitizeUsername(n)
		}
		if isNumeric(source) {
			if len(source) > 6 {
				return "u" + source[len(source)-6:]
			}
			return "u" + source
		}
		return sanitizeUsername(source)
	}
	return sanitizeUsername(source)
}

func shouldNormalizeExistingUsername(current, source string) bool {
	c := strings.TrimSpace(current)
	s := strings.TrimSpace(source)
	if c == "" {
		return true
	}
	if isNumeric(c) {
		return true
	}
	return c == s || c == strings.ToLower(s)
}

var usernameCleaner = regexp.MustCompile(`[^a-z0-9._-]+`)

func sanitizeUsername(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = usernameCleaner.ReplaceAllString(value, "")
	value = strings.Trim(value, "._-")
	return value
}

// ---- 邮箱策略 ----

var emailLocalCleaner = regexp.MustCompile(`[^a-z0-9._%+-]+`)

// sanitizeEmailLocal 仅保留邮箱本地名允许的字符（小写）。
func sanitizeEmailLocal(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = emailLocalCleaner.ReplaceAllString(value, "")
	value = strings.Trim(value, "._%+-")
	return value
}

// sanitizeEmailDomain 规整域名：去首尾空白、去掉开头多余的 @ 与结尾的点。
func sanitizeEmailDomain(domain string) string {
	domain = strings.ToLower(strings.TrimSpace(domain))
	domain = strings.TrimPrefix(domain, "@")
	domain = strings.Trim(domain, ".")
	return domain
}

// splitEmailAddress 拆分邮箱为本地名与域名；非法（无 @ 或 @ 在首尾）返回空串。
func splitEmailAddress(email string) (local, domain string) {
	email = strings.TrimSpace(email)
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 {
		return "", ""
	}
	return email[:at], strings.ToLower(email[at+1:])
}

// derivePinyinName 把远端 userId 等拼音串（如 "TianZhongYa"）拆成 [surname, givenName]。
// 约定：拼音为 CamelCase，首段为姓（单姓最常见），其余为名；适用于单姓中文名。
// 仅做拆分、不做中文字典转写，避免在代码中维护庞大的拼音表。
func derivePinyinName(s string) (surname, given string) {
	s = strings.TrimSpace(s)
	if s == "" || !isLatin(s) {
		return "", ""
	}
	segs := camelSegments(s)
	if len(segs) < 2 {
		return "", ""
	}
	return segs[0], strings.Join(segs[1:], "")
}

// camelSegments 按大写字母边界把 CamelCase 串拆成若干段，如 "TianZhongYa" -> ["Tian","Zhong","Ya"]。
func camelSegments(s string) []string {
	var segs []string
	var cur strings.Builder
	for i, r := range s {
		if unicode.IsUpper(r) && i > 0 && cur.Len() > 0 {
			segs = append(segs, cur.String())
			cur.Reset()
		}
		cur.WriteRune(r)
	}
	if cur.Len() > 0 {
		segs = append(segs, cur.String())
	}
	return segs
}

// generateEmail 按邮箱策略生成邮箱本地名。
// 拼音一律取自远端已经提供的拼音，不再反向用逐字中文表转写（易漏字且需手工维护）：
//   - given_surname：优先用远端独立的 givenName.surname（已是拼音）；
//     当远端 givenName/surname 为中文（非拉丁，无法拼装）时，回退到远端邮箱的本地名
//     （仅当远端邮箱域名与配置一致，避免误用个人邮箱）；再不行才回退到远端 username（完整拼音）。
//   - fullname：优先用远端 username（完整拼音），其次远端邮箱本地名，再回退到拉丁昵称。
//
// 仅当策略与域名都配置时返回非空；否则返回 ""（沿用远端或留空）。
// 该函数不依赖 receiver 状态（纯函数），故改为包级函数，供 wecom 建号等同包逻辑复用。
func generateEmail(cfg DirectorySyncConfig, sourceUsername, nickname, givenName, surname, rawEmail string) string {
	strategy := strings.TrimSpace(cfg.EmailStrategy)
	domain := sanitizeEmailDomain(cfg.EmailDomain)
	if strategy == "" || domain == "" {
		return ""
	}
	src := strings.ToLower(strings.TrimSpace(sourceUsername))
	g := strings.TrimSpace(givenName)
	sr := strings.TrimSpace(surname)
	// 远端邮箱本地名：仅当其域名与配置一致时才可作为兜底，避免误用个人邮箱等外部域名。
	remoteLocal, remoteDomain := splitEmailAddress(rawEmail)
	useRemoteEmail := remoteDomain != "" && strings.EqualFold(remoteDomain, domain)
	var local string
	switch strategy {
	case "given_surname":
		if isLatin(g) && isLatin(sr) {
			local = sanitizeEmailLocal(g + "." + sr)
		} else if dSurname, dGiven := derivePinyinName(sourceUsername); dGiven != "" && dSurname != "" {
			// 远端未单独给出 givenName/surname（或为中文）时，复用远端 userId 中已提供的拼音
			// （约定为「姓+名」CamelCase，如 TianZhongYa），拆出并反转为「名.姓」以契合策略。
			local = sanitizeEmailLocal(dGiven + "." + dSurname)
		} else if useRemoteEmail {
			local = sanitizeEmailLocal(remoteLocal)
		} else if src != "" {
			local = sanitizeEmailLocal(src) // 远端拼音兜底，完整可用
		}
	case "fullname":
		if src != "" {
			local = sanitizeEmailLocal(src)
		} else if useRemoteEmail {
			local = sanitizeEmailLocal(remoteLocal)
		} else if isLatin(nickname) {
			local = sanitizeEmailLocal(nickname)
		}
	default:
		return ""
	}
	if local == "" {
		return ""
	}
	return local + "@" + domain
}

// resolvePreviewEmail 预览阶段计算展示邮箱：
//   - 策略为空：沿用远端邮箱（无则空）
//   - 策略为 given_surname / fullname：按规则用配置的邮件后缀生成，忽略远端邮箱；
//     生成失败（缺少姓名/后缀）时回退到远端邮箱
func (s *DirectorySyncService) resolvePreviewEmail(cfg DirectorySyncConfig, sourceUsername, rawEmail, nickname, givenName, surname string) string {
	strategy := strings.TrimSpace(cfg.EmailStrategy)
	if strategy == "" {
		return strings.TrimSpace(rawEmail)
	}
	if gen := generateEmail(cfg, sourceUsername, nickname, givenName, surname, rawEmail); gen != "" {
		return gen
	}
	return strings.TrimSpace(rawEmail)
}

// resolveAssignEmail 计算最终写入的邮箱指针：
//   - 策略为空（跟随远端）：远端有邮箱则占用后使用，无则留空（不生成）；
//   - 策略为 given_surname / fullname：按规则用配置的邮件后缀生成并覆盖远端邮箱，
//     对生成值做唯一性兜底（追加数字）；生成失败（缺姓名/后缀）时回退到远端邮箱。
func (s *DirectorySyncService) resolveAssignEmail(tx *gorm.DB, cfg DirectorySyncConfig, sourceUsername, rawEmail, nickname, givenName, surname string, currentID uuid.UUID) *string {
	strategy := strings.TrimSpace(cfg.EmailStrategy)
	if strategy == "" {
		raw := strings.TrimSpace(rawEmail)
		if raw == "" {
			return nil
		}
		if valueTaken(tx, "email", raw, currentID) {
			return nil
		}
		return &raw
	}
	gen := generateEmail(cfg, sourceUsername, nickname, givenName, surname, rawEmail)
	if gen == "" {
		// 生成失败（缺姓名/后缀），回退远端邮箱
		raw := strings.TrimSpace(rawEmail)
		if raw == "" || valueTaken(tx, "email", raw, currentID) {
			return nil
		}
		return &raw
	}
	cand := gen
	at := strings.Index(cand, "@")
	for i := 2; valueTaken(tx, "email", cand, currentID); i++ {
		if at < 0 {
			cand = gen + strconv.Itoa(i)
		} else {
			cand = gen[:at] + strconv.Itoa(i) + gen[at:]
		}
	}
	return &cand
}

func validateDirectoryConfig(cfg DirectorySyncConfig, requireDepartments bool) error {
	switch cfg.PlatformType {
	case DirectoryProviderWeComAttendance:
		if strings.TrimSpace(cfg.BaseURL) == "" {
			return errors.New("请先配置第三方平台地址")
		}
		if strings.TrimSpace(cfg.APIKey) == "" {
			return errors.New("请先配置 API Key")
		}
	case DirectoryProviderWeCom:
		// 企业微信通讯录复用全局 wecom 配置，无需第三方平台地址 / API Key；
		// 可用性（是否已启用并校验、corp_id/secret 是否齐全）由 WeCom.FetchDirectorySnapshot 内部检查。
	default:
		return errors.New("暂只支持企微后台通讯录同步（考勤桥接）与企业微信通讯录")
	}
	if requireDepartments {
		if cfg.MappingMode {
			hasMapping := false
			for _, m := range cfg.DepartmentMappings {
				if m.Include && (strings.TrimSpace(m.LocalDepartmentID) != "" || (m.CreateLocal && strings.TrimSpace(m.NewDeptName) != "")) {
					hasMapping = true
					break
				}
			}
			if !hasMapping {
				return errors.New("请在『部门匹配』中至少勾选一个远端部门，并映射到本地部门或登记待创建部门")
			}
		} else if len(cfg.SelectedDepartmentPaths) == 0 {
			return errors.New("请至少选择一个同步部门")
		}
	}
	return nil
}

func parseOptionalUUID(value string) (*uuid.UUID, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return nil, errors.New("本地挂载部门 ID 无效")
	}
	return &id, nil
}

func hireStatus(active bool) string {
	if active {
		return "active"
	}
	return "resigned"
}

func localDepartmentPath(remotePath, stripPrefix string) string {
	path := trimSlashes(remotePath)
	prefix := trimSlashes(stripPrefix)
	if prefix != "" {
		if path == prefix {
			return ""
		}
		if strings.HasPrefix(path, prefix+"/") {
			return strings.TrimPrefix(path, prefix+"/")
		}
	}
	return path
}

func trimSlashes(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "/")
	for strings.Contains(value, "//") {
		value = strings.ReplaceAll(value, "//", "/")
	}
	return value
}

func parentPath(path string) string {
	path = trimSlashes(path)
	idx := strings.LastIndex(path, "/")
	if idx < 0 {
		return ""
	}
	return path[:idx]
}

func leafName(path string) string {
	path = trimSlashes(path)
	idx := strings.LastIndex(path, "/")
	if idx < 0 {
		return path
	}
	return path[idx+1:]
}

func pathDepth(path string) int {
	if strings.TrimSpace(path) == "" {
		return 0
	}
	return len(strings.Split(path, "/"))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func getStringAny(item map[string]any, path string) string {
	if item == nil || strings.TrimSpace(path) == "" {
		return ""
	}
	var current any = item
	for _, part := range strings.Split(path, ".") {
		m, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = m[part]
	}
	switch v := current.(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	default:
		return ""
	}
}

func getStringListAny(item map[string]any, path string) []string {
	if item == nil || strings.TrimSpace(path) == "" {
		return nil
	}
	value := item[path]
	if value == nil && strings.Contains(path, ".") {
		var current any = item
		for _, part := range strings.Split(path, ".") {
			m, ok := current.(map[string]any)
			if !ok {
				current = nil
				break
			}
			current = m[part]
		}
		value = current
	}
	switch v := value.(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	case []string:
		return v
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
		if strings.Contains(v, "|") {
			parts := strings.Split(v, "|")
			out := make([]string, 0, len(parts))
			for _, part := range parts {
				if strings.TrimSpace(part) != "" {
					out = append(out, strings.TrimSpace(part))
				}
			}
			return out
		}
		return []string{strings.TrimSpace(v)}
	default:
		return nil
	}
}

func getBoolAny(item map[string]any, path string, fallback bool) bool {
	if item == nil || strings.TrimSpace(path) == "" {
		return fallback
	}
	value := item[path]
	switch v := value.(type) {
	case bool:
		return v
	case string:
		if strings.EqualFold(v, "true") || v == "1" || v == "有效" {
			return true
		}
		if strings.EqualFold(v, "false") || v == "0" || v == "无效" {
			return false
		}
	case float64:
		return v != 0
	}
	return fallback
}

func isNumeric(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
