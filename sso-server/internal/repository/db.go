package repository

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"sso-server/internal/config"
	"sso-server/internal/geoip"
	"sso-server/internal/model"
)

func NewDB(cfg *config.Config) (*gorm.DB, error) {
	var dial gorm.Dialector
	switch cfg.App.Driver {
	case "postgres":
		dsn := fmt.Sprintf(
			"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=Asia/Shanghai",
			cfg.Database.Host, cfg.Database.Port, cfg.Database.User,
			cfg.Database.Password, cfg.Database.DBName, cfg.Database.SSLMode,
		)
		dial = postgres.Open(dsn)
	default:
		path := cfg.Database.SQLitePath
		if path == "" {
			path = "./data/sso.db"
		}
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			return nil, err
		}
		// _pragma=busy_timeout(5000)：锁冲突时等待 5 秒而非立刻 SQLITE_BUSY。
		// 配合 WAL 模式（下方手动 PRAGMA），读写不再互相阻塞。
		dial = sqlite.Open(path + "?_pragma=busy_timeout(5000)")
	}

	logLevel := logger.Warn
	if cfg.App.Environment == "development" {
		logLevel = logger.Info
	}

	db, err := gorm.Open(dial, &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	})
	if err != nil {
		return nil, err
	}

	if cfg.App.Driver != "postgres" {
		// WAL 模式：读操作不阻塞写操作，大幅缓解 SQLITE_BUSY。
		// busy_timeout 已在 DSN pragma 中设置（5 秒）。
		if err := db.Exec("PRAGMA journal_mode = WAL;").Error; err != nil {
			log.Printf("[db] 启用 WAL 失败: %v", err)
		}
	}

	if cfg.App.Driver == "postgres" {
		sqlDB, _ := db.DB()
		sqlDB.SetMaxOpenConns(cfg.Database.MaxOpenConns)
		sqlDB.SetMaxIdleConns(cfg.Database.MaxIdleConns)
	} else {
		// SQLite：单写锁模型，必须启用 WAL 让读不阻塞写，并设置 busy_timeout
		// 让锁冲突时自动等待而非立刻 SQLITE_BUSY；连接池限制为 1 写连接避免自锁。
		sqlDB, _ := db.DB()
		sqlDB.SetMaxOpenConns(1)
		sqlDB.SetMaxIdleConns(1)
	}

	return db, nil
}

func AutoMigrate(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&model.Department{},
		&model.User{},
		&model.Role{},
		&model.Permission{},
		&model.UserGroup{},
		&model.OAuth2Client{},
		&model.OAuth2Token{},
		&model.AuthorizationGrant{},
		&model.LoginLog{},
		&model.OperationLog{},
		&model.AccessLog{},
		&model.SystemConfig{},
		&model.Dictionary{},
		&model.IPAccess{},
		&model.LoginRule{},
		&model.AppGrant{},
		&model.AppMonitor{},
		&model.StatusProbe{},
		&model.StatusDaily{},
		&model.Incident{},
		&model.DirectorySyncBinding{},
		&model.DirectorySyncLog{},
		&model.DirectorySyncBuffer{},
		&model.AccountRecoveryRule{},
		&model.AccountRecoveryLog{},
		&model.AccountReconciliation{},
	); err != nil {
		return err
	}
	// 旧表的 NOT NULL 约束需要手动 drop（GORM AutoMigrate 不会主动放宽约束）
	// link 协议不需要 redirect_uris/grant_types/response_types
	for _, col := range []string{"redirect_uris", "grant_types", "response_types"} {
		db.Exec("ALTER TABLE sso_oauth2_client ALTER COLUMN " + col + " DROP NOT NULL")
	}
	runOnce(db, "backfill_health_check_urls_v1", func() { backfillHealthCheckURLs(db) })
	runOnce(db, "migrate_access_policy_v1", func() { migrateAccessPolicy(db) })
	runOnce(db, "purge_soft_deleted_users_v1", func() { purgeSoftDeletedUsers(db) })
	runOnce(db, "dedupe_user_group_members_v1", func() { dedupeUserGroupMembers(db) })
	runOnce(db, "prune_orphan_user_group_members_v1", func() { pruneOrphanUserGroupMembers(db) })
	runOnce(db, "migrate_user_source_v1", func() { migrateUserSource(db) })
	runOnce(db, "migrate_buffer_ext_idx_v1", func() { migrateBufferExtIdx(db) })
	runOnce(db, "revert_buffer_ext_idx_v1", func() { revertBufferExtIdx(db) })
	// 独立迁移：确保缓冲表的 external_id 索引被彻底清理（清重复行 + DROP 所有 external_id 索引）。
	// 用独立迁移名而非复用 revert_buffer_ext_idx_v1，避免旧库已标 done 导致本逻辑不再执行。
	runOnce(db, "drop_buf_ext_unique_v1", func() { dropBufferExtUnique(db) })
	return nil
}

