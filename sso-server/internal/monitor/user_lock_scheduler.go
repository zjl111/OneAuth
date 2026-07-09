package monitor

import (
	"context"
	"log"
	"sync"
	"time"

	"gorm.io/gorm"

	"sso-server/internal/model"
)

// UserLockScheduler 每天扫描一次，把超过 N 天未登录的用户自动锁定（admin 除外）。
type UserLockScheduler struct {
	db            *gorm.DB
	mu            sync.RWMutex
	inactiveDays  int // 默认 30
	excludeUsers  map[string]bool
	cancel        context.CancelFunc
	wg            sync.WaitGroup
}

// NewUserLockScheduler 创建用户自动锁定调度器。
func NewUserLockScheduler(db *gorm.DB, inactiveDays int) *UserLockScheduler {
	if inactiveDays <= 0 {
		inactiveDays = 30
	}
	return &UserLockScheduler{
		db:           db,
		inactiveDays: inactiveDays,
		excludeUsers: map[string]bool{"admin": true},
	}
}

// SetInactiveDays 热更新不活跃天数阈值
func (s *UserLockScheduler) SetInactiveDays(days int) {
	if days <= 0 {
		return
	}
	s.mu.Lock()
	s.inactiveDays = days
	s.mu.Unlock()
	log.Printf("[user-lock] inactive threshold updated to %d days", days)
}

// InactiveDays 当前阈值
func (s *UserLockScheduler) InactiveDays() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.inactiveDays
}

func (s *UserLockScheduler) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		// 启动后立即跑一次
		s.runOnce()
		// 之后每 6 小时扫一次
		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runOnce()
			}
		}
	}()
	log.Printf("[user-lock] scheduler started (threshold=%d days)", s.inactiveDays)
}

func (s *UserLockScheduler) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	s.wg.Wait()
}

func (s *UserLockScheduler) runOnce() {
	days := s.InactiveDays()
	cutoff := time.Now().AddDate(0, 0, -days)

	var users []model.User
	// 查找所有已锁定=false、活跃=true、last_login 早于 cutoff 的用户
	// last_login 为 NULL 的也视为需要锁定（从未登录过且创建时间超过阈值）
	if err := s.db.Where(
		"is_locked = ? AND is_active = ? AND (last_login < ? OR (last_login IS NULL AND created_at < ?))",
		false, true, cutoff, cutoff,
	).Find(&users).Error; err != nil {
		log.Printf("[user-lock] query failed: %v", err)
		return
	}

	locked := 0
	for _, u := range users {
		if s.excludeUsers[u.Username] {
			continue
		}
		u.IsLocked = true
		u.LockReason = "inactivity"
		if err := s.db.Save(&u).Error; err != nil {
			log.Printf("[user-lock] failed to lock user %s: %v", u.Username, err)
			continue
		}
		locked++
	}
	if locked > 0 {
		log.Printf("[user-lock] auto-locked %d users (inactive > %d days)", locked, days)
	}
}
