package handler

import (
	"github.com/gin-gonic/gin"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/response"
)

type MonitorHandler struct {
	Repo       *repository.MonitorRepository
	ClientRepo *repository.ClientRepository
	ProbeFunc  func(clientID string)
}

// Sync 把所有应用补齐到 sso_app_monitor 表里（缺则建，已存在则跳过）。
// 用于"应用中心数量 ≠ 状态监控数量"时的修复。
func (h *MonitorHandler) Sync(c *gin.Context) {
	if h.ClientRepo == nil {
		response.ServerError(c, "client repo 未注入")
		return
	}
	clients, err := h.ClientRepo.ListAll()
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	created := 0
	for _, cl := range clients {
		// 管理后台本身不需要纳入监控
		if cl.ClientID == AdminClientID {
			continue
		}
		// link 协议（外链应用）不参与健康监控
		if cl.Protocol == "link" {
			continue
		}
		if _, err := h.Repo.Get(cl.ClientID); err == nil {
			continue
		}
		_ = h.Repo.Upsert(&model.AppMonitor{
			ClientID:       cl.ClientID,
			Enabled:        cl.HealthCheckURL != "",
			HealthCheckURL: cl.HealthCheckURL,
			TimeoutMs:      10000,
			DegradedMs:     2000,
			CurrentStatus:  model.StatusNoData,
		})
		created++
	}
	response.OK(c, gin.H{"created": created, "total_apps": len(clients)})
}

func (h *MonitorHandler) List(c *gin.Context) {
	items, _ := h.Repo.ListAll()
	// 附加 client_name / logo_url，便于前端展示中文名
	nameMap := map[string]struct {
		Name    string `json:"client_name"`
		LogoURL string `json:"logo_url"`
		HomeURL string `json:"home_url"`
	}{}
	if h.ClientRepo != nil {
		if cs, err := h.ClientRepo.ListAll(); err == nil {
			for _, c2 := range cs {
				nameMap[c2.ClientID] = struct {
					Name    string `json:"client_name"`
					LogoURL string `json:"logo_url"`
					HomeURL string `json:"home_url"`
				}{Name: c2.ClientName, LogoURL: c2.LogoURL, HomeURL: c2.HomeURL}
			}
		}
	}
	out := make([]gin.H, 0, len(items))
	for _, m := range items {
		// 管理后台不在监控列表里露出
		if m.ClientID == AdminClientID {
			continue
		}
		row := gin.H{
			"id":               m.ID,
			"client_id":        m.ClientID,
			"enabled":          m.Enabled,
			"health_check_url": m.HealthCheckURL,
			"timeout_ms":       m.TimeoutMs,
			"degraded_ms":      m.DegradedMs,
			"maintenance":      m.Maintenance,
			"current_status":   m.CurrentStatus,
			"last_probed_at":   m.LastProbedAt,
			"last_response_ms": m.LastResponseMs,
			"created_at":       m.CreatedAt,
			"updated_at":       m.UpdatedAt,
		}
		if meta, ok := nameMap[m.ClientID]; ok {
			row["client_name"] = meta.Name
			row["logo_url"] = meta.LogoURL
			row["home_url"] = meta.HomeURL
		}
		out = append(out, row)
	}
	response.OK(c, out)
}

func (h *MonitorHandler) Get(c *gin.Context) {
	clientID := c.Param("client_id")
	m, err := h.Repo.Get(clientID)
	if err != nil {
		response.NotFound(c, "监控配置不存在")
		return
	}
	response.OK(c, m)
}

func (h *MonitorHandler) Update(c *gin.Context) {
	clientID := c.Param("client_id")
	m, err := h.Repo.Get(clientID)
	if err != nil {
		response.NotFound(c, "监控配置不存在")
		return
	}
	var in struct {
		Enabled        *bool   `json:"enabled"`
		HealthCheckURL *string `json:"health_check_url"`
		TimeoutMs      *int    `json:"timeout_ms"`
		DegradedMs     *int    `json:"degraded_ms"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if in.Enabled != nil {
		m.Enabled = *in.Enabled
	}
	if in.HealthCheckURL != nil {
		m.HealthCheckURL = *in.HealthCheckURL
	}
	if in.TimeoutMs != nil {
		m.TimeoutMs = *in.TimeoutMs
	}
	if in.DegradedMs != nil {
		m.DegradedMs = *in.DegradedMs
	}
	if err := h.Repo.Upsert(m); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, m)
}

func (h *MonitorHandler) Probe(c *gin.Context) {
	clientID := c.Param("client_id")
	if h.ProbeFunc != nil {
		go h.ProbeFunc(clientID)
	}
	response.OK(c, gin.H{"queued": true})
}

func (h *MonitorHandler) SetMaintenance(c *gin.Context) {
	clientID := c.Param("client_id")
	var req struct {
		On   bool   `json:"on"`
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.Repo.SetMaintenance(clientID, req.On, req.Note); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

func (h *MonitorHandler) Incidents(c *gin.Context) {
	clientID := c.Param("client_id")
	page := parseInt(c.Query("page"), 1)
	pageSize := parseInt(c.Query("page_size"), 20)
	items, total, _ := h.Repo.ListIncidents(clientID, page, pageSize)
	response.Page(c, total, items)
}

// Delete 删除指定 client 的监控配置和历史数据（不删除 OAuth Client 本身）
func (h *MonitorHandler) Delete(c *gin.Context) {
	clientID := c.Param("client_id")
	if err := h.Repo.DeleteByClientID(clientID); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

// BatchDelete 批量删除监控
func (h *MonitorHandler) BatchDelete(c *gin.Context) {
	var req struct {
		ClientIDs []string `json:"client_ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	for _, id := range req.ClientIDs {
		if err := h.Repo.DeleteByClientID(id); err != nil {
			response.ServerError(c, err.Error())
			return
		}
	}
	response.OK(c, gin.H{"deleted": len(req.ClientIDs)})
}

func (h *MonitorHandler) Global(c *gin.Context) {
	down, _ := h.Repo.CountDown()
	all, _ := h.Repo.ListAll()
	response.OK(c, gin.H{
		"total":    len(all),
		"abnormal": down,
	})
}
