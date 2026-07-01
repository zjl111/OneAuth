# OneAuth Release Bundle

This bundle is meant to be copied to a server and run from the bundle root.

## Prerequisites

- Docker Engine
- Docker Engine
- Docker Compose v2

## Quick start

1. Edit `release/.env` if you need a custom install directory or issuer.
2. Run `./release/install.sh`.

## Upgrade

1. Replace the bundle with the newer release.
2. Run `./release/upgrade.sh`.

## Stop

Run `./release/stop.sh`.

## Backup

Run `./release/backup.sh`.
