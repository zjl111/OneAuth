package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/response"
)

type LoginRuleHandler struct {
	Repo *repository.LoginRuleRepository
}

type loginRuleInput struct {
	Name      string   `json:"name" binding:"required"`
	Priority  int      `json:"priority"`
	Enabled   bool     `json:"enabled"`
	UserScope string   `json:"user_scope"`
	UserIDs   []string `json:"user_ids"`
	IPs       []string `json:"ips"`
	TimeMask  string   `json:"time_mask"`
	Action    string   `json:"action"`
}

func (in *loginRuleInput) sanitize() {
	if in.Priority <= 0 {
		in.Priority = 50
	}
	if in.UserScope != "specific" {
		in.UserScope = "all"
		in.UserIDs = nil
	}
	if in.Action != "accept" && in.Action != "deny" {
		in.Action = "deny"
	}
	// time_mask 必须 168 字符的 0/1，否则视为空（全时段）
	if len(in.TimeMask) != 168 {
		in.TimeMask = ""
	}
}

func (in *loginRuleInput) toModel(rule *model.LoginRule) {
	rule.Name = in.Name
	rule.Priority = in.Priority
	rule.Enabled = in.Enabled
	rule.UserScope = in.UserScope
	rule.UserIDs = model.StringSlice(in.UserIDs)
	rule.IPs = model.StringSlice(in.IPs)
	rule.TimeMask = in.TimeMask
	rule.Action = in.Action
}

func (h *LoginRuleHandler) List(c *gin.Context) {
	items, err := h.Repo.List()
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, items)
}

func (h *LoginRuleHandler) Create(c *gin.Context) {
	var in loginRuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	in.sanitize()
	rule := &model.LoginRule{}
	in.toModel(rule)
	if err := h.Repo.Create(rule); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, rule)
}

func (h *LoginRuleHandler) Update(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	rule, err := h.Repo.Get(id)
	if err != nil {
		response.NotFound(c, "规则不存在")
		return
	}
	var in loginRuleInput
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	in.sanitize()
	in.toModel(rule)
	if err := h.Repo.Update(rule); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, rule)
}

func (h *LoginRuleHandler) Delete(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	if err := h.Repo.Delete(id); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, nil)
}

// BatchDelete 批量删除登录规则
func (h *LoginRuleHandler) BatchDelete(c *gin.Context) {
	var req struct {
		IDs []string `json:"ids" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "参数错误")
		return
	}
	deleted := 0
	failed := []string{}
	for _, raw := range req.IDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			failed = append(failed, raw)
			continue
		}
		if err := h.Repo.Delete(id); err != nil {
			failed = append(failed, raw)
			continue
		}
		deleted++
	}
	response.OK(c, gin.H{"deleted": deleted, "failed": failed})
}

func (h *LoginRuleHandler) Toggle(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	rule, err := h.Repo.Get(id)
	if err != nil {
		response.NotFound(c, "规则不存在")
		return
	}
	if err := h.Repo.SetEnabled(id, !rule.Enabled); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, gin.H{"enabled": !rule.Enabled})
}
