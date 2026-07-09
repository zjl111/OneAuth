package main

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"sso-server/internal/model"
)

func main() {
	db, err := gorm.Open(sqlite.Open("./data/sso.db"), &gorm.Config{})
	if err != nil {
		panic(err)
	}

	now := time.Now()
	rng := rand.New(rand.NewSource(42))

	provinces := []string{"广东", "北京", "上海", "浙江", "江苏", "四川", "湖北", "山东", "福建", "湖南", "河南", "辽宁", "陕西", "云南", "贵州"}
	cities := map[string][]string{
		"广东": {"广州", "深圳", "东莞", "佛山"}, "北京": {"北京"}, "上海": {"上海"},
		"浙江": {"杭州", "宁波", "温州"}, "江苏": {"南京", "苏州", "无锡"},
		"四川": {"成都", "绵阳"}, "湖北": {"武汉", "宜昌"}, "山东": {"济南", "青岛"},
		"福建": {"福州", "厦门"}, "湖南": {"长沙", "株洲"}, "河南": {"郑州", "洛阳"},
		"辽宁": {"沈阳", "大连"}, "陕西": {"西安", "咸阳"}, "云南": {"昆明", "大理"},
		"贵州": {"贵阳", "遵义"},
	}

	// 从数据库读取真实用户
	type userRow struct {
		Username string
		Nickname string
	}
	var realUsers []userRow
	db.Table("sso_user").
		Select("username, nickname").
		Where("is_active = ?", true).
		Scan(&realUsers)

	if len(realUsers) == 0 {
		fmt.Println("ERROR: no active users found in sso_user table.")
		return
	}
	fmt.Printf("Found %d real users\n", len(realUsers))
	usernames := make([]string, len(realUsers))
	for i, u := range realUsers {
		usernames[i] = u.Username
	}

	// 从数据库读取真实的 OAuth2 客户端（排除 sso-admin）
	type clientRow struct {
		ClientID   string
		ClientName string
		LogoURL    string
	}
	var realClients []clientRow
	db.Table("sso_oauth2_client").
		Select("client_id, client_name, logo_url").
		Where("client_id <> ?", "sso-admin").
		Scan(&realClients)

	if len(realClients) == 0 {
		fmt.Println("ERROR: no OAuth2 clients found in database. Start the server first to run seed.")
		return
	}
	fmt.Printf("Found %d real clients:\n", len(realClients))
	for _, c := range realClients {
		fmt.Printf("  %s -> %s\n", c.ClientID, c.ClientName)
	}

	// 清理旧数据
	db.Exec("DELETE FROM sso_login_log")
	db.Exec("DELETE FROM sso_access_log")

	// ── 1) 生成过去 30 天的登录日志 ──────────────────────────────────────
	fmt.Println("\nGenerating login logs (30 days)...")
	var loginLogs []model.LoginLog
	for day := 29; day >= 0; day-- {
		dayStart := now.Truncate(24*time.Hour).AddDate(0, 0, -day)
		// 每天的基础量：工作日多、周末少
		weekday := dayStart.Weekday()
		isWeekend := weekday == time.Saturday || weekday == time.Sunday
		baseSuccess := 80
		baseFail := 8
		if isWeekend {
			baseSuccess = 30
			baseFail = 3
		}
		// 越近的日子数据越多（模拟增长趋势）
		growthFactor := 1.0 + float64(29-day)*0.02
		successCount := int(float64(baseSuccess+rng.Intn(40)) * growthFactor)
		failCount := baseFail + rng.Intn(6)

		for i := 0; i < successCount; i++ {
			u := usernames[rng.Intn(len(usernames))]
			prov := provinces[rng.Intn(len(provinces))]
			cityList := cities[prov]
			city := cityList[rng.Intn(len(cityList))]
			hour := rng.Intn(24)
			minute := rng.Intn(60)
			sec := rng.Intn(60)
			ts := dayStart.Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute + time.Duration(sec)*time.Second)
			loginLogs = append(loginLogs, model.LoginLog{
				Username:  u,
				IPAddress: fmt.Sprintf("192.168.%d.%d", rng.Intn(256), rng.Intn(256)),
				Province:  prov,
				City:      city,
				ISP:       "中国电信",
				UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
				Browser:   "Chrome",
				OS:        "Windows",
				Method:    "password",
				Status:    "success",
				Message:   "登录成功",
				CreatedAt: ts,
			})
		}
		for i := 0; i < failCount; i++ {
			u := usernames[rng.Intn(len(usernames))]
			hour := rng.Intn(24)
			minute := rng.Intn(60)
			sec := rng.Intn(60)
			ts := dayStart.Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute + time.Duration(sec)*time.Second)
			loginLogs = append(loginLogs, model.LoginLog{
				Username:  u,
				IPAddress: fmt.Sprintf("10.0.%d.%d", rng.Intn(256), rng.Intn(256)),
				Province:  provinces[rng.Intn(len(provinces))],
				City:      "",
				ISP:       "",
				UserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/17.0",
				Browser:   "Safari",
				OS:        "macOS",
				Method:    "password",
				Status:    "failure",
				Message:   "密码错误",
				CreatedAt: ts,
			})
		}
	}
	for i := 0; i < len(loginLogs); i += 200 {
		end := i + 200
		if end > len(loginLogs) {
			end = len(loginLogs)
		}
		batch := loginLogs[i:end]
		db.Create(&batch)
	}
	fmt.Printf("  Inserted %d login logs\n", len(loginLogs))

	// ── 2) 生成过去 30 天的访问日志（使用真实 client_id） ──────────────
	fmt.Println("Generating access logs (30 days)...")
	var accessLogs []model.AccessLog
	for day := 29; day >= 0; day-- {
		dayStart := now.Truncate(24*time.Hour).AddDate(0, 0, -day)
		weekday := dayStart.Weekday()
		isWeekend := weekday == time.Saturday || weekday == time.Sunday
		baseCount := 120
		if isWeekend {
			baseCount = 40
		}
		growthFactor := 1.0 + float64(29-day)*0.015
		count := int(float64(baseCount+rng.Intn(60)) * growthFactor)

		for i := 0; i < count; i++ {
			u := usernames[rng.Intn(len(usernames))]
			client := realClients[rng.Intn(len(realClients))]
			prov := provinces[rng.Intn(len(provinces))]
			cityList := cities[prov]
			city := cityList[rng.Intn(len(cityList))]
			hour := rng.Intn(24)
			minute := rng.Intn(60)
			sec := rng.Intn(60)
			ts := dayStart.Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute + time.Duration(sec)*time.Second)
			accessLogs = append(accessLogs, model.AccessLog{
				Username:   u,
				ClientID:   client.ClientID,
				ClientName: client.ClientName,
				IPAddress:  fmt.Sprintf("192.168.%d.%d", rng.Intn(256), rng.Intn(256)),
				Province:   prov,
				City:       city,
				ISP:        "中国电信",
				CreatedAt:  ts,
			})
		}
	}
	for i := 0; i < len(accessLogs); i += 200 {
		end := i + 200
		if end > len(accessLogs) {
			end = len(accessLogs)
		}
		batch := accessLogs[i:end]
		db.Create(&batch)
	}
	fmt.Printf("  Inserted %d access logs\n", len(accessLogs))

	// ── 3) 暴力破解数据 ──────────────────────────────────────────────
	bruteUser := realUsers[rng.Intn(len(realUsers))]
	fmt.Printf("Generating brute force data for %s...\n", bruteUser.Username)
	var bruteLogs []model.LoginLog
	for i := 0; i < 8; i++ {
		ts := now.Add(-time.Duration(rng.Intn(120)) * time.Minute)
		bruteLogs = append(bruteLogs, model.LoginLog{
			Username:  bruteUser.Username,
			IPAddress: "182.92.xx.xx",
			Province:  "广东",
			City:      "深圳",
			ISP:       "中国联通",
			UserAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0",
			Browser:   "Firefox",
			OS:        "Linux",
			Method:    "password",
			Status:    "failure",
			Message:   "密码错误",
			CreatedAt: ts,
		})
	}
	db.Create(&bruteLogs)
	fmt.Printf("  Inserted %d brute force logs\n", len(bruteLogs))

	// ── 4) 异地登录 ─────────────────────────────────────────────────
	locUser := realUsers[rng.Intn(len(realUsers))]
	fmt.Printf("Generating unusual location data for %s...\n", locUser.Username)
	locationProvs := []string{"北京", "广东", "上海"}
	for _, prov := range locationProvs {
		cityList := cities[prov]
		ts := now.Add(-time.Duration(rng.Intn(300)) * time.Minute)
		db.Create(&model.LoginLog{
			Username:  locUser.Username,
			IPAddress: fmt.Sprintf("192.168.1.%d", rng.Intn(256)),
			Province:  prov,
			City:      cityList[0],
			ISP:       "中国电信",
			UserAgent: "Mozilla/5.0 Chrome/120.0",
			Browser:   "Chrome",
			OS:        "Windows",
			Method:    "password",
			Status:    "success",
			Message:   "登录成功",
			CreatedAt: ts,
		})
	}
	fmt.Println("  Inserted unusual location logs")

	fmt.Println("\nDone! Refresh the dashboard to see the data.")
}
