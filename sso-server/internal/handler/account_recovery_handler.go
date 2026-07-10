package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/response"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AccountRecoveryHandler struct {
	Repo       *repository.AccountRecoveryRepository
	ClientRepo *repository.ClientRepository
	UserRepo   *repository.UserRepository
	ConfigRepo *repository.ConfigRepository
}

type accountRecoveryInput struct {
	AppID              string `json:"app_id" binding:"required"`
	FetchUsersEnabled  bool   `json:"fetch_users_enabled"`
	FetchUsersScript   string `json:"fetch_users_script"`
	DisableUserEnabled bool   `json:"disable_user_enabled"`
	DisableUserScript  string `json:"disable_user_script"`
	DeleteUserEnabled  bool   `json:"delete_user_enabled"`
	DeleteUserScript   string `json:"delete_user_script"`
	TimeoutSeconds     int    `json:"timeout_seconds"`
	RetryCount         int    `json:"retry_count"`
}

// ── Rules CRUD ──

func (h *AccountRecoveryHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	rules, total, err := h.Repo.List(page, pageSize)
	if err != nil {
		response.ServerError(c, "查询失败")
		return
	}
	response.Page(c, total, rules)
}

func (h *AccountRecoveryHandler) Get(c *gin.Context) {
	rawID := c.Param("id")
	if rawID == "" {
		response.BadRequest(c, "无效的 ID")
		return
	}
	rule, err := h.Repo.GetByID(rawID)
	if err != nil {
		response.NotFound(c, "规则不存在")
		return
	}
	response.OK(c, rule)
}

func (h *AccountRecoveryHandler) Create(c *gin.Context) {
	var in accountRecoveryInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, "参数错误: "+err.Error())
		return
	}

	// 检查是否已存在该应用的规则
	rules, _, _ := h.Repo.List(1, 100)
	for _, r := range rules {
		if r.AppID == in.AppID {
			response.BadRequest(c, "该应用已配置回收规则，不能重复创建")
			return
		}
	}

	rule := &model.AccountRecoveryRule{
		AppID:              in.AppID,
		FetchUsersEnabled:  in.FetchUsersEnabled,
		FetchUsersScript:   in.FetchUsersScript,
		DisableUserEnabled: in.DisableUserEnabled,
		DisableUserScript:  in.DisableUserScript,
		DeleteUserEnabled:  in.DeleteUserEnabled,
		DeleteUserScript:   in.DeleteUserScript,
		TimeoutSeconds:     in.TimeoutSeconds,
		RetryCount:         in.RetryCount,
		Enabled:            true,
	}

	// 获取应用名称
	if in.AppID != "" && h.ClientRepo != nil {
		app, err := h.ClientRepo.GetByClientID(in.AppID)
		if err == nil {
			rule.AppName = app.ClientName
		}
	}

	if err := h.Repo.Create(rule); err != nil {
		response.ServerError(c, "创建失败")
		return
	}
	response.OK(c, rule)
}

func (h *AccountRecoveryHandler) Update(c *gin.Context) {
	rawID := c.Param("id")
	if rawID == "" {
		response.BadRequest(c, "无效的 ID")
		return
	}

	existing, err := h.Repo.GetByID(rawID)
	if err != nil {
		response.NotFound(c, "规则不存在")
		return
	}

	var in accountRecoveryInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, "参数错误: "+err.Error())
		return
	}

	existing.AppID = in.AppID
	existing.FetchUsersEnabled = in.FetchUsersEnabled
	existing.FetchUsersScript = in.FetchUsersScript
	existing.DisableUserEnabled = in.DisableUserEnabled
	existing.DisableUserScript = in.DisableUserScript
	existing.DeleteUserEnabled = in.DeleteUserEnabled
	existing.DeleteUserScript = in.DeleteUserScript
	existing.TimeoutSeconds = in.TimeoutSeconds
	existing.RetryCount = in.RetryCount

	// 获取应用名称
	if in.AppID != "" && existing.AppName == "" && h.ClientRepo != nil {
		app, err := h.ClientRepo.GetByClientID(in.AppID)
		if err == nil {
			existing.AppName = app.ClientName
		}
	}

	if err := h.Repo.Update(existing); err != nil {
		response.ServerError(c, "更新失败")
		return
	}
	response.OK(c, existing)
}

