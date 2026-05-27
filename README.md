# OneAuth - 轻量级企业 SSO 平台

基于 **Golang + React** 的企业级单点登录与身份提供商（IdP）平台。完整实现 OAuth 2.0 授权码流程 + OpenID Connect 1.0，提供功能完备的管理后台、应用门户和状态监控页。

## ✨ 特性

- 🔐 **标准协议**：完整支持 OAuth 2.0 授权码模式 + OIDC 1.0（Discovery / JWKS / UserInfo / Revoke / EndSession）
- 🛡️ **安全设计**：RSA-RS256 签名、PKCE 支持、Refresh Token 轮换、bcrypt 密码哈希、CSRF/CORS 防护
- 🎛️ **统一登录入口**：所有用户共用 `/oauth/login`，登录后按 `is_staff` 自动路由到门户或管理后台
- 🧑‍💼 **完备的管理后台**：用户 / 部门 / 角色 / 应用 / 访问控制 / 配置 / 日志 / 状态监控
- 📊 **应用状态监控**：每 30 秒自动健康探测，90 天可用性条带 + 24h/7d/30d/90d 多窗口指标
- 🚀 **零依赖开发**：内置 SQLite + 内存 Store，无需 Postgres/Redis 即可本地启动
- 🐳 **生产部署**：Docker Compose 一键部署完整栈

## 🏗️ 技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | Go 1.22 · Gin · GORM · golang-jwt · Viper |
| 前端 | React 18 · TypeScript 5 · Vite · Ant Design 5 · Zustand · React Router 6 |
| 数据 | PostgreSQL 16（生产） / SQLite（开发） · Redis 7（生产）/ 内存（开发） |
| 部署 | Docker Compose · Nginx 反向代理 |

## 📦 项目结构

```
.
├── sso-server/             # Go 后端
│   ├── cmd/server/         # main 入口
│   ├── internal/
│   │   ├── config/         # Viper 配置
│   │   ├── model/          # GORM 数据模型
│   │   ├── repository/     # 仓储层 + Seed 初始数据
│   │   ├── service/        # 业务服务
│   │   ├── handler/        # HTTP Handler（OAuth/Auth/User/App/...)
│   │   ├── middleware/     # JWT / CORS / 安全响应头
│   │   ├── oauth/          # 密钥管理 / Token / 授权码 / Store
│   │   ├── session/        # 服务端 Session（SSO Cookie）
│   │   ├── monitor/        # 状态监控调度器
│   │   └── router/         # 路由注册
│   ├── pkg/                # 通用工具（response / password / utils）
│   └── configs/config.yaml
├── sso-admin/              # React 前端
│   └── src/
│       ├── pages/
│       │   ├── login/      # 统一登录页（左品牌 + 右表单）
│       │   ├── consent/    # 授权同意页
│       │   ├── portal/     # 应用门户（普通用户）
│       │   ├── status/     # 公开状态监控页
│       │   └── admin/      # 管理后台子页面
│       ├── layouts/AdminLayout.tsx
│       ├── components/AuthGuard.tsx
│       ├── api/ store/ router/
│       └── styles/
├── deployments/            # Docker / Nginx
├── docker-compose.yml
├── Makefile
└── sso-design-v2.md        # 设计文档
```

## 🚀 快速开始（本地开发）

### 1. 安装依赖

```bash
make install
```

### 2. 启动后端（默认零依赖：SQLite + 内存 Store）

```bash
make dev-backend
```

后端将在 `http://localhost:8080` 启动，并完成：

- 自动建表（GORM AutoMigrate）
- 自动 RSA-2048 密钥生成（写入 `./keys/`）
- 初始化默认账号、内置角色、示例应用与监控配置

### 3. 启动前端

```bash
make dev-frontend
```

前端在 `http://localhost:5173` 启动，已配置代理。

### 4. 访问

