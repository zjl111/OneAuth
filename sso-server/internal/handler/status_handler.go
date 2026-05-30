package handler

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/pkg/response"
)

type StatusHandler struct {
	MonitorRepo   *repository.MonitorRepository
	ClientService *service.ClientService

	cacheMu  sync.RWMutex
	cacheAt  time.Time
	cacheVal gin.H
}

const overviewCacheTTL = 25 * time.Second

type appOverview struct {
	ID                  string             `json:"id"`
	ClientID            string             `json:"client_id"`
	Name                string             `json:"name"`
	Description         string             `json:"description"`
	LogoURL             string             `json:"logo_url"`
	Status              string             `json:"status"`
	AvailabilityCurrent float64            `json:"availability_current"`
	ResponseTimeMs      int                `json:"response_time_ms"`
	LastProbedAt        *time.Time         `json:"last_probed_at"`
	Windows             map[string]float64 `json:"windows"`
	AvgResponse         map[string]int     `json:"avg_response"`
	Timeline            []timelineItem     `json:"timeline,omitempty"`
}

type timelineItem struct {
	Date          string  `json:"date"`
	Status        string  `json:"status"`
	Availability  float64 `json:"availability"`
	AvgResponseMs int     `json:"avg_response_ms"`
	MaxResponseMs int     `json:"max_response_ms"`
	TotalProbes   int     `json:"total_probes"`
	SuccessProbes int     `json:"success_probes"`
}

// Overview /api/status/overview — 状态页轮询周期 30s，缓存 25s 与之对齐
func (h *StatusHandler) Overview(c *gin.Context) {
	c.Header("Cache-Control", "public, max-age=30")
	h.cacheMu.RLock()
	if time.Since(h.cacheAt) < overviewCacheTTL && h.cacheVal != nil {
		val := h.cacheVal
		h.cacheMu.RUnlock()
		response.OK(c, val)
		return
	}
	h.cacheMu.RUnlock()

	val := h.computeOverview()

	h.cacheMu.Lock()
	h.cacheVal = val
	h.cacheAt = time.Now()
	h.cacheMu.Unlock()

	response.OK(c, val)
}

func (h *StatusHandler) computeOverview() gin.H {
	clients, _ := h.ClientService.ListAll()
	monitors, _ := h.MonitorRepo.ListAll()
	monMap := make(map[string]*model.AppMonitor, len(monitors))
	for i := range monitors {
		monMap[monitors[i].ClientID] = &monitors[i]
	}

	// 一次性批量查询所有客户端的窗口聚合（4 次查询，总计 4 个 SQL，与客户端数无关）
	windows := map[string]int{"24h": 24, "7d": 168, "30d": 720, "90d": 2160}
	winBatch := make(map[string]map[string]repository.WindowAgg, len(windows))
	for k, hours := range windows {
		winBatch[k] = h.MonitorRepo.WindowMetricsBatch(hours)
	}

	// 一次性拉取所有客户端的 90 天每日聚合
	daily := h.MonitorRepo.DailyRecordsBatch(90)

	apps := make([]appOverview, 0, len(clients))
	overallOK := true
	for _, cl := range clients {
		mon := monMap[cl.ClientID]
		ov := appOverview{
			ID:          cl.ID.String(),
			ClientID:    cl.ClientID,
			Name:        cl.ClientName,
			Description: cl.Description,
			LogoURL:     cl.LogoURL,
			Status:      model.StatusNoData,
			Windows:     make(map[string]float64, 4),
			AvgResponse: make(map[string]int, 4),
		}
		if mon != nil {
			ov.Status = mon.CurrentStatus
			ov.ResponseTimeMs = mon.LastResponseMs
			ov.LastProbedAt = mon.LastProbedAt
			if mon.Maintenance {
				ov.Status = model.StatusMaintenance
			}
			if mon.CurrentStatus == model.StatusDown {
				overallOK = false
			}
		}
		for k := range windows {
			agg, ok := winBatch[k][cl.ClientID]
			if !ok || agg.Total == 0 {
				ov.Windows[k] = 100
				ov.AvgResponse[k] = 0
				continue
			}
			ov.Windows[k] = round2(float64(agg.Up) / float64(agg.Total) * 100)
			ov.AvgResponse[k] = int(agg.Avg)
		}
		ov.AvailabilityCurrent = ov.Windows["24h"]
		ov.Timeline = timelineFromDaily(daily[cl.ClientID], 90)
		apps = append(apps, ov)
	}

	overall := "operational"
	if !overallOK {
		overall = model.StatusDegraded
	}

	// 综合可用性 & 平均响应（24h 窗口）
	var availSum, availCount float64
	var respSum, respCount int
	for _, a := range apps {
		if v, ok := a.Windows["24h"]; ok {
			availSum += v
			availCount++
		}
		if v, ok := a.AvgResponse["24h"]; ok && v > 0 {
			respSum += v
			respCount++
		}
	}
	availability := 100.0
	if availCount > 0 {
		availability = round2(availSum / availCount)
	}
	avgResponse := 0
	if respCount > 0 {
		avgResponse = respSum / respCount
	}

	return gin.H{
		"overall_status":           overall,
		"last_updated":             time.Now(),
		"refresh_interval_seconds": 30,
		"availability_24h_percent": availability,
		"avg_response_ms":          avgResponse,
		"apps":                     apps,
	}
}

