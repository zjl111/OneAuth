package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"

	"sso-server/internal/model"
)

type AccountRecoveryRepository struct {
	db *gorm.DB
}

func NewAccountRecoveryRepository(db *gorm.DB) *AccountRecoveryRepository {
	return &AccountRecoveryRepository{db: db}
}

// ── Rules ──

func (r *AccountRecoveryRepository) List(page, pageSize int) ([]model.AccountRecoveryRule, int64, error) {
	var rules []model.AccountRecoveryRule
	var total int64

	q := r.db.Model(&model.AccountRecoveryRule{})
	q.Count(&total)

	err := q.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&rules).Error

	return rules, total, err
}

func (r *AccountRecoveryRepository) GetByID(idStr string) (*model.AccountRecoveryRule, error) {
	var rule model.AccountRecoveryRule
	err := r.db.Where("id = ?", idStr).First(&rule).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

func (r *AccountRecoveryRepository) Create(rule *model.AccountRecoveryRule) error {
	return r.db.Create(rule).Error
}

func (r *AccountRecoveryRepository) Update(rule *model.AccountRecoveryRule) error {
	return r.db.Save(rule).Error
}

func (r *AccountRecoveryRepository) Delete(idStr string) error {
	return r.db.Where("id = ?", idStr).Delete(&model.AccountRecoveryRule{}).Error
}

func (r *AccountRecoveryRepository) UpdateLastExecuted(idStr string) error {
	return r.db.Model(&model.AccountRecoveryRule{}).
		Where("id = ?", idStr).
		Update("last_executed_at", gorm.Expr("CURRENT_TIMESTAMP")).Error
}

// ── Reconciliation ──

func (r *AccountRecoveryRepository) ListReconciliation(page, pageSize int, appID, filter, search string) ([]model.AccountReconciliation, int64, error) {
	var items []model.AccountReconciliation
	var total int64

	q := r.db.Model(&model.AccountReconciliation{})
	if appID != "" {
		q = q.Where("app_id = ?", appID)
	}
	if filter != "" {
		switch {
		case strings.HasPrefix(filter, "sso_"):
			// SSO 本地状态筛选：sso_locked, sso_active, sso_deleted
			q = q.Where("sso_status = ?", strings.TrimPrefix(filter, "sso_"))
		case strings.HasPrefix(filter, "tp_"):
			// 第三方状态筛选：tp_disabled, tp_locked, tp_not_found, tp_deleted, tp_active
			q = q.Where("third_party_status = ?", strings.TrimPrefix(filter, "tp_"))
		default:
			// 对账结果筛选：orphan, consistent, missing
			q = q.Where("reconcile_result = ?", filter)
		}
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("username LIKE ? OR third_party_user_id LIKE ? OR display_name LIKE ? OR email LIKE ?", like, like, like, like)
	}
	q.Count(&total)

	err := q.Order("CASE reconcile_result WHEN 'orphan' THEN 0 WHEN 'missing' THEN 1 ELSE 2 END, last_synced_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&items).Error

	return items, total, err
}

func (r *AccountRecoveryRepository) ClearReconciliationByAppID(appID string) error {
	return r.db.Where("app_id = ?", appID).Delete(&model.AccountReconciliation{}).Error
}

func (r *AccountRecoveryRepository) BulkCreateReconciliation(items []model.AccountReconciliation) error {
	if len(items) == 0 {
		return nil
	}
	return r.db.CreateInBatches(items, 100).Error
}

func (r *AccountRecoveryRepository) GetReconciliationByIDs(ids []string) ([]model.AccountReconciliation, error) {
	var items []model.AccountReconciliation
	err := r.db.Where("id IN ?", ids).Find(&items).Error
	return items, err
}

func (r *AccountRecoveryRepository) DeleteReconciliationByIDs(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	return r.db.Where("id IN ?", ids).Delete(&model.AccountReconciliation{}).Error
}

func (r *AccountRecoveryRepository) ReconciliationStats(appID string) (map[string]int64, error) {
	type row struct {
		ReconcileResult string
		Cnt             int64
	}
	var rows []row
	q := r.db.Model(&model.AccountReconciliation{}).
		Select("reconcile_result, count(*) as cnt")
	if appID != "" {
		q = q.Where("app_id = ?", appID)
	}
	q.Group("reconcile_result").Scan(&rows)

	stats := map[string]int64{}
	for _, r := range rows {
		stats[r.ReconcileResult] = r.Cnt
	}
	return stats, nil
}

// ── Logs ──

func (r *AccountRecoveryRepository) ListLogs(page, pageSize int, ruleID string) ([]model.AccountRecoveryLog, int64, error) {
	var logs []model.AccountRecoveryLog
	var total int64

	q := r.db.Model(&model.AccountRecoveryLog{})
	if ruleID != "" {
		q = q.Where("rule_id = ?", ruleID)
	}
	q.Count(&total)

	err := q.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&logs).Error

	return logs, total, err
}

func (r *AccountRecoveryRepository) CreateLog(log *model.AccountRecoveryLog) error {
	return r.db.Create(log).Error
}

func (r *AccountRecoveryRepository) GetLogByID(idStr string) (*model.AccountRecoveryLog, error) {
	var log model.AccountRecoveryLog
	err := r.db.Where("id = ?", idStr).First(&log).Error
	if err != nil {
		return nil, err
	}
	return &log, nil
}

// CleanupLogsBefore 清理指定时间之前的执行日志，返回删除条数
func (r *AccountRecoveryRepository) CleanupLogsBefore(cutoff time.Time) (int64, error) {
	result := r.db.Where("created_at < ?", cutoff).Delete(&model.AccountRecoveryLog{})
	return result.RowsAffected, result.Error
}
