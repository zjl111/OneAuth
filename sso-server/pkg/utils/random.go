package utils

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
)

func RandomBytes(n int) []byte {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return b
}

func RandomString(n int) string {
	return base64.RawURLEncoding.EncodeToString(RandomBytes(n))
}

func RandomHex(n int) string {
	return hex.EncodeToString(RandomBytes(n))
}
