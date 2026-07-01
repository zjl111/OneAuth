#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="release/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"

docker compose -f "$INSTALL_DIR/release/docker-compose.offline.yml" --env-file "$INSTALL_DIR/release/.env" down
