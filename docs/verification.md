# 独立安装验收

2026-09-10，当前导入版本。

- 独立目录 `npm ci --ignore-scripts` 成功，无旧仓库依赖软链接。
- `npm run check` 通过；`npm test` 43 项通过。
- `npm run verify:ui` 通过：真实 Chrome 桌面和 390px，首页、邀请、朋友接入、目录发布、隔离、版本、复制、密码与停用。已检查首页桌面与移动截图，见 `docs/assets/`。
- `node scripts/verify-docker.cjs` 通过：用 Docker 初始化 600 权限配置并验证再次初始化保留原密钥；非 root/只读根目录启动；首页、指南、CLI、Skill 下载；未认证接口拒绝；HTML 原样发布与 opaque sandbox；1200×630 中文 OG PNG；容器重建保留账号和网站；版本冲突及更新。
- Docker 验收仅创建独立测试 Compose 项目与临时卷，结束后已清理。测试未连接生产账户。
- 导入文件已检查真实 Quickshare 凭据、GitHub Token 模式、私有路径、数据库和备份，无匹配。

Docker 本地验证不等同 Cloudflare / Vercel 部署验收。两种云适配尚未实现，README 不提供不可用的部署按钮。旧生产服务没有因本次拆仓库被迁移或重启。

CI 对 PR 运行 Node 检查、43 项测试，以及 Linux Docker 集成验收；具体状态以对应提交的 GitHub Actions 为准。