// purgeSoftDeletedUsers 历史上 User 有 DeletedAt 字段、走软删；现在改为物理删除。
// 启动时把残留的 deleted_at IS NOT NULL 行（"幽灵行"）真删掉，否则它们仍占用
// username/email/phone 的 UNIQUE 索引，导致管理员重新创建同名用户报"已存在"。
// 同时清掉这些用户的 sso_user_roles 关联行，避免成为孤儿。
// 在 deleted_at 列被 DROP 之前必须先跑（DROP COLUMN 之后这条 WHERE 就找不到列了）。
func purgeSoftDeletedUsers(db *gorm.DB) {
	// 列不存在就跳过（model 改完后第一次启动时列还在；DROP 之后这里就该跳过）
	if !db.Migrator().HasColumn("sso_user", "deleted_at") {
		return
	}
	type row struct{ ID string }
	var rows []row
	if err := db.Raw(`SELECT id FROM sso_user WHERE deleted_at IS NOT NULL`).Scan(&rows).Error; err != nil {
		return
	}
	if len(rows) == 0 {
		return
	}
	ids := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	db.Exec(`DELETE FROM sso_user_roles WHERE user_id IN ?`, ids)
	db.Exec(`DELETE FROM sso_user WHERE deleted_at IS NOT NULL`)
	// 列本身 GORM AutoMigrate 不会主动 DROP（怕误删），手工 DROP 一次。
	// 失败也无所谓 —— 留着不影响功能，下次启动 HasColumn 仍 true 会再尝试。
	db.Exec(`ALTER TABLE sso_user DROP COLUMN deleted_at`)
}

// migrateBufferExtIdx 把 sso_directory_sync_buffer 的外部唯一约束从「单列 external_id」
// 改为「复合 (provider, external_id)」。
// 背景：不同平台（wecom 企业微信通讯录 / wecom_attendance 考勤桥接）可能复用同一批员工
// userid，旧单列唯一索引会让跨平台缓冲插入报 2067 UNIQUE 约束冲突。GORM AutoMigrate 不会
// 主动 DROP 旧唯一索引，这里手工删一次。新复合索引由模型 tag 在 AutoMigrate 中创建。
func migrateBufferExtIdx(db *gorm.DB) {
	// 删除旧的单列 external_id 唯一索引（若存在）。
	db.Exec(`DROP INDEX IF EXISTS idx_buf_ext`)
	// 若历史残留跨 provider 重复行（理论上不该有，删除旧唯一索引后复合索引可能无法创建），
	// 清理掉同 provider 内重复 external_id 的冗余行，保留最新的一条。
	switch db.Dialector.Name() {
	case "sqlite":
		db.Exec(`
			DELETE FROM sso_directory_sync_buffer
			WHERE id NOT IN (
				SELECT MAX(id) FROM sso_directory_sync_buffer
				GROUP BY provider, external_id
			)
		`)
	default:
		db.Exec(`
			DELETE FROM sso_directory_sync_buffer a
			USING sso_directory_sync_buffer b
			WHERE a.provider = b.provider
			  AND a.external_id = b.external_id
			  AND a.id < b.id
		`)
	}
}

