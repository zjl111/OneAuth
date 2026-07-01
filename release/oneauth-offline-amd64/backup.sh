#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ ! -f ".env" ]; then
  echo "Missing .env." >&2
  exit 1
fi

# shellcheck disable=SC1090
source ".env"
INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"

BACKUP_DIR="${INSTALL_DIR}/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup runtime data (SQLite DB, RSA keys)
if [ -d "$INSTALL_DIR/data" ] || [ -d "$INSTALL_DIR/keys" ]; then
  tar -czf "${BACKUP_DIR}/runtime-files.tar.gz" \
    -C "$INSTALL_DIR" data keys
fi

# Backup config and scripts
tar -czf "${BACKUP_DIR}/config.tar.gz" \
  "$INSTALL_DIR/.env" \
  "$INSTALL_DIR/docker-compose.offline.yml" \
  "$INSTALL_DIR/conf/config.yaml" \
  "$INSTALL_DIR/install.sh" \
  "$INSTALL_DIR/upgrade.sh" \
  "$INSTALL_DIR/stop.sh" \
  "$INSTALL_DIR/status.sh" \
  "$INSTALL_DIR/backup.sh" \
  "$INSTALL_DIR/README.md"

echo "Backup written to ${BACKUP_DIR}"
