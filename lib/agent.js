"use strict";

function installPrompt(baseUrl, access = {}) {
  const invitation = access.invite ? `\n\n本次邀请码：${access.invite}\n用它自动兑换独立发布空间，无须注册。` : "";
  const connection = access.connect ? `\n\n本次连接码：${access.connect}\n${access.recovery ? "这是恢复连接指令，24 小时内有效。兑换后撤销旧连接与网页登录状态，保留原空间和作品。" : "用它连接我现有的发布空间；15 分钟内有效。"}` : "";
  return `请帮我接入 Quickshare，以后直接在与你的对话中发布网页和文档。

先阅读 ${baseUrl}/skill.md，检查并安装 CLI；支持本地技能时，安装为 qiaomu-quickshare。

保留已有连接。若这段指令附有邀请码或连接码，按照技能说明自动完成接入，不要求我先注册或手动生成令牌。验证码只从标准输入传入；本地生成的私密令牌保存在权限为 600 的配置文件里，不输出到聊天或日志。若没有附带验证码且尚未连接，只问我要一个邀请链接或邀请码。

完成 whoami 和 capabilities 只读检查，确认我是谁、拥有哪些权限和可用工具。以后按我的要求，在对话中发布、更新、设置分享卡片和管理账号；本次不自动上传文件，也不修改账号。${invitation}${connection}`;
}

