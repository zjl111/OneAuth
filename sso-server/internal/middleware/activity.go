package middleware

import (
	"context"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"sso-server/internal/oauth"
)

// TouchActivity 用户主动操作时刷新 last_active_at（用于"无活动 N 秒登出"）。
// 仅当请求带 X-User-Action: 1 才更新——避免后台轮询（dashboard 状态页等）
// 误算成"用户活跃"导致永远不掉线。
//
// 必须挂在 JWTAuth 之后（依赖 user_id）。
func TouchActivity(store oauth.Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next() // 让业务先跑，避免失败的请求也算活跃
		if c.Writer.Status() >= 400 {
			return
		}
		if c.GetHeader("X-User-Action") != "1" {
			return
		}
		uid, _ := c.Get("user_id")
		userID, _ := uid.(string)
		if userID == "" {
			return
		}
		// 写入 unix 秒，TTL 14 天兜底（远超任何配置 session_timeout）
		_ = store.Set(c.Request.Context(), activityKey(userID),
			[]byte(strconv.FormatInt(time.Now().Unix(), 10)),
			14*24*time.Hour)
	}
}

// LastActiveAt 返回用户上次活跃时间（用于 refresh handler 校验）
// 没有记录则返回零值，调用方需视为"从未活跃"或"刚登录"。
func LastActiveAt(store oauth.Store, userID string) time.Time {
	if userID == "" {
		return time.Time{}
	}
	raw, err := store.Get(context.Background(), activityKey(userID))
	if err != nil || len(raw) == 0 {
		return time.Time{}
	}
	sec, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil {
		return time.Time{}
	}
	return time.Unix(sec, 0)
}

// MarkActive 显式刷新 last_active_at。Login 成功时调，免得用户登录后立刻被
// 算成"已经超时 N 小时"踢回登录页。
func MarkActive(store oauth.Store, userID string) {
	if userID == "" || store == nil {
		return
	}
	_ = store.Set(context.Background(), activityKey(userID),
		[]byte(strconv.FormatInt(time.Now().Unix(), 10)),
		14*24*time.Hour)
}

func activityKey(userID string) string { return "lastactive:" + userID }
