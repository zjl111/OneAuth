package oauth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type KeyManager struct {
	privateKey *rsa.PrivateKey
	publicKey  *rsa.PublicKey
	kid        string
	mu         sync.RWMutex
}

func NewKeyManager(keysDir string) (*KeyManager, error) {
	km := &KeyManager{}
	if err := os.MkdirAll(keysDir, 0755); err != nil {
		return nil, fmt.Errorf("create keys dir: %w", err)
	}
	privPath := filepath.Join(keysDir, "private.pem")
	if _, err := os.Stat(privPath); os.IsNotExist(err) {
		if err := km.generateAndSave(keysDir); err != nil {
			return nil, fmt.Errorf("generate keys: %w", err)
		}
	} else {
		if err := km.loadFromDisk(keysDir); err != nil {
			return nil, fmt.Errorf("load keys: %w", err)
		}
	}
	return km, nil
}

func (km *KeyManager) generateAndSave(keysDir string) error {
	// 开发环境使用 2048 加速生成，生产建议 4096
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return err
	}

	privFile, err := os.OpenFile(filepath.Join(keysDir, "private.pem"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer privFile.Close()
	if err := pem.Encode(privFile, &pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	}); err != nil {
		return err
	}

	pubBytes, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return err
	}
	pubFile, err := os.OpenFile(filepath.Join(keysDir, "public.pem"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer pubFile.Close()
	if err := pem.Encode(pubFile, &pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubBytes,
	}); err != nil {
		return err
	}

	km.privateKey = key
	km.publicKey = &key.PublicKey
	km.kid = computeKID(&key.PublicKey)
	return nil
}

func (km *KeyManager) loadFromDisk(keysDir string) error {
	privPEM, err := os.ReadFile(filepath.Join(keysDir, "private.pem"))
	if err != nil {
		return err
	}
	block, _ := pem.Decode(privPEM)
	if block == nil {
		return fmt.Errorf("invalid private key PEM")
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		// 尝试 PKCS8
		k2, e2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if e2 != nil {
			return err
		}
		var ok bool
		key, ok = k2.(*rsa.PrivateKey)
		if !ok {
			return fmt.Errorf("not an RSA key")
		}
	}
	km.privateKey = key
	km.publicKey = &key.PublicKey
	km.kid = computeKID(&key.PublicKey)
	return nil
}

func computeKID(pub *rsa.PublicKey) string {
	h := sha256.Sum256(pub.N.Bytes())
	return base64.RawURLEncoding.EncodeToString(h[:8])
}

func (km *KeyManager) PrivateKey() *rsa.PrivateKey { km.mu.RLock(); defer km.mu.RUnlock(); return km.privateKey }
func (km *KeyManager) PublicKey() *rsa.PublicKey   { km.mu.RLock(); defer km.mu.RUnlock(); return km.publicKey }
func (km *KeyManager) KID() string                 { km.mu.RLock(); defer km.mu.RUnlock(); return km.kid }