function agentSkill(baseUrl) {
  return `---
name: qiaomu-quickshare
description: "Manage Quickshare (QS/qs) through an Agent conversation: publish/update sites, sharing cards and SEO, account identity/username/password, versions, visibility and authorized friend invitations. Trigger on Quickshare, 发布到qs, 更新qs, 分享设置, or Quickshare账号管理."
metadata:
  author: 向阳乔木
  version: "1.4.1"
---

# Quickshare

Publish static files to ${baseUrl} using an individual member account.
Copyright (c) 向阳乔木
X: https://x.com/vista8
GitHub: https://github.com/joeseesun/

## Install and connect

An installation request authorizes setup only. Do not publish any files until the user chooses what to share.

1. Check for an existing Quickshare CLI and configuration; reuse them when they already point to ${baseUrl}. Do not overwrite another server's configuration.
2. Run \`node --version\`. Node.js 24 or newer is required. If unavailable, explain the prerequisite and follow the user's normal software installation process.
3. Download ${baseUrl}/client/quickshare.js to a suitable user-owned tools directory, preserving existing files. This CLI is a standalone script using Node built-ins; no npm dependencies are needed for normal publishing. Record its absolute path. The commands below use \`quickshare.js\` as shorthand for that path.
4. If the agent supports local skills, save this document as \`SKILL.md\` inside a \`qiaomu-quickshare\` folder in that agent's supported skills directory. Preserve the YAML frontmatter. Follow the agent's documented installation conventions; do not guess a universal skill path or overwrite an existing skill without checking it. If skills are unsupported, use the CLI directly and explain the scope.
5. Run \`doctor --json\` if a configuration exists. Reuse a working connection and do not consume a new invite. Registration is optional: invitations activate independent member spaces with no username/password form. An attached invitation authorizes accepting that invitation; an attached connection code authorizes connecting that existing space.
6. For an invitation, run \`join\`; for a connection code, run \`connect\`. Supply the code through process stdin using a tool's stdin facility or a private mode-600 temporary file. Do not interpolate codes into command arguments, shell history or logs, and do not repeat them in chat. Remove a temporary code file after use. Do not automate webpage form entry or require the user to register.

\`\`\`sh
node quickshare.js join --url ${baseUrl} --invite-stdin < PRIVATE_INVITE_FILE
# OR: connect the same space the user already uses in the browser
node quickshare.js connect --url ${baseUrl} --code-stdin < PRIVATE_CONNECTION_FILE
node quickshare.js doctor --json
\`\`\`

Use only the matching command. The CLI generates and privately saves its key BEFORE redemption, and the server makes a retry with that key safe. If a response is lost, keep that pending config and rerun the same command with the same code. Do not delete a pending config or generate another key, which would lose access to the accepted invitation. Invitations never grant admin access. A connection code carries the existing member’s permissions; treat it as a private one-use credential. An invitation is one-use and expires in 7 days; a connection code is one-use and expires in 15 minutes. Administrator-issued recovery codes instead expire in 24 hours and reconnect the original space; redeeming them revokes previous Agent keys and browser sessions. If expired, ask for a fresh invitation or a fresh copied Prompt. If a saved connection returns HTTP 401, join/connect preserves a private backup and creates a fresh key for the supplied new code; other errors leave the config unchanged.

If no code is attached and there is no working connection, ask only for an invitation link/code. Do not tell the user to register or fetch an admin token. Existing members may copy a fresh Prompt from their signed-in Quickshare page to connect the same space. The legacy personal-token \`login --token-stdin\` flow remains supported.

The CLI stores its configuration at \`~/.config/quickshare/config.json\` with mode 600. Use \`QUICKSHARE_CONFIG\` with a separate private path for another server, preserving the user's existing configuration. Do not display configuration contents.

\`doctor\` is a read-only authenticated account check. Report the actual installation paths and connection result. If authentication is still pending, say so rather than claiming setup is complete. Then ask what the user wants to publish. Username and password are optional; use the account command or browser settings when the user requests a change, preserving member ID and all content. Use \`dashboard\` for a one-use browser login link when the user asks to manage the space; this link is sensitive and must not be logged or published.

## Know the current space before acting

At the start of a management conversation, run \`whoami --json\` and \`capabilities --json\`. Read the current member ID, username, role, registration status, connection type, own-site usage, limits, permissions, defaults and available commands. Fetch current identity again after account changes; never assume a local nickname is the server identity. Never infer capabilities from this text when the live server disagrees. An existing client may need updating: compare \`--version\` with capabilities.cliVersion, download the current standalone CLI while preserving the original and private config, then refresh this Skill while retaining user-specific profile/trigger instructions. Do not overwrite a working connection or automatically consume an invite during upgrade.

Commands return JSON with \`--json\`; failures return a structured error on stderr. Ordinary members act on their own sites/account. Administrators may manage other sites/friends but account mutations always target the authenticated member, not a supplied member ID. Do not switch to a different configuration or administrator token after a permission error.

## Account changes in the conversation

Use \`account --json\` to read current account state and revision. \`account --username NEW_NAME\` changes only the username, including already registered accounts. Password changes require an explicit user request. Never change a real user's credentials just to test this feature.

- A supplied password goes through \`account --password-stdin\` using process stdin or a mode-600 private temporary file, never argv, an environment variable, logs or chat output. Remove temporary transport files afterward.
- If the user asks you to choose a password, use \`account --generate-password --output PRIVATE_NEW_FILE\`. It creates a cryptographically random password in a new mode-600 file before the request and reports only its path. Tell the user where it is saved without repeating its contents. The file may exist after a failed request; verify login before calling it active. Never overwrite an existing password file.
- Username and password can be updated together. Password changes revoke old browser sessions and pending login/connection links, while active Agent/CLI keys remain connected. They do not change member ID, ownership, site URLs, gallery visibility or search settings.
- After success, re-read \`whoami\`; password mutations also verify the new password through an authenticated check that creates no session. Use \`account --verify-password-stdin\` to check a supplied password without changing anything. On a lost response, verify current account/login instead of blindly repeating the mutation. A 409 requires a fresh read and resolution of the changed state.
- Web settings can make the same edits. Passwords are never readable back from the server. Use \`dashboard --output PRIVATE_FILE\` only when the user wants the browser; the one-use URL is sensitive.

## Other management tools

\`visibility SLUG --gallery true|false --published true|false\` updates only visibility with revision checking. No options means read-only. \`sharing SLUG --preview ...\` previews proposed title/description/cover without saving; add \`--output preview.png\` to save an automatically generated/uploaded raster preview for visual inspection. Do not silently overwrite the output file. Existing OG image URLs are returned for inspection without a server-side fetch. Keep enhancements and search indexing opt-in; original webpage metadata wins, and the author can change settings in the dashboard.

For an administrator only: \`friends --json\`, \`friend MEMBER_ID --note TEXT\`, \`friend MEMBER_ID --disabled true|false\`, \`invite NAME --output PRIVATE_FILE\`, \`reinvite INVITE_ID --output PRIVATE_FILE\`, \`revoke-invite INVITE_ID\`, and \`recover MEMBER_ID --output PRIVATE_FILE\`. Identify the correct member/invitation from the live list. Creating a recovery prompt does not revoke access until redemption. Invites and recovery prompts are private, and administrator notes never belong in a friend's prompt. Do not send prompts to another person without the user's explicit instruction.

## Publish only the selected content

Confirm the intended file or static build output if the target is ambiguous. Explain that anyone with the link can view it, even when it is not in the gallery. Build frontend applications locally, then publish only their static output. Publish the selected content as provided; do not add attribution, promotional links, watermarks or extra explanations to it.

\`\`\`sh
node quickshare.js publish ./index.html
node quickshare.js publish ./article.md
node quickshare.js publish ./dist
node quickshare.js update RETURNED_SLUG ./dist
node quickshare.js list --json
node quickshare.js versions my-tool
node quickshare.js rollback my-tool 1
node quickshare.js unpublish my-tool
node quickshare.js restore my-tool
\`\`\`

Report the returned \`work.url\`; updates preserve the site's link. New sites are unlisted unless the user chooses gallery visibility with \`--listed\`. An unlisted link is not access control. Never silently add a site to the gallery.

The server assigns an address from the title plus a random suffix. Do not ask the user to choose a slug or invent one; use \`--slug\` only when the user explicitly requests a custom address. Save the returned slug with the source association so later updates target the same site. Changing the title or account name does not change the URL.

Retrying the same publish command with unchanged source path, content, options and member returns the original site, even after a lost response or CLI restart. A changed file is a new publish request: to revise an existing site, use \`update RETURNED_SLUG FILE\`. Use \`--request-id ID\` (16–128 letters, numbers, underscores or hyphens) only for an explicitly separate new site or for a caller-managed request; retain the same ID and payload when retrying. A reused ID with different content is rejected. If the server does not support automatic addresses, stop and request an upgrade; do not fall back to creating another random URL after an ambiguous response.

## Share cards and search

Sharing enhancement and search indexing both default off and are independent of gallery visibility. Preserve original source and never enable either without the user choosing it. Read settings with \`node quickshare.js sharing SLUG --json\`. On request, use \`sharing SLUG --share-enabled true --title "Title" --description "Description" --cover ./cover.png\`; cover is optional. Use \`--indexable true\` only when the author wants search visibility. \`--share-enabled false\` restores byte-for-byte original output. Original OG tags and noindex directives always win; explain any existing source restriction. Downloads retain original HTML.

## Limits and runtime

- A directory needs \`index.html\` or \`index.md\`. Limits: 100 files, 5 MB each, 8 MB combined (including rendered Markdown).
- Exclude secrets, dotfiles, source repositories, databases and node_modules. The CLI rejects symlinks. Do not upload unrelated files or install extra tools without authorization.
- Only static hosting is supported; there is no server-side Node/Python/PHP execution.
- Uploaded pages use an opaque sandbox origin. localStorage, authenticated requests to management APIs and Service Workers are unavailable.
- Relative static resources and ES modules work. Root-relative paths need a relative build base. Original Markdown remains downloadable as \`index.md\`.
- \`--capture\` is optional and requires the full repository installation; the standalone CLI does not provide it. Do not use it during basic installation.
- A single exported entry HTML from a directory can still depend on other site files; do not call it an offline single-file export.
`;
}

