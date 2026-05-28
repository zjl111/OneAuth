package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/response"
)

// AppPermHandler 应用授权管理：哪些用户/角色/用户组能访问应用
type AppPermHandler struct {
	GrantRepo  *repository.AppGrantRepository
	ClientRepo *repository.ClientRepository
}

// ListApps 应用授权概览：每个应用 + 已授权的 principal 数
func (h *AppPermHandler) ListApps(c *gin.Context) {
	clients, err := h.ClientRepo.ListAll()
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}

	// 一次性查所有 grant 按 client 分组
	type aggRow struct {
		ClientID string
		Total    int64
		Users    int64
		Roles    int64
		Groups   int64
	}
	var rows []aggRow
	h.GrantRepo.DB().Raw(`
		SELECT client_id,
			COUNT(*) AS total,
			SUM(CASE WHEN principal_type = 'user'  THEN 1 ELSE 0 END) AS users,
			SUM(CASE WHEN principal_type = 'role'  THEN 1 ELSE 0 END) AS roles,
			SUM(CASE WHEN principal_type = 'group' THEN 1 ELSE 0 END) AS groups
		FROM sso_app_grant
		GROUP BY client_id
	`).Scan(&rows)
	cntMap := make(map[string]aggRow, len(rows))
	for _, r := range rows {
		cntMap[r.ClientID] = r
	}

	out := make([]gin.H, 0, len(clients))
	for _, cl := range clients {
		agg := cntMap[cl.ClientID]
		out = append(out, gin.H{
			"id":          cl.ID.String(),
			"client_id":   cl.ClientID,
			"client_name": cl.ClientName,
			"logo_url":    cl.LogoURL,
			"is_builtin":  cl.IsBuiltin,
			"is_active":   cl.IsActive,
			"granted":     agg.Total > 0,
			"grant_total": agg.Total,
			"grant_users": agg.Users,
			"grant_roles": agg.Roles,
			"grant_groups": agg.Groups,
		})
	}
	response.OK(c, out)
}

// ListGrants 某应用的授权明细 + 关联实体名称
func (h *AppPermHandler) ListGrants(c *gin.Context) {
	clientID := c.Param("client_id")
	if clientID == "" {
		response.BadRequest(c, "client_id 不能为空")
		return
	}
	grants, err := h.GrantRepo.ListByClient(clientID)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}

	// 批量补充名字，避免前端 N 次查询
	type idName struct {
		ID   uuid.UUID
		Name string
	}
	collect := func(typ string) map[uuid.UUID]string {
		ids := []uuid.UUID{}
		for _, g := range grants {
			if g.PrincipalType == typ {
				ids = append(ids, g.PrincipalID)
			}
		}
		out := make(map[uuid.UUID]string, len(ids))
		if len(ids) == 0 {
			return out
		}
		var rows []idName
		switch typ {
		case "user":
			h.GrantRepo.DB().Table("sso_user").
				Select("id, COALESCE(NULLIF(nickname,''), username) AS name").
				Where("id IN ?", ids).Scan(&rows)
		case "role":
			h.GrantRepo.DB().Table("sso_role").
				Select("id, name").Where("id IN ?", ids).Scan(&rows)
		case "group":
			h.GrantRepo.DB().Table("sso_user_group").
				Select("id, name").Where("id IN ?", ids).Scan(&rows)
		}
		for _, r := range rows {
			out[r.ID] = r.Name
		}
		return out
	}
	userMap := collect("user")
	roleMap := collect("role")
	groupMap := collect("group")

	out := make([]gin.H, 0, len(grants))
	for _, g := range grants {
		var name string
		switch g.PrincipalType {
		case "user":
			name = userMap[g.PrincipalID]
		case "role":
			name = roleMap[g.PrincipalID]
		case "group":
			name = groupMap[g.PrincipalID]
		}
		if name == "" {
			name = g.PrincipalID.String()
		}
		out = append(out, gin.H{
			"id":             g.ID.String(),
			"client_id":      g.ClientID,
			"principal_type": g.PrincipalType,
			"principal_id":   g.PrincipalID.String(),
			"principal_name": name,
			"created_at":     g.CreatedAt,
		})
	}
	response.OK(c, out)
}

// SetGrants 全量替换某应用的授权
func (h *AppPermHandler) SetGrants(c *gin.Context) {
	clientID := c.Param("client_id")
	if clientID == "" {
		response.BadRequest(c, "client_id 不能为空")
		return
	}
	var req struct {
		Grants []struct {
			PrincipalType string `json:"principal_type" binding:"required"`
			PrincipalID   string `json:"principal_id" binding:"required"`
		} `json:"grants"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	grants := make([]model.AppGrant, 0, len(req.Grants))
	for _, g := range req.Grants {
		pid, err := uuid.Parse(g.PrincipalID)
		if err != nil {
			response.BadRequest(c, "principal_id 不是合法 UUID")
			return
		}
		if g.PrincipalType != "user" && g.PrincipalType != "role" && g.PrincipalType != "group" {
			response.BadRequest(c, "principal_type 必须是 user/role/group")
			return
		}
		grants = append(grants, model.AppGrant{
			PrincipalType: g.PrincipalType,
			PrincipalID:   pid,
		})
	}
	if err := h.GrantRepo.SetGrants(clientID, grants); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, gin.H{"count": len(grants)})
}
