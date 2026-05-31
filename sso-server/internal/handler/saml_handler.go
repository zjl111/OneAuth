package handler

// SAML 2.0 IdP 实现：
//
//   GET  /saml/metadata                IdP 元数据 XML，SP 一键导入
//   GET  /saml/sso                     接收 HTTP-Redirect 绑定的 AuthnRequest
//   POST /saml/sso                     接收 HTTP-POST 绑定的 AuthnRequest
//   GET  /saml/slo                     单点登出（HTTP-Redirect/POST 都接）
//   POST /saml/slo
//
//   AuthnRequest 流程：
//     1) 解析 SP 在 ?SAMLRequest 里发来的 AuthnRequest（base64+deflate / 直接 base64）
//     2) 取 issuer (= SP Entity ID) 找应用；校验 ACS URL 与配置一致
//     3) 检查 sso_session cookie；未登录 302 到前端 /?return_to=<原 URL>
//     4) 已登录 → 用 crewjam/saml 库构造 SAML Response（含签名，可选加密 Assertion）
//        → 渲染一个自动 POST 表单回跳 SP 的 ACS URL
//
//   元数据使用 IdP 站点 URL 作为 Entity ID，对外暴露 OneAuth 的签名公钥
//   （由 RSA 私钥派生的自签名 X.509 证书）。

import (
	"compress/flate"
	"context"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"crypto/rand"

	"github.com/crewjam/saml"
	samllogger "github.com/crewjam/saml/logger"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"sso-server/internal/model"
	"sso-server/internal/oauth"
	"sso-server/internal/repository"
	"sso-server/internal/service"
	"sso-server/internal/session"
)


// SAMLHandler IdP 协议实现。共享 OAuth 体系的 KeyManager / SessionMgr / Store。
type SAMLHandler struct {
	KeyManager    *oauth.KeyManager
	Store         oauth.Store
	SessionMgr    *session.Manager
	ClientService *service.ClientService
	UserService   *service.UserService
	AppGrantRepo  *repository.AppGrantRepository
	LogRepo       *repository.LogRepository
	ConfigRepo    *repository.ConfigRepository
	FrontendBase  string
	Issuer        string // 配置文件兜底 issuer

	// 派生的自签名 X.509 证书（由 KeyManager.PrivateKey + Issuer 生成，单进程缓存）
	certOnce sync.Once
	cert     *x509.Certificate
	certErr  error
}

// effectiveIssuer 同 OAuthHandler：优先 SystemConfig.platform.site_url
func (h *SAMLHandler) effectiveIssuer() string {
	if h.ConfigRepo != nil {
		if v := h.ConfigRepo.SiteURL(); v != "" {
			return v
		}
	}
	return h.Issuer
}

// idpCertificate 从 RSA 公钥派生自签名 X.509 证书。10 年有效期，CN=站点 host。
func (h *SAMLHandler) idpCertificate() (*x509.Certificate, error) {
	h.certOnce.Do(func() {
		priv := h.KeyManager.PrivateKey()
		if priv == nil {
			h.certErr = errors.New("RSA 私钥未加载")
			return
		}
		issuerHost := h.effectiveIssuer()
		cn := issuerHost
		if u, _ := url.Parse(issuerHost); u != nil && u.Host != "" {
			cn = u.Host
		}
		serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
		tmpl := &x509.Certificate{
			SerialNumber: serial,
			Subject:      pkix.Name{CommonName: cn, Organization: []string{"OneAuth"}},
			Issuer:       pkix.Name{CommonName: cn, Organization: []string{"OneAuth"}},
			NotBefore:    time.Now().Add(-1 * time.Hour),
			NotAfter:     time.Now().Add(10 * 365 * 24 * time.Hour),
			KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
			ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
			IsCA:         true,
			BasicConstraintsValid: true,
		}
		der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &priv.PublicKey, priv)
		if err != nil {
			h.certErr = err
			return
		}
		c, err := x509.ParseCertificate(der)
		if err != nil {
			h.certErr = err
			return
		}
		h.cert = c
	})
	return h.cert, h.certErr
}