function capabilities(baseUrl, state) {
  const entry = (name, command, method, endpoint, options = {}) => ({name, command, method, endpoint, mutates: method !== "GET", ...options});
  const tools = [
    entry("identity", "whoami --json", "GET", "/api/v1/me"),
    entry("capabilities", "capabilities --json", "GET", "/api/v1/capabilities"),
    entry("account.read", "account --json", "GET", "/api/v1/account"),
    entry("account.verifyPassword", "account --verify-password-stdin", "POST", "/api/v1/account/verify-password", {mutates:false,sensitiveInput:true}),
    entry("account.update", "account --username NAME --password-stdin", "PATCH", "/api/v1/account", {scope:"self", fields:{revision:"required integer from account.read",username:"optional string, 3–30 lowercase letters/digits/_/-",password:"optional secret, 12–200 characters; stdin only"}, effects:"Username keeps member ID, ownership and links. Password revokes web sessions and pending login/connection grants, preserves active Agent keys."}),
    entry("sites.list", "list --json", "GET", "/api/v1/works?all=true"),
    entry("sites.read", "get SLUG --json", "GET", "/api/v1/works/:slug"),
    entry("sites.publish", "publish FILE_OR_DIRECTORY", "POST", "/api/v1/works", {retry:"Reuse requestId and identical payload; do not allocate a new request after an uncertain response."}),
    entry("sites.update", "update SLUG FILE_OR_DIRECTORY", "PUT", "/api/v1/works/:slug", {precondition:"content revision"}),
    entry("sites.visibility", "visibility SLUG --gallery true|false --published true|false", "PATCH", "/api/v1/works/:slug", {precondition:"content revision"}),
    entry("sites.unpublish", "unpublish SLUG", "PATCH", "/api/v1/works/:slug", {effect:"reversible; public link becomes unavailable"}),
    entry("sites.restore", "restore SLUG", "PATCH", "/api/v1/works/:slug"),
    entry("versions.list", "versions SLUG --json", "GET", "/api/v1/works/:slug/versions"),
    entry("versions.restore", "rollback SLUG REVISION", "POST", "/api/v1/works/:slug/rollback"),
    entry("sharing.read", "sharing SLUG --json", "GET", "/api/v1/works/:slug/sharing"),
    entry("sharing.preview", "sharing SLUG --preview --share-enabled true", "POST", "/api/v1/works/:slug/sharing-preview", {mutates:false}),
    entry("sharing.update", "sharing SLUG --share-enabled true|false --title TEXT --description TEXT --cover FILE --indexable true|false", "PATCH", "/api/v1/works/:slug/sharing", {precondition:"content revision and shareRevision", policy:"Original OG wins. Only enable sharing enhancement or search indexing when the author chooses it."}),
    entry("dashboard.open", "dashboard --output PRIVATE_FILE", "POST", "/api/v1/dashboard-link", {sensitiveOutput:true}),
  ];
  if (state.permissions.manageFriends) tools.push(
    entry("friends.list", "friends --json", "GET", "/api/v1/friends"),
    entry("friends.update", "friend MEMBER_ID --note TEXT | --disabled true|false", "PATCH", "/api/v1/members/:id", {effect:"Disabling revokes this member's connections; content is retained."}),
    entry("friends.invite", "invite NAME --output PRIVATE_FILE", "POST", "/api/v1/invites", {sensitiveOutput:true}),
    entry("friends.reinvite", "reinvite INVITE_ID --output PRIVATE_FILE", "POST", "/api/v1/invites/:id/reissue", {sensitiveOutput:true}),
    entry("friends.revokeInvite", "revoke-invite INVITE_ID", "DELETE", "/api/v1/invites/:id"),
    entry("friends.recover", "recover MEMBER_ID --output PRIVATE_FILE", "POST", "/api/v1/members/:id/recovery", {sensitiveOutput:true,effect:"Redeeming recovery reconnects the same member and revokes their old access."}),
  );
  return {schemaVersion:1, cliVersion:"1.4.1", baseUrl, skillUrl:baseUrl+"/skill.md", ...state, tools,
    boundaries:["Only act on the authenticated member's request; never switch to an admin profile to bypass permissions.","Password values and credential hashes are never readable.","No permanent site/account deletion, custom domains, server code execution or billing API.","Global token rotation is currently a browser account action; normal password updates preserve Agent keys."],
    errors:{401:"Connection unavailable: retain local config and reconnect using an authorized invitation/connection/recovery.",403:"Permission denied: do not retry with another profile.",409:"Read current state; do not blindly overwrite or repeat an uncertain account mutation.",429:"Respect rate limiting; retry later."}};
}
module.exports = { installPrompt, agentSkill, capabilities };