// Timeline /api/status/apps/:client_id/timeline
func (h *StatusHandler) Timeline(c *gin.Context) {
	clientID := c.Param("client_id")
	days := parseInt(c.Query("days"), 90)
	response.OK(c, h.buildTimeline(clientID, days))
}

// Windows /api/status/apps/:client_id/windows
func (h *StatusHandler) Windows(c *gin.Context) {
	clientID := c.Param("client_id")
	out := map[string]map[string]interface{}{}
	for k, hours := range map[string]int{"24h": 24, "7d": 168, "30d": 720, "90d": 2160} {
		avail, avg := h.MonitorRepo.WindowMetrics(clientID, hours)
		out[k] = map[string]interface{}{"availability": round2(avail), "avg_response_ms": avg}
	}
	response.OK(c, out)
}

func (h *StatusHandler) buildTimeline(clientID string, days int) []timelineItem {
	return timelineFromDaily(nil, days, h.MonitorRepo.DailyRecords(clientID, days)...)
}

// timelineFromDaily 将一段已按日期升序的 StatusDaily 转换成补齐 days 天的时间线。
// 兼容两种调用：(rows, days) 或 (nil, days, rows...) — 前者用于已确定天数的预切片输入，后者方便单点查询。
func timelineFromDaily(rows []model.StatusDaily, days int, extras ...model.StatusDaily) []timelineItem {
	if rows == nil {
		rows = extras
	}
	end := time.Now().Truncate(24 * time.Hour)
	start := end.AddDate(0, 0, -days+1)
	byDate := make(map[string]model.StatusDaily, len(rows))
	for _, r := range rows {
		byDate[r.Date.Format("2006-01-02")] = r
	}
	items := make([]timelineItem, 0, days)
	for i := 0; i < days; i++ {
		d := start.AddDate(0, 0, i)
		key := d.Format("2006-01-02")
		r, ok := byDate[key]
		if !ok {
			items = append(items, timelineItem{Date: key, Status: model.StatusNoData, Availability: 0})
			continue
		}
		avail := 100.0
		if r.TotalProbes > 0 {
			avail = float64(r.SuccessProbes) / float64(r.TotalProbes) * 100
		}
		items = append(items, timelineItem{
			Date:          key,
			Status:        r.WorstStatus,
			Availability:  round2(avail),
			AvgResponseMs: r.AvgResponseMs,
			MaxResponseMs: r.MaxResponseMs,
			TotalProbes:   r.TotalProbes,
			SuccessProbes: r.SuccessProbes,
		})
	}
	return items
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
