// 仪表盘假数据填充器：往本地 SQLite（默认 ./data/sso.db）里塞 30 天的
// LoginLog / AccessLog / OperationLog，让仪表盘所有图表都有真实形状的数据。
//
// 用法（在 sso-server 目录下）：
//   go run ./cmd/seed-fake                    # 默认 30 天
//   go run ./cmd/seed-fake --days 30 --reset  # 先清掉旧假数据
package main

import (
	"flag"
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"sso-server/internal/model"
	"sso-server/internal/repository"
)

// 省份名 + 期望的日均 PV（决定颜色档位 1-100 / 101-300 / 301-500 / 501-1000 / 1001-2000 / 2000+）
type provincePlan struct {
	Name        string
	DailyAvgPV  int // 每日大约 PV
	JitterRange int // PV 抖动幅度
}

var plan = []provincePlan{
	// 2000+ 档
	{"广东", 90, 30},  // 30 天 ~2700
	{"江苏", 80, 25},  // ~2400
	// 1001 - 2000
	{"浙江", 55, 20}, // ~1650
	{"北京", 50, 15}, // ~1500
	{"上海", 45, 15}, // ~1350
	// 501 - 1000
	{"山东", 28, 8},
	{"四川", 25, 8},
	{"湖北", 22, 7},
	// 301 - 500
	{"福建", 14, 5},
	{"湖南", 13, 4},
	{"河南", 12, 4},
	{"安徽", 11, 4},
	// 101 - 300
	{"河北", 9, 3},
	{"辽宁", 8, 2},
	{"陕西", 7, 2},
	{"江西", 6, 2},
	{"广西", 5, 2},
	{"重庆", 5, 2},
	{"云南", 4, 2},
	// 1 - 100
	{"贵州", 2, 1},
	{"山西", 2, 1},
	{"黑龙江", 2, 1},
	{"吉林", 2, 1},
	{"内蒙古", 1, 1},
	{"甘肃", 1, 1},
	{"新疆", 1, 1},
	{"海南", 1, 1},
	{"宁夏", 1, 1},
	{"青海", 1, 1},
	{"天津", 2, 1},
	{"西藏", 1, 1},
	{"香港", 1, 1},
	{"澳门", 1, 1},
	{"台湾", 1, 1},
}

// 应用列表（与 seed.go demo 应用一致）
var demoApps = []struct{ ClientID, Name string }{
	{"demo-oa", "OA 演示"},
	{"demo-mail", "邮件演示"},
	{"demo-files", "文件演示"},
	{"demo-monitor", "监控演示"},
	{"demo-blog", "博客演示"},
	{"demo-cms", "CMS 演示"},
	{"demo-shop", "商城演示"},
	{"demo-meet", "会议演示"},
}

var loginMethods = []string{"password", "password", "password", "oauth_code", "oauth_code", "refresh_token"}

var browsers = []string{"Chrome", "Edge", "Safari", "Firefox"}
var oses = []string{"macOS", "Windows", "Linux", "iOS", "Android"}

func main() {
	dbPath := flag.String("db", "./data/sso.db", "sqlite path")
	days := flag.Int("days", 30, "how many days back")
	reset := flag.Bool("reset", false, "clear sso_login_log / sso_access_log first")
	flag.Parse()

	db, err := gorm.Open(sqlite.Open(*dbPath), &gorm.Config{})
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	if err := repository.AutoMigrate(db); err != nil {
		log.Fatalf("automigrate: %v", err)
	}

	if *reset {
		log.Println("[seed-fake] truncating login/access/operation logs ...")
		db.Exec("DELETE FROM sso_login_log")
		db.Exec("DELETE FROM sso_access_log")
		db.Exec("DELETE FROM sso_operation_log")
	}

	// 取个真实用户作为 user_id 关联（用 admin / jinli）
	var users []model.User
	db.Where("username IN (?)", []string{"admin", "jinli"}).Find(&users)
	if len(users) == 0 {
		log.Fatalf("no admin/jinli user found, run server first to seed users")
	}

	now := time.Now()
	rand.Seed(now.UnixNano())

	totalLogin := 0
	totalAccess := 0

	for _, p := range plan {
		for d := 0; d < *days; d++ {
			day := now.AddDate(0, 0, -d)
			// 当日 PV = 平均 + 抖动
			dailyPV := p.DailyAvgPV + rand.Intn(p.JitterRange*2+1) - p.JitterRange
			if dailyPV < 0 {
				dailyPV = 0
			}

			// 30% 进 login_log（其余进 access_log），凑齐"省份访问"统计
			loginCount := dailyPV * 30 / 100
			accessCount := dailyPV - loginCount

			ip := fakeIP()
			for i := 0; i < loginCount; i++ {
				u := users[rand.Intn(len(users))]
				ts := day.Add(time.Duration(rand.Intn(86400)) * time.Second)
				db.Create(&model.LoginLog{
					UserID:    &u.ID,
					Username:  u.Username,
					IPAddress: ip,
					Province:  p.Name,
					Location:  p.Name + " - 虚构",
					UserAgent: "FakeSeed/1.0",
					Browser:   browsers[rand.Intn(len(browsers))],
					OS:        oses[rand.Intn(len(oses))],
					Method:    loginMethods[rand.Intn(len(loginMethods))],
					Status:    "success",
					Message:   "",
					CreatedAt: ts,
				})
				totalLogin++
			}

			for i := 0; i < accessCount; i++ {
				u := users[rand.Intn(len(users))]
				ts := day.Add(time.Duration(rand.Intn(86400)) * time.Second)
				app := demoApps[rand.Intn(len(demoApps))]
				db.Create(&model.AccessLog{
					UserID:     &u.ID,
					Username:   u.Username,
					ClientID:   app.ClientID,
					ClientName: app.Name,
					IPAddress:  ip,
					Province:   p.Name,
					CreatedAt:  ts,
				})
				totalAccess++
			}
		}
	}

	// 顺便造一些操作日志，让"最近操作"有内容
	ops := []struct{ Action, Resource, Desc string }{
		{"create", "user", "新增用户 alice"},
		{"update", "user", "更新用户 bob 资料"},
		{"create", "client", "创建应用 demo-newapp"},
		{"delete", "role", "删除角色 reporter"},
		{"update", "client", "更新应用 demo-oa 的回调地址"},
		{"reset_password", "user", "重置用户 charlie 密码"},
		{"login", "session", "登录系统"},
		{"logout", "session", "退出登录"},
	}
	for i := 0; i < 30; i++ {
		o := ops[rand.Intn(len(ops))]
		u := users[rand.Intn(len(users))]
		ts := now.Add(-time.Duration(rand.Intn(*days*24)) * time.Hour)
		db.Create(&model.OperationLog{
			UserID:       &u.ID,
			Username:     u.Username,
			Action:       o.Action,
			ResourceType: o.Resource,
			ResourceID:   uuid.New().String(),
			Description:  o.Desc,
			IPAddress:    fakeIP(),
			Status:       200,
			CreatedAt:    ts,
		})
	}

	fmt.Printf("\n[seed-fake] done.\n  login_log:     +%d\n  access_log:    +%d\n  operation_log: +30\n", totalLogin, totalAccess)
	fmt.Printf("  spread across %d provinces over last %d days.\n", len(plan), *days)
}

func fakeIP() string {
	return fmt.Sprintf("%d.%d.%d.%d", rand.Intn(223)+1, rand.Intn(255), rand.Intn(255), rand.Intn(254)+1)
}