// idpInstance 构造一个一次性的 crewjam IdentityProvider（每个请求构造，便于按客户端定制签名/加密策略）
func (h *SAMLHandler) idpInstance(ctx context.Context, c *model.OAuth2Client) (*saml.IdentityProvider, error) {
	cert, err := h.idpCertificate()
	if err != nil {
		return nil, err
	}
	priv := h.KeyManager.PrivateKey()
	issuer := h.effectiveIssuer()
	if c.SAMLIssuer != "" {
		issuer = c.SAMLIssuer
	}
	metaURL, _ := url.Parse(strings.TrimRight(issuer, "/") + "/saml/metadata")
	ssoURL, _ := url.Parse(strings.TrimRight(issuer, "/") + "/saml/sso")
	sloURL, _ := url.Parse(strings.TrimRight(issuer, "/") + "/saml/slo")

	idp := &saml.IdentityProvider{
		Key:         priv,
		Certificate: cert,
		Logger:      samllogger.DefaultLogger,
		MetadataURL: *metaURL,
		SSOURL:      *ssoURL,
		LogoutURL:   *sloURL,

		// 用应用配置里的 SP 元数据：实时构造一个 EntityDescriptor
		ServiceProviderProvider: &spProvider{client: c},

		// 签名 / 摘要算法可在签发时按 client 调
		SignatureMethod: samlSignatureURL(c.SAMLSignatureAlgorithm),

		AssertionMaker: &assertionMaker{handler: h, client: c},
		SessionProvider: nil, // 我们手工绕开 crewjam 的 cookie session，自己注入 user
	}
	return idp, nil
}

// spProvider 把 OneAuth 的 OAuth2Client (protocol=saml) 转成 crewjam 期望的 EntityDescriptor。
type spProvider struct {
	client *model.OAuth2Client
}

func (p *spProvider) GetServiceProvider(r *http.Request, serviceProviderID string) (*saml.EntityDescriptor, error) {
	c := p.client
	if c == nil || c.SAMLEntityID == "" {
		return nil, errors.New("应用未配置 SAML Entity ID")
	}
	// 校验 issuer
	if serviceProviderID != "" && serviceProviderID != c.SAMLEntityID {
		return nil, fmt.Errorf("issuer mismatch: %s != %s", serviceProviderID, c.SAMLEntityID)
	}
	desc := &saml.EntityDescriptor{
		EntityID: c.SAMLEntityID,
		SPSSODescriptors: []saml.SPSSODescriptor{{
			SSODescriptor: saml.SSODescriptor{
				RoleDescriptor: saml.RoleDescriptor{
					ProtocolSupportEnumeration: "urn:oasis:names:tc:SAML:2.0:protocol",
				},
			},
			AssertionConsumerServices: []saml.IndexedEndpoint{{
				Binding:  saml.HTTPPostBinding,
				Location: c.SAMLACSURL,
				Index:    0,
			}},
		}},
	}
	if c.SAMLCertificate != "" {
		// 解析 SP 公钥证书（可选）
		block, _ := pem.Decode([]byte(c.SAMLCertificate))
		if block != nil {
			if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
				kd := saml.KeyDescriptor{
					Use: "encryption",
					KeyInfo: saml.KeyInfo{
						X509Data: saml.X509Data{
							X509Certificates: []saml.X509Certificate{{Data: base64.StdEncoding.EncodeToString(cert.Raw)}},
						},
					},
				}
				desc.SPSSODescriptors[0].KeyDescriptors = []saml.KeyDescriptor{kd}
			}
		}
	}
	return desc, nil
}

// assertionMaker 自定义 Assertion 内容：NameID 来源 + AttributeStatement
type assertionMaker struct {
	handler *SAMLHandler
	client  *model.OAuth2Client
}

