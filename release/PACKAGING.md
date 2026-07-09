# OneAuth 离线打包指南

## 概述

本文档说明如何打包 OneAuth 离线安装包。打包过程会自动构建后端、前端、Docker 镜像，并生成包含所有依赖的 tar.gz 安装包。

## 环境要求

打包前确保本地已安装以下工具：

| 工具 | 用途 | 最低版本 |
|------|------|----------|
| Go | 编译后端二进制 | 1.21+ |
| Node.js | 构建前端静态资源 | 18+ |
| npm | 前端依赖管理 | 9+ |
| Docker | 构建和导出离线镜像 | 20.10+ |
| bsdtar | 打包工具（macOS 自带） | - |

验证环境：

```bash
go version
node -v
npm -v
docker --version
which bsdtar  # macOS 自带，Linux 需安装：sudo apt install libarchive-tools
```

## 版本管理

版本号由 `release/VERSION` 文件控制，格式为 `主版本。次版本.修订号`（如 `1.0.12`）。

- **查看当前版本**：`cat release/VERSION`
- **手动修改版本**：直接编辑 `release/VERSION` 文件
- **自动递增**：每次打包成功后，脚本会自动将修订号 +1（如 1.0.12 → 1.0.13）

示例：

```bash
# 查看当前版本
cat release/VERSION
# 输出：1.0.12

# 手动设置为 2.0.0
echo "2.0.0" > release/VERSION
```

## 打包步骤

### 1. 进入项目根目录

```bash
cd /path/to/OneAuth
```

### 2. 确认版本号

```bash
cat release/VERSION
```

如需修改版本，编辑 `release/VERSION` 文件。

### 3. 执行打包脚本

```bash
bash release/package-offline.sh
```

脚本会自动完成以下操作：

1. **读取版本号** — 从 `release/VERSION` 读取
2. **清理旧产物** — 删除之前的 build、images 目录和旧 tar.gz
3. **编译后端** — 构建 linux/amd64 架构的 sso-server 和 gateway 二进制
4. **构建前端** — 执行 `npm run build` 生成静态资源
5. **构建 Docker 镜像** — 创建 backend 和 gateway 的离线镜像
6. **导出镜像** — 将镜像保存为 tar 文件到 `release/images/`
7. **同步版本** — 更新 `docker-compose.yml` 和 `install.sh` 中的镜像标签
8. **打包** — 生成 `oneauth-vX.X.X.tar.gz`
9. **递增版本** — 自动将 `release/VERSION` 的修订号 +1
10. **清理** — 删除所有 oneauth Docker 镜像和构建产物

### 4. 验证打包结果

```bash
# 查看生成的安装包
ls -lh oneauth-v*.tar.gz

# 查看包内容（不解压）
tar -tzf oneauth-v1.0.12.tar.gz
```

预期输出结构：

```
oneauth-v1.0.12/
── install.sh              # 安装脚本
├── upgrade.sh              # 升级脚本
├── stop.sh                 # 停止服务
├── status.sh               # 查看状态
├── backup.sh               # 备份脚本
├── docker-compose.yml      # Docker 编排文件
├── .env.example            # 环境变量模板
├── README.md               # 说明文档
├── VERSION                 # 版本号
├── Dockerfile.backend.offline
├── Dockerfile.gateway.offline
├── package-offline.sh      # 打包脚本
├── conf/
│   └── config.yaml         # 后端配置文件
├── data/
│   └── ip2region.xdb       # IP 归属地数据库
└── images/
    ├── backend-v1.0.12.tar # 后端 Docker 镜像
    └── gateway-v1.0.12.tar # 网关 Docker 镜像
```

## 安装包内容说明

