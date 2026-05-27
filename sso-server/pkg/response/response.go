package response

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Response struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

type PageData struct {
	Total int64       `json:"total"`
	Items interface{} `json:"items"`
}

func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{Code: 0, Message: "ok", Data: data})
}

func Page(c *gin.Context, total int64, items interface{}) {
	c.JSON(http.StatusOK, Response{Code: 0, Message: "ok", Data: PageData{Total: total, Items: items}})
}

func Err(c *gin.Context, status int, code int, msg string) {
	c.AbortWithStatusJSON(status, Response{Code: code, Message: msg})
}

func BadRequest(c *gin.Context, msg string) {
	Err(c, http.StatusBadRequest, 4000, msg)
}

func Unauthorized(c *gin.Context, msg string) {
	Err(c, http.StatusUnauthorized, 4001, msg)
}

func Forbidden(c *gin.Context, msg string) {
	Err(c, http.StatusForbidden, 4003, msg)
}

func NotFound(c *gin.Context, msg string) {
	Err(c, http.StatusNotFound, 4004, msg)
}

func ServerError(c *gin.Context, msg string) {
	Err(c, http.StatusInternalServerError, 5000, msg)
}
