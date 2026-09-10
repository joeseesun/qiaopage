# 多平台架构与状态

2026-09-10。QiaoPage 已提供 Docker / VPS、Cloudflare Workers 和 Vercel 的独立运行方式。[安装指南](cloud-install.md)记录 CLI、登录、资源创建与恢复步骤；[验收记录](verification.md)区分本地、云端和浏览器按钮。

| 平台 | 数据库 | 文件存储 | 运行时 |
| --- | --- | --- | --- |
| Docker / VPS | SQLite 或 libSQL | 持久目录或私有 S3 | Node.js 24 |
| Cloudflare | SQLite Durable Object | 私有 R2 binding | Workers + Node HTTP bridge，预编译 EJS，WASM OG |
| Vercel | Turso / libSQL | 私有 Blob | Node 函数，专用 CJS 构建，流式大响应 |

业务规则共用：账号、邀请、所有权、配额、幂等 requestId、稳定 slug、revision CAS、历史恢复、opaque sandbox 和可选分享增强。新默认仍为不进入展厅、凭链接访问；不添加水印或署名。

## 为什么 Cloudflare 使用 Durable Object

现有账号和发布事务包含条件读取、身份复验与多步更新，需要真正的事务上下文。SQLite Durable Object 支持在 `storage.transaction` 内运行 SQL，使这些规则无需改写成分散的 D1 batch。每个安装一个 `primary` 对象，异步事务通过队列隔离；文件内容移到 R2，因此数据库行不承载整个网站。

该架构面向自己和朋友，不宣称大规模多租户吞吐。未来需扩展时，应先明确跨账户事务和迁移策略，再拆分对象。无需把今天的产品引入额外服务。

## 文件与平台限制

内容先写入不可变对象，再在短事务中切换索引并保留历史。CLI / Skill 1.5.0、网页和 API 的分块上传共用同一发布入口；不会因为运行在不同平台而绕过权限或验证。

Vercel 的 4.5 MB 请求限制由私有 512 KiB 分块解决，超过 3 MiB 的响应流式发送。分块在数据库中有成员归属、完整哈希、期限、会话数量和总大小限制，最终发布仍限制 5 MiB 单文件、8 MiB 总量。私有对象始终经过应用的发布状态与 sandbox 响应层读取。

## 仓库与数据迁移

QiaoPage 从 Quickshare 演进而来，保留 API、CLI 和配置兼容，旧仓库保留旧历史。2026-09-10 既有生产服务已迁移到数据库索引 + 私有对象目录：14 个站点、11 条历史、2 名成员，原地址和内容保留；迁移前后逻辑审计一致，完整备份与隔离恢复通过。生产目前运行已合并的存储版本；云端运行时适配先在两个独立测试安装验收，不会自动替换生产服务或搬走朋友的数据。

Cloudflare 的恢复使用数据库 PITR + 仍保留的不可变 R2 对象；Vercel 可完整导出为 SQLite + 文件并恢复到 Node / Docker。备份与恢复操作须覆盖账号、索引、历史和文件，不能只备份数据库。

仓库按 ISC 许可开源。CLI 安装流程已实测；浏览器部署按钮尚未完成验收，因此不将它们列为可用入口。

依据：[Cloudflare SQLite 事务与 PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[Node HTTP bridge](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/)、[Vercel 函数限制](https://vercel.com/docs/functions/limitations)、[私有 Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk)。