| 文件/目录 | 说明 |
|-----------|------|
| `install.sh` | 一键安装脚本，加载镜像并启动服务 |
| `upgrade.sh` | 升级脚本，保留数据升级版本 |
| `stop.sh` | 停止所有服务 |
| `status.sh` | 查看服务运行状态 |
| `backup.sh` | 备份数据库和配置文件 |
| `docker-compose.yml` | Docker Compose 编排，定义 backend 和 gateway 服务 |
| `.env.example` | 环境变量模板，安装时会自动复制为 `.env` |
| `conf/config.yaml` | 后端应用配置（数据库、OAuth、监控等） |
| `data/ip2region.xdb` | IP 归属地查询数据库 |
| `images/*.tar` | 离线 Docker 镜像，安装时自动加载 |

## 部署说明

将 `oneauth-vX.X.X.tar.gz` 传输到目标服务器后：

```bash
# 1. 解压
tar -xzf oneauth-v1.0.12.tar.gz
cd oneauth-v1.0.12

# 2. 执行安装
bash install.sh

# 3. 查看状态
bash status.sh

# 4. 访问系统
# 默认地址：http://<服务器IP>
# 默认账号：admin / Admin@123456
```

安装脚本会自动：
- 加载 Docker 镜像
- 生成随机 SECRET_KEY（如未设置）
- 创建目录结构（`/opt/oneauth`）
- 复制配置文件
- 启动服务

## 常见问题

### Q: 打包时提示 `go is required`

确保 Go 已安装且在 PATH 中：

```bash
export PATH=$PATH:/usr/local/go/bin
```

### Q: 打包时提示 `docker is required`

确保 Docker 已安装且服务正在运行：

```bash
docker --version
docker ps
```

### Q: macOS 提示 `bsdtar: command not found`

macOS 自带 bsdtar，通常在 `/usr/bin/bsdtar`。如缺失，安装 libarchive：

```bash
brew install libarchive
```

### Q: 打包后 Docker 镜像不见了

这是正常的。打包脚本会自动清理所有 `oneauth/*` 镜像，避免占用磁盘空间。镜像已导出到 `release/images/` 并打包进 tar.gz。

### Q: 如何跳版本（如 1.0.12 直接到 1.1.0）

手动编辑 `release/VERSION`：

```bash
echo "1.1.0" > release/VERSION
bash release/package-offline.sh
```

### Q: 打包失败后重新打包

直接重新运行脚本即可。脚本会自动清理之前的产物：

```bash
bash release/package-offline.sh
```

### Q: 如何只更新前端/后端，不重新打包镜像

修改代码后必须重新打包，因为镜像包含了编译后的二进制和前端静态资源。

## 注意事项

1. **打包会删除 Docker 镜像** — 脚本执行完毕后，所有 `oneauth/*` 镜像会被删除。如需保留，在打包前手动备份：
   ```bash
   docker save oneauth/backend:v1.0.12 -o backend-backup.tar
   ```

2. **版本号自动递增** — 每次打包成功后，`release/VERSION` 会自动 +1。如不想递增，在打包前备份版本号，打包后恢复。

3. **交叉编译** — 后端和网关二进制编译为 `linux/amd64` 架构，在 macOS/Windows 上打包也可在 Linux 服务器运行。

4. **前端构建产物较大** — `npm run build` 生成的 JS 文件约 4MB，属于正常现象。

5. **不要提交构建产物** — `release/build/`、`release/images/`、`release/data/` 目录已被 `.gitignore` 排除，不要手动添加到 git。

## 脚本源码说明

打包脚本位于 `release/package-offline.sh`，主要流程：

```bash
# 1. 读取版本
VERSION="$(tr -d '[:space:]' < release/VERSION)"

# 2. 清理旧产物
rm -rf release/build release/images

# 3. 编译后端（linux/amd64）
cd sso-server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ...

# 4. 构建前端
cd sso-admin && npm run build

# 5. 构建 Docker 镜像
docker build -t oneauth/backend:v${VERSION} ...
docker build -t oneauth/gateway:v${VERSION} ...

# 6. 导出镜像
docker save oneauth/backend:v${VERSION} -o release/images/backend-v${VERSION}.tar

# 7. 打包
bsdtar -czf oneauth-v${VERSION}.tar.gz ...

# 8. 递增版本
echo "next_version" > release/VERSION

# 9. 清理
docker rmi oneauth/backend:v${VERSION} oneauth/gateway:v${VERSION}
rm -rf release/build release/images release/data
```

