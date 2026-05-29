package service

import (
	"errors"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"sso-server/internal/model"
	"sso-server/internal/repository"
	"sso-server/pkg/utils"
)

type ClientService struct {
	repo        *repository.ClientRepository
	monitorRepo *repository.MonitorRepository
}

func NewClientService(r *repository.ClientRepository, m *repository.MonitorRepository) *ClientService {
	return &ClientService{repo: r, monitorRepo: m}
}

type CreateClientInput struct {
	ClientName      string `json:"client_name" binding:"required"`
	ClientType      string `json:"client_type"`
	Protocol        string `json:"protocol"`
	ProtocolVersion string `json:"protocol_version"`
	Description     string `json:"description"`

	// 通用
	LogoURL        string `json:"logo_url"`
	HomeURL        string `json:"home_url"`
	LoginURL       string `json:"login_url"`
	HealthCheckURL string `json:"health_check_url"`

	// OAuth2 / OIDC
	RedirectURIs    []string `json:"redirect_uris"`
	GrantTypes      []string `json:"grant_types"`
	Scope           string   `json:"scope"`
	SubjectType     string   `json:"subject_type"`
	RequirePKCE     bool     `json:"require_pkce"`
	RequireConsent  bool     `json:"require_consent"`
	AccessTokenTTL    int  `json:"access_token_ttl"`
	RefreshTokenTTL   int  `json:"refresh_token_ttl"`
	IDTokenTTL        int  `json:"id_token_ttl"`
	IssueRefreshToken *bool `json:"issue_refresh_token"`

	// OIDC
	OIDCIssuer            string   `json:"oidc_issuer"`
	OIDCAudience          string   `json:"oidc_audience"`
	OIDCIDTokenSigningAlg string   `json:"oidc_id_token_signing_alg"`
	OIDCUserInfoResponse  string   `json:"oidc_userinfo_response"`
	OIDCClaims            []string `json:"oidc_claims"`

	// SAML 2.0
	SAMLEntityID           string `json:"saml_entity_id"`
	SAMLACSURL             string `json:"saml_acs_url"`
	SAMLAudience           string `json:"saml_audience"`
	SAMLIssuer             string `json:"saml_issuer"`
	SAMLBinding            string `json:"saml_binding"`
	SAMLNameIDFormat       string `json:"saml_nameid_format"`
	SAMLNameIDConvert      string `json:"saml_nameid_convert"`
	SAMLSignatureAlgorithm string `json:"saml_signature_algorithm"`
	SAMLDigestAlgorithm    string `json:"saml_digest_algorithm"`
	SAMLEncrypted          bool   `json:"saml_encrypted"`
	SAMLValiditySeconds    int    `json:"saml_validity_seconds"`
	SAMLCertificate        string `json:"saml_certificate"`

	// CAS
	CASService        string `json:"cas_service"`
	CASCallbackURL    string `json:"cas_callback_url"`
	CASUserAttribute  string `json:"cas_user_attribute"`
	CASExpiresSeconds int    `json:"cas_expires_seconds"`
}

// ClientWithSecret 创建/轮换时一次性返回的明文 secret 包装。
// 只在 Create/RotateSecret 返回，永远不写入数据库的 JSON 字段。
type ClientWithSecret struct {
	*model.OAuth2Client
	ClientSecret string `json:"client_secret"`
}

