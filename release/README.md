# OneAuth 离线安装包

## 前置条件

- Docker Engine
- Docker Compose v2

## 安装

```bash
tar -xzf oneauth-v1.0.0.tar.gz
cd oneauth-v1.0.0
vi .env                    # 按需修改配置
bash install.sh
```

安装完成后进入安装目录启动服务：

```bash
cd /opt/oneauth            # 即 .env 中的 INSTALL_DIR
docker compose up -d
```

## 配置说明

- `.env` — 端口、密钥、Issuer 等基础配置
- `conf/config.yaml` — Token 有效期、CORS、监控等高级配置，修改后 `docker compose restart backend` 生效

## 常用操作

```bash
docker compose ps          # 查看状态
docker compose down        # 停止
docker compose restart     # 重启
docker compose logs -f     # 查看日志
```
