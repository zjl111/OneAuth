#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# OneAuth 升级脚本
#
# 用法:
#   方式一（推荐）: bash upgrade.sh oneauth-v1.0.5.tar.gz
#     自动解压 → 备份 → 加载镜像 → 更新文件 → 重启服务
#
#   方式二: 解压后在包目录内执行
#     tar xzf oneauth-v1.0.5.tar.gz
#     cd oneauth-v1.0.5
#     bash upgrade.sh
# ============================================================

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd docker
require_cmd tar

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required." >&2
  exit 1
fi

# ============================================================
# Step 0: Auto-extract package if tar.gz argument is provided
# ============================================================
CLEANUP_DIR=""

if [ $# -ge 1 ] && [ -f "$1" ]; then
  ARCHIVE="$1"
  echo "==> Extracting package: $ARCHIVE ..."

  # Determine the package name from the tarball (e.g., oneauth-v1.0.5)
  PKG_NAME="$(tar tzf "$ARCHIVE" | head -1 | cut -d/ -f1)"
  if [ -z "$PKG_NAME" ]; then
    echo "Failed to detect package name from archive." >&2
    exit 1
  fi

  EXTRACT_DIR="$(mktemp -d)"
  CLEANUP_DIR="$EXTRACT_DIR"
  tar xzf "$ARCHIVE" -C "$EXTRACT_DIR"

  ROOT="$EXTRACT_DIR/$PKG_NAME"
  if [ ! -d "$ROOT" ]; then
    echo "Package directory not found: $ROOT" >&2
    exit 1
  fi

  echo "    Extracted to: $ROOT"
  echo ""
else
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

cd "$ROOT"

INSTALL_DIR="${INSTALL_DIR:-/opt/oneauth}"

# Verify install directory exists
if [ ! -d "$INSTALL_DIR" ]; then
  echo "Install directory not found: $INSTALL_DIR" >&2
  echo "Please run install.sh first." >&2
  exit 1
fi

# ============================================================
# Step 1: Backup current runtime data
# ============================================================
BACKUP_DIR="$INSTALL_DIR/backup/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "==> Creating backup at ${BACKUP_DIR} ..."

# Backup SQLite database
if [ -f "$INSTALL_DIR/data/sso.db" ]; then
  cp "$INSTALL_DIR/data/sso.db" "$BACKUP_DIR/sso.db"
  echo "    Backed up: data/sso.db"
fi

# Backup RSA keys
if [ -d "$INSTALL_DIR/keys" ] && [ "$(ls -A "$INSTALL_DIR/keys" 2>/dev/null)" ]; then
  cp -R "$INSTALL_DIR/keys" "$BACKUP_DIR/keys"
  echo "    Backed up: keys/"
fi

# Backup config.yaml
if [ -f "$INSTALL_DIR/conf/config.yaml" ]; then
  cp "$INSTALL_DIR/conf/config.yaml" "$BACKUP_DIR/config.yaml"
  echo "    Backed up: conf/config.yaml"
fi

# Backup .env
if [ -f "$INSTALL_DIR/.env" ]; then
  cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env"
  echo "    Backed up: .env"
fi

echo "    Backup complete."
echo ""

# ============================================================
# Step 2: Handle .env — preserve existing or create new
# ============================================================
echo "==> Handling .env ..."

if [ -f "$INSTALL_DIR/.env" ]; then
  # Copy existing .env to package dir so docker compose can read it
  cp "$INSTALL_DIR/.env" "$ROOT/.env"
  echo "    Using existing .env from $INSTALL_DIR/.env"
else
  # No existing .env — create from example
  if [ -f "$ROOT/.env.example" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    echo "    Created .env from .env.example"

    # Generate random SECRET_KEY if still default
    source "$ROOT/.env"
    SECRET_KEY="${SECRET_KEY:-oneauth-secret-key-default}"
    if [ -z "${SECRET_KEY}" ] || [ "${SECRET_KEY}" = "oneauth-secret-key-default" ]; then
      if command -v openssl >/dev/null 2>&1; then
        SECRET_KEY="$(openssl rand -hex 32)"
      else
        SECRET_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      fi
      # Update SECRET_KEY in .env
      if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" "$ROOT/.env"
      else
        sed -i "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" "$ROOT/.env"
      fi
      echo "    Generated random SECRET_KEY"
    fi

    # Also install to INSTALL_DIR
    cp "$ROOT/.env" "$INSTALL_DIR/.env"
    echo "    Installed .env to $INSTALL_DIR/.env"
  else
    echo "WARNING: No .env found in $INSTALL_DIR and no .env.example in package." >&2
    echo "         Please create .env manually before starting services." >&2
  fi
fi

# Source .env for this script's use
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo ""

# ============================================================
# Step 3: Copy updated runtime files to INSTALL_DIR
# ============================================================
echo "==> Updating runtime files ..."

# Copy docker-compose.yml
cp "$ROOT/docker-compose.yml" "$INSTALL_DIR/"
echo "    Updated: docker-compose.yml"

# Copy config.yaml (safe to overwrite — no env-specific data)
if [ -f "$ROOT/conf/config.yaml" ]; then
  cp "$ROOT/conf/config.yaml" "$INSTALL_DIR/conf/config.yaml"
  echo "    Updated: conf/config.yaml"
fi

# Ensure ip2region.xdb exists
if [ ! -f "$INSTALL_DIR/data/ip2region.xdb" ]; then
  if [ -f "$ROOT/data/ip2region.xdb" ]; then
    cp "$ROOT/data/ip2region.xdb" "$INSTALL_DIR/data/ip2region.xdb"
    echo "    Copied: data/ip2region.xdb"
  else
    echo "    Extracting ip2region.xdb from backend image..."
    BACKEND_TAG="$(grep 'image: oneauth/backend' "$ROOT/docker-compose.yml" | sed 's/.*image: *//')"
    cid="$(docker create "$BACKEND_TAG")"
    docker cp "${cid}:/app/data/ip2region.xdb" "$INSTALL_DIR/data/ip2region.xdb"
    docker rm "$cid" >/dev/null
  fi
fi

echo ""

# ============================================================
# Step 4: Load new Docker images
# ============================================================
echo "==> Loading new images ..."

first_image="$(find "$ROOT/images" -name '*.tar' -print -quit 2>/dev/null || true)"
if [ -z "${first_image}" ]; then
  echo "WARNING: No offline images found under $ROOT/images/." >&2
  echo "         Services will use existing local images." >&2
else
  for img in "$ROOT"/images/*.tar; do
    echo "    Loading $(basename "$img")"
    docker load -i "$img"
  done
fi

echo ""

# ============================================================
# Step 5: Restart services with new version
# ============================================================
echo "==> Restarting services ..."

cd "$INSTALL_DIR"
docker compose down
docker compose up -d --remove-orphans
docker compose ps

# ============================================================
# Cleanup
# ============================================================
if [ -n "$CLEANUP_DIR" ] && [ -d "$CLEANUP_DIR" ]; then
  rm -rf "$CLEANUP_DIR"
  echo ""
  echo "    Cleaned up temporary files."
fi

echo ""
echo "==> Upgrade complete."
echo "    Backup saved to: ${BACKUP_DIR}"
if [ -f "$INSTALL_DIR/.env" ]; then
  echo "    .env preserved — your port and secret configurations are intact."
fi
