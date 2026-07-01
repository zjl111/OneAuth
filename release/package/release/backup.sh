#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
COMPOSE_FILE="release/docker-compose.offline.yml"
ENV_FILE="release/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Copy release/.env.example to release/.env first." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"

BACKUP_DIR="${INSTALL_DIR}/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -n "$(docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$INSTALL_DIR/$ENV_FILE" ps -q backend 2>/dev/null || true)" ]; then
  docker compose -f "$INSTALL_DIR/$COMPOSE_FILE" --env-file "$INSTALL_DIR/$ENV_FILE" exec -T backend sh -c 'tar -C /app -czf - keys data' > "${BACKUP_DIR}/runtime-files.tar.gz"
fi

tar -czf "${BACKUP_DIR}/config.tar.gz" \
  "$INSTALL_DIR/release/.env" \
  "$INSTALL_DIR/release/docker-compose.offline.yml" \
  "$INSTALL_DIR/release/install.sh" \
  "$INSTALL_DIR/release/upgrade.sh" \
  "$INSTALL_DIR/release/stop.sh" \
  "$INSTALL_DIR/release/status.sh" \
  "$INSTALL_DIR/release/backup.sh" \
  "$INSTALL_DIR/release/README.md"

echo "Backup written to ${BACKUP_DIR}"