func (s *ClientService) Create(in CreateClientInput) (*ClientWithSecret, error) {
	protocol := defaultStr(in.Protocol, "oidc")

	// 不同协议必填校验：OAuth2/OIDC 必须有 redirect_uris；SAML 必须有 EntityID + ACS；CAS 必须有 service
	switch protocol {
	case "oauth2", "oidc":
		if len(in.RedirectURIs) == 0 {
			return nil, errors.New("redirect_uris 不能为空")
		}
	case "saml":
		if in.SAMLEntityID == "" || in.SAMLACSURL == "" {
			return nil, errors.New("SAML 应用必须填写 Entity ID 与 ACS URL")
		}
	case "cas":
		if in.CASService == "" {
			return nil, errors.New("CAS 应用必须填写服务地址 (service)")
		}
	}
	secret := utils.RandomString(48)
	hash, err := bcrypt.GenerateFromPassword([]byte(secret), 12)
	if err != nil {
		return nil, err
	}
	clientID := "app_" + utils.RandomHex(8)
	c := &model.OAuth2Client{
		ID:               uuid.New(),
		ClientID:         clientID,
		ClientSecretHash: string(hash),
		ClientName:       in.ClientName,
		ClientType:       defaultStr(in.ClientType, model.ClientTypeConfidential),
		Protocol:         protocol,
		ProtocolVersion:  defaultStr(in.ProtocolVersion, defaultProtocolVersion(protocol)),
		Description:      in.Description,
		LogoURL:          in.LogoURL,
		HomeURL:          in.HomeURL,
		LoginURL:         in.LoginURL,
		HealthCheckURL:   in.HealthCheckURL,
		IsActive:         true,

		RedirectURIs:    in.RedirectURIs,
		GrantTypes:      defaultSlice(in.GrantTypes, []string{"authorization_code", "refresh_token"}),
		ResponseTypes:   []string{"code"},
		Scope:           defaultStr(in.Scope, "openid profile email"),
		SubjectType:     defaultStr(in.SubjectType, "username"),
		RequirePKCE:     in.RequirePKCE,
		RequireConsent:  in.RequireConsent,
		AccessTokenTTL:  defaultInt(in.AccessTokenTTL, 3600),
		RefreshTokenTTL: defaultInt(in.RefreshTokenTTL, 604800),
		IDTokenTTL:      defaultInt(in.IDTokenTTL, 3600),
		IssueRefreshToken: in.IssueRefreshToken == nil || *in.IssueRefreshToken,

		OIDCIssuer:            in.OIDCIssuer,
		OIDCAudience:          in.OIDCAudience,
		OIDCIDTokenSigningAlg: defaultStr(in.OIDCIDTokenSigningAlg, "RS256"),
		OIDCUserInfoResponse:  defaultStr(in.OIDCUserInfoResponse, "NORMAL"),
		OIDCClaims:            in.OIDCClaims,

		SAMLEntityID:           in.SAMLEntityID,
		SAMLACSURL:             in.SAMLACSURL,
		SAMLAudience:           defaultStr(in.SAMLAudience, in.SAMLEntityID),
		SAMLIssuer:             in.SAMLIssuer,
		SAMLBinding:            defaultStr(in.SAMLBinding, "Redirect-Post"),
		SAMLNameIDFormat:       defaultStr(in.SAMLNameIDFormat, "unspecified"),
		SAMLNameIDConvert:      defaultStr(in.SAMLNameIDConvert, "original"),
		SAMLSignatureAlgorithm: defaultStr(in.SAMLSignatureAlgorithm, "RSAwithSHA256"),
		SAMLDigestAlgorithm:    defaultStr(in.SAMLDigestAlgorithm, "SHA256"),
		SAMLEncrypted:          in.SAMLEncrypted,
		SAMLValiditySeconds:    defaultInt(in.SAMLValiditySeconds, 300),
		SAMLCertificate:        in.SAMLCertificate,

		CASService:        in.CASService,
		CASCallbackURL:    defaultStr(in.CASCallbackURL, in.CASService),
		CASUserAttribute:  defaultStr(in.CASUserAttribute, "username"),
		CASExpiresSeconds: defaultInt(in.CASExpiresSeconds, 300),
	}
	if err := s.repo.Create(c); err != nil {
		return nil, err
	}
	if s.monitorRepo != nil {
		s.monitorRepo.Upsert(&model.AppMonitor{
			ClientID:       clientID,
			Enabled:        in.HealthCheckURL != "",
			HealthCheckURL: in.HealthCheckURL,
			TimeoutMs:      10000,
			DegradedMs:     2000,
			CurrentStatus:  model.StatusNoData,
		})
	}
	return &ClientWithSecret{OAuth2Client: c, ClientSecret: secret}, nil
}

