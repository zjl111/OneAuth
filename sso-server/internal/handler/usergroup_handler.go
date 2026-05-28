package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/response"
)

type UserGroupHandler struct {
	Repo *repository.UserGroupRepository
}

func (h *UserGroupHandler) List(c *gin.Context) {
	items, err := h.Repo.ListWithCount()
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, items)
}

func (h *UserGroupHandler) Create(c *gin.Context) {
	var in struct {
		Name        string `json:"name" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	g := &model.UserGroup{Name: in.Name, Description: in.Description}
	if err := h.Repo.Create(g); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, g)
}

func (h *UserGroupHandler) Update(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var in struct {
		Name        string `json:"name" binding:"required"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	g, err := h.Repo.Get(id)
	if err != nil {
		response.NotFound(c, "用户组不存在")
		return
	}
	g.Name = in.Name
	g.Description = in.Description
	if err := h.Repo.Update(g); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, g)
}

func (h *UserGroupHandler) Delete(c *gin.Context) {
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

func (h *UserGroupHandler) Members(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	users, err := h.Repo.ListMembers(id)
	if err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, users)
}

func (h *UserGroupHandler) SetMembers(c *gin.Context) {
	id, ok := parseIDParam(c, "id")
	if !ok {
		return
	}
	var in struct {
		UserIDs []uuid.UUID `json:"user_ids"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	if err := h.Repo.SetMembers(id, in.UserIDs); err != nil {
		response.ServerError(c, err.Error())
		return
	}
	response.OK(c, gin.H{"count": len(in.UserIDs)})
}