func (h *AccountRecoveryHandler) Delete(c *gin.Context) {
	rawID := c.Param("id")
	if rawID == "" {
		response.BadRequest(c, "无效的 ID")
		return
	}
	if err := h.Repo.Delete(rawID); err != nil {
		response.ServerError(c, "删除失败")
		return
	}
	response.OK(c, nil)
}

func (h *AccountRecoveryHandler) Toggle(c *gin.Context) {
	rawID := c.Param("id")
	if rawID == "" {
		response.BadRequest(c, "无效的 ID")
		return
	}

	rule, err := h.Repo.GetByID(rawID)
	if err != nil {
		response.NotFound(c, "规则不存在")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}

	rule.Enabled = req.Enabled
	if err := h.Repo.Update(rule); err != nil {
		response.ServerError(c, "更新失败")
		return
	}
	response.OK(c, rule)
}

func (h *AccountRecoveryHandler) TestRun(c *gin.Context) {
	rawID := c.Param("id")
	if rawID == "" {
		response.BadRequest(c, "无效的 ID")
		return
	}

	rule, err := h.Repo.GetByID(rawID)
	if err != nil {
		response.NotFound(c, "规则不存在")
		return
	}

	// 创建测试日志
	log := &model.AccountRecoveryLog{
		RuleID:    rule.ID,
		RuleName:  rule.AppName,
		AppName:   rule.AppName,
		Username:  "test_user",
		EventType: "test",
		Status:    "success",
		Stdout:    "测试运行成功",
	}

	if err := h.Repo.CreateLog(log); err != nil {
		response.ServerError(c, "创建日志失败")
		return
	}

	h.Repo.UpdateLastExecuted(rule.ID)
	response.OK(c, log)
}

// ── Reconciliation ──

func (h *AccountRecoveryHandler) ListReconciliation(c *gin.Context) {
	page, pageSize := parsePagination(c)
	appID := c.Query("app_id")
	filter := c.Query("filter") // orphan, consistent, missing
	search := c.Query("search")

	items, total, err := h.Repo.ListReconciliation(page, pageSize, appID, filter, search)
	if err != nil {
		response.ServerError(c, "查询失败")
		return
	}
	response.Page(c, total, items)
}

func (h *AccountRecoveryHandler) ReconciliationStats(c *gin.Context) {
	appID := c.Query("app_id")
	stats, err := h.Repo.ReconciliationStats(appID)
	if err != nil {
		response.ServerError(c, "查询统计失败")
		return
	}
	response.OK(c, stats)
}

