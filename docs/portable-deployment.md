# 独立仓库与多平台部署

2026-09-10。状态：Docker 已实测；Cloudflare / Vercel 为待实现设计，不宣称一键部署可用。

## 仓库边界

保留 Quickshare 产品名；新仓库建议 `quickshare-agent`，旧 `quickshare` 保留旧项目历史。新仓库以当前运行代码为起点，携带 CLI、Skill 生成器、测试、Docker 和通用文档。旧路由、旧认证、设计试稿、真实数据、凭据、个人路径、阿里云 DNS 管理和私有运维记录不进入新仓库。

拆仓库不改变线上域名、网站 slug、成员 ID 或凭据。迁移部署需另外验证数据和版本兼容性。现有安装连接继续访问原来的服务。

## 部署目标

| 目标 | 持久化 | 实施状态 |
| --- | --- | --- |
| Docker / VPS | 持久卷中的 SQLite | 镜像、Compose、初始化、健康检查与重建保留数据已实测 |
| Cloudflare Workers | D1 存账号与索引，R2 存不可变内容和版本 | 待改造及线上验收 |
| Vercel | 托管关系数据库与对象存储，例如 Neon + Blob | 待改造及线上验收 |

不把反向代理到现有私人服务器称为独立部署，也不依赖临时磁盘保存账号和站点。

## 为什么不是加两个配置文件

当前 `server.js`、`lib/accounts.js` 使用同步 `node:sqlite` 和事务，内容与资产 Base64 保存在同一数据库记录。OG 使用原生 Resvg 和本地字体。

- Vercel 的函数实例没有共享的持久本地文件系统，不能把 SQLite 放进 `/tmp` 作为生产数据；函数请求和响应体上限 4.5 MB，现有 8 MB 文件包经 Base64 后会超限。
- Cloudflare Workers 的 `node:sqlite` 只是非功能 stub。D1 单行/字符串/BLOB 上限 2 MB，不能直接搬运现有 8 MB 网站记录。
- Cloudflare Containers 的磁盘也是临时的；只搬 Dockerfile 不能解决持久化。

来源：[Vercel SQLite](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)、[函数限制](https://vercel.com/docs/functions/limitations)、[Workers Node 兼容性](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)、[D1 限制](https://developers.cloudflare.com/d1/platform/limits/)、[Containers 磁盘](https://developers.cloudflare.com/containers/concepts/architecture/)。

## 推荐架构

一套业务规则，平台存储适配。Web、CLI 和 Skill 使用相同 API 契约，账号身份、权限、slug、revision、幂等请求与分享默认值保持一致。

1. 从服务中抽出账号、站点、版本、邀请的异步 repository 接口。事务在适配层内完成，不允许用多个无事务网络 SQL 模拟 `BEGIN/COMMIT`。
2. 内容改为不可变版本 manifest 和资产对象。先写对象，再通过数据库条件更新切换当前版本；失败的未引用对象可回收。新版本验证完整之前，公开地址继续读取上一版本。
3. 上传改为创建会话 → 授权分块/直传 → finalize。发布成功才占用最终地址和版本；必须复验成员、路径、字节数、哈希和配额。支持重试、过期、冲突与清理，不让未授权对象直接公开。
4. Cloudflare 适配 D1 + R2，事务性写入用数据库 batch/CAS；需要跨步骤序列化时由 Durable Object 协调。Cookie/Origin 和 opaque sandbox 规则保留。
5. Vercel 适配托管数据库和 Blob，直传避免 4.5 MB 函数载荷上限。资产公开时仍必须经过满足沙箱、撤销和权限规则的响应层，不能裸露不可撤销的公共对象 URL。
6. OG 在发布侧生成或采用兼容运行时的 WASM 渲染；手动封面和原始 meta 的优先级不变。字体大小、CPU 与平台配额需真实验证。

## 一键部署的完成标准

点击按钮后由平台引导创建所需数据库、存储和 secrets，首次进入生成管理员身份；用户不手写 SQL、不手动拼连接串。缺少权限、存储或初始化失败时明确退出，不退化为内存库。

每个平台独立验收：空账号安装 → 管理员接入 → 邀请朋友 → Agent 发布多文件站点 → 同地址更新 → 原文一致 → OG 预览 → 重建后数据仍在 → 并发冲突 → 下架/恢复 → 备份恢复。最后才添加部署按钮和“支持”标记。

优先完成 Docker 和独立仓库，再做 Cloudflare 原生版，最后复用存储接口实现 Vercel。当前既有站点继续运行，不混入未经验证的云适配实验。
