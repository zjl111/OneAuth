# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

OneAuth - a lightweight enterprise SSO platform implementing OAuth 2.0 Authorization Code Grant + OpenID Connect 1.0. Go backend (`sso-server/`) + React frontend (`sso-admin/`). The complete design spec lives in `sso-design-v2.md` (~2600 lines) and is authoritative for protocol behavior, data model, and feature scope.

## Common commands

```bash
make install         # install both backend (go mod download) and frontend (npm install)
make dev-backend     # cd sso-server && go run ./cmd/server --config ./configs/config.yaml
make dev-frontend    # cd sso-admin && npm run dev   (Vite on :5173, proxies /api & /oauth to :8080)
make build           # CGO_ENABLED=0 backend binary into ./bin/, plus npm run build for SPA
make docker-up       # full stack: Nginx + backend + frontend + Postgres + Redis on :80
make docker-down
make logs            # docker compose logs -f backend
```

**Running a single Go test**: `cd sso-server && go test ./internal/oauth/ -run TestVerifyPKCE -v` (no test files exist yet — the project ships without a test suite). **Frontend has no test runner configured.**

**Backend build must stay CGO_ENABLED=0**. The SQLite driver is `github.com/glebarez/sqlite` (pure-Go, modernc-based). Do not switch to `gorm.io/driver/sqlite` — it pulls in `mattn/go-sqlite3` and breaks the Alpine Docker image.

## Architecture

### Dual storage modes (config-driven)

- `app.driver=sqlite` + `redis.enabled=false` → zero-dependency dev mode. SQLite at `./data/sso.db`, in-memory `oauth.Store` for auth codes / refresh tokens / sessions / rate limits.
- `app.driver=postgres` + `redis.enabled=true` → production. Wired up by Docker Compose env vars (`SSO_APP_DRIVER`, `SSO_REDIS_ENABLED`, ...). The same `oauth.Store` interface (`internal/oauth/store.go`) has both `RedisStore` and `MemoryStore` implementations — handler/service code never branches on which one is active.

### Two parallel authentication mechanisms

The backend issues **two independent credentials per login**, which is the most important thing to understand before touching auth code:

1. **SSO session cookie** (`sso_session`, HttpOnly, server-side state in `oauth.Store`, managed by `internal/session/`). Used only by `/oauth/authorize` to detect "is this browser already logged in to the IdP?" Set/cleared by `handler/auth_handler.go`'s `Login`/`Logout`. **Never** read by `/api/v1/*` endpoints.
2. **JWT access token + opaque refresh token** (RS256-signed JWT + 64-byte random string in `oauth.Store`). Used by Bearer-token middleware (`middleware/JWTAuth`) for all `/api/v1/*` calls and by third-party clients via `/oauth/token`.

`Login` creates both. `Logout` clears the cookie + deletes the session, but JWTs remain valid until expiry (revoke via `/oauth/revoke` to blacklist). Refresh tokens are **rotated on every use** — old one is deleted from `Store` before the new one is written.

### OAuth/OIDC flow split between backend and frontend

`/oauth/authorize` is a backend redirect handler — it never renders HTML. Flow:

1. Third-party app → `GET /oauth/authorize?...` on backend (`:8080`)
2. Backend checks SSO cookie. If absent → `302` to `${cfg.OAuth.FrontendURL}/oauth/login?return_to=<original-url>` (dev: `http://localhost:5173`; prod: empty string → same-origin via Nginx).
3. React SPA renders the login page, POSTs to `/api/v1/auth/login`, gets JWT + sets cookie via `Set-Cookie` header, then `window.location.replace(return_to)` back to `/oauth/authorize`.
4. Backend now sees the cookie, checks `AuthorizationGrant` (skip-consent table). If user hasn't authorized this client+scope → `302` to `/oauth/consent` (also rendered by SPA), which POSTs back to `/oauth/authorize?consent=1`.
5. Backend issues authorization code into `AuthCodeStore` (5-min TTL), redirects to `redirect_uri?code=...&state=...`.

Built-in client `sso-admin` (seeded by `repository/seed.go`) **always auto-grants** (no consent page) — that's how `/portal` "管理后台" tile bootstraps into `/admin` without an extra click.

### Frontend routing & guards

- `/oauth/login`, `/oauth/consent` → public/auth-bootstrap pages
- `/portal` → `AuthGuard` (any logged-in user). Default landing for non-admin users.
- `/admin/*` → `AuthGuard requireStaff` (checks `user.is_staff` from `useAuthStore`)
- `/status` → fully public

Login routing logic is in `pages/login/index.tsx`. Three cases: (a) `return_to` starts with `/oauth/authorize` → `window.location.replace` (full reload so backend sees the new cookie); (b) other `return_to` → SPA `navigate`; (c) no `return_to` → `/portal`.

