package service

import (
	"context"
	"log"
	"sync"
	"time"
)

// DirectorySyncScheduler 目录同步定时调度器：每天凌晨 2:00 触发一次完整同步。
// 是否真正执行由配置中的「启用同步」(DirectorySyncConfig.Enabled) 决定——未启用则整点跳过。
// 完整同步逻辑与前端「同步用户」按钮完全一致（拉取远端 → 写入缓冲表 → 应用到用户）。
type DirectorySyncScheduler struct {
	svc    *DirectorySyncService
	cancel context.CancelFunc
	ctx    context.Context
	wg     sync.WaitGroup
}

// NewDirectorySyncScheduler 创建目录同步调度器。
func NewDirectorySyncScheduler(svc *DirectorySyncService) *DirectorySyncScheduler {
	return &DirectorySyncScheduler{svc: svc}
}

// Start 启动调度器，阻塞在独立 goroutine 中等待每天的 02:00 触发。
func (s *DirectorySyncScheduler) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	s.ctx = ctx
	s.cancel = cancel
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		s.sleepUntilNext2AM()
		if s.ctx.Err() != nil {
			return
		}
		s.tick()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				s.tick()
			}
		}
	}()
	log.Println("[dir-sync] 定时同步调度器已启动（每日 02:00，受「启用同步」开关控制）")
}

// Stop 停止调度器并等待 goroutine 退出。
func (s *DirectorySyncScheduler) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	s.wg.Wait()
}

// tick 执行一次定时同步（先判断是否启用）。
func (s *DirectorySyncScheduler) tick() {
	if s.svc == nil {
		return
	}
	cfg := s.svc.LoadConfig(false)
	if !cfg.Enabled {
		log.Printf("[dir-sync] 定时同步跳过：配置中「启用同步」为关闭")
		return
	}
	log.Printf("[dir-sync] 定时同步开始（每日 02:00）")
	if _, err := s.svc.SyncUsers(); err != nil {
		log.Printf("[dir-sync] 定时同步失败: %v", err)
		return
	}
	log.Printf("[dir-sync] 定时同步完成")
}

// sleepUntilNext2AM 阻塞直到下一个凌晨 2:00（按服务器本地时区），期间可被 ctx 取消。
func (s *DirectorySyncScheduler) sleepUntilNext2AM() {
	d := time.Until(next2AM())
	if d <= 0 {
		return
	}
	// 分片睡眠，便于在长时间等待中及时响应取消信号
	for d > 0 {
		select {
		case <-s.ctx.Done():
			return
		case <-time.After(minDuration(d, time.Minute)):
		}
		d = time.Until(next2AM())
	}
}

// next2AM 返回当前时区下一个凌晨 2:00 的时间点。
func next2AM() time.Time {
	now := time.Now()
	next := time.Date(now.Year(), now.Month(), now.Day(), 2, 0, 0, 0, now.Location())
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
