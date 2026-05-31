package handler

// CAS 2.0/3.0 服务端实现：
//
//   GET /cas/login?service=URL
//     检查 sso_session cookie；未登录 → 302 到前端登录页，附带 return_to 回到本端点；
//     已登录 → 校验 service 是否命中应用的 cas_service 白名单 → 生成 ST 票据
//             → 302 service?ticket=ST-xxx
//
//   GET /cas/serviceValidate?ticket=ST-xxx&service=URL    (CAS v2 XML)
//   GET /cas/p3/serviceValidate?ticket=ST-xxx&service=URL (CAS v3 XML，含 attributes)
//   GET /cas/proxyValidate?ticket=ST-xxx&service=URL      (V2 别名)
//
//   GET /cas/logout[?service=URL|?url=URL]
//     删 sso_session cookie；如带 service/url 则 302 回去，否则跳前端登录页。
//
// 设计要点：
//   - ST 票据存进现有 oauth.Store（Redis 或内存），key 为 cas:st:<ticket>，TTL = client.CASExpiresSeconds
//   - ticket 一次性消费（验票成功后立即 Del）
//   - 是否在响应里输出 <cas:attributes> 由 client.CASReturnAttributes 控制

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/oauth"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/internal/session"
	"sso-server/pkg/response"
)

type CASHandler struct {
	Store         oauth.Store
	SessionMgr    *session.Manager
	ClientService *service.ClientService
	UserService   *service.UserService
	GrantRepo     *repository.GrantRepository
	AppGrantRepo  *repository.AppGrantRepository
	LogRepo       *repository.LogRepository
	FrontendBase  string
}

// --- ST ticket store --------------------------------------------------------

type casTicket struct {
	ClientID  string    `json:"client_id"`
	Service   string    `json:"service"`
	UserID    string    `json:"user_id"`
	Username  string    `json:"username"`
	IssuedAt  time.Time `json:"issued_at"`
}

func casTicketKey(t string) string { return "cas:st:" + t }

func newST() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return "ST-" + base64.RawURLEncoding.EncodeToString(b)
}

func (h *CASHandler) saveTicket(ctx context.Context, t string, data *casTicket, ttl time.Duration) error {
	b, _ := json.Marshal(data)
	return h.Store.Set(ctx, casTicketKey(t), b, ttl)
}

