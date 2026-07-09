#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── Read version from release/VERSION ──
VERSION="$(tr -d '[:space:]' < release/VERSION)"
PKG_NAME="oneauth-v${VERSION}"

OUT_DIR="release/build"

command -v go >/dev/null 2>&1 || { echo "go is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }

echo "==> Packaging OneAuth v${VERSION}"

# Clean previous build artifacts and images
rm -rf "$OUT_DIR" "release/images" "${PKG_NAME}.tar.gz"
mkdir -p "$OUT_DIR/backend" "$OUT_DIR/gateway" "$OUT_DIR/frontend/dist"
mkdir -p "$OUT_DIR/base"
mkdir -p "release/images"

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
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 --pull=false -t "oneauth/backend:v${VERSION}" -f release/Dockerfile.backend.offline .
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 --pull=false -t "oneauth/gateway:v${VERSION}" -f release/Dockerfile.gateway.offline .

echo "Saving images to release/images/..."
docker save "oneauth/backend:v${VERSION}" -o "release/images/backend-v${VERSION}.tar"
docker save "oneauth/gateway:v${VERSION}" -o "release/images/gateway-v${VERSION}.tar"

echo "Copying ip2region data..."
mkdir -p release/data
cp sso-server/data/ip2region.xdb "release/data/ip2region.xdb"

# ── Sync version into docker-compose.yml and install.sh ──
sed -i '' "s|oneauth/backend:v[0-9]*\.[0-9]*\.[0-9]*|oneauth/backend:v${VERSION}|g" release/docker-compose.yml
sed -i '' "s|oneauth/gateway:v[0-9]*\.[0-9]*\.[0-9]*|oneauth/gateway:v${VERSION}|g" release/docker-compose.yml
sed -i '' "s|oneauth/backend:v[0-9]*\.[0-9]*\.[0-9]*|oneauth/backend:v${VERSION}|g" release/install.sh

echo "Packaging..."
COPYFILE_DISABLE=1 tar -czf "${PKG_NAME}.tar.gz" \
  --exclude='build' \
  --exclude='package' \
  --exclude='gateway' \
  --exclude='.env' \
  --exclude='.DS_Store' \
  --exclude="${PKG_NAME}.tar.gz" \
  -C "release" .

echo "Package created: $ROOT/${PKG_NAME}.tar.gz"

# ── Auto-increment patch version for next build ──
MAJOR="$(echo "$VERSION" | cut -d. -f1)"
MINOR="$(echo "$VERSION" | cut -d. -f2)"
PATCH="$(echo "$VERSION" | cut -d. -f3)"
NEXT_PATCH=$((PATCH + 1))
NEXT_VERSION="${MAJOR}.${MINOR}.${NEXT_PATCH}"
printf '%s\n' "$NEXT_VERSION" > release/VERSION

echo "Version bumped: v${VERSION} -> v${NEXT_VERSION}"
