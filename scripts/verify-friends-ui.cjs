const { chromium } = require("playwright");
const { createApp } = require("../server");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const base = "http://127.0.0.1:39997",
  token = "local-browser-test-only-".repeat(3),
  root = path.join(__dirname, "..");
(async () => {
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  const runtime = await createApp({ token, dbPath: ":memory:", baseUrl: base });
  const server = await new Promise((resolve) => {
    const s = runtime.app.listen(39997, "127.0.0.1", () => resolve(s));
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const errors = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  const page = await context.newPage();
  const request = async (p, body, method = "POST") => {
    const r = await fetch(base + p, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.ok(r.ok, await r.clone().text());
    return r.json();
  };
  try {
    await page.goto(base);
    await page.getByRole("heading", { name: /做好了，\s*就分享。/ }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const setupPrompt = await (await fetch(base + "/agent-prompt.txt")).text();
    await page.locator("#welcome [data-copy-agent]").click();
    await page.waitForFunction(() => document.querySelector("#agent-feedback").textContent.includes("已复制"));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), setupPrompt);
    assert.equal(await page.locator("#auth-dialog").isVisible(), false);
    await page.locator("#agent-feedback").waitFor({state: "hidden"});
    await page.screenshot({
      path: path.join(root, "artifacts/friends-welcome.png"),
      fullPage: true,
    });
    // Header, primary action, explanatory copy and footer must fit the actual browser viewport.
    const screenFits = [];
    for (const size of [{width: 1271, height: 696}, {width: 1440, height: 800}, {width: 1024, height: 600}, {width: 390, height: 667}]) {
      await page.setViewportSize(size);
      const geometry = await page.evaluate(() => ({
        viewport: {width: innerWidth, height: innerHeight},
        page: {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight},
        headerTop: document.querySelector('.top').getBoundingClientRect().top,
        footerBottom: document.querySelector('body > footer').getBoundingClientRect().bottom,
        cta: document.querySelector('#welcome [data-copy-agent]').getBoundingClientRect().bottom,
      }));
      assert.ok(geometry.page.height <= size.height + 1, JSON.stringify(geometry));
      assert.ok(geometry.page.width <= size.width, JSON.stringify(geometry));
      assert.ok(geometry.headerTop >= 0 && geometry.footerBottom <= size.height + 1 && geometry.cta <= size.height, JSON.stringify(geometry));
      screenFits.push(geometry);
      await page.screenshot({path: path.join(root, `artifacts/welcome-${size.width}x${size.height}.png`)});
    }
    fs.writeFileSync(path.join(root, 'artifacts/welcome-screen-fit.json'), JSON.stringify(screenFits, null, 2));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path: path.join(root, "artifacts/friends-welcome-mobile.png"), fullPage: true});
    await page.locator("#login-button").click();
    await page.getByRole("heading", { name: "欢迎回来" }).waitFor();
    await page.screenshot({path: path.join(root, "artifacts/friends-login-mobile.png"), fullPage: true});
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#auth-dialog").isVisible(), false);
    assert.equal(await page.locator("#login-button").evaluate(el => el === document.activeElement), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const fallbackPage = await context.newPage();
    await fallbackPage.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {value: {writeText: async () => {throw new Error("Clipboard disabled for acceptance");}}});
    });
    await fallbackPage.goto(base + "/publish");
    await fallbackPage.locator("[data-copy-agent]").click();
    await fallbackPage.locator("#agent-dialog").waitFor({state: "visible"});
    assert.equal(await fallbackPage.locator("#install-prompt").inputValue(), setupPrompt);
    assert.equal(await fallbackPage.locator("#install-prompt").evaluate(el => el.selectionEnd - el.selectionStart), setupPrompt.length);
    await fallbackPage.keyboard.press("Escape");
    assert.equal(await fallbackPage.locator("[data-copy-agent]").evaluate(el => el === document.activeElement), true);
    await fallbackPage.setViewportSize({width: 390, height: 844});
    assert.equal(await fallbackPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await fallbackPage.screenshot({path: path.join(root, "artifacts/friends-install-mobile.png"), fullPage: true});
    await fallbackPage.close();
    const { url } = await request("/api/v1/dashboard-link", {});
    await page.goto(url);
    await page.getByRole("heading", { name: "发布，然后分享" }).waitFor();
    await page.getByRole("button", { name: "朋友", exact: true }).click();
    await page.getByRole("button", { name: "邀请朋友" }).click();
    await page.getByPlaceholder("例如：小林").fill("小林");
    await page.screenshot({path:path.join(root,"artifacts/friends-invite-simple.png"),fullPage:true});
    await page.getByRole("button", { name: "生成并复制" }).click();
    await page.locator("#invite-result").waitFor({ state: "visible" });
    const invitation = await page.locator("#invite-url").inputValue();
    await page.waitForFunction(() => document.querySelector("#invite-result-message").textContent.includes("已复制"));
    const invitedPrompt = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(invitedPrompt.includes(new URL(invitation).hash.slice(8)));
    assert.ok(!invitedPrompt.includes("小林"));
    await page.locator("#invite-alternative summary").click();
    await page.getByRole("button", { name: "复制邀请链接" }).click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      invitation,
    );
    await page.locator("#invite-dialog [data-close]").click();
    const pendingRow = page.locator(".friend-row").filter({hasText:"小林"});
    await pendingRow.getByText("待加入",{exact:true}).waitFor();
    const friendRowId = await pendingRow.getAttribute("data-friend-id");
    const friendContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const friend = await friendContext.newPage();
    friend.on("pageerror", (e) => errors.push(e.message));
    await friend.goto(invitation);
    await friend.getByRole("heading", { name: "你的作品，即刻出发。" }).waitFor();
    assert.equal(new URL(friend.url()).hash, "");
    await friend.locator("[data-invite-agent]").click();
    assert.ok((await friend.evaluate(() => navigator.clipboard.readText())).includes(new URL(invitation).hash.slice(8)));
    await friend.screenshot({path: path.join(root, "artifacts/friends-guest-invite.png")});
    await friend.getByRole("button", { name: "免注册开始使用" }).click();
    await friend.getByRole("heading", { name: "发布，然后分享" }).waitFor();
    const guest = await friend.evaluate(async () => (await (await fetch("/api/v1/me")).json()).member);
    assert.equal(guest.registered, false);
    await page.getByRole("button", {name:"朋友",exact:true}).click();
    await page.locator(`[data-friend-id="${friendRowId}"]`).getByText("已加入",{exact:true}).waitFor();
    await friend.locator("#workspace .workspace-agent [data-copy-agent]").click();
    await friend.waitForFunction(async () => /本次连接码：[a-f0-9]{64}/.test(await navigator.clipboard.readText()));
    assert.match(await friend.evaluate(() => navigator.clipboard.readText()), /本次连接码：[a-f0-9]{64}/);
    await friend.locator("#account-button").click();
    await friend.locator("#password-form [name=username]").fill("xiaolin");
    await friend.locator("#password-form [name=password]").fill("qa-password-123456");
    await friend.getByRole("button", {name: "保存账号"}).click();
    await friend.locator("#toast").filter({hasText: "密码已保存"}).waitFor();
    const registered = await friend.evaluate(async () => (await (await fetch("/api/v1/me")).json()).member);
    assert.equal(registered.id, guest.id);
    assert.equal(registered.registered, true);
    await friend.locator("#account-dialog [data-close]").click();
    assert.equal(await friend.locator("#invite-button").isVisible(), false);
    const site = path.join(root, "artifacts/qa-site");
    fs.mkdirSync(path.join(site, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(site, "index.html"),
      '<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>午后的小实验</title><link rel="stylesheet" href="assets/style.css"><h1>午后的小实验</h1><button id="counter">试一下</button><p id="count">0</p><a href="second.html">下一页</a><img src="assets/pic.svg" alt="绿色圆圈"><script type="module" src="assets/main.js"></script></html>',
    );
    fs.writeFileSync(
      path.join(site, "second.html"),
      '<h1>第二页</h1><a href="./">回到首页</a>',
    );
    fs.writeFileSync(
      path.join(site, "assets/style.css"),
      "body{background:#f8f9f6;color:#203c30;padding:48px;font-family:system-ui}button{padding:12px}img{width:80px;display:block;margin-top:30px}",
    );
    fs.writeFileSync(
      path.join(site, "assets/main.js"),
      'import {step} from "./step.js";document.querySelector("button").onclick=()=>{document.querySelector("#count").textContent=step(Number(document.querySelector("#count").textContent));}',
    );
    fs.writeFileSync(
      path.join(site, "assets/step.js"),
      "export const step=n=>n+1;",
    );
    fs.writeFileSync(
      path.join(site, "assets/pic.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="38" fill="#285c45"/></svg>',
    );
    fs.writeFileSync(path.join(site, ".env"), "PRIVATE_DO_NOT_PUBLISH");
    await friend.locator("#folder-input").setInputFiles(site);
    await friend.locator("#publish-form [name=title]").fill("午后的小实验");
    assert.equal(await friend.locator("#publish-form [name=slug]").isVisible(), false);
    await friend.locator("#toast.show").waitFor({state:"hidden"});
    await friend.locator("#agent-feedback").waitFor({state:"hidden"});
    await friend.screenshot({path: path.join(root, "artifacts/publish-auto-desktop.png"), fullPage:true});
    await friend.setViewportSize({width:390,height:844});
    assert.ok(await friend.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await friend.screenshot({path: path.join(root, "artifacts/publish-auto-mobile.png"), fullPage:true});
    await friend.locator("#publish-link-settings summary").click();
    await friend.locator("#publish-form [name=slug]").fill("optional-custom-link");
    await friend.screenshot({path: path.join(root, "artifacts/publish-custom-mobile.png"), fullPage:true});
    await friend.locator("#publish-form [name=slug]").fill("");
    await friend.locator("#publish-link-settings summary").click();
    await friend.setViewportSize({width:1440,height:1000});
    // The server accepts the publication, but the browser loses its first response.
    let lostRequestId;
    await friend.route("**/api/v1/works", async route => {
      if (route.request().method() !== "POST") return route.continue();
      lostRequestId = route.request().postDataJSON().requestId;
      const accepted = await route.fetch();
      assert.equal(accepted.status(), 201);
      await route.abort("failed");
    });
    await friend.getByRole("button", { name: "发布并获取链接" }).click();
    await friend.locator("#publish-error").getByText(/连接中断/).waitFor();
    await friend.unroute("**/api/v1/works");
    await friend.reload();
    await friend.locator("#workspace").waitFor({state:"visible"});
    await friend.locator("#folder-input").setInputFiles(site);
    await friend.locator("#publish-form [name=title]").fill("午后的小实验");
    let retryRequestId;
    friend.on("request", req => { if(req.method() === "POST" && new URL(req.url()).pathname === "/api/v1/works") retryRequestId = req.postDataJSON().requestId; });
    await friend.getByRole("button", { name: "发布并获取链接" }).click();
    await friend.locator("#publish-success").waitFor({ state: "visible" });
    const siteUrl = await friend.locator("#published-url").textContent();
    assert.match(siteUrl, /\/s\/site-[a-z2-9]{10}\/$/);
    assert.equal(retryRequestId, lostRequestId);
    assert.equal(await friend.locator(".site-row").count(), 1);
    await friend
      .getByRole("button", { name: "复制链接", exact: true })
      .first()
      .click();
    assert.equal(
      await friend.evaluate(() => navigator.clipboard.readText()),
      siteUrl,
    );
    const sitePage = await friendContext.newPage();
    await sitePage.goto(siteUrl);
    await sitePage.locator("#counter").click();
    assert.equal(await sitePage.locator("#count").textContent(), "1");
    assert.equal(
      await sitePage.locator("h1").evaluate((el) => getComputedStyle(el).color),
      "rgb(32, 60, 48)",
    );
    assert.equal(
      await sitePage.locator("img").evaluate((el) => el.naturalWidth),
      80,
    );
    assert.equal(
      await sitePage.evaluate(() => {
        try {
          return localStorage.length;
        } catch (e) {
          return e.name;
        }
      }),
      "SecurityError",
    );
    const probe = await sitePage.evaluate(async () => {
      try {
        await fetch("/api/v1/works?all=true", { credentials: "include" });
        return "readable";
      } catch {
        return "blocked";
      }
    });
    assert.equal(probe, "blocked");
    await sitePage.getByRole("link", { name: "下一页" }).click();
    await sitePage.getByRole("heading", { name: "第二页" }).waitFor();
    await sitePage.getByRole("link", { name: "回到首页" }).click();
    await sitePage.getByRole("heading", { name: "午后的小实验" }).waitFor();
    await sitePage.close();
    await friend.getByRole("button", { name: "管理", exact: true }).click();
    const originalShareHtml = await (await fetch(siteUrl)).text();
    await friend.locator("#sharing-settings summary").click();
    await friend.locator("#sharing-form").waitFor({state:"visible"});
    assert.equal(await friend.locator("#share-enabled").isChecked(), false);
    await friend.locator("#share-enabled").check();
    await friend.locator("#share-title").waitFor({state:"visible"});
    await friend.locator("#share-title").fill("午后的小实验");
    await friend.locator("#share-description").fill("一个想法，从这里开始。把好奇心变成可以打开的作品。");
    await friend.waitForFunction(() => document.querySelector("#share-preview-description").textContent.includes("好奇心"));
    await friend.waitForFunction(() => document.querySelector("#share-preview-image").complete && document.querySelector("#share-preview-image").naturalWidth === 1200);
    for (const size of [{width:1440,height:1000},{width:390,height:844}]) {
      await friend.setViewportSize(size);
      await friend.locator("#sharing-settings").scrollIntoViewIfNeeded();
      assert.equal(await friend.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await friend.locator("#detail-dialog").evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await friend.screenshot({path:path.join(root,`artifacts/sharing-${size.width}.png`)});
    }
    await friend.locator("#share-save").click();
    await friend.waitForFunction(() => document.querySelector("#toast").textContent === "分享设置已保存");
    const changedShareHtml = await (await fetch(siteUrl)).text();
    assert.match(changedShareHtml, /og:title/);
    assert.equal((await fetch(siteUrl)).headers.get("x-robots-tag"), "noindex");
    await friend.locator("#share-indexable").check();
    await Promise.all([friend.waitForResponse(r => r.url().endsWith("/sharing") && r.request().method() === "PATCH" && r.ok()), friend.locator("#share-save").click()]);
    assert.equal((await fetch(siteUrl)).headers.get("x-robots-tag"), null);
    await friend.locator("#share-enabled").uncheck();
    await friend.locator("#share-indexable").uncheck();
    await Promise.all([friend.waitForResponse(r => r.url().endsWith("/sharing") && r.request().method() === "PATCH" && r.ok()), friend.locator("#share-save").click()]);
    assert.equal(await (await fetch(siteUrl)).text(), originalShareHtml);
    await friend.locator("#sharing-settings summary").click();
    await friend.setViewportSize({width:390,height:844});
    const [chooser] = await Promise.all([
      friend.waitForEvent("filechooser"),
      friend.getByRole("button", { name: "更新文件", exact: true }).click(),
    ]);
    const md = path.join(root, "artifacts/update.md");
    fs.writeFileSync(
      md,
      "# 阅读实验\n\n## 今天\n\n- [x] 发布\n\n```js\nconst answer=42;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    await chooser.setFiles(md);
    await friend.getByRole("button", { name: "更新这个链接" }).click();
    await friend.locator("#publish-success").waitFor({ state: "visible" });
    await friend.getByRole("button", { name: "管理", exact: true }).click();
    await friend.getByRole("button", { name: "恢复此版本" }).first().click();
    await friend.locator("#confirm-ok").click();
    await friend
      .locator("#version-list")
      .getByText("当前版本", { exact: true })
      .waitFor();
    assert.equal((await fetch(siteUrl + "assets/main.js")).status, 200);
    await friend.getByRole("button", { name: "展示到展厅" }).click();
    await friend.getByRole("button", { name: "移出展厅" }).waitFor();
    await friend.getByRole("button", { name: "下架链接" }).click();
    await friend.locator("#confirm-ok").click();
    await friend.getByRole("button", { name: "恢复发布" }).waitFor();
    assert.equal((await fetch(siteUrl)).status, 404);
    await friend.getByRole("button", { name: "恢复发布" }).click();
    await friend.getByRole("button", { name: "下架链接" }).waitFor();
    await friend.locator("#detail-dialog [data-close]").click();
    await page.reload();
    await page.getByRole("button",{name:/全部内容/}).click();
    await page.locator(".site-row").waitFor();
    await page.screenshot({
      path: path.join(root, "artifacts/friends-dashboard-desktop.png"),
      fullPage: true,
    });
    await friend.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await friend.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await friend.screenshot({
      path: path.join(root, "artifacts/friends-dashboard-mobile.png"),
      fullPage: true,
    });
    await friend.getByRole("button", { name: "账号", exact: true }).click();
    await friend.locator("#password-form").waitFor({state:"visible"});
    for (const size of [{width:1440,height:1000},{width:390,height:844}]) {
      await friend.setViewportSize(size);
      await friend.screenshot({path:path.join(root,`artifacts/account-${size.width}.png`)});
      assert.ok(await friend.locator("#account-dialog").evaluate(el=>el.scrollWidth<=el.clientWidth));
    }
    await friend.locator("#password-form [name=username]").fill("xiaolin-renamed");
    await friend.locator("#account-save").click();
    await friend.locator("#toast").filter({hasText:"用户名已保存"}).waitFor();
    assert.equal(runtime.db.prepare("SELECT username FROM members WHERE username=?").get("xiaolin-renamed").username,"xiaolin-renamed");
    await friend.locator("#password-form [name=username]").fill("xiaolin");
    await Promise.all([friend.waitForResponse(r=>r.url().endsWith("/api/v1/account")&&r.request().method()==="PATCH"&&r.ok()),friend.locator("#account-save").click()]);
    await friend.getByRole("button", { name: "生成我的令牌" }).click();
    await friend.locator("#confirm-ok").click();
    await friend.locator("#key-result").waitFor({ state: "visible" });
    const key = await friend.locator("#key-value").inputValue();
    assert.ok(key.length >= 32);
    await friend.getByRole("button", { name: "复制令牌" }).click();
    assert.equal(
      await friend.evaluate(() => navigator.clipboard.readText()),
      key,
    );
    await friend
      .locator("#password-form [name=password]")
      .fill("qa-new-password-654321");
    await friend.getByRole("button", { name: "保存账号" }).click();
    await friend.locator("#toast").filter({ hasText: "密码已保存" }).waitFor();
    await friend.locator("#account-dialog [data-close]").click();
    await friend.getByRole("button", { name: "退出", exact: true }).click();
    await friend.locator("#login-button").click();
    await friend.getByRole("heading", { name: "欢迎回来" }).waitFor();
    await friend.locator("#auth-form").getByLabel("用户名", { exact: true }).fill("xiaolin");
    await friend
      .getByLabel("密码", { exact: true })
      .fill("qa-new-password-654321");
    await friend.locator("#auth-submit").click();
    await friend.locator(".site-row").waitFor();
    await friend.getByRole("button", { name: "安装与 CLI" }).click();
    await friend.locator("#guide-panel [data-copy-agent]").click();
    await friend.waitForFunction(async () => /本次连接码：[a-f0-9]{64}/.test(await navigator.clipboard.readText()));
    assert.match(await friend.evaluate(() => navigator.clipboard.readText()), /本次连接码：[a-f0-9]{64}/);
    await friend.screenshot({
      path: path.join(root, "artifacts/friends-guide-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await friend.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.getByRole("button", { name: "朋友", exact: true }).click();
    const managedRow = page.locator(`[data-friend-id="${friendRowId}"]`);
    await managedRow.locator("summary").click();
    await managedRow.getByRole("button",{name:"修改备注",exact:true}).click();
    await page.locator("#note-form [name=note]").fill("小林 · 设计师");
    await page.locator("#note-form button").click();
    await managedRow.getByText("小林 · 设计师",{exact:true}).waitFor();
    const extra = await request("/api/v1/invites", {label:"阿杰 · 独立开发"});
    const expiredInvite = await request("/api/v1/invites", {label:"小陈 · 产品设计"});
    runtime.db.prepare("UPDATE invites SET expires=0 WHERE invite_id=?").run(expiredInvite.id);
    await page.getByRole("button",{name:"朋友",exact:true}).click();
    await page.getByText("邀请过期",{exact:true}).waitFor();
    await page.screenshot({path:path.join(root,"artifacts/friends-management-desktop.png"),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(root,"artifacts/friends-management-mobile.png"),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const expiredRow = page.locator(`[data-friend-id="${expiredInvite.id}"]`);
    await expiredRow.getByRole("button",{name:"重新邀请"}).click();
    await page.locator("#invite-result").waitFor({state:"visible"});
    await page.locator("#invite-dialog [data-close]").click();
    await expiredRow.getByText("待加入",{exact:true}).waitFor();
    await expiredRow.locator("summary").click();
    await expiredRow.getByRole("button",{name:"撤销邀请"}).click();
    await page.locator("#confirm-ok").click();
    await expiredRow.getByText("已撤销",{exact:true}).waitFor();
    await managedRow.getByRole("button",{name:"查看作品"}).click();
    await page.locator("#owner-filter").waitFor({state:"visible"});
    assert.ok((await page.locator("#owner-filter-label").textContent()).includes("小林 · 设计师"));
    await page.reload();
    await page.locator("#owner-filter").waitFor({state:"visible"});
    await page.getByRole("button", {name:"朋友",exact:true}).click();
    await managedRow.locator("summary").click();
    await managedRow.getByRole("button", {name:"恢复连接",exact:true}).click();
    await page.locator("#confirm-ok").click();
    await page.locator("#invite-result").waitFor({state:"visible"});
    await page.waitForFunction(()=>document.querySelector("#invite-result-message").textContent.includes("已复制"));
    assert.ok((await page.evaluate(()=>navigator.clipboard.readText())).includes("恢复连接指令"));
    await page.locator("#invite-dialog [data-close]").click();
    await managedRow.locator("summary").click();
    await managedRow.getByRole("button", { name: "停用", exact: true }).click();
    await page.locator("#confirm-ok").click();
    await managedRow.getByText("已停用",{exact:true}).waitFor();
    await friend.reload();
    await friend.getByRole("heading", { name: "欢迎回来" }).waitFor();
    // Error recovery and clipboard-denied invitation must keep the generated Prompt usable.
    const blockedCopy = await context.newPage();
    await blockedCopy.addInitScript(() => {
      Object.defineProperty(navigator,"clipboard",{value:{writeText:async()=>{throw new Error("QA clipboard unavailable");}}});
    });
    await blockedCopy.route("**/api/v1/friends",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"暂时不可用"})}));
    await blockedCopy.goto(base+"/dashboard?tab=members");
    await blockedCopy.locator("#friends-error").getByText(/暂时不可用/).waitFor();
    await blockedCopy.unroute("**/api/v1/friends");
    await blockedCopy.getByRole("button",{name:"朋友",exact:true}).click();
    await blockedCopy.locator(".friend-row").first().waitFor();
    assert.equal(await blockedCopy.locator("#friends-error").textContent(),"");
    await blockedCopy.getByRole("button",{name:"邀请朋友"}).click();
    await blockedCopy.locator("#invite-form input").fill("林同学 · 一起做网页和交互设计的朋友".repeat(3));
    await blockedCopy.getByRole("button",{name:"生成并复制"}).click();
    await blockedCopy.locator("#invite-prompt-value").waitFor({state:"visible"});
    assert.equal(await blockedCopy.locator("#invite-prompt-value").evaluate(el=>el.selectionEnd-el.selectionStart),await blockedCopy.locator("#invite-prompt-value").evaluate(el=>el.value.length));
    await blockedCopy.locator("#invite-dialog [data-close]").click();
    await blockedCopy.setViewportSize({width:390,height:844});
    await blockedCopy.locator(".friend-row").filter({hasText:"林同学"}).waitFor();
    assert.equal(await blockedCopy.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await blockedCopy.screenshot({path:path.join(root,"artifacts/friends-management-long-mobile.png"),fullPage:true});
    const longRow=blockedCopy.locator(".friend-row").filter({hasText:"林同学"});
    await longRow.locator("summary").click();
    await longRow.locator("summary").press("Escape");
    assert.equal(await longRow.locator("details").getAttribute("open"),null);
    await blockedCopy.close();
    const gallery = await context.newPage();
    await gallery.goto(base + "/explore");
    await gallery.evaluate(() => document.fonts.ready);
    await gallery.screenshot({path: path.join(root, "artifacts/friends-gallery-desktop.png"), fullPage: true});
    await gallery.setViewportSize({width: 390, height: 844});
    assert.equal(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await gallery.screenshot({path: path.join(root, "artifacts/friends-gallery-mobile.png"), fullPage: true});
    await gallery.close();
    assert.equal(errors.length, 0, errors.join("\n"));
    fs.writeFileSync(
      path.join(root, "artifacts/friends-ui-results.json"),
      JSON.stringify(
        {
          passed: true,
          pageErrors: errors,
          checks: [
            "owner grant",
            "invite+join",
            "clipboard",
            "public install prompt + clipboard fallback",
            "login dialog + keyboard focus return",
            "directory+ES modules+CSS+image+subpage",
            "sandbox isolation",
            "same-link update",
            "version restore",
            "gallery visibility",
            "unpublish/restore",
            "desktop+390px",
            "CLI key",
            "password change+login",
            "disable member",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "Browser acceptance passed: desktop, 390px, invitations, directory publishing, isolation, versions, clipboard, password, member disable.",
    );
  } catch (error) {
    await page.screenshot({path:path.join(root,"artifacts/friends-failure.png"),fullPage:true});
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    runtime.db.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
