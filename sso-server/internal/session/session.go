package session

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"sso-server/internal/oauth"
	"sso-server/pkg/utils"
)

const (
	CookieName     = "sso_session"
	DefaultTTL     = 8 * time.Hour
	sessionKeyBase = "session:"
)

// SessionData 服务端会话数据
type SessionData struct {
	SessionID string    `json:"sid"`
	UserID    string    `json:"user_id"`
	Username  string    `json:"username"`
	IsStaff   bool      `json:"is_staff"`
	IP        string    `json:"ip"`
	UserAgent string    `json:"ua"`
	AuthTime  time.Time `json:"auth_time"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

type Manager struct {
	store oauth.Store
	ttl   time.Duration

	mu    sync.RWMutex
	index map[string]struct{} // 已知会话 sid 集合（内存索引，进程重启后清空，但 Get/Delete 仍可用 Store 直接命中）
}

func New(store oauth.Store, ttl time.Duration) *Manager {
	if ttl == 0 {
		ttl = DefaultTTL
	}
	return &Manager{store: store, ttl: ttl, index: make(map[string]struct{})}
}

func (m *Manager) Create(ctx context.Context, userID, username, ip, ua string, isStaff bool) (*SessionData, error) {
	now := time.Now()
	data := &SessionData{
		SessionID: utils.RandomString(32),
		UserID:    userID,
		Username:  username,
		IsStaff:   isStaff,
		IP:        ip,
		UserAgent: ua,
		AuthTime:  now,
		CreatedAt: now,
		ExpiresAt: now.Add(m.ttl),
	}
	b, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	if err := m.store.Set(ctx, sessionKeyBase+data.SessionID, b, m.ttl); err != nil {
		return nil, err
	}
	m.mu.Lock()
	m.index[data.SessionID] = struct{}{}
	m.mu.Unlock()
	return data, nil
}

func (m *Manager) Get(ctx context.Context, sid string) (*SessionData, error) {
	if sid == "" {
		return nil, oauth.ErrNotFound
	}
	b, err := m.store.Get(ctx, sessionKeyBase+sid)
	if err != nil {
		return nil, err
	}
	var data SessionData
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, err
	}
	return &data, nil
}

func (m *Manager) Delete(ctx context.Context, sid string) error {
	m.mu.Lock()
	delete(m.index, sid)
	m.mu.Unlock()
	return m.store.Del(ctx, sessionKeyBase+sid)
}

// ListAll 列出当前进程感知的所有会话（仅含本进程创建的；进程重启后索引清空）
func (m *Manager) ListAll(ctx context.Context) []*SessionData {
	m.mu.RLock()
	ids := make([]string, 0, len(m.index))
	for sid := range m.index {
		ids = append(ids, sid)
	}
	m.mu.RUnlock()
	result := make([]*SessionData, 0, len(ids))
	stale := []string{}
	for _, sid := range ids {
		sd, err := m.Get(ctx, sid)
		if err != nil {
			stale = append(stale, sid)
			continue
		}
		result = append(result, sd)
	}
	if len(stale) > 0 {
		m.mu.Lock()
		for _, sid := range stale {
			delete(m.index, sid)
		}
		m.mu.Unlock()
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result
}

// Count 当前在线数（与 ListAll 同步剔除过期会话）
func (m *Manager) Count(ctx context.Context) int {
	return len(m.ListAll(ctx))
}

func (m *Manager) TTL() time.Duration { return m.ttl }
