package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// SecretCipher 用 AES-GCM 对配置类密钥（如企业微信通讯录 Secret、桥接 API Key）
// 做信封加密后落库，避免明文写入数据库。密钥由 app.secret_key 经 SHA-256 派生为 32 字节。
//
// 密文格式： enc:v1:<base64(nonce || ciphertext)>
// 解密时若值不以 "enc:v1:" 开头，视为历史明文（向后兼容），原样返回。
type SecretCipher struct {
	key []byte
}

const encPrefix = "enc:v1:"

// NewSecretCipher 由主密钥（app.secret_key）派生 AES 密钥。master 为空时返回错误，
// 调用方应据此决定是否降级为明文存储（而不是让进程崩溃）。
func NewSecretCipher(master string) (*SecretCipher, error) {
	if strings.TrimSpace(master) == "" {
		return nil, errors.New("主密钥为空，无法派生加密密钥")
	}
	sum := sha256.Sum256([]byte(master))
	return &SecretCipher{key: sum[:]}, nil
}

// IsEncrypted 判断一个存储值是否已被本工具加密。
func IsEncrypted(v string) bool {
	return strings.HasPrefix(v, encPrefix)
}

// EncryptSecret 加密明文；plaintext 为空时直接返回空串（不加密空值）。
func (c *SecretCipher) EncryptSecret(plaintext string) (string, error) {
	if c == nil {
		return plaintext, nil
	}
	if strings.TrimSpace(plaintext) == "" {
		return "", nil
	}
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	buf := append(nonce, sealed...)
	return encPrefix + base64.StdEncoding.EncodeToString(buf), nil
}

// DecryptSecret 解密密文；若值非本工具加密（历史明文），原样返回。
func (c *SecretCipher) DecryptSecret(value string) (string, error) {
	if c == nil {
		return value, nil
	}
	if !strings.HasPrefix(value, encPrefix) {
		return value, nil
	}
	b64 := strings.TrimPrefix(value, encPrefix)
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	ns := gcm.NonceSize()
	if len(raw) < ns {
		return "", errors.New("密文长度不足")
	}
	nonce, sealed := raw[:ns], raw[ns:]
	plain, err := gcm.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
