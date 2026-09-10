# 数据库、文件存储与迁移

数据库保存账号、权限、邀请、站点索引、版本和发布回执；HTML、附件、封面及分享图保存到私有对象存储。默认安装仍只需要 Docker 和一个持久卷。

## 后端选择

| 数据库 | 文件存储 | 适用方式 |
| --- | --- | --- |
| 本地 SQLite | 本地文件目录 | 默认 Docker / 单实例 Node 服务 |
| 本地 SQLite | 私有 S3 / R2 | 文件放对象存储，数据库仍需持久磁盘 |
| libSQL HTTP | 私有 S3 / R2 | 多个 Node 服务实例共享数据库和文件 |
| libSQL HTTP | 本地文件目录 | 必须显式选择；仅适合固定持久磁盘的单实例 |

`DATABASE_URL` 存在时使用 libSQL HTTP 客户端，否则使用 `DB_PATH` 指定的 SQLite。两者共用异步 SQL 接口，事务使用对应数据库自身的事务。远程写事务内不进行对象上传；邀请兑换、账号修改、版本切换和发布幂等回执都在事务提交后才返回成功。身份验证的频率限制也保存在数据库，跨实例生效。

对象后端通过 `OBJECT_STORE=filesystem` 或 `s3` 选择。远程数据库必须显式选择对象后端，不能意外依赖临时磁盘。`R2Objects` 还提供 Workers bucket binding 接口，在 Miniflare 实测过；当前 Express 服务使用 R2 的 S3 API，尚不是 Workers 应用。D1 和 PostgreSQL 不是本次实现的数据库后端。

环境变量见 [.env.example](../.env.example)。Node 启动读取 `.env`；Compose 使用 `.env.docker`。远程模式需配置：

```dotenv
DATABASE_URL=libsql://your-database.example
DATABASE_AUTH_TOKEN=
OBJECT_STORE=s3
S3_ENDPOINT=https://your-storage-endpoint.example
S3_BUCKET=quickshare
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=auto
```

空白密钥由部署者私密填写，不能提交 Git。使用专用数据库和私有 bucket/prefix。R2 禁用公开访问，凭据限制到该 bucket 的对象读写。S3 和数据库连接默认要求 TLS，只有回环测试地址允许 HTTP。服务代理公开内容并添加原有 sandbox 响应头，浏览器不会得到对象存储凭据或直连地址；下架仍由站点索引控制。

本地对象默认位于 `DB_PATH` 相邻的 `objects/`，可用 `OBJECTS_PATH` 指定持久目录。Compose 固定把数据库和本地对象存入 `/app/data` 数据卷。各实例共享远程数据库时，必须使用相同管理员密钥、对象 bucket/prefix 和公开 `BASE_URL`；不要让多进程共享一个 SQLite 文件。

## 写入与恢复语义

1. 验证权限、文件路径、大小及逻辑配额。
2. 将原始文件写为 SHA-256 寻址的不可变对象，再保存 manifest。重复内容复用同一键；读取时校验哈希。
3. 开启短数据库事务，复验当前身份、配额、revision 和请求幂等性，再原子切换索引并保存历史。
4. 提交成功才返回链接。上传失败、身份被撤销或版本冲突时，原站点保持原版本。

历史记录存引用而不是整份 Base64。配额仍按逻辑内容和历史字节计算，不能通过短引用绕过。原始 HTML 与文件逐字节保留；slug、成员 ID、分享默认值和 CLI/API 契约不变。

失败或冲突的上传可能留下无引用对象。本版本不自动删除对象，避免误删历史版本或其他正在上传的内容；部署者需监控存储用量。不要按最后访问时间配置 bucket 删除规则，旧版本也可能仍被引用。成员配额是逻辑用量，不是 bucket 物理用量。

## 旧数据迁移

新代码兼容旧的内联内容，启动只做增量建表/加列，新发布直接使用对象存储。旧站点逐条转换，可中断后重跑；不会自动在启动时搬运全部内容。首次升级前先用旧版方式备份整个数据目录，迁移工具自身会在当前兼容结构下生成另一个恢复点。

Node 环境中，先配置 `.env` 的现有数据库和目标对象存储：

```sh
# 只查看待转换数量（会执行增量结构初始化）
npm run storage:migrate
# 先生成完整备份，再迁移；目标目录必须不存在
npm run storage:migrate -- --apply --backup ./backups/before-object-migration
# 后续日常备份
npm run storage:migrate -- --backup-only --backup ./backups/recovery-point
```

Docker 中：

```sh
docker compose --env-file .env.docker exec -T quickshare \
  node scripts/migrate-storage.js --apply --backup /app/data/backups/before-object-migration
```

使用远程数据库时必须指定 `--backup` 本地持久目录。`--apply` 转换当前数据库里的内联内容，不负责创建云资源、搬迁整个数据库到另一家服务或复制两个 bucket。不要仅更改 bucket 配置便切换到空 bucket。

## 备份与恢复

备份目录包含 `quickshare.sqlite`、`objects/` 和完成标记 `backup.json`。数据库先取得一致快照，再从快照中的当前版本和全部历史引用复制对象，并校验哈希。没有完成标记代表失败，不能用于恢复。远程 libSQL 也能导出成独立 SQLite；账号、邀请状态、发布回执和版本随数据库一起导出。

备份含账号哈希和用户内容，目录权限为 0700，文件为 0600。另行备份服务密钥。备份放到运行服务之外的持久位置；Docker 内生成的备份应复制到外部备份介质。

恢复到 Node / Docker：停止目标服务，把完整备份的数据库和 `objects/` 放入新的持久数据目录，使用本次重构或更高兼容版本，设置 `DB_PATH`、`OBJECT_STORE=filesystem`、`OBJECTS_PATH`，清除 `DATABASE_URL`，保留原管理员密钥与公开域名，然后启动并核验账号、旧链接、文件、历史和下架状态。不要覆盖正在运行的数据库，也不要只还原 SQLite 而遗漏对象。

已迁移的数据库不能交给不认识 `content_ref` 的旧代码。回滚旧代码需恢复迁移前的整套数据库/文件备份，会失去该恢复点之后的写入；有新写入时优先使用兼容修复版本。

本地 SQLite 迁移后文件未必立刻缩小，空闲页可被后续写入复用。本工具不在线执行 `VACUUM`。

## 验证范围

- 自动测试：原文一致、大文件索引体积、失败写入、撤权竞态、版本冲突、逻辑配额、迁移中断/重试、损坏对象、事务回滚、迁移命令、备份恢复。
- `npm run verify:backends`：隔离的真实 libSQL HTTP + MinIO S3 容器，双实例并发邀请/发布/更新、共享频率限制、下架/恢复、远程备份转本地、后端重启。
- R2 binding：Miniflare 本地运行时与持久化重启测试。
- `npm run verify:docker`：Node 24 镜像、文件持久卷、原文发布、备份命令和容器重建。

Cloudflare Workers + R2、Vercel + Turso + 私有 Blob 已完成独立云端验收，见[验收记录](verification.md)和[云端安装](cloud-install.md)。AWS S3 未做真实账号验收；S3 协议测试使用 MinIO。

接口依据：[libSQL TypeScript 客户端](https://docs.turso.tech/sdk/ts/reference)、[R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)、[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Node SQLite](https://nodejs.org/api/sqlite.html)。