## 更新日志

### v1.0.12 (2026-07-09)

**新增：自动清理机制**

- 打包完成后自动删除所有 `oneauth/*` Docker 镜像（包括历史版本）
- 自动清理 `release/build/`、`release/images/`、`release/data/` 构建产物目录
- 避免误提交大文件到 git 仓库
- 清理命令：
  ```bash
  docker images --format '{{.Repository}}:{{.Tag}}' | grep '^oneauth/' | xargs -r docker rmi
  rm -rf release/build release/images release/data
  ```

---

### v1.0.11 (2026-07-09)

**修复：压缩包目录结构**

- 改用 `bsdtar` 替代 `tar`，解决 macOS 下 `--transform` 参数不支持的问题
- 使用 `-s "|^\\./|${PKG_NAME}/|"` 参数为所有文件添加顶层目录前缀
- 解压后生成 `oneauth-vX.X.X/` 目录，避免文件散落在当前目录
- 压缩包内容结构：
  ```
  oneauth-v1.0.11/
  ├── install.sh
  ├── docker-compose.yml
  ├── images/
  └── ...
  ```

---

### v1.0.10 (2026-07-09)

**新增：VERSION 文件自动版本管理**

- 引入 `release/VERSION` 文件集中管理版本号
- 打包脚本自动读取版本号，无需手动修改多处
- 打包成功后自动递增修订号（如 1.0.10 → 1.0.11）
- 自动同步版本号到 `docker-compose.yml` 和 `install.sh`
- 手动跳版本方法：
  ```bash
  echo "2.0.0" > release/VERSION
  bash release/package-offline.sh
  ```

---

### v1.0.9 (2026-07-06)

**优化：扁平化 release 目录结构**

- 移除 `release/oneauth-vX.X.X/` 子目录，直接在 `release/` 根目录操作
- 镜像文件保存到 `release/images/` 而非版本化子目录
- 简化打包脚本逻辑，减少目录层级
- 排除旧 artifacts（`package/`、`gateway/`、`.env`）避免误打包

---

### v1.0.8 (2026-07-03)

**修复：macOS tar 元数据问题**

- 添加 `COPYFILE_DISABLE=1` 环境变量，防止 macOS 在 tar 包中生成 `._` 资源分支文件
- 解决 Linux 解压时出现 `Ignoring unknown extended header keyword` 警告
- 命令示例：
  ```bash
  COPYFILE_DISABLE=1 tar -czf package.tar.gz ...
  ```

---

### v1.0.7 (2026-07-03)

**初始版本：离线打包脚本**

- 创建 `release/package-offline.sh` 打包脚本
- 支持编译 linux/amd64 架构的后端和网关二进制
- 构建前端静态资源（Vite build）
- 创建 Docker 离线镜像并导出为 tar 文件
- 生成包含所有依赖的完整安装包
- 包结构：
  ```
  release/oneauth-v1.0.7/
  ├── install.sh / upgrade.sh / stop.sh / status.sh / backup.sh
  ├── docker-compose.yml
  ├── .env.example
  ├── conf/config.yaml
  ├── data/ip2region.xdb
  ── images/
      ├── backend-v1.0.7.tar
      └── gateway-v1.0.7.tar
  ```

---

### 版本演进总结

| 版本 | 核心变更 | 影响范围 |
|------|----------|----------|
| 1.0.7 | 初始打包功能 | 新增脚本 |
| 1.0.8 | 修复 macOS 兼容性 | 打包命令 |
| 1.0.9 | 简化目录结构 | 脚本逻辑 |
| 1.0.10 | 自动版本管理 | VERSION 文件 + 脚本 |
| 1.0.11 | 修复压缩包结构 | bsdtar 参数 |
| 1.0.12 | 自动清理机制 | 脚本清理步骤 |