func (m *assertionMaker) MakeAssertion(req *saml.IdpAuthnRequest, sess *saml.Session) error {
	c := m.client
	user := userFromSession(sess)
	if user == nil {
		// fallback：用 sess 里的 NameID 字段
		dummy := &model.User{Username: sess.NameID}
		user = dummy
	}

	// 取 NameID
	nameIDValue := pickSAMLPrincipal(c.SAMLNameIDConvert, user)
	if nameIDValue == "" {
		nameIDValue = user.Username
	}
	nameIDFormat := c.SAMLNameIDFormat
	if nameIDFormat == "" {
		nameIDFormat = "unspecified"
	}
	if !strings.HasPrefix(nameIDFormat, "urn:") {
		nameIDFormat = "urn:oasis:names:tc:SAML:1.1:nameid-format:" + nameIDFormat
	}

	// 让默认逻辑先生成 Assertion 框架
	dam := saml.DefaultAssertionMaker{}
	if err := dam.MakeAssertion(req, sess); err != nil {
		return err
	}
	a := req.Assertion
	if a == nil {
		return errors.New("crewjam saml 未生成 Assertion 框架")
	}

	// 替换 Issuer 为我们的 effective issuer
	a.Issuer = saml.Issuer{Format: "urn:oasis:names:tc:SAML:2.0:nameid-format:entity", Value: m.handler.effectiveIssuer()}
	if c.SAMLIssuer != "" {
		a.Issuer.Value = c.SAMLIssuer
	}
	// Subject NameID
	if a.Subject == nil {
		a.Subject = &saml.Subject{}
	}
	a.Subject.NameID = &saml.NameID{
		Format:          nameIDFormat,
		NameQualifier:   m.handler.effectiveIssuer(),
		SPNameQualifier: c.SAMLEntityID,
		Value:           nameIDValue,
	}

	// 替换 AttributeStatement 为我们想发的字段
	attrs := []saml.Attribute{
		simpleAttr("username", user.Username),
		simpleAttr("nickname", firstNonEmpty(user.Nickname, user.Username)),
		simpleAttr("user_id", user.ID.String()),
	}
	if user.Email != nil && *user.Email != "" {
		attrs = append(attrs, simpleAttr("email", *user.Email))
	}
	if user.Phone != nil && *user.Phone != "" {
		attrs = append(attrs, simpleAttr("mobile", *user.Phone))
	}
	if user.EmployeeNo != "" {
		attrs = append(attrs, simpleAttr("employee_no", user.EmployeeNo))
	}
	if user.Department != nil && user.Department.Name != "" {
		attrs = append(attrs, simpleAttr("department", user.Department.Name))
	}
	attrs = append(attrs, simpleAttr("is_staff", boolStr(user.IsStaff)))
	a.AttributeStatements = []saml.AttributeStatement{{Attributes: attrs}}

	// 有效期
	ttl := time.Duration(c.SAMLValiditySeconds) * time.Second
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	now := time.Now().UTC()
	a.Conditions = &saml.Conditions{
		NotBefore:    now.Add(-30 * time.Second),
		NotOnOrAfter: now.Add(ttl),
		AudienceRestrictions: []saml.AudienceRestriction{{
		Audience: saml.Audience{Value: nonEmptyStr(c.SAMLAudience, c.SAMLEntityID)},
		}},
	}
	a.IssueInstant = now
	for i := range a.AuthnStatements {
		a.AuthnStatements[i].SessionNotOnOrAfter = pTime(now.Add(ttl))
	}
	for i := range a.Subject.SubjectConfirmations {
		if a.Subject.SubjectConfirmations[i].SubjectConfirmationData != nil {
			a.Subject.SubjectConfirmations[i].SubjectConfirmationData.NotOnOrAfter = now.Add(ttl)
		}
	}
	return nil
}

