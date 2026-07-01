#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE_FILE="release/docker-compose.offline.yml"
ENV_FILE="release/.env"

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    if [ -f "release/.env.example" ]; then
      cp "release/.env.example" "$ENV_FILE"
    else
      echo "Missing $ENV_FILE" >&2
      exit 1
    fi
  fi
  # shellcheck disable=SC1090
  source "$ENV_FILE"
}

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

load_env

INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"
SECRET_KEY="${SECRET_KEY:-oneauth-secret-key-default}"

if [ -z "${SECRET_KEY}" ] || [ "${SECRET_KEY}" = "oneauth-secret-key-default" ]; then
  if command -v openssl >/dev/null 2>&1; then
    SECRET_KEY="$(openssl rand -hex 32)"
  else
    SECRET_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
fi

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
SECRET_KEY=${SECRET_KEY}
EOF

first_image="$(find release/images -name '*.tar' -print -quit 2>/dev/null || true)"
if [ -z "${first_image}" ]; then
  echo "Missing offline images under release/images/." >&2
  exit 1
fi

for img in "$INSTALL_DIR"/release/images/*.tar; do
  echo "Loading $img"
  docker load -i "$img"
done

docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$INSTALL_DIR/$ENV_FILE" up -d
docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$INSTALL_DIR/$ENV_FILE" ps
