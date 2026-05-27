package model

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
)

// StringSlice 实现 JSON 序列化的字符串数组（支持 JSONB / TEXT 存储）
type StringSlice []string

func (s StringSlice) Value() (driver.Value, error) {
	if s == nil {
		return "[]", nil
	}
	b, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (s *StringSlice) Scan(value interface{}) error {
	if value == nil {
		*s = StringSlice{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("unsupported type for StringSlice")
	}
	if len(bytes) == 0 {
		*s = StringSlice{}
		return nil
	}
	return json.Unmarshal(bytes, s)
}

func (s StringSlice) Contains(v string) bool {
	for _, item := range s {
		if item == v {
			return true
		}
	}
	return false
}
