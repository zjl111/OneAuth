# OneAuth 离线安装包

本安装包用于在无网络环境下部署 OneAuth 认证平台。

## 前置条件

- Docker Engine
- Docker Compose v2

## 快速开始

1. 编辑 `.env` 文件，按需修改安装目录或 Issuer 等配置。
2. 运行 `./install.sh`。

## 升级

1. 用新版安装包替换旧版。
2. 运行 `./upgrade.sh`。

## 停止

运行 `./stop.sh`。

## 查看状态

运行 `./status.sh`。

## 备份

运行 `./backup.sh`。