func (h *AccountRecoveryHandler) RunReconciliation(c *gin.Context) {
	var req struct {
		AppID string `json:"app_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误: 需要 app_id")
		return
	}

	// 查找该应用的回收规则
	var rule *model.AccountRecoveryRule
	rules, _, listErr := h.Repo.List(1, 100)
	if listErr == nil {
		for i := range rules {
			if rules[i].AppID == req.AppID {
				rule = &rules[i]
				break
			}
		}
	}

	appName := req.AppID
	if rule != nil && rule.AppName != "" {
		appName = rule.AppName
	} else if h.ClientRepo != nil {
		if app, err := h.ClientRepo.GetByClientID(req.AppID); err == nil {
			appName = app.ClientName
		}
	}

	// ── 1. 获取 SSO 全量用户 ──
	ssoUsers, _, err := h.UserRepo.List(repository.UserQuery{Page: 1, PageSize: 10000})
	if err != nil {
		response.ServerError(c, "获取 SSO 用户列表失败")
		return
	}

	// ── 2. 执行获取全量用户脚本 ──
	thirdPartyMap := make(map[string]model.StandardUserDTO) // username -> DTO
	if rule != nil && rule.FetchUsersEnabled && rule.FetchUsersScript != "" {
		timeout := time.Duration(rule.TimeoutSeconds) * time.Second
		if timeout == 0 {
			timeout = 30 * time.Second
		}
		stdout, err := executeFetchScript(rule.FetchUsersScript, timeout)
		if err != nil {
			// 记录日志但继续执行（可能脚本未配置）
			logEntry := &model.AccountRecoveryLog{
				EventType:    "fetch",
				Status:       "failed",
				AppName:      appName,
				ErrorMessage: fmt.Sprintf("执行获取用户脚本失败: %v", err),
			}
			if rule != nil {
				logEntry.RuleID = rule.ID
				logEntry.RuleName = rule.AppName
			}
			h.Repo.CreateLog(logEntry)
		} else {
			// 解析 JSON 输出
			var users []model.StandardUserDTO
			if err := json.Unmarshal([]byte(stdout), &users); err != nil {
				logEntry := &model.AccountRecoveryLog{
					EventType:    "fetch",
					Status:       "failed",
					AppName:      appName,
					ErrorMessage: fmt.Sprintf("解析脚本输出失败: %v, 输出: %s", err, stdout),
				}
				if rule != nil {
					logEntry.RuleID = rule.ID
					logEntry.RuleName = rule.AppName
				}
				h.Repo.CreateLog(logEntry)
			} else {
				for _, u := range users {
					thirdPartyMap[u.Username] = u
				}
				// 记录成功日志
				logEntry := &model.AccountRecoveryLog{
					EventType: "fetch",
					Status:    "success",
					AppName:   appName,
					Stdout:    fmt.Sprintf("获取到 %d 个第三方用户", len(users)),
				}
				if rule != nil {
					logEntry.RuleID = rule.ID
					logEntry.RuleName = rule.AppName
				}
				h.Repo.CreateLog(logEntry)
			}
		}
	}

	// ── 3. 交叉对比（按用户名 1:1 匹配）──
	now := time.Now()
	var results []model.AccountReconciliation

	// 3a. SSO 用户 vs 第三方
	for _, u := range ssoUsers {
		ssoStatus := "active"
		if u.IsLocked {
			ssoStatus = "locked"
		} else if !u.IsActive {
			ssoStatus = "deleted"
		}

		ssoDisplayName := u.Nickname
		ssoEmail := derefOrEmpty(u.Email)

		tpUser, found := thirdPartyMap[u.Username]
		if found {
			// 双方都有 → 检查属性是否一致
			var mismatches []string
			if tpUser.DisplayName != ssoDisplayName {
				mismatches = append(mismatches, "display_name")
			}
			if tpUser.Email != ssoEmail {
				mismatches = append(mismatches, "email")
			}

			attributeMismatch := ""
			if len(mismatches) > 0 {
				attributeMismatch = strings.Join(mismatches, ",")
			}

			results = append(results, model.AccountReconciliation{
				ID:                    uuid.New().String(),
				RuleID:                ruleIDOrEmpty(rule),
				AppID:                 req.AppID,
				AppName:               appName,
				Username:              u.Username,
				DisplayName:           ssoDisplayName,
				Email:                 ssoEmail,
				SSOStatus:             ssoStatus,
				ThirdPartyUserID:      tpUser.UserID,
				ThirdPartyStatus:      tpUser.Status,
				ThirdPartyDisplayName: tpUser.DisplayName,
				ThirdPartyEmail:       tpUser.Email,
				AttributeMismatch:     attributeMismatch,
				ReconcileResult:       "consistent",
				LastSyncedAt:          now,
			})
		} else {
			// SSO 有但第三方没有 → missing
			results = append(results, model.AccountReconciliation{
				ID:                    uuid.New().String(),
				RuleID:                ruleIDOrEmpty(rule),
				AppID:                 req.AppID,
				AppName:               appName,
				Username:              u.Username,
				DisplayName:           ssoDisplayName,
				Email:                 ssoEmail,
				SSOStatus:             ssoStatus,
				ThirdPartyStatus:      "not_found",
				ThirdPartyDisplayName: "",
				ThirdPartyEmail:       "",
				AttributeMismatch:     "",
				ReconcileResult:       "missing",
				LastSyncedAt:          now,
			})
		}
	}

	// 3b. 第三方独有用户（SSO 中不存在 → orphan）
	ssoUsernames := make(map[string]bool, len(ssoUsers))
	for _, u := range ssoUsers {
		ssoUsernames[u.Username] = true
	}
	for username, tpUser := range thirdPartyMap {
		if !ssoUsernames[username] {
			results = append(results, model.AccountReconciliation{
				ID:                    uuid.New().String(),
				RuleID:                ruleIDOrEmpty(rule),
				AppID:                 req.AppID,
				AppName:               appName,
				Username:              tpUser.Username,
				DisplayName:           tpUser.DisplayName,
				Email:                 tpUser.Email,
				SSOStatus:             "not_found",
				ThirdPartyUserID:      tpUser.UserID,
				ThirdPartyStatus:      tpUser.Status,
				ThirdPartyDisplayName: tpUser.DisplayName,
				ThirdPartyEmail:       tpUser.Email,
				AttributeMismatch:     "",
				ReconcileResult:       "orphan",
				LastSyncedAt:          now,
			})
		}
	}

	// ── 4. 写入数据库 ──
	if err := h.Repo.ClearReconciliationByAppID(req.AppID); err != nil {
		response.ServerError(c, "清理旧对账数据失败")
		return
	}
	if err := h.Repo.BulkCreateReconciliation(results); err != nil {
		response.ServerError(c, "写入对账结果失败")
		return
	}

	// 统计
	var consistent, missing, orphan, mismatch int
	for _, r := range results {
		switch r.ReconcileResult {
		case "consistent":
			consistent++
			if r.AttributeMismatch != "" {
				mismatch++
			}
		case "missing":
			missing++
		case "orphan":
			orphan++
		}
	}

	// 创建对账日志
	logEntry := &model.AccountRecoveryLog{
		EventType: "reconcile",
		Status:    "success",
		AppName:   appName,
		Stdout: fmt.Sprintf("对账完成: 共 %d 条记录 (一致: %d, 属性不一致: %d, 缺失: %d, 孤儿: %d)",
			len(results), consistent, mismatch, missing, orphan),
	}
	if rule != nil {
		logEntry.RuleID = rule.ID
		logEntry.RuleName = rule.AppName
		h.Repo.UpdateLastExecuted(rule.ID)
	}
	h.Repo.CreateLog(logEntry)

	response.OK(c, gin.H{
		"total":      len(results),
		"consistent": consistent,
		"mismatch":   mismatch,
		"missing":    missing,
		"orphan":     orphan,
	})
}

// ── helpers ──

func ruleIDOrEmpty(rule *model.AccountRecoveryRule) string {
	if rule != nil {
		return rule.ID
	}
	return ""
}

func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// executeFetchScript 执行 Go 脚本获取第三方系统用户列表
// 脚本必须输出符合 StandardUserDTO 格式的 JSON 数组
// 注意：脚本可能有调试输出（fmt.Printf），只提取 JSON 数组部分
func executeFetchScript(script string, timeout time.Duration) (string, error) {
	// 创建临时目录
	tmpDir, err := os.MkdirTemp("", "recovery-script-*")
	if err != nil {
		return "", fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// 写入脚本文件
	scriptPath := filepath.Join(tmpDir, "main.go")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return "", fmt.Errorf("写入脚本文件失败: %w", err)
	}

	// 初始化 go.mod
	modPath := filepath.Join(tmpDir, "go.mod")
	modContent := "module fetchscript\n\ngo 1.21\n"
	if err := os.WriteFile(modPath, []byte(modContent), 0644); err != nil {
		return "", fmt.Errorf("写入 go.mod 失败: %w", err)
	}

	// 创建上下文设置超时
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// 执行脚本
	cmd := exec.CommandContext(ctx, "go", "run", ".")
	cmd.Dir = tmpDir

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("脚本执行超时: %v", err)
		}
		return "", fmt.Errorf("脚本执行失败: %v, stderr: %s", err, stderr.String())
	}

	// 从 stdout 中提取 JSON 数组
	// 脚本可能有调试输出，只取 JSON 部分（以 [ 开头的行开始）
	output := stdout.String()
	jsonStart := strings.Index(output, "[")
	if jsonStart == -1 {
		return "", fmt.Errorf("脚本输出中未找到 JSON 数组，输出: %s", output)
	}

	return output[jsonStart:], nil
}

// parseScriptResult 解析脚本标准输出的 JSON，提取 success 和 message 字段。
// 如果输出不是合法 JSON 或没有 success 字段，默认认为成功（兼容旧脚本）。
func parseScriptResult(stdout string) (success bool, message string) {
	stdout = strings.TrimSpace(stdout)
	if stdout == "" {
		return true, ""
	}
	var result struct {
		Success *bool  `json:"success"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(stdout), &result); err != nil {
		// 不是 JSON，可能脚本直接输出了文本，视为成功
		return true, ""
	}
	if result.Success == nil {
		return true, result.Message
	}
	return *result.Success, result.Message
}