func simpleAttr(name, value string) saml.Attribute {
	return saml.Attribute{
		FriendlyName: name,
		Name:         name,
		NameFormat:   "urn:oasis:names:tc:SAML:2.0:attrname-format:basic",
		Values:       []saml.AttributeValue{{Type: "xs:string", Value: value}},
	}
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

func pTime(t time.Time) *time.Time { return &t }

func samlSignatureURL(alg string) string {
	switch alg {
	case "RSAwithSHA1":
		return "http://www.w3.org/2000/09/xmldsig#rsa-sha1"
	case "RSAwithSHA384":
		return "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384"
	case "RSAwithSHA512":
		return "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512"
	default:
		return "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
	}
}

func pickSAMLPrincipal(field string, u *model.User) string {
	switch field {
	case "email":
		if u.Email != nil {
			return *u.Email
		}
	case "mobile":
		if u.Phone != nil {
			return *u.Phone
		}
	case "user_id":
		return u.ID.String()
	}
	return u.Username
}

// userFromSession 把我们注入到 saml.Session.UserName 后面的 user JSON 反序列化回 model.User
func userFromSession(sess *saml.Session) *model.User {
	if sess == nil || sess.UserCommonName == "" {
		return nil
	}
	var u model.User
	if err := json.Unmarshal([]byte(sess.UserCommonName), &u); err != nil {
		return nil
	}
	return &u
}

// --- HTTP handlers ---------------------------------------------------------

func (h *SAMLHandler) Metadata(c *gin.Context) {
	cert, err := h.idpCertificate()
	if err != nil {
		c.String(http.StatusInternalServerError, "metadata error: %v", err)
		return
	}
	issuer := h.effectiveIssuer()
	metaP, _ := url.Parse(strings.TrimRight(issuer, "/") + "/saml/metadata")
	ssoP, _ := url.Parse(strings.TrimRight(issuer, "/") + "/saml/sso")
	sloP, _ := url.Parse(strings.TrimRight(issuer, "/") + "/saml/slo")
	idp := saml.IdentityProvider{
		Key:         h.KeyManager.PrivateKey(),
		Certificate: cert,
		MetadataURL: *metaP,
		SSOURL:      *ssoP,
		LogoutURL:   *sloP,
	}
	md := idp.Metadata()
	md.EntityID = issuer
	out, err := xml.MarshalIndent(md, "", "  ")
	if err != nil {
		c.String(http.StatusInternalServerError, "marshal: %v", err)
		return
	}
	c.Header("Content-Type", "application/samlmetadata+xml; charset=utf-8")
	c.Status(http.StatusOK)
	_, _ = c.Writer.Write([]byte(xml.Header))
	_, _ = c.Writer.Write(out)
}

// SSO 接收 SAML AuthnRequest（GET=Redirect, POST=POST 绑定）
func (h *SAMLHandler) SSO(c *gin.Context) {
	// crewjam 的 NewIdpAuthnRequest 期望 *http.Request；直接用 c.Request
	rawReq, err := readSAMLRequest(c)
	if err != nil {
		c.String(http.StatusBadRequest, "解析 SAMLRequest 失败：%v", err)
		return
	}
	// 解 base64+inflate 拿到 AuthnRequest XML，先解析 issuer 找 client
	authn, err := decodeAuthnRequest(rawReq.SAMLRequest, rawReq.IsRedirect)
	if err != nil {
		c.String(http.StatusBadRequest, "AuthnRequest 解析失败：%v", err)
		return
	}
	issuer := ""
	if authn.Issuer != nil {
		issuer = authn.Issuer.Value
	}
	if issuer == "" {
		c.String(http.StatusBadRequest, "AuthnRequest 缺少 Issuer")
		return
	}
	client, err := h.findClientByEntityID(issuer)
	if err != nil {
		c.String(http.StatusNotFound, "未知的 SP（issuer=%s）；请确认应用已在 OneAuth 注册并且 Entity ID 一致", issuer)
		return
	}
	if !client.IsActive {
		c.String(http.StatusForbidden, "该应用已禁用")
		return
	}
	if authn.AssertionConsumerServiceURL != "" && client.SAMLACSURL != "" &&
		authn.AssertionConsumerServiceURL != client.SAMLACSURL {
		c.String(http.StatusBadRequest, "AssertionConsumerServiceURL 与应用配置不一致")
		return
	}

	// 检查登录态
	sd := h.currentSession(c)
	if sd == nil {
		loginURL := h.FrontendBase + "/?" + url.Values{
			"return_to": []string{c.Request.URL.RequestURI()},
		}.Encode()
		c.Redirect(http.StatusFound, loginURL)
		return
	}
	uid, err := uuid.Parse(sd.UserID)
	if err != nil {
		c.String(http.StatusUnauthorized, "无效会话")
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
				allowed, _ := h.AppGrantRepo.UserAllowed(client.ClientID, uid)
				if !allowed {
					c.String(http.StatusForbidden, "您没有权限访问该应用")
					return
				}
			}
		}
	}

	user, err := h.UserService.GetByID(uid)
	if err != nil {
		c.String(http.StatusUnauthorized, "用户不存在")
		return
	}

	// 应用访问日志
	if h.LogRepo != nil {
		h.LogRepo.RecordAccess(&uid, sd.Username, client.ClientID, client.ClientName, c.ClientIP())
	}

	// 构造 IdP 实例并签发 Response
	idp, err := h.idpInstance(c.Request.Context(), client)
	if err != nil {
		c.String(http.StatusInternalServerError, "IdP 初始化失败：%v", err)
		return
	}

	// crewjam 的 IdpAuthnRequest 原始流程：
	idpReq, err := saml.NewIdpAuthnRequest(idp, c.Request)
	if err != nil {
		c.String(http.StatusBadRequest, "构造 IdpAuthnRequest 失败：%v", err)
		return
	}
	if err := idpReq.Validate(); err != nil {
		c.String(http.StatusBadRequest, "AuthnRequest 校验失败：%v", err)
		return
	}

	// 把 user 序列化进 saml.Session.UserCommonName，AssertionMaker 再读出来
	userJSON, _ := json.Marshal(user)
	sess := &saml.Session{
		ID:             uuid.NewString(),
		CreateTime:     time.Now(),
		ExpireTime:     time.Now().Add(time.Duration(client.SAMLValiditySeconds) * time.Second),
		Index:          uuid.NewString(),
		NameID:         pickSAMLPrincipal(client.SAMLNameIDConvert, user),
		UserName:       user.Username,
		UserCommonName: string(userJSON),
	}

	maker := &assertionMaker{handler: h, client: client}
	if err := maker.MakeAssertion(idpReq, sess); err != nil {
		c.String(http.StatusInternalServerError, "签发 Assertion 失败：%v", err)
		return
	}
	if err := idpReq.MakeAssertionEl(); err != nil {
		c.String(http.StatusInternalServerError, "序列化 Assertion 失败：%v", err)
		return
	}
	if err := idpReq.MakeResponse(); err != nil {
		c.String(http.StatusInternalServerError, "签发 Response 失败：%v", err)
		return
	}

	// crewjam 提供了一个写自动提交表单的方法
	if err := idpReq.WriteResponse(c.Writer); err != nil {
		// fallback：自定义 HTML 表单
		c.String(http.StatusInternalServerError, "回写 Response 失败：%v", err)
		return
	}
}