type UpdateClientInput struct {
	ClientName      *string `json:"client_name"`
	Protocol        *string `json:"protocol"`
	ProtocolVersion *string `json:"protocol_version"`
	Description     *string `json:"description"`

	LogoURL        *string `json:"logo_url"`
	HomeURL        *string `json:"home_url"`
	LoginURL       *string `json:"login_url"`
	HealthCheckURL *string `json:"health_check_url"`
	IsActive       *bool   `json:"is_active"`

	RedirectURIs    *[]string `json:"redirect_uris"`
	GrantTypes      *[]string `json:"grant_types"`
	Scope           *string   `json:"scope"`
	SubjectType     *string   `json:"subject_type"`
	RequirePKCE     *bool     `json:"require_pkce"`
	RequireConsent  *bool     `json:"require_consent"`
	AccessTokenTTL    *int  `json:"access_token_ttl"`
	RefreshTokenTTL   *int  `json:"refresh_token_ttl"`
	IDTokenTTL        *int  `json:"id_token_ttl"`
	IssueRefreshToken *bool `json:"issue_refresh_token"`

	OIDCIssuer            *string   `json:"oidc_issuer"`
	OIDCAudience          *string   `json:"oidc_audience"`
	OIDCIDTokenSigningAlg *string   `json:"oidc_id_token_signing_alg"`
	OIDCUserInfoResponse  *string   `json:"oidc_userinfo_response"`
	OIDCClaims            *[]string `json:"oidc_claims"`

	SAMLEntityID           *string `json:"saml_entity_id"`
	SAMLACSURL             *string `json:"saml_acs_url"`
	SAMLAudience           *string `json:"saml_audience"`
	SAMLIssuer             *string `json:"saml_issuer"`
	SAMLBinding            *string `json:"saml_binding"`
	SAMLNameIDFormat       *string `json:"saml_nameid_format"`
	SAMLNameIDConvert      *string `json:"saml_nameid_convert"`
	SAMLSignatureAlgorithm *string `json:"saml_signature_algorithm"`
	SAMLDigestAlgorithm    *string `json:"saml_digest_algorithm"`
	SAMLEncrypted          *bool   `json:"saml_encrypted"`
	SAMLValiditySeconds    *int    `json:"saml_validity_seconds"`
	SAMLCertificate        *string `json:"saml_certificate"`

	CASService        *string `json:"cas_service"`
	CASCallbackURL    *string `json:"cas_callback_url"`
	CASUserAttribute  *string `json:"cas_user_attribute"`
	CASExpiresSeconds *int    `json:"cas_expires_seconds"`
}

func (s *ClientService) Update(id uuid.UUID, in UpdateClientInput) (*model.OAuth2Client, error) {
	c, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if in.ClientName != nil {
		c.ClientName = *in.ClientName
	}
	if in.Protocol != nil {
		c.Protocol = *in.Protocol
	}
	if in.ProtocolVersion != nil {
		c.ProtocolVersion = *in.ProtocolVersion
	}
	if in.Description != nil {
		c.Description = *in.Description
	}
	if in.RedirectURIs != nil {
		c.RedirectURIs = *in.RedirectURIs
	}
	if in.GrantTypes != nil {
		c.GrantTypes = *in.GrantTypes
	}
	if in.Scope != nil {
		c.Scope = *in.Scope
	}
	if in.SubjectType != nil {
		c.SubjectType = *in.SubjectType
	}
	if in.RequirePKCE != nil {
		c.RequirePKCE = *in.RequirePKCE
	}
	if in.RequireConsent != nil {
		c.RequireConsent = *in.RequireConsent
	}
	if in.AccessTokenTTL != nil {
		c.AccessTokenTTL = *in.AccessTokenTTL
	}
	if in.RefreshTokenTTL != nil {
		c.RefreshTokenTTL = *in.RefreshTokenTTL
	}
	if in.IDTokenTTL != nil {
		c.IDTokenTTL = *in.IDTokenTTL
	}
	if in.IssueRefreshToken != nil {
		c.IssueRefreshToken = *in.IssueRefreshToken
	}
	if in.LogoURL != nil {
		c.LogoURL = *in.LogoURL
	}
	if in.HomeURL != nil {
		c.HomeURL = *in.HomeURL
	}
	if in.LoginURL != nil {
		c.LoginURL = *in.LoginURL
	}
	if in.HealthCheckURL != nil {
		c.HealthCheckURL = *in.HealthCheckURL
	}
	if in.IsActive != nil {
		c.IsActive = *in.IsActive
	}

	if in.OIDCIssuer != nil {
		c.OIDCIssuer = *in.OIDCIssuer
	}
	if in.OIDCAudience != nil {
		c.OIDCAudience = *in.OIDCAudience
	}
	if in.OIDCIDTokenSigningAlg != nil {
		c.OIDCIDTokenSigningAlg = *in.OIDCIDTokenSigningAlg
	}
	if in.OIDCUserInfoResponse != nil {
		c.OIDCUserInfoResponse = *in.OIDCUserInfoResponse
	}
	if in.OIDCClaims != nil {
		c.OIDCClaims = *in.OIDCClaims
	}

	if in.SAMLEntityID != nil {
		c.SAMLEntityID = *in.SAMLEntityID
	}
	if in.SAMLACSURL != nil {
		c.SAMLACSURL = *in.SAMLACSURL
	}
	if in.SAMLAudience != nil {
		c.SAMLAudience = *in.SAMLAudience
	}
	if in.SAMLIssuer != nil {
		c.SAMLIssuer = *in.SAMLIssuer
	}
	if in.SAMLBinding != nil {
		c.SAMLBinding = *in.SAMLBinding
	}
	if in.SAMLNameIDFormat != nil {
		c.SAMLNameIDFormat = *in.SAMLNameIDFormat
	}
	if in.SAMLNameIDConvert != nil {
		c.SAMLNameIDConvert = *in.SAMLNameIDConvert
	}
	if in.SAMLSignatureAlgorithm != nil {
		c.SAMLSignatureAlgorithm = *in.SAMLSignatureAlgorithm
	}
	if in.SAMLDigestAlgorithm != nil {
		c.SAMLDigestAlgorithm = *in.SAMLDigestAlgorithm
	}
	if in.SAMLEncrypted != nil {
		c.SAMLEncrypted = *in.SAMLEncrypted
	}
	if in.SAMLValiditySeconds != nil {
		c.SAMLValiditySeconds = *in.SAMLValiditySeconds
	}
	if in.SAMLCertificate != nil {
		c.SAMLCertificate = *in.SAMLCertificate
	}

	if in.CASService != nil {
		c.CASService = *in.CASService
	}
	if in.CASCallbackURL != nil {
		c.CASCallbackURL = *in.CASCallbackURL
	}
	if in.CASUserAttribute != nil {
		c.CASUserAttribute = *in.CASUserAttribute
	}
	if in.CASExpiresSeconds != nil {
		c.CASExpiresSeconds = *in.CASExpiresSeconds
	}

	if err := s.repo.Update(c); err != nil {
		return nil, err
	}
	// 同步更新 monitor URL
	if s.monitorRepo != nil && in.HealthCheckURL != nil {
		s.monitorRepo.UpdateHealthURL(c.ClientID, *in.HealthCheckURL)
	}
	return c, nil
}

