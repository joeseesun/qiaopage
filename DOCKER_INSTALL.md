# Docker 安装

需要 Docker Engine / Docker Desktop 和 Compose v2，无需在宿主机安装 Node.js。

## 启动

在仓库根目录执行。初始化会生成随机管理员密钥，写入权限为 600 的 `.env.docker`；已有文件会保留。

```sh
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" -w /workspace \
  node:24.20.0-bookworm-slim node scripts/setup.js --docker

docker compose --env-file .env.docker up -d --build --wait
```

打开 <http://127.0.0.1:8090>。获取一次性管理员登录链接：

```sh
docker compose --env-file .env.docker exec -T quickshare \
  node bin/quickshare.js dashboard --url http://127.0.0.1:3000
```

CLI 在容器内部访问服务，返回的登录链接使用配置的 `BASE_URL`。该链接五分钟有效、只可使用一次；不要分享给别人。登录后在“账号”中设置用户名和密码，在“朋友”中生成邀请 Prompt。没有通用默认密码。管理员密钥只用于初始化和恢复，朋友使用各自的连接。

## 配置和 HTTPS

- `.env.docker` 的 `BASE_URL` 必须与浏览器实际访问地址完全一致。公网部署设置为你的 HTTPS 域名，例如 `https://share.example.com`，再配置反向代理和 TLS。
- 默认端口仅绑定宿主机 `127.0.0.1:8090`。可在 `.env.docker` 设置 `QUICKSHARE_PORT=8091`；本地访问时同时修改 `BASE_URL`。不要与已有服务占用同一端口。
- `.env` 用于本地 Node 开发，`.env.docker` 用于 Compose；命令都显式指定后者。
- 应用运行在非 root 用户下，根文件系统只读，数据库和私有文件写入持久卷 `/app/data`。请保留 `.env.docker` 和数据卷，丢失密钥可能失去管理员恢复入口。
- 服务镜像包含 CLI、Skill、中文 OG 字体和 PNG 渲染依赖；截图需要发布端自行安装 Playwright 浏览器。

## 更新与备份

使用默认本地存储时，更新前备份。以下命令暂停这一套 Compose 服务，生成包含 SQLite/WAL 和 objects/ 的一致数据目录归档，然后重新启动。归档包含账号数据，应私密保管。

```sh
mkdir -p backups
chmod 700 backups
docker compose --env-file .env.docker stop quickshare
docker compose --env-file .env.docker run --rm --no-deps -T quickshare \
  tar -C /app/data -czf - . > "backups/quickshare-$(date +%Y%m%d-%H%M%S).tar.gz"
docker compose --env-file .env.docker up -d --build --wait
```

每次备份先确认归档命令成功，再进行版本升级。另行私密备份 `.env.docker`。恢复时先停服务，把归档解包到同一数据卷，再启动兼容当前数据结构的版本。不要使用 `docker compose down --volumes`，它会删除数据；不要让多套应用进程同时写同一个 SQLite 卷。正常 `up --build` 或容器重建保留数据。

## 验证

```sh
curl --fail http://127.0.0.1:8090/healthz
docker compose --env-file .env.docker ps
```

开发者可运行 `node scripts/verify-docker.cjs`。它创建独立测试项目和临时数据卷，验证权限、发布原文、OG PNG、重建保留账号及网站、版本冲突，最后只删除测试项目的数据。当前阿里云实例仍使用 systemd，Docker 安装不会自动迁移它。

## 远程数据库和对象存储

可在 `.env.docker` 设置 `DATABASE_URL` / `DATABASE_AUTH_TOKEN` 和 `OBJECT_STORE=s3` / `S3_*`。Compose 已转发这些配置，详见[存储与迁移](docs/storage.md)。使用远程后端时，上面的卷归档不包含远程数据库或 bucket，必须使用文档中的完整备份命令。旧版内联数据可渐进迁移，升级前先备份。