func (h *CASHandler) consumeTicket(ctx context.Context, t string) (*casTicket, error) {
	b, err := h.Store.Get(ctx, casTicketKey(t))
	if err != nil {
		return nil, err
	}
	// 一次性：先尝试删除
	_ = h.Store.Del(ctx, casTicketKey(t))
	var data casTicket
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

// --- helpers ----------------------------------------------------------------

// matchService 严格匹配 service URL，但允许 trailing slash 差异（CAS 客户端实现五花八门）。
func matchService(want, got string) bool {
	if want == "" {
		return false
	}
	w := strings.TrimRight(want, "/")
	g := strings.TrimRight(got, "/")
	return w == g
}

func (h *CASHandler) currentSession(c *gin.Context) *session.SessionData {
	sid, err := c.Cookie(session.CookieName)
	if err != nil {
		return nil
	}
	sd, err := h.SessionMgr.Get(c.Request.Context(), sid)
	if err != nil {
		return nil
	}
	return sd
}

// --- /cas/login -------------------------------------------------------------

func (h *CASHandler) Login(c *gin.Context) {
	service := c.Query("service")
	if service == "" {
		// 没带 service 就是空 IdP 登录，直接 302 到首页
		c.Redirect(http.StatusFound, h.FrontendBase+"/")
		return
	}

	// 查应用：cas_service 白名单匹配
	client, err := h.findClientByService(service)
	if err != nil {
		response.NotFound(c, "未知的 CAS service（请确认应用已在 OneAuth 注册并且 service URL 完全一致）")
		return
	}
	if !client.IsActive {
		response.Forbidden(c, "该应用已禁用")
		return
	}

	// 检查 SSO 登录态
	sd := h.currentSession(c)
	if sd == nil {
		loginURL := h.FrontendBase + "/?" + url.Values{
			"return_to": []string{c.Request.URL.RequestURI()},
		}.Encode()
		c.Redirect(http.StatusFound, loginURL)
		return
	}

	userID, err := uuid.Parse(sd.UserID)
	if err != nil {
		response.ServerError(c, "无效的会话")
		return
	}

	// 访问授权门 + SP-initiated 开关
	if !client.IsBuiltin {
		if !client.AllowSpInitiated {
			c.String(http.StatusForbidden, "该应用未启用 SP-initiated 登录，请联系管理员")
			return
		}
		switch client.AccessPolicy {
		case "none":
			c.String(http.StatusForbidden, "该应用尚未授权给任何用户访问")
			return
		case "assigned":
			if h.AppGrantRepo != nil {
				allowed, _ := h.AppGrantRepo.UserAllowed(client.ClientID, userID)
				if !allowed {
					c.String(http.StatusForbidden, "您没有权限访问该应用")
					return
				}
			}
		}
	}

	// 生成 ST 票据
	ttl := time.Duration(client.CASExpiresSeconds) * time.Second
	if ttl <= 0 {
		ttl = 300 * time.Second
	}
	ticket := newST()
	if err := h.saveTicket(c.Request.Context(), ticket, &casTicket{
		ClientID: client.ClientID,
		Service:  service,
		UserID:   sd.UserID,
		Username: sd.Username,
		IssuedAt: time.Now(),
	}, ttl); err != nil {
		response.ServerError(c, "颁发 ticket 失败")
		return
	}

	// 记一条应用访问日志
	if h.LogRepo != nil {
		h.LogRepo.RecordAccess(&userID, sd.Username, client.ClientID, client.ClientName, c.ClientIP())
	}

	// 302 回 service?ticket=ST-xxx
	loc := service
	sep := "?"
	if strings.Contains(loc, "?") {
		sep = "&"
	}
	c.Redirect(http.StatusFound, loc+sep+"ticket="+url.QueryEscape(ticket))
}

// findClientByService 按 cas_service 找应用；兼容 callback_url 也作为 service 传来的客户端实现。
func (h *CASHandler) findClientByService(svc string) (*model.OAuth2Client, error) {
	// 先尝试 cas_service 完全匹配
	if c, err := h.ClientService.FindByCASService(svc); err == nil {
		return c, nil
	}
	// 兜底：扫所有 protocol=cas 的应用，看 callback_url 是否匹配（允许尾部斜杠差异）
	all, err := h.ClientService.ListAll()
	if err != nil {
		return nil, err
	}
	for i := range all {
		c := &all[i]
		if c.Protocol != "cas" {
			continue
		}
		if matchService(c.CASService, svc) || matchService(c.CASCallbackURL, svc) {
			return c, nil
		}
	}
	return nil, oauth.ErrNotFound
}

// --- /cas/logout ------------------------------------------------------------

func (h *CASHandler) Logout(c *gin.Context) {
	target := c.Query("service")
	if target == "" {
		target = c.Query("url")
	}

	sd := h.currentSession(c)
	if sd != nil {
		_ = h.SessionMgr.Delete(c.Request.Context(), sd.SessionID)
	}
	// 清 cookie
	secure := c.Request.TLS != nil
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(session.CookieName, "", -1, "/", "", secure, true)

	if target != "" {
		c.Redirect(http.StatusFound, target)
		return
	}
	c.Redirect(http.StatusFound, h.FrontendBase+"/")
}

// --- /cas/serviceValidate (V2 XML) -----------------------------------------

// CAS V2 验票响应。
//   成功：
//     <cas:serviceResponse xmlns:cas="...">
//       <cas:authenticationSuccess>
//         <cas:user>jinli</cas:user>
//       </cas:authenticationSuccess>
//     </cas:serviceResponse>
//   失败：
//     <cas:serviceResponse>
//       <cas:authenticationFailure code="INVALID_TICKET">...</cas:authenticationFailure>
//     </cas:serviceResponse>
//
// V3 在 success 内追加 <cas:attributes> 段。

type casV2Response struct {
	XMLName xml.Name      `xml:"cas:serviceResponse"`
	XMLNS   string        `xml:"xmlns:cas,attr"`
	Success *casV2Success `xml:"cas:authenticationSuccess,omitempty"`
	Failure *casFailure   `xml:"cas:authenticationFailure,omitempty"`
}

type casV2Success struct {
	User string `xml:"cas:user"`
}

type casV3Response struct {
	XMLName xml.Name      `xml:"cas:serviceResponse"`
	XMLNS   string        `xml:"xmlns:cas,attr"`
	Success *casV3Success `xml:"cas:authenticationSuccess,omitempty"`
	Failure *casFailure   `xml:"cas:authenticationFailure,omitempty"`
}

type casV3Success struct {
	User       string         `xml:"cas:user"`
	Attributes *casAttributes `xml:"cas:attributes,omitempty"`
}

type casAttributes struct {
	Username     string `xml:"cas:username,omitempty"`
	UserID       string `xml:"cas:user_id,omitempty"`
	DisplayName  string `xml:"cas:display_name,omitempty"`
	Nickname     string `xml:"cas:nickname,omitempty"`
	Email        string `xml:"cas:email,omitempty"`
	Mobile       string `xml:"cas:mobile,omitempty"`
	Department   string `xml:"cas:department,omitempty"`
	EmployeeNo   string `xml:"cas:employee_no,omitempty"`
	IsStaff      bool   `xml:"cas:is_staff"`
	AuthDate     string `xml:"cas:authenticationDate,omitempty"`
}

type casFailure struct {
	Code    string `xml:"code,attr"`
	Message string `xml:",chardata"`
}

const casNS = "http://www.yale.edu/tp/cas"

func writeXML(c *gin.Context, payload any) {
	c.Header("Content-Type", "application/xml; charset=utf-8")
	c.Status(http.StatusOK)
	enc := xml.NewEncoder(c.Writer)
	enc.Indent("", "  ")
	_, _ = c.Writer.Write([]byte(xml.Header))
	_ = enc.Encode(payload)
	enc.Flush()
}

func writeFailureV2(c *gin.Context, code, msg string) {
	writeXML(c, &casV2Response{
		XMLNS:   casNS,
		Failure: &casFailure{Code: code, Message: " " + msg + " "},
	})
}

func writeFailureV3(c *gin.Context, code, msg string) {
	writeXML(c, &casV3Response{
		XMLNS:   casNS,
		Failure: &casFailure{Code: code, Message: " " + msg + " "},
	})
}

// ServiceValidate CAS V2
func (h *CASHandler) ServiceValidate(c *gin.Context) { h.validate(c, false) }

// P3ServiceValidate CAS V3
func (h *CASHandler) P3ServiceValidate(c *gin.Context) { h.validate(c, true) }

func (h *CASHandler) validate(c *gin.Context, v3 bool) {
	ticket := c.Query("ticket")
	service := c.Query("service")
	fail := func(code, msg string) {
		if v3 {
			writeFailureV3(c, code, msg)
		} else {
			writeFailureV2(c, code, msg)
		}
	}
	if ticket == "" || service == "" {
		fail("INVALID_REQUEST", "缺少 ticket 或 service 参数")
		return
	}

	td, err := h.consumeTicket(c.Request.Context(), ticket)
	if err != nil {
		fail("INVALID_TICKET", "ticket 不存在或已过期")
		return
	}
	if !matchService(td.Service, service) {
		fail("INVALID_SERVICE", "service 参数与 ticket 颁发时不一致")
		return
	}

	client, err := h.ClientService.GetByClientID(td.ClientID)
	if err != nil {
		fail("INVALID_TICKET", "应用不存在")
		return
	}

	uid, err := uuid.Parse(td.UserID)
	if err != nil {
		fail("INVALID_TICKET", "无效用户")
		return
	}
	user, err := h.UserService.GetByID(uid)
	if err != nil {
		fail("INVALID_TICKET", "用户不存在")
		return
	}

	principal := pickCASPrincipal(client.CASUserAttribute, user)
	if principal == "" {
		principal = user.Username
	}

	if !v3 {
		writeXML(c, &casV2Response{
			XMLNS:   casNS,
			Success: &casV2Success{User: principal},
		})
		return
	}

	success := &casV3Success{User: principal}
	if client.CASReturnAttributes {
		dept := ""
		if user.Department != nil {
			dept = user.Department.Name
		}
		email := ""
		if user.Email != nil {
			email = *user.Email
		}
		mobile := ""
		if user.Phone != nil {
			mobile = *user.Phone
		}
		success.Attributes = &casAttributes{
			Username:    user.Username,
			UserID:      user.ID.String(),
			DisplayName: firstNonEmpty(user.Nickname, user.Username),
			Nickname:    user.Nickname,
			Email:       email,
			Mobile:      mobile,
			Department:  dept,
			EmployeeNo:  user.EmployeeNo,
			IsStaff:     user.IsStaff,
			AuthDate:    td.IssuedAt.UTC().Format(time.RFC3339),
		}
	}
	writeXML(c, &casV3Response{XMLNS: casNS, Success: success})
}

func pickCASPrincipal(attr string, u *model.User) string {
	switch attr {
	case "user_id":
		return u.ID.String()
	case "email":
		if u.Email != nil {
			return *u.Email
		}
	case "mobile":
		if u.Phone != nil {
			return *u.Phone
		}
	}
	return u.Username
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}