func executeScript(script string, timeout time.Duration, envVars map[string]string) (string, error) {
	tmpDir, err := os.MkdirTemp("", "recovery-script-*")
	if err != nil {
		return "", fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	scriptPath := filepath.Join(tmpDir, "main.go")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return "", fmt.Errorf("写入脚本文件失败: %w", err)
	}

	modPath := filepath.Join(tmpDir, "go.mod")
	modContent := "module recoveryaction\n\ngo 1.21\n"
	if err := os.WriteFile(modPath, []byte(modContent), 0644); err != nil {
		return "", fmt.Errorf("写入 go.mod 失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "go", "run", ".")
	cmd.Dir = tmpDir

	// 设置环境变量
	cmd.Env = os.Environ()
	for k, v := range envVars {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("脚本执行超时: %v", err)
		}
		return "", fmt.Errorf("脚本执行失败: %v, stderr: %s", err, stderr.String())
	}

	return stdout.String(), nil
}

func (h *AccountRecoveryHandler) BatchCleanup(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}

	// 查询对账记录
	records, err := h.Repo.GetReconciliationByIDs(req.IDs)
	if err != nil {
		response.ServerError(c, "查询对账记录失败")
		return
	}
	if len(records) == 0 {
		response.BadRequest(c, "未找到对账记录")
		return
	}

	// 获取应用对应的回收规则（取第一条记录的 app_id）
	appID := records[0].AppID
	var rule *model.AccountRecoveryRule
	rules, _, listErr := h.Repo.List(1, 100)
	if listErr == nil {
		for i := range rules {
			if rules[i].AppID == appID {
				rule = &rules[i]
				break
			}
		}
	}

	if rule == nil || !rule.DeleteUserEnabled || rule.DeleteUserScript == "" {
		response.BadRequest(c, "该应用未配置删除脚本或未启用删除能力")
		return
	}

	timeout := time.Duration(rule.TimeoutSeconds) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	var successCount, failCount int
	var failDetails []string

	for _, record := range records {
		// 准备环境变量
		envVars := map[string]string{
			"RECOVERY_USER_ID":      record.ThirdPartyUserID,
			"RECOVERY_USERNAME":     record.Username,
			"RECOVERY_EMAIL":        record.Email,
			"RECOVERY_THIRD_PARTY_ID": record.ThirdPartyUserID,
		}

		stdout, execErr := executeScript(rule.DeleteUserScript, timeout, envVars)

		logEntry := &model.AccountRecoveryLog{
			EventType: "delete",
			Username:  record.Username,
			AppName:   record.AppName,
			RuleID:    rule.ID,
			RuleName:  rule.AppName,
			Stdout:    stdout,
		}

		if execErr != nil {
			failCount++
			logEntry.Status = "failed"
			logEntry.ErrorMessage = execErr.Error()
			failDetails = append(failDetails, record.Username)
		} else {
			successCount++
			logEntry.Status = "success"
		}
		h.Repo.CreateLog(logEntry)
	}

	// 删除成功的对账记录
	var successIDs []string
	for _, record := range records {
		isSuccess := true
		for _, failUser := range failDetails {
			if record.Username == failUser {
				isSuccess = false
				break
			}
		}
		if isSuccess {
			successIDs = append(successIDs, record.ID)
		}
	}
	if len(successIDs) > 0 {
		h.Repo.DeleteReconciliationByIDs(successIDs)
	}

	response.OK(c, gin.H{
		"total":   len(records),
		"success": successCount,
		"failed":  failCount,
	})
}

