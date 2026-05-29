package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/oauth"
	"sso-server/internal/service"
)

// JWTAuth 解析 Bearer Token 并写入上下文
func JWTAuth(ts *oauth.TokenService, userSvc *service.UserService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 4001, "message": "未登录"})
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		claims, err := ts.ValidateAccessToken(tokenStr)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 4001, "message": "Token 无效"})
			return
		}
		// uid 永远是 UUID（OneAuth 内部主键）；sub 可能被 client.subject_type 改成 username/email 等。
		// 优先用 uid，兼容旧 token 时回退到 sub。
		userIDStr := claims.UID
		if userIDStr == "" {
			userIDStr = claims.Subject
		}
		c.Set("user_id", userIDStr)
		c.Set("client_id", claims.ClientID)
		c.Set("scope", claims.Scope)
		c.Set("username", claims.Username)

		uid, err := uuid.Parse(userIDStr)
		if err == nil {
			if u, err := userSvc.GetByID(uid); err == nil {
				c.Set("user", u)
				c.Set("is_staff", u.IsStaff)
				c.Set("permissions", userSvc.Permissions(u))
			}
		}
		c.Next()
	}
}

// RequireStaff 仅 is_staff=true 用户可访问（管理后台路由）
func RequireStaff() gin.HandlerFunc {
	return func(c *gin.Context) {
		isStaff, _ := c.Get("is_staff")
		if b, ok := isStaff.(bool); !ok || !b {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 4003, "message": "需要管理员权限"})
			return
		}
		c.Next()
	}
}

// RequirePermission 检查用户拥有指定权限编码
func RequirePermission(perm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		permsVal, _ := c.Get("permissions")
		perms, _ := permsVal.([]string)
		for _, p := range perms {
			if p == "*" || p == perm {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"code":    4003,
			"message": "权限不足: " + perm,
		})
	}
}
