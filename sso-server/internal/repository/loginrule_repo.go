package repository

import (
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

type LoginRuleRepository struct{ db *gorm.DB }

func NewLoginRuleRepository(db *gorm.DB) *LoginRuleRepository { return &LoginRuleRepository{db: db} }

func (r *LoginRuleRepository) List() ([]model.LoginRule, error) {
	var items []model.LoginRule
	err := r.db.Order("priority ASC, created_at DESC").Find(&items).Error
	return items, err
}

func (r *LoginRuleRepository) Get(id uuid.UUID) (*model.LoginRule, error) {
	var rule model.LoginRule
	if err := r.db.First(&rule, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &rule, nil
}

func (r *LoginRuleRepository) Create(rule *model.LoginRule) error { return r.db.Create(rule).Error }

func (r *LoginRuleRepository) Update(rule *model.LoginRule) error { return r.db.Save(rule).Error }

func (r *LoginRuleRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&model.LoginRule{}, "id = ?", id).Error
}

func (r *LoginRuleRepository) SetEnabled(id uuid.UUID, enabled bool) error {
	return r.db.Model(&model.LoginRule{}).
		Where("id = ?", id).
		Update("enabled", enabled).Error
}

// Evaluate 按 priority 升序匹配，首条命中决定 accept/deny；
// 没有任何启用规则命中则默认放行（accept）。
// userID 可为 uuid.Nil（如登录失败前无法确定身份时），此时 specific 范围规则不参与匹配。
func (r *LoginRuleRepository) Evaluate(userID uuid.UUID, ip string, at time.Time) (allowed bool, hit *model.LoginRule) {
	var rules []model.LoginRule
	if err := r.db.Where("enabled = ?", true).Order("priority ASC, created_at ASC").Find(&rules).Error; err != nil {
		return true, nil
	}
	for i := range rules {
		rule := &rules[i]
		if !ruleMatches(rule, userID, ip, at) {
			continue
		}
		return rule.Action == "accept", rule
	}
	return true, nil
}

func ruleMatches(rule *model.LoginRule, userID uuid.UUID, ip string, at time.Time) bool {
	// 用户范围
	switch rule.UserScope {
	case "specific":
		if userID == uuid.Nil {
			return false
		}
		uidStr := userID.String()
		hit := false
		for _, u := range rule.UserIDs {
			if u == uidStr {
				hit = true
				break
			}
		}
		if !hit {
			return false
		}
	default: // "all" or unset
	}

	// IP 匹配
	if !matchIPs(rule.IPs, ip) {
		return false
	}

	// 时段
	if !matchTimeMask(rule.TimeMask, at) {
		return false
	}
	return true
}

func matchIPs(list model.StringSlice, ip string) bool {
	if len(list) == 0 {
		return true
	}
	parsed := net.ParseIP(ip)
	for _, entry := range list {
		entry = strings.TrimSpace(entry)
		if entry == "*" || entry == "" {
			return true
		}
		if strings.Contains(entry, "/") {
			_, cidr, err := net.ParseCIDR(entry)
			if err == nil && parsed != nil && cidr.Contains(parsed) {
				return true
			}
			continue
		}
		if strings.Contains(entry, "-") {
			// 区间 1.1.1.1-1.1.1.10
			parts := strings.SplitN(entry, "-", 2)
			if len(parts) == 2 {
				lo := net.ParseIP(strings.TrimSpace(parts[0]))
				hi := net.ParseIP(strings.TrimSpace(parts[1]))
				if lo != nil && hi != nil && parsed != nil && bytesBetween(parsed, lo, hi) {
					return true
				}
			}
			continue
		}
		if entry == ip {
			return true
		}
	}
	return false
}

func bytesBetween(target, lo, hi net.IP) bool {
	t := target.To16()
	l := lo.To16()
	h := hi.To16()
	if t == nil || l == nil || h == nil {
		return false
	}
	return string(t) >= string(l) && string(t) <= string(h)
}

// matchTimeMask 全 '0' 或空 = 全时段允许
func matchTimeMask(mask string, at time.Time) bool {
	if mask == "" {
		return true
	}
	if !strings.Contains(mask, "1") {
		return true
	}
	// weekday: 周一=0 … 周日=6
	wd := int(at.Weekday())
	if wd == 0 {
		wd = 6 // 周日
	} else {
		wd = wd - 1
	}
	idx := wd*24 + at.Hour()
	if idx < 0 || idx >= len(mask) {
		return false
	}
	return mask[idx] == '1'
}
