#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f .env ] || { echo "Missing .env" >&2; exit 1; }

# shellcheck disable=SC1090
source .env
INSTALL_DIR="${INSTALL_DIR:-.}"

BACKUP_DIR="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup runtime data (SQLite DB, RSA keys)
if [ -d "data" ] || [ -d "keys" ]; then
  tar -czf "${BACKUP_DIR}/runtime-files.tar.gz" data keys
fi

# Backup config and scripts
tar -czf "${BACKUP_DIR}/config.tar.gz" \
  .env \
  docker-compose.yml \
  conf/config.yaml \
  install.sh \
  upgrade.sh \
  stop.sh \
  status.sh \
  backup.sh \
  README.md

echo "Backup written to ${BACKUP_DIR}"
