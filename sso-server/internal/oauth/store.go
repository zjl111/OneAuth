package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Store 抽象 K/V 存储（同时支持 Redis 与内存）
type Store interface {
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Get(ctx context.Context, key string) ([]byte, error)
	Del(ctx context.Context, keys ...string) error
	Incr(ctx context.Context, key string, ttl time.Duration) (int64, error)
}

var ErrNotFound = errors.New("not found")

// RedisStore 基于 Redis
type RedisStore struct{ rdb *redis.Client }

func NewRedisStore(rdb *redis.Client) *RedisStore { return &RedisStore{rdb: rdb} }

func (s *RedisStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return s.rdb.Set(ctx, key, value, ttl).Err()
}

func (s *RedisStore) Get(ctx context.Context, key string) ([]byte, error) {
	v, err := s.rdb.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, ErrNotFound
	}
	return v, err
}

func (s *RedisStore) Del(ctx context.Context, keys ...string) error {
	return s.rdb.Del(ctx, keys...).Err()
}

func (s *RedisStore) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	pipe := s.rdb.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, err
	}
	return incr.Val(), nil
}

// MemoryStore 内存 K/V（开发模式）
type MemoryStore struct {
	mu   sync.RWMutex
	data map[string]memEntry
}

type memEntry struct {
	value     []byte
	expiresAt time.Time
}

func NewMemoryStore() *MemoryStore {
	s := &MemoryStore{data: make(map[string]memEntry)}
	go s.gc()
	return s
}

func (s *MemoryStore) gc() {
	t := time.NewTicker(30 * time.Second)
	for range t.C {
		s.mu.Lock()
		now := time.Now()
		for k, v := range s.data {
			if !v.expiresAt.IsZero() && now.After(v.expiresAt) {
				delete(s.data, k)
			}
		}
		s.mu.Unlock()
	}
}

func (s *MemoryStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var exp time.Time
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	s.data[key] = memEntry{value: value, expiresAt: exp}
	return nil
}

func (s *MemoryStore) Get(ctx context.Context, key string) ([]byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.data[key]
	if !ok {
		return nil, ErrNotFound
	}
	if !v.expiresAt.IsZero() && time.Now().After(v.expiresAt) {
		return nil, ErrNotFound
	}
	return v.value, nil
}

func (s *MemoryStore) Del(ctx context.Context, keys ...string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, k := range keys {
		delete(s.data, k)
	}
	return nil
}

func (s *MemoryStore) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.data[key]
	var n int64
	if ok {
		if err := json.Unmarshal(v.value, &n); err != nil {
			n = 0
		}
	}
	n++
	b, _ := json.Marshal(n)
	exp := time.Now().Add(ttl)
	s.data[key] = memEntry{value: b, expiresAt: exp}
	return n, nil
}
