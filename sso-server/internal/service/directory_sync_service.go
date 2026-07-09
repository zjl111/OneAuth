package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	"sso-server/pkg/password"
)

const DirectoryProviderWeComAttendance = "wecom_attendance"

type DirectorySyncService struct {
	configRepo *repository.ConfigRepository
	userRepo   *repository.UserRepository
	deptRepo   *repository.DepartmentRepository
	db         *gorm.DB
	client     *http.Client
}

func NewDirectorySyncService(configRepo *repository.ConfigRepository, userRepo *repository.UserRepository, deptRepo *repository.DepartmentRepository) *DirectorySyncService {
	return &DirectorySyncService{
		configRepo: configRepo,
		userRepo:   userRepo,
		deptRepo:   deptRepo,
		db:         userRepo.DB(),
		client:     &http.Client{Timeout: 20 * time.Second},
	}
}

type DirectorySyncConfig struct {
	Enabled                 bool              `json:"enabled"`
	PlatformType            string            `json:"platform_type"`
	BaseURL                 string            `json:"base_url"`
	APIKey                  string            `json:"api_key,omitempty"`
	SelectedDepartmentPaths []string          `json:"selected_department_paths"`
	StripPrefix             string            `json:"strip_prefix"`
	MountDepartmentID       string            `json:"mount_department_id"`
	DeactivateMissing       bool              `json:"deactivate_missing"`
	UsernameStrategy        string            `json:"username_strategy"`
	FieldMapping            map[string]string `json:"field_mapping"`
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
	DryRun            bool     `json:"dry_run"`
	Status            string   `json:"status"`
	DepartmentCreated int      `json:"department_created"`
	DepartmentMatched int      `json:"department_matched"`
	UserCreated       int      `json:"user_created"`
	UserUpdated       int      `json:"user_updated"`
	UserDisabled      int      `json:"user_disabled"`
	UserSkipped       int      `json:"user_skipped"`
	Message           string   `json:"message"`
	Details           []string `json:"details"`
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
	if !maskSecret {
		cfg.APIKey = s.configRepo.Get("directory_sync", "api_key")
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
	selected, _ := json.Marshal(in.SelectedDepartmentPaths)
	mapping, _ := json.Marshal(in.FieldMapping)
	items := map[string]string{
		"enabled":                   strconv.FormatBool(in.Enabled),
		"platform_type":             strings.TrimSpace(in.PlatformType),
		"base_url":                  strings.TrimRight(strings.TrimSpace(in.BaseURL), "/"),
		"selected_department_paths": string(selected),
		"strip_prefix":              trimSlashes(in.StripPrefix),
		"mount_department_id":       strings.TrimSpace(in.MountDepartmentID),
		"deactivate_missing":        strconv.FormatBool(in.DeactivateMissing),
		"username_strategy":         strings.TrimSpace(in.UsernameStrategy),
		"field_mapping":             string(mapping),
	}
	for k, v := range items {
		if err := s.configRepo.Set("directory_sync", k, v); err != nil {
			return err
		}
	}
	if strings.TrimSpace(in.APIKey) != "" {
		if err := s.configRepo.Set("directory_sync", "api_key", strings.TrimSpace(in.APIKey)); err != nil {
			return err
		}
	}
	return nil
}

func (s *DirectorySyncService) FetchDepartments() ([]DirectoryDepartment, error) {
	cfg := s.LoadConfig(false)
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

	err = s.db.Transaction(func(tx *gorm.DB) error {
		return s.applySnapshot(tx, cfg, snap, dryRun, summary)
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

func (s *DirectorySyncService) LatestLogs(limit int) ([]model.DirectorySyncLog, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	var logs []model.DirectorySyncLog
	err := s.db.Order("started_at DESC").Limit(limit).Find(&logs).Error
	return logs, err
}

func (s *DirectorySyncService) fetchCombinedSnapshot(cfg DirectorySyncConfig) (*directorySnapshot, error) {
	roots := cfg.SelectedDepartmentPaths
	if len(roots) == 0 {
		roots = []string{""}
	}
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

func (s *DirectorySyncService) applySnapshot(tx *gorm.DB, cfg DirectorySyncConfig, snap *directorySnapshot, dryRun bool, summary *DirectorySyncSummary) error {
	mountID, err := parseOptionalUUID(cfg.MountDepartmentID)
	if err != nil {
		return err
	}
	pathToDeptID, err := s.buildDepartmentPathIndex(tx, mountID)
	if err != nil {
		return err
	}

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
		localID, ok := pathToDeptID[localPath]
		if !ok {
			if binding, err := s.getBinding(tx, cfg.PlatformType, "department", remoteID); err == nil {
				localID = binding.LocalID
				ok = true
			}
		}
		if ok {
			summary.DepartmentMatched++
			if !dryRun {
				_ = s.upsertBinding(tx, cfg.PlatformType, "department", remoteID, localID, localPath)
			}
			continue
		}
		summary.DepartmentCreated++
		if dryRun {
			continue
		}
		parentID := mountID
		if parent := parentPath(localPath); parent != "" {
			if id, ok := pathToDeptID[parent]; ok {
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
		pathToDeptID[localPath] = dept.ID
		if err := s.upsertBinding(tx, cfg.PlatformType, "department", remoteID, dept.ID, localPath); err != nil {
			return err
		}
	}

	seenUserIDs := make(map[string]bool)
	for _, remote := range snap.Users {
		if err := s.applyRemoteUser(tx, cfg, remote, pathToDeptID, mountID, dryRun, summary, seenUserIDs); err != nil {
			summary.UserSkipped++
			summary.Details = append(summary.Details, err.Error())
		}
	}
	if cfg.DeactivateMissing {
		if err := s.disableMissingUsers(tx, cfg, seenUserIDs, dryRun, summary); err != nil {
			return err
		}
	}
	return nil
}

func (s *DirectorySyncService) applyRemoteUser(tx *gorm.DB, cfg DirectorySyncConfig, remote map[string]any, pathToDeptID map[string]uuid.UUID, mountID *uuid.UUID, dryRun bool, summary *DirectorySyncSummary, seen map[string]bool) error {
	externalID := getStringAny(remote, cfg.FieldMapping["external_id"])
	if externalID == "" {
		return errors.New("跳过用户：缺少 external_id")
	}
	seen[externalID] = true

	nickname := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["nickname"]), externalID)
	sourceUsername := firstNonEmpty(getStringAny(remote, cfg.FieldMapping["username"]), externalID)
	email := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["email"]))
	phone := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["phone"]))
	position := strings.TrimSpace(getStringAny(remote, cfg.FieldMapping["position"]))
	active := getBoolAny(remote, cfg.FieldMapping["active"], true)
	deptID := s.resolveUserDepartment(remote, cfg, pathToDeptID, mountID)

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

	if user == nil {
		summary.UserCreated++
		if dryRun {
			return nil
		}
		username := s.generateUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, uuid.Nil)
		hash, _ := password.Hash(uuid.New().String())
		user = &model.User{
			ID:            uuid.New(),
			Username:      username,
			Nickname:      nickname,
			PasswordHash:  hash,
			Position:      position,
			DomainAccount: externalID,
			UserType:      "wecom",
			HireStatus:    hireStatus(active),
			DepartmentID:  deptID,
			IsActive:      active,
		}
		if email != "" && !s.valueTaken(tx, "email", email, uuid.Nil) {
			user.Email = &email
		}
		if phone != "" && !s.valueTaken(tx, "phone", phone, uuid.Nil) {
			user.Phone = &phone
		}
		if err := tx.Create(user).Error; err != nil {
			return fmt.Errorf("创建用户 %s 失败: %w", nickname, err)
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
	if shouldNormalizeExistingUsername(user.Username, sourceUsername) {
		user.Username = s.generateUsername(tx, cfg.UsernameStrategy, sourceUsername, nickname, user.ID)
	} else {
		user.Username = strings.ToLower(user.Username)
	}
	if email == "" {
		user.Email = nil
	} else if !s.valueTaken(tx, "email", email, user.ID) {
		user.Email = &email
	}
	if phone == "" {
		user.Phone = nil
	} else if !s.valueTaken(tx, "phone", phone, user.ID) {
		user.Phone = &phone
	}
	if err := tx.Save(user).Error; err != nil {
		return fmt.Errorf("更新用户 %s 失败: %w", nickname, err)
	}
	return s.upsertBinding(tx, cfg.PlatformType, "user", externalID, user.ID, "")
}

func (s *DirectorySyncService) resolveUserDepartment(remote map[string]any, cfg DirectorySyncConfig, pathToDeptID map[string]uuid.UUID, mountID *uuid.UUID) *uuid.UUID {
	paths := getStringListAny(remote, cfg.FieldMapping["department_paths"])
	if len(paths) == 0 {
		if p := getStringAny(remote, cfg.FieldMapping["department_path"]); p != "" {
			paths = []string{p}
		}
	}
	for _, p := range paths {
		localPath := localDepartmentPath(p, cfg.StripPrefix)
		if id, ok := pathToDeptID[localPath]; ok {
			return &id
		}
	}
	return mountID
}

func (s *DirectorySyncService) disableMissingUsers(tx *gorm.DB, cfg DirectorySyncConfig, seen map[string]bool, dryRun bool, summary *DirectorySyncSummary) error {
	var bindings []model.DirectorySyncBinding
	if err := tx.Where("provider = ? AND external_type = ?", cfg.PlatformType, "user").Find(&bindings).Error; err != nil {
		return err
	}
	for _, binding := range bindings {
		if seen[binding.ExternalID] {
			continue
		}
		var user model.User
		if err := tx.First(&user, "id = ?", binding.LocalID).Error; err != nil {
			continue
		}
		if !user.IsActive && user.HireStatus == "resigned" {
			continue
		}
		summary.UserDisabled++
		if dryRun {
			continue
		}
		user.IsActive = false
		user.HireStatus = "resigned"
		if err := tx.Save(&user).Error; err != nil {
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

func (s *DirectorySyncService) valueTaken(tx *gorm.DB, field, value string, currentID uuid.UUID) bool {
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
	for i := 2; s.valueTaken(tx, "username", candidate, currentID); i++ {
		candidate = base + strconv.Itoa(i)
	}
	return candidate
}

func normalizeUsernameBase(strategy, sourceUsername, nickname string) string {
	source := strings.TrimSpace(sourceUsername)
	lower := strings.ToLower(source)
	switch strategy {
	case "source_lower":
		return sanitizeUsername(lower)
	case "pinyin":
		if py := nameToPinyin(nickname); py != "" {
			return sanitizeUsername(py)
		}
	case "smart_pinyin", "":
		if isNumeric(source) {
			if py := nameToPinyin(nickname); py != "" {
				return sanitizeUsername(py)
			}
			if len(source) > 6 {
				return "u" + source[len(source)-6:]
			}
		}
		return sanitizeUsername(lower)
	}
	return sanitizeUsername(lower)
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

func nameToPinyin(name string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(name) {
		if unicode.IsSpace(r) {
			continue
		}
		if r < unicode.MaxASCII {
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				b.WriteRune(unicode.ToLower(r))
			}
			continue
		}
		if py, ok := commonNamePinyin[r]; ok {
			b.WriteString(py)
		}
	}
	return b.String()
}

var commonNamePinyin = map[rune]string{
	'王': "wang", '李': "li", '张': "zhang", '刘': "liu", '陈': "chen", '杨': "yang", '黄': "huang", '赵': "zhao",
	'吴': "wu", '周': "zhou", '徐': "xu", '孙': "sun", '马': "ma", '朱': "zhu", '胡': "hu", '郭': "guo",
	'何': "he", '林': "lin", '罗': "luo", '高': "gao", '郑': "zheng", '梁': "liang", '谢': "xie", '宋': "song",
	'唐': "tang", '许': "xu", '韩': "han", '冯': "feng", '邓': "deng", '曹': "cao", '彭': "peng", '曾': "zeng",
	'萧': "xiao", '田': "tian", '董': "dong", '袁': "yuan", '潘': "pan", '于': "yu", '蒋': "jiang", '蔡': "cai",
	'余': "yu", '杜': "du", '叶': "ye", '程': "cheng", '苏': "su", '魏': "wei", '吕': "lv", '丁': "ding",
	'任': "ren", '沈': "shen", '姚': "yao", '卢': "lu", '姜': "jiang", '崔': "cui", '钟': "zhong", '谭': "tan",
	'陆': "lu", '汪': "wang", '范': "fan", '金': "jin", '石': "shi", '廖': "liao", '贾': "jia", '夏': "xia",
	'韦': "wei", '付': "fu", '方': "fang", '白': "bai", '邹': "zou", '孟': "meng", '熊': "xiong", '秦': "qin",
	'邱': "qiu", '江': "jiang", '尹': "yin", '薛': "xue", '闫': "yan", '段': "duan", '雷': "lei", '侯': "hou",
	'龙': "long", '史': "shi", '陶': "tao", '黎': "li", '贺': "he", '顾': "gu", '毛': "mao", '郝': "hao",
	'龚': "gong", '邵': "shao", '万': "wan", '钱': "qian", '严': "yan", '覃': "qin", '武': "wu", '戴': "dai",
	'莫': "mo", '孔': "kong", '向': "xiang", '常': "chang", '汤': "tang", '康': "kang", '施': "shi", '文': "wen",
	'牛': "niu", '樊': "fan", '葛': "ge", '邢': "xing", '安': "an", '齐': "qi", '易': "yi", '乔': "qiao",
	'伍': "wu", '庞': "pang", '颜': "yan", '倪': "ni", '庄': "zhuang", '聂': "nie", '章': "zhang", '鲁': "lu",
	'岳': "yue", '翟': "zhai", '殷': "yin", '詹': "zhan", '申': "shen", '欧': "ou", '耿': "geng", '关': "guan",
	'兰': "lan", '焦': "jiao", '俞': "yu", '左': "zuo", '柳': "liu", '甄': "zhen", '宫': "gong", '晏': "yan",
	'涛': "tao", '浩': "hao", '欣': "xin", '飞': "fei", '狮': "shi", '德': "de", '尚': "shang", '靖': "jing",
	'凯': "kai", '燕': "yan", '昊': "hao", '洁': "jie", '海': "hai", '洋': "yang", '伟': "wei", '芳': "fang",
	'娜': "na", '敏': "min", '静': "jing", '强': "qiang", '磊': "lei", '军': "jun", '丽': "li", '勇': "yong",
	'艳': "yan", '杰': "jie", '娟': "juan", '明': "ming", '超': "chao", '秀': "xiu", '霞': "xia", '平': "ping",
	'刚': "gang", '辉': "hui", '鹏': "peng", '华': "hua", '鑫': "xin", '俊': "jun", '峰': "feng", '健': "jian",
	'斌': "bin", '宇': "yu", '宁': "ning", '博': "bo", '佳': "jia", '瑞': "rui", '萍': "ping", '兵': "bing",
	'旭': "xu", '阳': "yang", '雪': "xue", '丹': "dan", '媛': "yuan", '倩': "qian", '亮': "liang",
}

func validateDirectoryConfig(cfg DirectorySyncConfig, requireDepartments bool) error {
	if cfg.PlatformType != DirectoryProviderWeComAttendance {
		return errors.New("暂只支持企微后台通讯录同步")
	}
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return errors.New("请先配置第三方平台地址")
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return errors.New("请先配置 API Key")
	}
	if requireDepartments && len(cfg.SelectedDepartmentPaths) == 0 {
		return errors.New("请至少选择一个同步部门")
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
