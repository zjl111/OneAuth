package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"sso-server/pkg/utils"
)

type AuthCodeData struct {
	Code                string `json:"code"`
	ClientID            string `json:"client_id"`
	RedirectURI         string `json:"redirect_uri"`
	Scope               string `json:"scope"`
	UserID              string `json:"user_id"`
	Username            string `json:"username"`
	Nonce               string `json:"nonce"`
	CodeChallenge       string `json:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method"`
	AuthTime            int64  `json:"auth_time"`
	CreatedAt           int64  `json:"created_at"`
}

type AuthCodeStore struct {
	store Store
	ttl   time.Duration
}

func NewAuthCodeStore(s Store, ttl time.Duration) *AuthCodeStore {
	return &AuthCodeStore{store: s, ttl: ttl}
}

func (s *AuthCodeStore) GenerateCode() string {
	return utils.RandomString(32)
}

func (s *AuthCodeStore) Save(ctx context.Context, data *AuthCodeData) error {
	data.CreatedAt = time.Now().Unix()
	b, err := json.Marshal(data)
	if err != nil {
		return err
	}
	return s.store.Set(ctx, "auth_code:"+data.Code, b, s.ttl)
}

func (s *AuthCodeStore) Get(ctx context.Context, code, clientID string) (*AuthCodeData, error) {
	b, err := s.store.Get(ctx, "auth_code:"+code)
	if err != nil {
		return nil, fmt.Errorf("authorization code not found or expired")
	}
	var data AuthCodeData
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	if data.ClientID != clientID {
		return nil, fmt.Errorf("client_id mismatch")
	}
	return &data, nil
}

func (s *AuthCodeStore) Delete(ctx context.Context, code string) error {
	return s.store.Del(ctx, "auth_code:"+code)
}
