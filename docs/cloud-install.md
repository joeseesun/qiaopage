# 云端安装

需要 Node.js 24+，能够访问此仓库，以及对应平台账号。首次登录、平台条款和账户计费资格由平台确认；脚本不会代替本人接受条款。每个安装拥有独立账号数据库和私有文件存储，不依赖现有 Quickshare 服务器。自定义项目名会使用 `.env.平台名-项目名` 保存独立凭据；下方环境文件示例对应默认项目名。

```sh
npm ci --ignore-scripts
# 二选一；第二个参数可改为自己的项目名
npm run install:cloudflare -- quickshare-agent
npm run install:vercel -- quickshare-agent
```

使用官方 Wrangler 4.130.0 / Vercel CLI 59.15.1。先用 `npx wrangler login` 或 `npx vercel@59.15.1 login` 登录。安装失败时按 CLI 提示处理后重跑，已连接的资源与管理员密钥会保留。Cloudflare API Token 会覆盖 OAuth；若个人 shell 中有不适用的旧 Token，先移除该命令环境中的 `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN`，再使用已登录的 OAuth。

## Cloudflare

脚本自动创建项目对应的私有 R2 bucket，部署 Worker 和 SQLite Durable Object，生成权限 600 的 `.env.cloudflare`，以 secret 注入管理员密钥。数据事务在 Durable Object 内完成，R2 保存按 SHA-256 寻址的不可变内容。不是 D1，也不是代理到私人 VPS。EJS 预编译，中文 OG 使用 WASM Resvg，字体走静态资产 binding。

部署结束后 CLI 输出 `workers.dev` 地址。自定义名称生成独立 `.wrangler-install.json`，升级时继续使用相同名称；更改 Worker 名称会得到另一套数据库。没有设置 `BASE_URL` 时使用请求的部署域名；绑定自定义域名时在 `.env.cloudflare` 设置正确的 HTTPS `BASE_URL` 并重新部署。

## Vercel

脚本创建或连接项目，使用 Marketplace 的 Turso Starter 免费计划和私有 Blob，生成或保留管理员密钥，最后执行 production 部署。Turso 首次使用必须本人接受平台条款；CLI 会给出链接，确认后重跑同一命令。超额限制与价格以账号的平台页面为准，脚本不主动升级套餐。

函数使用专用 CJS 构建入口，数据库连接读取平台注入的 `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`，也兼容 `DATABASE_URL` / `DATABASE_AUTH_TOKEN`。Blob 使用平台绑定凭据，应用不把对象地址或凭据交给访客。默认函数与新 Turso 数据库放在东京 `hnd1`；已有资源可按实际区域调整 `vercel.json`。

平台默认生产域名用于 `BASE_URL`；自定义域名应设置明确的 HTTPS `BASE_URL`。首次 `.env.vercel` 含私密环境变量，权限 600，不提交或分享。平台会将受保护密钥回读为 `[SENSITIVE]`；重跑时脚本保留本地已有真实值，不覆盖服务器密钥。若换设备后只有占位符，需要原有管理员连接或私密备份，本地占位符不能用于登录。当前仓库为私有仓库，外部朋友不能直接从公开部署按钮复制；当前验收覆盖 CLI 安装流程，没有把浏览器按钮点击标记为已验收。

## 管理员接入

没有统一用户名或默认密码。以平台输出的真实地址替换示例地址，用私密环境文件启动 CLI，生成一次性后台链接：

```sh
node --env-file=.env.cloudflare bin/quickshare.js dashboard --url https://YOUR-WORKER.workers.dev
# 或
node --env-file=.env.vercel bin/quickshare.js dashboard --url https://YOUR-PROJECT.vercel.app
```

链接包含一次性凭据，只在本人设备打开，不贴进公开聊天或日志。登录后设置账号，创建朋友邀请 Prompt。朋友使用各自的邀请，不共享管理员环境文件。CLI / Skill 1.5.0 与网页自动对大请求分块，用户仍然执行正常的 publish / update。

## 上传与恢复

单文件 5 MiB、每次 8 MiB / 100 文件的限制不变。超过 3 MiB 的 JSON 请求自动分成 512 KiB 私有分块，经完整哈希复验后进入正常发布事务。每名成员最多两个上传会话，一小时过期；成功或失败后客户端清理会话，下次新上传清理过期会话。断线导致清理失败时，重试仍使用发布 requestId 防止重复站点。原有客户端需要更新到 1.5.0。大响应在 Vercel 流式输出，原字节与 sandbox 头保留。

Vercel 使用[完整备份工具](storage.md)，包括数据库、历史和引用的 Blob 对象：

```sh
node --env-file=.env.vercel scripts/migrate-storage.js --backup-only --backup ./backups/cloud-checkpoint
```

工具支持 `DATABASE_*` / `TURSO_*` 连接；设置 `OBJECT_STORE=vercel-blob`。备份可恢复到隔离的 Node / Docker 实例，避免对运行中的云数据库直接覆盖。恢复测试应同时检查身份、历史、原链接内容和大文件，不能只检查 SQL 行数。

Cloudflare 的 SQLite Durable Object 提供过去 30 天的时间点恢复。运维端点默认关闭，需另行生成至少 32 字符的 `QUICKSHARE_RECOVERY_TOKEN` 并作为 secret 部署，不能交给普通 Agent 连接。停止新的发布后：

```sh
# QUICKSHARE_URL 指向本安装；凭据从私密环境文件读取
node --env-file=.env.cloudflare scripts/cloudflare-recovery.cjs checkpoint ./backups/cloudflare-point.json
# 明确需要回到该恢复点时执行；会撤销此后的数据库写入
node --env-file=.env.cloudflare scripts/cloudflare-recovery.cjs restore ./backups/cloudflare-point.json
```

恢复命令先保存 undo bookmark，再重启 Durable Object 并检查健康接口。之后必须读取账号与文件确认。R2 对象不可变且当前不自动删除，因此历史恢复点仍能引用原文件。不要给 bucket 配置按时间删除规则。PITR 不是异地备份，也不能恢复被删除的 R2 bucket；重要内容仍需独立备份。该 API 只能在云端实测，本地 Workers 不支持 PITR。

参考：[Cloudflare SQL 事务与 PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[Vercel 函数限制](https://vercel.com/docs/functions/limitations)、[Vercel 私有 Blob](https://vercel.com/docs/vercel-blob/using-blob-sdk)、[Vercel Marketplace CLI](https://vercel.com/docs/cli/integration)。
