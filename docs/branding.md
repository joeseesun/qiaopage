# QiaoPage 与 Quickshare 的兼容性

QiaoPage（乔木发布）是从 Quickshare 演进而来的 Agent 发布服务，新的开源仓库为 [joeseesun/qiaopage](https://github.com/joeseesun/qiaopage)。旧项目与已有实例独立维护。

页面、README 和仓库采用新品牌。以下标识保留，用于现有安装直接升级：

- CLI 命令 `quickshare`、`bin/quickshare.js`、下载路径 `/client/quickshare.js`。
- Skill 标识 `qiaomu-quickshare`，同时识别 QiaoPage、乔木发布、Quickshare、`qp` / `QP` 和 `qs` / `QS`。
- `QUICKSHARE_*` 环境变量、`~/.config/quickshare/` 配置目录、数据库与 Compose 服务名。
- API 路径、网站 slug、分享链接和账号身份。
- 云安装脚本不传项目名时仍使用 `quickshare-agent`；新安装可显式传入 `qiaopage` 或自己的项目名。升级已有云实例时务必沿用原来的项目名。

更名不需要迁移数据、重新邀请朋友或重建连接。不要为了更名批量替换已有数据库、云资源名或本地凭据路径。

## 对话中的简称

可以说“发布到 qp”“发布到qp”“发到 quickshare”“更新 qs 上的网页”或“列出 QiaoPage 的网站”。英文名称不区分大小写，有无空格都能识别；它们使用同一份已配置连接。

这些是 Agent 的自然语言触发词。终端仍使用 `quickshare` 或 `node quickshare.js`，不会自动创建可能冲突的 `qp` / `qs` shell 命令。询问简称或单独说一个简称不会触发上传。

已有安装无需改目录名、重新注册或重新邀请。复制自己实例的新版 Prompt 给 Agent，检查后原位更新 `qiaomu-quickshare/SKILL.md`，保留个人发布配置和路径；不要另装一个重复技能。Skill 文档版本与 CLI 版本分别管理。
