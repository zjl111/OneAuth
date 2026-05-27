package middleware

import (
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/repository"
)

// Audit 写操作审计中间件：对所有非 GET 请求记录 operation_log。
// 必须挂在 JWTAuth 之后，能从 ctx 拿到 user_id / username。
func Audit(logRepo *repository.LogRepository) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		method := c.Request.Method
		if method == "GET" || method == "OPTIONS" || method == "HEAD" {
			return
		}
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		// 不记录健康检查 / 探针
		if strings.HasPrefix(path, "/api/v1/health") {
			return
		}

		resourceType, resourceID, action := describe(method, path, c)
		if resourceType == "" {
			return
		}

		var uid *uuid.UUID
		if v, ok := c.Get("user_id"); ok {
			if s, ok := v.(string); ok {
				if id, err := uuid.Parse(s); err == nil {
					uid = &id
				}
			}
		}
		username, _ := c.Get("username")
		uname, _ := username.(string)

		logRepo.RecordOperation(
			uid,
			uname,
			action,
			resourceType,
			resourceID,
			describeAction(method, resourceType, resourceID, path),
			c.ClientIP(),
			c.Writer.Status(),
		)
	}
}

// 把 /api/v1/users/:id/roles 这种路径切成 (resourceType, resourceID, action)
// 规则：去掉前缀 /api/v1，第一个段是资源类型，紧跟的 UUID 是 ID，其余拼成 action。
var uuidRe = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)

func describe(method, fullPath string, c *gin.Context) (resourceType, resourceID, action string) {
	p := strings.TrimPrefix(fullPath, "/api/v1/")
	p = strings.TrimPrefix(p, "/")
	segs := strings.Split(p, "/")
	if len(segs) == 0 {
		return "", "", ""
	}
	resourceType = segs[0]
	verbs := []string{}
	for i := 1; i < len(segs); i++ {
		s := segs[i]
		// 路径中的 :id 占位符 → 取实际值
		if strings.HasPrefix(s, ":") {
			actual := c.Param(strings.TrimPrefix(s, ":"))
			if uuidRe.MatchString(actual) {
				resourceID = actual
			} else if actual != "" && resourceID == "" {
				resourceID = actual
			}
			continue
		}
		verbs = append(verbs, s)
	}
	suffix := strings.Join(verbs, ".")
	switch {
	case suffix != "":
		action = strings.ToLower(method) + "." + suffix
	case method == "POST":
		action = "create"
	case method == "PUT", method == "PATCH":
		action = "update"
	case method == "DELETE":
		action = "delete"
	default:
		action = strings.ToLower(method)
	}
	return
}

func describeAction(method, resType, resID, path string) string {
	if resID != "" {
		return method + " " + resType + "/" + resID + " (" + path + ")"
	}
	return method + " " + resType + " (" + path + ")"
}