| 页面 | URL | 说明 |
| --- | --- | --- |
| 统一登录页 | http://localhost:5173/oauth/login | 所有用户登录入口 |
| 应用门户 | http://localhost:5173/portal | 普通用户登录后落地 |
| 管理后台 | http://localhost:5173/admin | 仅 `is_staff=true` 用户 |
| 状态监控 | http://localhost:5173/status | 公开可访问 |
| OIDC Discovery | http://localhost:8080/.well-known/openid-configuration | — |

### 默认账号

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `Admin@123456` | 超级管理员（is_staff=true） |
| `zhang.li` | `User@123456` | 普通用户 |

## 🔐 OAuth 2.0 / OIDC 接入示例

第三方应用接入：

1. 在管理后台 `应用中心` 创建应用，获取 `client_id` 与 `client_secret`
2. 引导用户跳转到：

```
GET http://localhost:8080/oauth/authorize?
    response_type=code
    &client_id=YOUR_CLIENT_ID
    &redirect_uri=https://your.app/callback
    &scope=openid profile email
    &state=RANDOM
    &nonce=RANDOM
    &code_challenge=...   # PKCE 可选
    &code_challenge_method=S256
```

3. 用户登录授权后回调到 `redirect_uri?code=...&state=...`
4. 应用后端用授权码换 Token：

```
POST /oauth/token
Authorization: Basic base64(client_id:client_secret)

grant_type=authorization_code
&code=...
&redirect_uri=https://your.app/callback
&code_verifier=...   # PKCE 时必填
```

返回：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "id_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

5. 用 Access Token 调 UserInfo：

```
GET /oauth/userinfo
Authorization: Bearer <access_token>
```

## 🐳 生产部署（Docker Compose）

```bash
cp .env.example .env
# 修改 .env 中的密码与 SSO_ISSUER
make docker-build
make docker-up
```

完整栈监听 `80` 端口：

- Nginx 反代 `/oauth/*`, `/api/*`, `/.well-known/*` → backend
- 其他路径 → 前端 SPA

## 📑 主要 API

### OIDC 协议端点

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/.well-known/openid-configuration` | GET | 元数据 |
| `/oauth/jwks.json` | GET | RSA 公钥集 |
| `/oauth/authorize` | GET/POST | 授权端点 |
| `/oauth/token` | POST | 令牌端点 |
| `/oauth/userinfo` | GET/POST | 用户信息 |
| `/oauth/revoke` | POST | 撤销令牌 |
| `/oauth/end_session` | GET/POST | 单点登出 |

### 管理后台 API（`/api/v1/...`）

- `auth/login`, `auth/refresh`, `auth/profile`, `auth/logout`, `auth/change-password`
- `users`（CRUD + reset-password + lock + roles）
- `departments/tree`, `departments`
- `roles`, `roles/:id/permissions`, `permissions/tree`
- `apps`（CRUD + rotate-secret + toggle-status）
- `dashboard/stats`, `dashboard/login-trends`, `dashboard/app-distribution`
- `logs/login`, `logs/operation`, `logs/access`
- `configs`, `dictionaries`
- `access/ip`
- `monitor/apps`, `monitor/apps/:cid/config`, `monitor/apps/:cid/probe`, `monitor/apps/:cid/maintenance`

### 状态页公开 API（`/api/status/...`）

- `overview` - 整体状态 + 应用卡片列表（含 90 天时间线）
- `apps/:cid/timeline` - 指定应用 90 天聚合
- `apps/:cid/windows` - 多窗口可用性

## 🔧 配置

配置文件 `sso-server/configs/config.yaml`，支持环境变量覆盖（前缀 `SSO_`）。

关键开关：
- `app.driver`: `sqlite` 或 `postgres`
- `redis.enabled`: `false` 启用内存模式
- `monitor.enabled`: `true` 启动状态探测
- `monitor.interval_seconds`: 探测周期（默认 30s）

## 📜 许可

[MIT License](LICENSE) © 2026 zjl111
