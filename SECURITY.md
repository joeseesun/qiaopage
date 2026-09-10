# 安全说明

账号、邀请、凭据与管理 API 仅面向受邀成员。管理员密钥、浏览器 Cookie、Agent Token、邀请/恢复链接、数据库与备份都属于敏感数据，不应提交到 Issues 或仓库。

报告漏洞时优先使用 GitHub Private vulnerability reporting（若仓库已启用），或通过维护者 [X](https://x.com/vista8) 私下联系。不要公开有效凭据、他人内容或可直接利用的生产细节。

上传内容必须保持 opaque sandbox；管理 API 不向上传内容开放 CORS。普通成员只能管理自己的内容。任何拿到已发布链接的人均可访问该网站；不要上传密码、个人敏感数据或尚未准备公开的文件。

升级前备份数据。已有多成员数据不能回滚到忽略 owner_id 或 listed 的旧版本。Cloudflare 使用 Durable Objects + 私有 R2；Vercel 使用 Turso + 私有 Blob。不要把本地 SQLite 或文件存储放到临时磁盘上承载真实数据。
