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
	ClientName     string   `json:"client_name" binding:"required"`
	ClientType     string   `json:"client_type"`
	Description    string   `json:"description"`
	RedirectURIs   []string `json:"redirect_uris" binding:"required"`
	GrantTypes     []string `json:"grant_types"`
	Scope          string   `json:"scope"`
	LogoURL        string   `json:"logo_url"`
	HomeURL        string   `json:"home_url"`
	HealthCheckURL string   `json:"health_check_url"`
}

// ClientWithSecret 创建/轮换时一次性返回的明文 secret 包装。
// 只在 Create/RotateSecret 返回，永远不写入数据库的 JSON 字段。
type ClientWithSecret struct {
	*model.OAuth2Client
	ClientSecret string `json:"client_secret"`
}

func (s *ClientService) Create(in CreateClientInput) (*ClientWithSecret, error) {
	if len(in.RedirectURIs) == 0 {
		return nil, errors.New("redirect_uris 不能为空")
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
		Description:      in.Description,
		RedirectURIs:     in.RedirectURIs,
		GrantTypes:       defaultSlice(in.GrantTypes, []string{"authorization_code", "refresh_token"}),
		ResponseTypes:    []string{"code"},
		Scope:            defaultStr(in.Scope, "openid profile email"),
		LogoURL:          in.LogoURL,
		HomeURL:          in.HomeURL,
		HealthCheckURL:   in.HealthCheckURL,
		IsActive:         true,
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
	ClientName     *string   `json:"client_name"`
	Description    *string   `json:"description"`
	RedirectURIs   *[]string `json:"redirect_uris"`
	Scope          *string   `json:"scope"`
	LogoURL        *string   `json:"logo_url"`
	HomeURL        *string   `json:"home_url"`
	HealthCheckURL *string   `json:"health_check_url"`
	IsActive       *bool     `json:"is_active"`
}

func (s *ClientService) Update(id uuid.UUID, in UpdateClientInput) (*model.OAuth2Client, error) {
	c, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if in.ClientName != nil {
		c.ClientName = *in.ClientName
	}
	if in.Description != nil {
		c.Description = *in.Description
	}
	if in.RedirectURIs != nil {
		c.RedirectURIs = *in.RedirectURIs
	}
	if in.Scope != nil {
		c.Scope = *in.Scope
	}
	if in.LogoURL != nil {
		c.LogoURL = *in.LogoURL
	}
	if in.HomeURL != nil {
		c.HomeURL = *in.HomeURL
	}
	if in.HealthCheckURL != nil {
		c.HealthCheckURL = *in.HealthCheckURL
	}
	if in.IsActive != nil {
		c.IsActive = *in.IsActive
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
