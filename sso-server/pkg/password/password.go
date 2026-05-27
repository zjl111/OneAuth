package password

import (
	"errors"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

const Cost = 12

func Hash(plain string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(plain), Cost)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func Verify(hashed, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(plain)) == nil
}

// Validate 检查密码是否满足策略：≥8 位，字母+数字至少 2 类
func Validate(p string) error {
	if len(p) < 8 {
		return errors.New("密码长度至少 8 位")
	}
	var hasLower, hasUpper, hasDigit, hasSpecial bool
	for _, r := range p {
		switch {
		case unicode.IsLower(r):
			hasLower = true
		case unicode.IsUpper(r):
			hasUpper = true
		case unicode.IsDigit(r):
			hasDigit = true
		case unicode.IsPunct(r) || unicode.IsSymbol(r):
			hasSpecial = true
		}
	}
	categories := 0
	for _, b := range []bool{hasLower, hasUpper, hasDigit, hasSpecial} {
		if b {
			categories++
		}
	}
	if categories < 2 {
		return errors.New("密码至少包含两类字符（大写/小写/数字/特殊字符）")
	}
	return nil
}