func (h *SAMLHandler) SLO(c *gin.Context) {
	sd := h.currentSession(c)
	if sd != nil {
		_ = h.SessionMgr.Delete(c.Request.Context(), sd.SessionID)
	}
	secure := c.Request.TLS != nil
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(session.CookieName, "", -1, "/", "", secure, true)
	c.Redirect(http.StatusFound, h.FrontendBase+"/")
}

// --- helpers --------------------------------------------------------------

type rawSAMLRequest struct {
	SAMLRequest string
	RelayState  string
	IsRedirect  bool
}

func readSAMLRequest(c *gin.Context) (*rawSAMLRequest, error) {
	if c.Request.Method == http.MethodGet {
		return &rawSAMLRequest{
			SAMLRequest: c.Query("SAMLRequest"),
			RelayState:  c.Query("RelayState"),
			IsRedirect:  true,
		}, nil
	}
	if err := c.Request.ParseForm(); err != nil {
		return nil, err
	}
	return &rawSAMLRequest{
		SAMLRequest: c.Request.PostFormValue("SAMLRequest"),
		RelayState:  c.Request.PostFormValue("RelayState"),
		IsRedirect:  false,
	}, nil
}

// decodeAuthnRequest base64 解码（Redirect 绑定还要 inflate）。
func decodeAuthnRequest(s string, redirect bool) (*saml.AuthnRequest, error) {
	if s == "" {
		return nil, errors.New("SAMLRequest 为空")
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		raw, err = base64.RawStdEncoding.DecodeString(s)
		if err != nil {
			return nil, fmt.Errorf("base64: %w", err)
		}
	}
	if redirect {
		fr := flate.NewReader(strings.NewReader(string(raw)))
		defer fr.Close()
		raw2, err := io.ReadAll(fr)
		if err != nil {
			return nil, fmt.Errorf("inflate: %w", err)
		}
		raw = raw2
	}
	var req saml.AuthnRequest
	if err := xml.Unmarshal(raw, &req); err != nil {
		return nil, fmt.Errorf("xml: %w", err)
	}
	return &req, nil
}

func (h *SAMLHandler) findClientByEntityID(entityID string) (*model.OAuth2Client, error) {
	all, err := h.ClientService.ListAll()
	if err != nil {
		return nil, err
	}
	for i := range all {
		c := &all[i]
		if c.Protocol == "saml" && c.SAMLEntityID == entityID {
			return c, nil
		}
	}
	return nil, oauth.ErrNotFound
}