// revertBufferExtIdx 清理 sso_directory_sync_buffer 上所有可能存在的 external_id 索引，
// 并把缓冲表回退到"不依赖数据库唯一约束"的状态。
//
// 背景与教训（关键）：历史版本曾给 external_id 加过单列唯一索引 idx_buf_ext，
// 后又改成复合唯一索引 idx_buf_provider_ext，最终决定**彻底去掉 external_id 的唯一约束**
// （用户明确"平台只可能一个、切换平台时清缓冲"，唯一性交给业务同步链路 seen 去重/导入去重）。
// 期间多次迁移在 AutoMigrate 阶段 CREATE UNIQUE INDEX 时，因缓冲表存在跨 provider 重复
// external_id 而抛 2067，导致服务 migrate 失败、登录全挂。
//
// 本迁移在 AutoMigrate 之后的 runOnce 阶段执行（此时模型已不再声明 external_id 索引），
// 做两件事：
//  1) 清理跨 provider 重复的 external_id 行（保留最新一条），让表数据干净；
//  2) 显式 DROP 掉历史残留的 idx_buf_ext / idx_buf_provider_ext 索引（无论唯一与否），
//     确保数据库层不再有任何 external_id 约束，杜绝 2067。
//
// 注意：idx_buf_provider（provider 普通索引）保留——业务按 provider 清缓冲/导入查询依赖它。
func revertBufferExtIdx(db *gorm.DB) {
	dropBufferExtUnique(db)
}

// dropBufferExtUnique 承载缓冲表 external_id 索引的彻底清理逻辑：
//  1) 清理跨 provider 重复的 external_id 行，保留 id 最大（最新）的一条（避免残留唯一约束/重复数据）；
//  2) 显式 DROP 历史残留的 external_id 索引（单列唯一 idx_buf_ext / 复合唯一 idx_buf_provider_ext），
//     模型已不再声明，AutoMigrate 不会重建。
//
// 用独立迁移名 drop_buf_ext_unique_v1 注册，确保即使旧迁移 revert_buffer_ext_idx_v1
// 已标 done（旧库已执行过），这组清理也一定会执行一次。
func dropBufferExtUnique(db *gorm.DB) {
	// 1) 清理跨 provider 重复的 external_id 行，保留 id 最大（最新）的一条。
	switch db.Dialector.Name() {
	case "sqlite":
		db.Exec(`
			DELETE FROM sso_directory_sync_buffer
			WHERE id NOT IN (
				SELECT MAX(id) FROM sso_directory_sync_buffer
				GROUP BY external_id
			)
		`)
	default:
		db.Exec(`
			DELETE FROM sso_directory_sync_buffer a
			USING sso_directory_sync_buffer b
			WHERE a.external_id = b.external_id
			  AND a.id < b.id
		`)
	}
	// 2) 显式删除历史残留的 external_id 索引（单列唯一 / 复合唯一 / 普通 一并清理），
	//    避免数据库层残留约束导致 2067 或迁移告警。模型已不再声明，AutoMigrate 不会重建。
	db.Exec(`DROP INDEX IF EXISTS idx_buf_ext`)
	db.Exec(`DROP INDEX IF EXISTS idx_buf_provider_ext`)
}
// 第一次执行 fn 后写入 marker，之后启动直接跳过。
// 想强制重跑就 DELETE FROM sso_system_config WHERE category='_migration' AND key=<name>。
func runOnce(db *gorm.DB, name string, fn func()) {
	const cat = "_migration"
	var existing model.SystemConfig
	err := db.Where("category = ? AND key = ?", cat, name).First(&existing).Error
	if err == nil && existing.Value == "done" {
		return
	}
	fn()
	if err == gorm.ErrRecordNotFound {
		db.Create(&model.SystemConfig{Category: cat, Key: name, Value: "done", Description: "迁移完成标记"})
	} else {
		db.Model(&model.SystemConfig{}).
			Where("category = ? AND key = ?", cat, name).
			Update("value", "done")
	}
}

