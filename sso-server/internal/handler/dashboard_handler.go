package handler

import (
	"log"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"sso-server/internal/repository"
	"sso-server/internal/session"
	"sso-server/pkg/response"
)

// ActiveWindow 活跃用户判定窗口：近 24 小时内有成功登录或应用访问的用户视为活跃。
const ActiveWindow = 24 * time.Hour

type DashboardHandler struct {
	UserRepo    *repository.UserRepository
	ClientRepo  *repository.ClientRepository
	LogRepo     *repository.LogRepository
	MonitorRepo *repository.MonitorRepository
	SessionMgr  *session.Manager
}

func (h *DashboardHandler) Stats(c *gin.Context) {
	var (
		wg                                                                    sync.WaitGroup
		userCount, loginCount, appCount, downCount, totalMonitor, activeUsers int64
	)
	// safeGoroutine 给子 goroutine 加 panic 兜底：单点查询 panic 只影响本次统计、
	// 返回降级值，绝不拖垮整个进程——否则 gin Recovery 抓不住子 goroutine，
	// 一旦 panic 会直接 crash 服务，网关对同时刻的并发请求统一报 502。
	safeGoroutine := func(f func()) {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[dashboard] stats goroutine recovered: %v", r)
			}
		}()
		f()
	}
	wg.Add(6)
	go func() { defer wg.Done(); safeGoroutine(func() { userCount, _ = h.UserRepo.CountActive() }) }()
	go func() { defer wg.Done(); safeGoroutine(func() { loginCount, _ = h.LogRepo.CountLoginsToday() }) }()
	go func() { defer wg.Done(); safeGoroutine(func() { appCount, _ = h.ClientRepo.Count() }) }()
	go func() { defer wg.Done(); safeGoroutine(func() { downCount, _ = h.MonitorRepo.CountDown() }) }()
	go func() {
		defer wg.Done()
		safeGoroutine(func() {
			all, _ := h.MonitorRepo.ListAll()
			totalMonitor = int64(len(all))
		})
	}()
	go func() {
		defer wg.Done()
		safeGoroutine(func() { activeUsers, _ = h.LogRepo.CountActiveUsersWithin(ActiveWindow) })
	}()
	wg.Wait()

	uptime := 100.0
	if totalMonitor > 0 {
		uptime = float64(totalMonitor-downCount) / float64(totalMonitor) * 100
	}

	response.OK(c, gin.H{
		"user_count":           userCount,
		"login_today":          loginCount,
		"app_count":            appCount,
		"abnormal_count":       downCount,
		"uptime_percent":       uptime,
		"monitor_total":        totalMonitor,
		"active_users":         activeUsers,
		"active_window_minutes": int(ActiveWindow / time.Minute),
	})
}

func (h *DashboardHandler) LoginTrends(c *gin.Context) {
	days := parseInt(c.Query("days"), 30)
	data, _ := h.LogRepo.LoginTrend(days)
	response.OK(c, data)
}

func (h *DashboardHandler) AppDistribution(c *gin.Context) {
	days := parseInt(c.Query("days"), 30)
	data, _ := h.LogRepo.AppAccessDistribution(days)
	response.OK(c, data)
}

// RecentOperations 仪表盘"最近操作日志"
func (h *DashboardHandler) RecentOperations(c *gin.Context) {
	limit := parseInt(c.Query("limit"), 5)
	items, _, _ := h.LogRepo.ListOperationLogs(repository.LogQuery{Page: 1, PageSize: limit})
	response.OK(c, items)
}

// LoginMethods 登录方式分布（按次数倒序）
func (h *DashboardHandler) LoginMethods(c *gin.Context) {
	days := parseInt(c.Query("days"), 30)
	data, _ := h.LogRepo.LoginMethodDistribution(days)
	response.OK(c, data)
}

// RegionTop10 仪表盘"30 日 TOP10 访问统计"
func (h *DashboardHandler) RegionTop10(c *gin.Context) {
	days := parseInt(c.Query("days"), 30)
	data, _ := h.LogRepo.RegionTop10(days)
	response.OK(c, data)
}

// HourlyTrends 仪表盘"流量趋势"，支持 range=day(24h按小时)|week(7天按天)|month(30天按天)
func (h *DashboardHandler) HourlyTrends(c *gin.Context) {
	rangeParam := c.DefaultQuery("range", "day")
	data, _ := h.LogRepo.TrafficTrendByRange(rangeParam)
	response.OK(c, data)
}

// SecurityAlerts 仪表盘"实时安全风险预警"
func (h *DashboardHandler) SecurityAlerts(c *gin.Context) {
	data, _ := h.LogRepo.RecentSecurityAlerts()
	response.OK(c, data)
}

// TopLoginUsers 仪表盘"Top 登录用户"
func (h *DashboardHandler) TopLoginUsers(c *gin.Context) {
	days := parseInt(c.Query("days"), 30)
	limit := parseInt(c.Query("limit"), 5)
	data, _ := h.LogRepo.TopLoginUsers(days, limit)
	response.OK(c, data)
}