func (h *SAMLHandler) currentSession(c *gin.Context) *session.SessionData {
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

// 抑制未使用 import 警告（备用 helpers）
var _ = sha1.New
var _ = html.EscapeString
var _ rsa.PrivateKey

func nonEmptyStr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

// ParseMetadataReq /api/v1/saml/parse-metadata：管理员粘贴 SP metadata URL 或 XML 文本，
// 返回前端需要的字段（entity_id / acs_url / nameid_format / certificate / binding）。
type ParseMetadataReq struct {
	URL  string `json:"url"`
	XML  string `json:"xml"`
}

type ParseMetadataResp struct {
	EntityID     string `json:"entity_id"`
	ACSURL       string `json:"acs_url"`
	Binding      string `json:"binding"`
	NameIDFormat string `json:"nameid_format"`
	Certificate  string `json:"certificate"` // PEM
	Source       string `json:"source"`      // url|xml
}

func (h *SAMLHandler) ParseMetadata(c *gin.Context) {
	var req ParseMetadataReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 4001, "message": "请求格式错误：" + err.Error()})
		return
	}
	if req.URL == "" && req.XML == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 4001, "message": "请提供 metadata URL 或 XML 文本"})
		return
	}
	body := req.XML
	source := "xml"
	if req.URL != "" {
		source = "url"
		client := &http.Client{Timeout: 10 * time.Second}
		hreq, err := http.NewRequest("GET", req.URL, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 4001, "message": "URL 格式错误：" + err.Error()})
			return
		}
		hreq.Header.Set("Accept", "application/samlmetadata+xml, application/xml, text/xml, */*")
		resp, err := client.Do(hreq)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"code": 4002, "message": "拉取 metadata 失败：" + err.Error()})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode/100 != 2 {
			c.JSON(http.StatusBadGateway, gin.H{"code": 4002, "message": fmt.Sprintf("metadata 返回 HTTP %d", resp.StatusCode)})
			return
		}
		raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20)) // 2MB 上限
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"code": 4002, "message": "读取 metadata 失败：" + err.Error()})
			return
		}
		body = string(raw)
	}

	var ed saml.EntityDescriptor
	if err := xml.Unmarshal([]byte(body), &ed); err != nil {
		// 也可能是 EntitiesDescriptor 包了一层
		var eds saml.EntitiesDescriptor
		if err2 := xml.Unmarshal([]byte(body), &eds); err2 != nil {
			c.JSON(http.StatusBadRequest, gin.H{"code": 4001, "message": "metadata XML 解析失败：" + err.Error()})
			return
		}
		if len(eds.EntityDescriptors) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"code": 4001, "message": "metadata 中找不到 EntityDescriptor"})
			return
		}
		ed = eds.EntityDescriptors[0]
	}

	out := ParseMetadataResp{Source: source}
	out.EntityID = ed.EntityID
	if len(ed.SPSSODescriptors) > 0 {
		sp := ed.SPSSODescriptors[0]
		// ACS URL：优先选 HTTP-POST 绑定的
		var acsPost, acsRedirect string
		for _, acs := range sp.AssertionConsumerServices {
			switch acs.Binding {
			case saml.HTTPPostBinding:
				if acsPost == "" {
					acsPost = acs.Location
				}
			case saml.HTTPRedirectBinding:
				if acsRedirect == "" {
					acsRedirect = acs.Location
				}
			}
		}
		if acsPost != "" {
			out.ACSURL = acsPost
			out.Binding = "Redirect-Post"
		} else if acsRedirect != "" {
			out.ACSURL = acsRedirect
			out.Binding = "Redirect-Post"
		}
		// NameID Format
		if len(sp.NameIDFormats) > 0 {
			f := string(sp.NameIDFormats[0])
			if i := strings.LastIndex(f, ":"); i >= 0 {
				f = f[i+1:]
			}
			out.NameIDFormat = f
		}
		// 证书：找 use=signing 优先，没有就用 encryption
		var signing, enc string
		for _, kd := range sp.KeyDescriptors {
			for _, x := range kd.KeyInfo.X509Data.X509Certificates {
				if x.Data == "" {
					continue
				}
				pemTxt := certBase64ToPEM(x.Data)
				if kd.Use == "signing" && signing == "" {
					signing = pemTxt
				}
				if kd.Use == "encryption" && enc == "" {
					enc = pemTxt
				}
				if kd.Use == "" && signing == "" {
					signing = pemTxt
				}
			}
		}
		out.Certificate = nonEmptyStr(signing, enc)
	}

	if out.EntityID == "" && out.ACSURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 4001, "message": "metadata 既没有 Entity ID 也没有 ACS URL，可能不是 SP metadata"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 200, "message": "ok", "data": out})
}

func certBase64ToPEM(b64 string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			return -1
		}
		return r
	}, b64)
	var sb strings.Builder
	sb.WriteString("-----BEGIN CERTIFICATE-----\n")
	for i := 0; i < len(cleaned); i += 64 {
		end := i + 64
		if end > len(cleaned) {
			end = len(cleaned)
		}
		sb.WriteString(cleaned[i:end])
		sb.WriteString("\n")
	}
	sb.WriteString("-----END CERTIFICATE-----\n")
	return sb.String()
}
