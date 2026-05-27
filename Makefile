# OneAuth 开发 / 部署 Makefile

.PHONY: help dev-backend dev-frontend install build clean docker-up docker-down docker-build logs

help:
	@echo "OneAuth - 轻量级 SSO 平台"
	@echo ""
	@echo "本地开发："
	@echo "  make install        - 安装前后端依赖"
	@echo "  make dev-backend    - 启动 Go 后端（SQLite + 内存，无需 Postgres/Redis）"
	@echo "  make dev-frontend   - 启动 React 前端开发服务器"
	@echo ""
	@echo "构建："
	@echo "  make build          - 构建后端二进制和前端 dist"
	@echo ""
	@echo "Docker 部署："
	@echo "  make docker-build   - 构建所有镜像"
	@echo "  make docker-up      - 启动完整栈（Nginx + Backend + Frontend + Postgres + Redis）"
	@echo "  make docker-down    - 停止并清理"
	@echo "  make logs           - 查看后端日志"

install:
	cd sso-admin && npm install
	cd sso-server && go mod download

dev-backend:
	cd sso-server && go run ./cmd/server --config ./configs/config.yaml

dev-frontend:
	cd sso-admin && npm run dev

build:
	cd sso-server && CGO_ENABLED=0 go build -o ../bin/sso-server ./cmd/server
	cd sso-admin && npm run build

clean:
	rm -rf bin sso-server/data sso-server/keys sso-admin/dist sso-admin/node_modules

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

logs:
	docker compose logs -f backend