### State stores

- `useAuthStore` (Zustand + localStorage persist, key `oneauth-auth`) holds access token, refresh token, user, permissions. The axios interceptor in `api/request.ts` reads `accessToken` per request and **deduplicates concurrent refresh calls** via a module-level `refreshing` promise — preserve this pattern when modifying refresh logic.
- No global server-state cache (no React Query). Each page does its own `useEffect` + `setLoading` pattern.

### Backend layout

```
sso-server/
├── cmd/server/main.go          # Wire-up only (see below)
├── internal/
│   ├── config/                 # Viper, env vars prefixed SSO_*
│   ├── model/                  # GORM models. types.go has StringSlice (JSON-backed []string for portable JSONB)
│   ├── repository/             # GORM queries. seed.go runs on every startup (idempotent inserts)
│   ├── service/                # Business logic (user/client). Returns errors as values.
│   ├── handler/                # Gin handlers. One file per resource. auth_handler vs oauth_handler distinction matters (see above).
│   ├── middleware/             # JWTAuth, RequireStaff, RequirePermission, RequestID, SecurityHeaders
│   ├── oauth/                  # Protocol primitives: KeyManager (RSA), TokenService (JWT), AuthCodeStore, Store interface
│   ├── session/                # SSO browser cookie session (NOT the JWT one)
│   ├── monitor/scheduler.go    # Goroutine that probes apps every 30s, writes probe + daily aggregate + opens/closes incidents
│   └── router/router.go        # Route registration. Sole place where auth groups (public / authed / admin) are defined.
└── pkg/{response,password,utils}/  # response.OK/Page/Err helpers used by every handler
```

`main.go` is **only wiring**: build repos → build services → build `*Handler` structs → pass to `router.Setup`. Never put business logic there.

### Monitor scheduler

`internal/monitor/scheduler.go` runs as a background goroutine. Every 30s (configurable via `monitor.interval_seconds`):
- Reads all `AppMonitor` rows where `enabled=true AND maintenance=false`
- Concurrently probes (semaphore of 16) each `health_check_url`
- Writes one row to `sso_app_status_probe` + upserts `sso_app_status_daily` (UTC-day key) + updates `AppMonitor.current_status`
- Opens/closes `sso_app_incident` on status transitions (up↔down)

The status page (`/status` + `/api/status/overview`) reads from the **daily aggregate** for the 90-day strip, and from raw probes for windowed metrics (24h/7d/30d/90d) via `MonitorRepository.WindowMetrics`. Don't query `sso_app_status_probe` for the strip — it's pruned to 30 days by an hourly goroutine.

### Default seed data (created on first startup)

Wired in `repository/seed.go`:
- Admin: `admin / Admin@123456` (is_staff, super_admin role)
- Normal user: `jinli / User@123456`
- Built-in client `sso-admin` (the admin panel itself)
- 8 demo apps (`demo-oa`, `demo-mail`, ...) with public health-check URLs for monitor demo data

Seed inserts are guarded by `gorm.ErrRecordNotFound` checks — safe to run repeatedly.

## Conventions specific to this codebase

- **All IDs are UUIDs as `char(36)`** (works on both SQLite and Postgres). `BeforeCreate` hooks auto-generate them if zero — don't pre-set IDs in handlers.
- **`StringSlice` (model/types.go)** is the portable JSONB-ish type for `redirect_uris`, `grant_types` etc. Don't use raw `pq.StringArray` — it breaks SQLite.
- **Response envelope is fixed**: `{code, message, data}` via `pkg/response`. Frontend `api/request.ts` unwraps `.data.data`. Adding a new endpoint without this envelope breaks the frontend.
- **Permission strings**: `"*"` = all permissions (super_admin). Other codes match permission table `code` column. `service.UserService.Permissions()` returns `["*"]` for super_admin and explicit list for others.
- **Frontend imports use `@/` alias** for `src/` (configured in `vite.config.ts` and `tsconfig.json`).
- **Antd v5 + Chinese locale** is set globally in `main.tsx`. Use `AntdApp.useApp()` (not the static `message.success(...)`) to ensure correct context for theming.

## Deploy gotchas

- Nginx config (`deployments/nginx.conf`) **explicitly routes `/oauth/login` and `/oauth/consent` to the frontend SPA** (via `location = ...` exact matches), while everything else under `/oauth/` goes to the backend. Adding new SPA-served routes under `/oauth/` requires updating this config.
- In production set `oauth.frontend_url` to `""` (empty) so backend redirects are same-origin relative paths. In dev it's `http://localhost:5173`.
- RSA keys are auto-generated into `./keys/` (2048-bit) on first run. In Docker this is the `rsa_keys` volume — back it up or all issued tokens become unverifiable after a recreate.
