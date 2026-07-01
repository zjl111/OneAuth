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

if [ ! -f ".env" ]; then
  echo "Missing .env. Copy .env.example to .env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source ".env"
set +a

INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"

# Ensure directory structure exists
mkdir -p "$INSTALL_DIR"/{conf,data,keys}

# Copy updated runtime files to INSTALL_DIR
for item in docker-compose.offline.yml install.sh upgrade.sh stop.sh status.sh backup.sh README.md; do
  cp "$ROOT/$item" "$INSTALL_DIR/"
done

# Copy default config.yaml only if not exists (preserve user customizations)
if [ ! -f "$INSTALL_DIR/conf/config.yaml" ]; then
  cp "$ROOT/conf/config.yaml" "$INSTALL_DIR/conf/config.yaml"
  echo "Created default conf/config.yaml"
fi

# Preserve existing .env in INSTALL_DIR (don't overwrite config)
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cp "$ROOT/.env" "$INSTALL_DIR/.env"
fi

# Ensure ip2region.xdb exists
if [ ! -f "$INSTALL_DIR/data/ip2region.xdb" ]; then
  if [ -f "$ROOT/data/ip2region.xdb" ]; then
    cp "$ROOT/data/ip2region.xdb" "$INSTALL_DIR/data/ip2region.xdb"
  else
    echo "Extracting ip2region.xdb from backend image..."
    cid="$(docker create oneauth/backend:offline-amd64)"
    docker cp "${cid}:/app/data/ip2region.xdb" "$INSTALL_DIR/data/ip2region.xdb"
    docker rm "$cid" >/dev/null
  fi
fi

# Load new images from package
first_image="$(find "$ROOT/images" -name '*.tar' -print -quit 2>/dev/null || true)"
if [ -z "${first_image}" ]; then
  echo "Missing offline images under images/." >&2
  exit 1
fi

for img in "$ROOT"/images/*.tar; do
  echo "Loading $img"
  docker load -i "$img"
done

cd "$INSTALL_DIR"
docker compose -f docker-compose.offline.yml --env-file .env up -d --remove-orphans
docker compose -f docker-compose.offline.yml --env-file .env ps