func (s *ClientService) Delete(id uuid.UUID) error {
	c, err := s.repo.GetByID(id)
	if err != nil {
		return err
	}
	if c.IsBuiltin {
		return errors.New("内置应用不可删除")
	}
	if s.monitorRepo != nil {
		_ = s.monitorRepo.DeleteByClientID(c.ClientID)
	}
	return s.repo.Delete(id)
}

func (s *ClientService) RotateSecret(id uuid.UUID) (string, error) {
	c, err := s.repo.GetByID(id)
	if err != nil {
		return "", err
	}
	secret := utils.RandomString(48)
	hash, err := bcrypt.GenerateFromPassword([]byte(secret), 12)
	if err != nil {
		return "", err
	}
	c.ClientSecretHash = string(hash)
	if err := s.repo.Update(c); err != nil {
		return "", err
	}
	return secret, nil
}

func (s *ClientService) GetByClientID(clientID string) (*model.OAuth2Client, error) {
	return s.repo.GetByClientID(clientID)
}

func (s *ClientService) GetByID(id uuid.UUID) (*model.OAuth2Client, error) {
	return s.repo.GetByID(id)
}

func (s *ClientService) List(q repository.ClientQuery) ([]model.OAuth2Client, int64, error) {
	return s.repo.List(q)
}

func (s *ClientService) ListAll() ([]model.OAuth2Client, error) {
	return s.repo.ListAll()
}

func defaultStr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}

func defaultSlice(v []string, fallback []string) []string {
	if len(v) == 0 {
		return fallback
	}
	return v
}

func defaultProtocolVersion(protocol string) string {
	switch protocol {
	case "oidc":
		return "OpenID_Connect_v1.0"
	case "oauth2":
		return "OAuth_v2.0"
	case "saml":
		return "SAML_v2.0"
	case "cas":
		return "CAS_v3.0"
	default:
		return ""
	}
}

func defaultInt(v, fallback int) int {
	if v <= 0 {
		return fallback
	}
	return v
}
