package monitor

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"sso-server/internal/model"
	"sso-server/internal/repository"
)

type Scheduler struct {
	repo     *repository.MonitorRepository
	client   *http.Client
	interval time.Duration
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

func New(repo *repository.MonitorRepository, intervalSeconds int) *Scheduler {
	if intervalSeconds <= 0 {
		intervalSeconds = 30
	}
	return &Scheduler{
		repo: repo,
		client: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        50,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		interval: time.Duration(intervalSeconds) * time.Second,
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		// 启动后立即跑一次
		s.runOnce(ctx)
		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runOnce(ctx)
			}
		}
	}()
	// 每小时清理一次旧探测数据
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				_ = s.repo.PruneProbes(30 * 24 * time.Hour)
			}
		}
	}()
}

func (s *Scheduler) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	s.wg.Wait()
}

func (s *Scheduler) runOnce(ctx context.Context) {
	monitors, err := s.repo.ListEnabled()
	if err != nil {
		log.Printf("[monitor] list enabled: %v", err)
		return
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, 16)
	for _, m := range monitors {
		if m.HealthCheckURL == "" {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(m model.AppMonitor) {
			defer wg.Done()
			defer func() { <-sem }()
			s.ProbeOne(ctx, &m)
		}(m)
	}
	wg.Wait()
}

// ProbeOne 立即执行一次探测
func (s *Scheduler) ProbeOne(ctx context.Context, m *model.AppMonitor) {
	url := m.HealthCheckURL
	timeout := time.Duration(m.TimeoutMs) * time.Millisecond
	if timeout == 0 {
		timeout = 10 * time.Second
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		s.record(m, model.StatusDown, 0, 0, err.Error())
		return
	}
	req.Header.Set("User-Agent", "OneAuth-Monitor/1.0")

	start := time.Now()
	resp, err := s.client.Do(req)
	elapsed := int(time.Since(start) / time.Millisecond)

	if err != nil {
		s.record(m, model.StatusDown, elapsed, 0, err.Error())
		return
	}
	defer resp.Body.Close()

	status := model.StatusDown
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		status = model.StatusUp
		if m.DegradedMs > 0 && elapsed > m.DegradedMs {
			status = model.StatusDegraded
		}
	}
	s.record(m, status, elapsed, resp.StatusCode, "")
}

// ProbeByClientID 立即探测指定 client
func (s *Scheduler) ProbeByClientID(clientID string) {
	m, err := s.repo.Get(clientID)
	if err != nil {
		return
	}
	if m.HealthCheckURL == "" {
		return
	}
	s.ProbeOne(context.Background(), m)
}

func (s *Scheduler) record(m *model.AppMonitor, status string, elapsedMs, code int, errMsg string) {
	now := time.Now()
	if len(errMsg) > 500 {
		errMsg = errMsg[:500]
	}
	_ = s.repo.RecordProbe(&model.StatusProbe{
		ClientID:     m.ClientID,
		Status:       status,
		ResponseMs:   elapsedMs,
		HTTPCode:     code,
		ErrorMessage: errMsg,
		ProbedAt:     now,
	})
	_ = s.repo.UpsertDaily(m.ClientID, now, status, elapsedMs)

	prev := m.CurrentStatus
	_ = s.repo.UpdateStatus(m.ClientID, status, elapsedMs)

	if status == model.StatusDown && prev != model.StatusDown {
		_ = s.repo.OpenIncident(m.ClientID, errMsg)
	}
	if status == model.StatusUp && prev == model.StatusDown {
		_ = s.repo.CloseIncident(m.ClientID)
	}
}
