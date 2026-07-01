#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE_FILE="release/docker-compose.offline.yml"
ENV_FILE="release/.env"

if ! command -v docker >/dev/null 2>&1; then
  echo "Missing required command: docker" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy release/.env.example to release/.env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"

mkdir -p "$INSTALL_DIR"
if [ "$ROOT" != "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR/release"
  cp -R "release" "$INSTALL_DIR/"
fi

cat > "$INSTALL_DIR/release/.env" <<EOF
INSTALL_DIR=${INSTALL_DIR}
DB_NAME=${DB_NAME:-sso_platform}
DB_USER=${DB_USER:-sso}
DB_PASSWORD=${DB_PASSWORD:-Password123@sqlite}
REDIS_PASSWORD=${REDIS_PASSWORD:-Password123@redis}
SSO_ISSUER=${SSO_ISSUER:-http://localhost}
SECRET_KEY=${SECRET_KEY:-oneauth-secret-key-default}
EOF

first_image="$(find "$INSTALL_DIR/release/images" -name '*.tar' -print -quit 2>/dev/null || true)"
if [ -z "${first_image}" ]; then
  echo "Missing offline images under release/images/." >&2
  exit 1
fi

for img in "$INSTALL_DIR"/release/images/*.tar; do
  echo "Loading $img"
  docker load -i "$img"
done

docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$INSTALL_DIR/$ENV_FILE" up -d --remove-orphans
docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$INSTALL_DIR/$ENV_FILE" ps
