package handler

import (
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
	wg.Add(6)
	go func() { defer wg.Done(); userCount, _ = h.UserRepo.CountActive() }()
	go func() { defer wg.Done(); loginCount, _ = h.LogRepo.CountLoginsToday() }()
	go func() { defer wg.Done(); appCount, _ = h.ClientRepo.Count() }()
	go func() { defer wg.Done(); downCount, _ = h.MonitorRepo.CountDown() }()
	go func() {
		defer wg.Done()
		all, _ := h.MonitorRepo.ListAll()
		totalMonitor = int64(len(all))
	}()
	go func() {
		defer wg.Done()
		activeUsers, _ = h.LogRepo.CountActiveUsersWithin(ActiveWindow)
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