// migrateUserSource 把旧的 user_type（internal/external/wecom/ldap）迁移到新的 user_source（local/platform）。
// 平台同步来的（wecom/ldap）标记为 platform，其余（internal/external/手动创建）标记为 local。
// 在 AutoMigrate 已为模型新增 user_source 列之后执行；user_type 列由本函数手工 DROP（GORM 不会主动删列）。
func migrateUserSource(db *gorm.DB) {
	if !db.Migrator().HasColumn("sso_user", "user_type") {
		return
	}
	type row struct {
		ID       string
		UserType string
	}
	var rows []row
	if err := db.Raw(`SELECT id, user_type FROM sso_user`).Scan(&rows).Error; err != nil {
		return
	}
	for _, r := range rows {
		src := "local"
		if r.UserType == "wecom" || r.UserType == "ldap" {
			src = "platform"
		}
		db.Exec(`UPDATE sso_user SET user_source = ? WHERE id = ?`, src, r.ID)
	}
	// 列本身 GORM AutoMigrate 不会主动 DROP（怕误删），手工 DROP 一次；失败也无所谓（留着不影响功能）。
	db.Exec(`ALTER TABLE sso_user DROP COLUMN user_type`)
}

// migrateAccessPolicy 把旧的 grant_mode (public/user/group/org) 迁移到新的 access_policy (all/assigned/none)
// public         -> all
// user/group/org -> assigned
// 同时把已存在的 grants 应用关联保持不变；新建列 access_policy 默认 'all'
func migrateAccessPolicy(db *gorm.DB) {
	// 旧值映射：public -> all；其他视为 assigned
	db.Exec(`UPDATE sso_oauth2_client SET access_policy = 'all'
	         WHERE COALESCE(access_policy, '') = ''
	           AND COALESCE(grant_mode, '') IN ('', 'public')`)
	db.Exec(`UPDATE sso_oauth2_client SET access_policy = 'assigned'
	         WHERE COALESCE(access_policy, '') = ''
	           AND COALESCE(grant_mode, '') IN ('user', 'group', 'org')`)
}

