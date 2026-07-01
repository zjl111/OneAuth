#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f .env ] || { echo "Missing .env" >&2; exit 1; }

docker compose ps
