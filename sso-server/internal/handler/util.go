package handler

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/pkg/response"
)

func parseInt(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return v
}

// parseIDParam 解析 :id 路径参数为 UUID。失败时已写入 400 响应并返回 false。
func parseIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	raw := c.Param(name)
	id, err := uuid.Parse(raw)
	if err != nil {
		response.BadRequest(c, "无效的 ID")
		return uuid.Nil, false
	}
	return id, true
}

func parsePagination(c *gin.Context) (page, size int) {
	return parseInt(c.Query("page"), 1), parseInt(c.Query("page_size"), 20)
}