// dedupeUserGroupMembers 清理历史 many2many 重复关系，并补一个唯一约束，避免成员数和
// 关联数据继续膨胀。旧数据可能因为 AddMember/导入重复执行而写出多行同一关系。
func dedupeUserGroupMembers(db *gorm.DB) {
	switch db.Dialector.Name() {
	case "sqlite":
		db.Exec(`
			DELETE FROM sso_user_group_members
			WHERE rowid NOT IN (
				SELECT MIN(rowid)
				FROM sso_user_group_members
				GROUP BY user_group_id, user_id
			)
		`)
	case "postgres":
		db.Exec(`
			DELETE FROM sso_user_group_members a
			USING sso_user_group_members b
			WHERE a.user_group_id = b.user_group_id
			  AND a.user_id = b.user_id
			  AND a.ctid < b.ctid
		`)
	}
	db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sso_user_group_members_unique
		ON sso_user_group_members (user_group_id, user_id)`)
}

// pruneOrphanUserGroupMembers 清理已经不存在的用户/用户组对应的成员关系。
// 历史上用户物理删除时没有级联清理，导致 sso_user_group_members 里残留大量孤儿行，
// 页面成员数和应用授权判断都会被这些脏数据抬高。
func pruneOrphanUserGroupMembers(db *gorm.DB) {
	switch db.Dialector.Name() {
	case "sqlite":
		db.Exec(`
			DELETE FROM sso_user_group_members
			WHERE user_id NOT IN (SELECT id FROM sso_user)
			   OR user_group_id NOT IN (SELECT id FROM sso_user_group)
		`)
	default:
		db.Exec(`
			DELETE FROM sso_user_group_members m
			WHERE NOT EXISTS (SELECT 1 FROM sso_user u WHERE u.id = m.user_id)
			   OR NOT EXISTS (SELECT 1 FROM sso_user_group g WHERE g.id = m.user_group_id)
		`)
	}
}

// BackfillLogRegion 在 geoip.Init 之后由 main 调用，重算所有缺 city 的日志行。
// 这条不走 runOnce 标记，因为 ip2region 库可能后续更新，下次启动如果检测到坏数据仍需修复。
// 用 LIMIT 200 防止启动时一次扫太多。
func BackfillLogRegion(db *gorm.DB) { backfillLogRegion(db) }

// backfillLogRegion 修复历史登录/访问日志的 province/city/isp。
// 历史问题：旧版本只写 province，但当时 geoip 把直辖市的城市名（如"郑州"）写到了 province 字段。
// 启动时跑一次：把所有 city=” 的行用当前 IP 重新解析一次，填齐三列。
func backfillLogRegion(db *gorm.DB) {
	type row struct {
		Table string
		ID    uint64
		IP    string
	}
	rows := []row{}
	// 包含两种坏数据：城市/运营商位完全没填，或第一轮回填把"移动/电信/CN"写进了 city/isp。
	badCondition := `ip_address <> '' AND (
		COALESCE(city,'') = ''
		OR city IN ('移动','中国移动','联通','中国联通','电信','中国电信','铁通','广电','教育网')
		OR isp IN ('CN','cn')
	)`
	// 每次启动最多处理 200 行；防止历史数据量大时拖慢启动。
	// 剩下的会在后续启动陆续处理掉。
	var login []model.LoginLog
	db.Select("id, ip_address").Where(badCondition).Limit(200).Find(&login)
	for _, l := range login {
		rows = append(rows, row{Table: "sso_login_log", ID: l.ID, IP: l.IPAddress})
	}
	var access []model.AccessLog
	db.Select("id, ip_address").Where(badCondition).Limit(200).Find(&access)
	for _, l := range access {
		rows = append(rows, row{Table: "sso_access_log", ID: l.ID, IP: l.IPAddress})
	}
	if len(rows) == 0 {
		return
	}
	updated := 0
	for _, r := range rows {
		p, c, isp := geoip.Lookup(r.IP)
		if p == "" && c == "" && isp == "" {
			continue
		}
		db.Table(r.Table).Where("id = ?", r.ID).Updates(map[string]any{
			"province": p,
			"city":     c,
			"isp":      isp,
		})
		updated++
	}
	if updated > 0 {
		fmt.Printf("[startup] backfilled region (province/city/isp) for %d log rows\n", updated)
	}
}

// backfillHealthCheckURLs 修复历史数据：把空的 health_check_url 用 login_url/home_url 兜底，
// 然后把客户端表的 health_check_url 同步到 sso_app_monitor 表中空的行。
// 用 ORM 写，避免 PostgreSQL 与 SQLite 的 UPDATE FROM 语法差异。
func backfillHealthCheckURLs(db *gorm.DB) {
	var clients []model.OAuth2Client
	db.Find(&clients)
	for _, c := range clients {
		if c.HealthCheckURL != "" {
			continue
		}
		hc := c.LoginURL
		if hc == "" {
			hc = c.HomeURL
		}
		if hc == "" {
			continue
		}
		db.Model(&model.OAuth2Client{}).Where("client_id = ?", c.ClientID).Update("health_check_url", hc)
	}
	// 监控表同步
	var monitors []model.AppMonitor
	db.Find(&monitors)
	for _, m := range monitors {
		if m.HealthCheckURL != "" {
			continue
		}
		var c model.OAuth2Client
		if err := db.Where("client_id = ?", m.ClientID).First(&c).Error; err != nil {
			continue
		}
		if c.HealthCheckURL == "" {
			continue
		}
		db.Model(&model.AppMonitor{}).Where("client_id = ?", m.ClientID).Update("health_check_url", c.HealthCheckURL)
	}
}
