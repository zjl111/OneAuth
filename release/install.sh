#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

# Load env: copy from example if missing
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp ".env.example" ".env"
  else
    echo "Missing .env" >&2
    exit 1
  fi
fi

# shellcheck disable=SC1090
source ".env"

SECRET_KEY="${SECRET_KEY:-oneauth-secret-key-default}"
if [ -z "${SECRET_KEY}" ] || [ "${SECRET_KEY}" = "oneauth-secret-key-default" ]; then
  if command -v openssl >/dev/null 2>&1; then
    SECRET_KEY="$(openssl rand -hex 32)"
  else
    SECRET_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
fi

INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"
GATEWAY_PORT="${GATEWAY_PORT:-80}"

# Create directory structure
echo "Setting up install directory: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"/{conf,data,keys}

# Copy docker-compose.yml
cp "$ROOT/docker-compose.yml" "$INSTALL_DIR/"

# Copy default config.yaml if not exists
if [ ! -f "$INSTALL_DIR/conf/config.yaml" ]; then
  cp "$ROOT/conf/config.yaml" "$INSTALL_DIR/conf/config.yaml"
  echo "Created default conf/config.yaml"
fi

# Write final .env
cat > "$INSTALL_DIR/.env" <<EOF
INSTALL_DIR=${INSTALL_DIR}
DB_NAME=${DB_NAME:-sso_platform}
DB_USER=${DB_USER:-sso}
DB_PASSWORD=${DB_PASSWORD:-Password123@sqlite}
REDIS_PASSWORD=${REDIS_PASSWORD:-Password123@redis}
SSO_ISSUER=${SSO_ISSUER:-http://localhost}
SECRET_KEY=${SECRET_KEY}
GATEWAY_PORT=${GATEWAY_PORT}
EOF

# Load images from package
first_image="$(find "$ROOT/images" -name '*.tar' -print -quit 2>/dev/null || true)"
if [ -z "${first_image}" ]; then
  echo "Missing offline images under images/." >&2
  exit 1
fi

for img in "$ROOT"/images/*.tar; do
  echo "Loading $img"
  docker load -i "$img"
done

# Copy ip2region.xdb to data dir if not present
if [ ! -f "$INSTALL_DIR/data/ip2region.xdb" ]; then
  if [ -f "$ROOT/data/ip2region.xdb" ]; then
    cp "$ROOT/data/ip2region.xdb" "$INSTALL_DIR/data/ip2region.xdb"
    echo "Copied ip2region.xdb to data/"
  else
    echo "Extracting ip2region.xdb from backend image..."
    cid="$(docker create oneauth/backend:v1.0.7)"
    docker cp "${cid}:/app/data/ip2region.xdb" "$INSTALL_DIR/data/ip2region.xdb"
    docker rm "$cid" >/dev/null
  fi
fi

# Start services
cd "$INSTALL_DIR"
echo ""
echo "Starting services..."
docker compose up -d
docker compose ps