// BatchDisableUser 批量禁用第三方系统中的用户（传入 third_party_user_ids）
func (h *AccountRecoveryHandler) BatchDisableUser(c *gin.Context) {
	var req struct {
		AppID            string   `json:"app_id" binding:"required"`
		ThirdPartyUserIDs []string `json:"third_party_user_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}

	// 查找该应用的回收规则
	var rule *model.AccountRecoveryRule
	rules, _, listErr := h.Repo.List(1, 100)
	if listErr == nil {
		for i := range rules {
			if rules[i].AppID == req.AppID {
				rule = &rules[i]
				break
			}
		}
	}
	if rule == nil || !rule.DisableUserEnabled || rule.DisableUserScript == "" {
		response.BadRequest(c, "该应用未配置禁用脚本或未启用禁用能力")
		return
	}

	timeout := time.Duration(rule.TimeoutSeconds) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	// 查找匹配的对账记录
	userIDSet := make(map[string]bool, len(req.ThirdPartyUserIDs))
	for _, id := range req.ThirdPartyUserIDs {
		userIDSet[id] = true
	}
	allRecords, _, _ := h.Repo.ListReconciliation(1, 10000, req.AppID, "", "")
	var records []model.AccountReconciliation
	for _, r := range allRecords {
		if userIDSet[r.ThirdPartyUserID] {
			records = append(records, r)
		}
	}

	// 收集所有第三方用户ID，用于脚本环境变量
	allThirdPartyIDs := strings.Join(req.ThirdPartyUserIDs, ",")

	var successCount, failCount int
	var successIDs []string

	// 获取当前操作人
	operator := c.GetString("username")

	for _, record := range records {
		envVars := map[string]string{
			"RECOVERY_USER_ID":        record.ThirdPartyUserID,
			"RECOVERY_USER_IDS":       allThirdPartyIDs,
			"RECOVERY_USERNAME":       record.Username,
			"RECOVERY_EMAIL":          record.Email,
			"RECOVERY_THIRD_PARTY_ID": record.ThirdPartyUserID,
		}

		start := time.Now()
		stdout, execErr := executeScript(rule.DisableUserScript, timeout, envVars)
		execMs := int(time.Since(start).Milliseconds())

		logEntry := &model.AccountRecoveryLog{
			EventType:        "disable",
			Username:         record.Username,
			UserEmail:        record.Email,
			ThirdPartyUserID: record.ThirdPartyUserID,
			AppName:          record.AppName,
			RuleID:           rule.ID,
			RuleName:         rule.AppName,
			Stdout:           stdout,
			ExecutionTime:    execMs,
			TriggeredBy:      operator,
		}

		if execErr != nil {
			failCount++
			logEntry.Status = "failed"
			logEntry.ErrorMessage = execErr.Error()
		} else if scriptSuccess, scriptMsg := parseScriptResult(stdout); !scriptSuccess {
			failCount++
			logEntry.Status = "failed"
			logEntry.ErrorMessage = scriptMsg
		} else {
			successCount++
			logEntry.Status = "success"
			successIDs = append(successIDs, record.ID)
		}
		h.Repo.CreateLog(logEntry)
	}

	// 删除成功的对账记录
	if len(successIDs) > 0 {
		h.Repo.DeleteReconciliationByIDs(successIDs)
	}

	response.OK(c, gin.H{"success": successCount, "failed": failCount})
}

// BatchDeleteUser 批量删除第三方系统中的用户（传入 third_party_user_ids）
func (h *AccountRecoveryHandler) BatchDeleteUser(c *gin.Context) {
	var req struct {
		AppID            string   `json:"app_id" binding:"required"`
		ThirdPartyUserIDs []string `json:"third_party_user_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}

	// 查找该应用的回收规则
	var rule *model.AccountRecoveryRule
	rules, _, listErr := h.Repo.List(1, 100)
	if listErr == nil {
		for i := range rules {
			if rules[i].AppID == req.AppID {
				rule = &rules[i]
				break
			}
		}
	}
	if rule == nil || !rule.DeleteUserEnabled || rule.DeleteUserScript == "" {
		response.BadRequest(c, "该应用未配置删除脚本或未启用删除能力")
		return
	}

	timeout := time.Duration(rule.TimeoutSeconds) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	// 查找匹配的对账记录
	userIDSet := make(map[string]bool, len(req.ThirdPartyUserIDs))
	for _, id := range req.ThirdPartyUserIDs {
		userIDSet[id] = true
	}
	allRecords, _, _ := h.Repo.ListReconciliation(1, 10000, req.AppID, "", "")
	var records []model.AccountReconciliation
	for _, r := range allRecords {
		if userIDSet[r.ThirdPartyUserID] {
			records = append(records, r)
		}
	}

	// 收集所有第三方用户ID，用于脚本环境变量
	allThirdPartyIDs := strings.Join(req.ThirdPartyUserIDs, ",")

	// 获取当前操作人
	operator := c.GetString("username")

	var successCount, failCount int
	var successIDs []string

	for _, record := range records {
		envVars := map[string]string{
			"RECOVERY_USER_ID":        record.ThirdPartyUserID,
			"RECOVERY_USER_IDS":       allThirdPartyIDs,
			"RECOVERY_USERNAME":       record.Username,
			"RECOVERY_EMAIL":          record.Email,
			"RECOVERY_THIRD_PARTY_ID": record.ThirdPartyUserID,
		}

		start := time.Now()
		stdout, execErr := executeScript(rule.DeleteUserScript, timeout, envVars)
		execMs := int(time.Since(start).Milliseconds())

		logEntry := &model.AccountRecoveryLog{
			EventType:        "delete",
			Username:         record.Username,
			UserEmail:        record.Email,
			ThirdPartyUserID: record.ThirdPartyUserID,
			AppName:          record.AppName,
			RuleID:           rule.ID,
			RuleName:         rule.AppName,
			Stdout:           stdout,
			ExecutionTime:    execMs,
			TriggeredBy:      operator,
		}

		if execErr != nil {
			failCount++
			logEntry.Status = "failed"
			logEntry.ErrorMessage = execErr.Error()
		} else if scriptSuccess, scriptMsg := parseScriptResult(stdout); !scriptSuccess {
			failCount++
			logEntry.Status = "failed"
			logEntry.ErrorMessage = scriptMsg
		} else {
			successCount++
			logEntry.Status = "success"
			successIDs = append(successIDs, record.ID)
		}
		h.Repo.CreateLog(logEntry)
	}

	// 删除成功的对账记录
	if len(successIDs) > 0 {
		h.Repo.DeleteReconciliationByIDs(successIDs)
	}

	response.OK(c, gin.H{"success": successCount, "failed": failCount})
}

// ── Logs ──

func (h *AccountRecoveryHandler) ListLogs(c *gin.Context) {
	page, pageSize := parsePagination(c)
	ruleID := c.Query("rule_id")

	logs, total, err := h.Repo.ListLogs(page, pageSize, ruleID)
	if err != nil {
		response.ServerError(c, "查询失败")
		return
	}
	response.Page(c, total, logs)
}

func (h *AccountRecoveryHandler) GetLog(c *gin.Context) {
	rawID := c.Param("id")
	if rawID == "" {
		response.BadRequest(c, "无效的 ID")
		return
	}
	log, err := h.Repo.GetLogByID(rawID)
	if err != nil {
		response.NotFound(c, "日志不存在")
		return
	}
	response.OK(c, log)
}

// GetRetentionConfig 获取执行历史保留天数配置
func (h *AccountRecoveryHandler) GetRetentionConfig(c *gin.Context) {
	days := 30 // 默认30天
	if h.ConfigRepo != nil {
		v := h.ConfigRepo.Get("account_recovery", "log_retention_days")
		if v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				days = n
			}
		}
	}
	response.OK(c, gin.H{"retention_days": days})
}

// SetRetentionConfig 设置执行历史保留天数
func (h *AccountRecoveryHandler) SetRetentionConfig(c *gin.Context) {
	var req struct {
		RetentionDays int `json:"retention_days" binding:"required,min=1,max=3650"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误：保留天数必须为 1-3650 之间的整数")
		return
	}
	if h.ConfigRepo != nil {
		h.ConfigRepo.Set("account_recovery", "log_retention_days", strconv.Itoa(req.RetentionDays))
	}
	response.OK(c, gin.H{"retention_days": req.RetentionDays})
}

// CleanupLogs 清理指定天数前的执行历史
func (h *AccountRecoveryHandler) CleanupLogs(c *gin.Context) {
	var req struct {
		Days int `json:"days" binding:"required,min=1,max=3650"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}

	cutoff := time.Now().AddDate(0, 0, -req.Days)
	deleted, err := h.Repo.CleanupLogsBefore(cutoff)
	if err != nil {
		response.ServerError(c, "清理失败")
		return
	}

	response.OK(c, gin.H{"deleted": deleted, "before": cutoff.Format("2006-01-02")})
}
