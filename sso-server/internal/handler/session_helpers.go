package handler

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/oauth"
	"sso-server/internal/service"
	"sso-server/internal/session"
)

func setCookie(c *gin.Context, name, value string, ttlSeconds int) {
	secure := isHTTPSRequest(c)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, value, ttlSeconds, "/", "", secure, true)
}

func clearCookie(c *gin.Context, name string) {
	secure := isHTTPSRequest(c)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(name, "", -1, "/", "", secure, true)
}

func currentSessionFromCookie(c *gin.Context, mgr *session.Manager) *session.SessionData {
	sid, err := c.Cookie(session.CookieName)
	if err != nil || sid == "" {
		log.Printf("[session-debug] /oauth authorize: cookie %q not found, err=%v", session.CookieName, err)
		return nil
	}
	sd, err := mgr.Get(c.Request.Context(), sid)
	if err != nil {
		log.Printf("[session-debug] /oauth authorize: store lookup failed for sid=%q (len=%d), err=%v", sid, len(sid), err)
		return nil
	}
	log.Printf("[session-debug] /oauth authorize: session found sid=%q user=%s", sid, sd.Username)
	return sd
}

func recoverSessionFromAccessToken(c *gin.Context, mgr *session.Manager, ts *oauth.TokenService, userSvc *service.UserService) *session.SessionData {
	if mgr == nil || ts == nil || userSvc == nil {
		log.Printf("[session-debug] recover: nil mgr/ts/userSvc")
		return nil
	}
	tokenStr, err := c.Cookie(session.AccessTokenCookieName)
	if err != nil || tokenStr == "" {
		log.Printf("[session-debug] recover: access token cookie not found, err=%v", err)
		return nil
	}
	claims, err := ts.ValidateAccessToken(tokenStr)
	if err != nil {
		log.Printf("[session-debug] recover: access token invalid: %v", err)
		return nil
	}
	log.Printf("[session-debug] recover: access token valid, creating new session")
	userID := claims.UID
	if userID == "" {
		userID = claims.Subject
	}
	uid, err := uuid.Parse(userID)
	if err != nil {
		return nil
	}
	user, err := userSvc.GetByID(uid)
	if err != nil {
		return nil
	}
	sd, err := mgr.Create(c.Request.Context(), user.ID.String(), user.Username, sessionDisplayName(user), c.ClientIP(), c.GetHeader("User-Agent"), user.IsStaff)
	if err != nil {
		return nil
	}
	setCookie(c, session.CookieName, sd.SessionID, int(mgr.TTL().Seconds()))
	log.Printf("[session-debug] recover: new session created sid=%q", sd.SessionID)
	return sd
}
