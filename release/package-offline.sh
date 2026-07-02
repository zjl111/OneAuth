#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="release/build"
PKG_NAME="oneauth-v1.0.6"
PKG_DIR="release/$PKG_NAME"

command -v go >/dev/null 2>&1 || { echo "go is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

rm -rf "$OUT_DIR" "$PKG_DIR" "${PKG_NAME}.tar.gz"
mkdir -p "$OUT_DIR/backend" "$OUT_DIR/gateway" "$OUT_DIR/frontend/dist"
mkdir -p "$OUT_DIR/base"
mkdir -p "$PKG_DIR"/{images,conf,data}

echo "Building backend binary (linux/amd64)..."
(cd sso-server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "../$OUT_DIR/backend/sso-server" ./cmd/server)

echo "Building gateway binary (linux/amd64)..."
(cd sso-server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o "../$OUT_DIR/gateway/oneauth-gateway" ./cmd/gateway)

echo "Building frontend assets..."
(cd sso-admin && npm run build)
rm -rf "$OUT_DIR/frontend/dist"
cp -R sso-admin/dist "$OUT_DIR/frontend/dist"

echo "Copying CA certificates from local Alpine image..."
cid="$(docker create alpine:latest)"
docker cp "${cid}:/etc/ssl/certs/ca-certificates.crt" "$OUT_DIR/base/ca-certificates.crt"
docker rm -v "$cid" >/dev/null

echo "Building amd64 images..."
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 --pull=false -t oneauth/backend:v1.0.6 -f release/Dockerfile.backend.offline .
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 --pull=false -t oneauth/gateway:v1.0.6 -f release/Dockerfile.gateway.offline .

echo "Saving images..."
docker save oneauth/backend:v1.0.6 -o "$PKG_DIR/images/backend-v1.0.6.tar"
docker save oneauth/gateway:v1.0.6 -o "$PKG_DIR/images/gateway-v1.0.6.tar"

echo "Assembling package..."
# Scripts, configs, and data files
cp release/install.sh release/upgrade.sh release/stop.sh release/status.sh release/backup.sh release/README.md "$PKG_DIR/"
cp release/docker-compose.yml "$PKG_DIR/docker-compose.yml"
cp release/.env.example "$PKG_DIR/.env.example"
cp release/conf/config.yaml "$PKG_DIR/conf/config.yaml"
cp sso-server/data/ip2region.xdb "$PKG_DIR/data/ip2region.xdb"

tar -czf "${PKG_NAME}.tar.gz" -C "release" "$PKG_NAME"

echo "Package created: $ROOT/${PKG_NAME}.tar.gz"
