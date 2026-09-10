const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");
const { prepareFiles } = require("../lib/files");
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawn } = require("node:child_process");
const rootToken = "friends-fixture-only-".repeat(3),
  origin = "http://127.0.0.1:39999";
async function fixture(t) {
  const runtime = createApp({
    token: rootToken,
    dbPath: ":memory:",
    baseUrl: origin,
  });
  const server = await new Promise((resolve) => {
    const s = runtime.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(
    () =>
      new Promise((resolve) =>
        server.close(() => {
          runtime.db.close();
          resolve();
        }),
      ),
  );
  const url = "http://127.0.0.1:" + server.address().port;
  async function call(endpoint, method = "GET", body, options = {}) {
    return fetch(url + endpoint, {
      method,
      headers: {
        ...(options.root ? { Authorization: "Bearer " + rootToken } : {}),
        ...(options.token ? { Authorization: "Bearer " + options.token } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(options.origin ? { Origin: options.origin } : {}),
        ...options.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: options.redirect || "follow",
    });
  }
  async function invite(name) {
    const r = await call(
      "/api/v1/invites",
      "POST",
      { label: name },
      { root: true },
    );
    assert.equal(r.status, 201);
    return new URL((await r.json()).url).hash.slice("#invite=".length);
  }
  async function join(name) {
    const code = await invite(name);
    const r = await call(
      "/auth/join",
      "POST",
      { invite: code, username: name, password: "test-password-long-enough" },
      { origin },
    );
    assert.equal(r.status, 201, await r.clone().text());
    return { cookie: r.headers.get("set-cookie").split(";")[0], code };
  }
  return { call, join, invite, url, ...runtime };
}
const html = { title: "测试内容", html: "<!doctype html><h1>hello</h1>" };
const files = [
  {
    path: "index.html",
    data: Buffer.from(
      '<!doctype html><link rel="stylesheet" href="assets/style.css"><h1 id="v">v1</h1><script type="module" src="assets/main.js"></script>',
    ).toString("base64"),
  },
  {
    path: "assets/style.css",
    data: Buffer.from("h1{color:rgb(20,80,40)}").toString("base64"),
  },
  {
    path: "assets/main.js",
    data: Buffer.from(
      'document.querySelector("h1").textContent="module works"',
    ).toString("base64"),
  },
];
test("administrator identity follows the stored username after a rename", async (t) => {
  const { call, db } = await fixture(t);
  db.prepare("UPDATE members SET username=? WHERE id=1").run("joe");
  const r = await call("/api/v1/me", "GET", undefined, { root: true });
  assert.equal(r.status, 200);
  const { member } = await r.json();
  assert.equal(member.id, 1);
  assert.equal(member.username, "joe");
  assert.equal(member.admin, true);
});
test("invite only, single-use registration, password login and strict session CSRF", async (t) => {
  const { call, join } = await fixture(t);
  const { cookie, code } = await join("alice");
  assert.match(cookie, /^quickshare_session=/);
  let r = await call("/api/v1/me", "GET", undefined, { cookie });
  assert.equal((await r.json()).member.username, "alice");
  assert.equal(
    (
      await call(
        "/auth/join",
        "POST",
        {
          invite: code,
          username: "bob",
          password: "test-password-long-enough",
        },
        { origin },
      )
    ).status,
    410,
  );
  assert.equal(
    (
      await call(
        "/auth/join",
        "POST",
        {
          invite: "fake",
          username: "bob",
          password: "test-password-long-enough",
        },
        { origin },
      )
    ).status,
    410,
  );
  for (const badOrigin of [undefined, "null", "https://evil.example"])
    assert.equal(
      (
        await call("/api/v1/works/test", "PUT", html, {
          cookie,
          origin: badOrigin,
        })
      ).status,
      403,
    );
  r = await call(
    "/auth/login",
    "POST",
    { username: "alice", password: "test-password-long-enough" },
    { origin },
  );
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.match(r.headers.get("set-cookie"), /SameSite=Strict/);
  assert.equal(
    (
      await call(
        "/auth/login",
        "POST",
        { username: "alice", password: "this-password-is-wrong" },
        { origin },
      )
    ).status,
    401,
  );
  await call("/auth/logout", "POST", {}, { cookie, origin });
  assert.equal(
    (await call("/api/v1/me", "GET", undefined, { cookie })).status,
    401,
  );
});
test("members cannot read, change, list or restore another member content; admin can manage", async (t) => {
  const { call, join } = await fixture(t);
  const alice = await join("alice"),
    bob = await join("bobby");
  const a = { cookie: alice.cookie, origin },
    b = { cookie: bob.cookie, origin };
  assert.equal(
    (await call("/api/v1/works/alice-site", "PUT", html, a)).status,
    201,
  );
  for (const [endpoint, method, body] of [
    ["/api/v1/works/alice-site", "GET"],
    ["/api/v1/works/alice-site", "PUT", { ...html, revision: 1 }],
    ["/api/v1/works/alice-site", "PATCH", { revision: 1, published: false }],
    ["/api/v1/works/alice-site/versions", "GET"],
    ["/api/v1/works/alice-site/rollback", "POST", { revision: 1, version: 1 }],
  ])
    assert.equal((await call(endpoint, method, body, b)).status, 404);
  assert.equal(
    (await (await call("/api/v1/works?all=true", "GET", undefined, b)).json())
      .works.length,
    0,
  );
  assert.equal((await call("/api/v1/invites", "POST", {}, b)).status, 403);
  assert.equal(
    (await call("/api/v1/members", "GET", undefined, b)).status,
    403,
  );
  assert.equal(
    (await call("/api/v1/members/2", "PATCH", { disabled: true }, b)).status,
    403,
  );
  assert.equal(
    (await call("/api/v1/works/alice-site", "GET", undefined, { root: true }))
      .status,
    200,
  );
});
test("new publications are unlisted; gallery is opt-in; unpublish blocks every file", async (t) => {
  const { call } = await fixture(t);
  let r = await call(
    "/api/v1/works/site",
    "PUT",
    { title: "不列出的内容", files },
    { root: true },
  );
  assert.equal(r.status, 201);
  const work = (await r.json()).work;
  assert.equal(work.listed, false);
  assert.equal(work.files, undefined);
  assert.equal((await (await call("/api/v1/works")).json()).works.length, 0);
  assert.ok(!(await (await call("/explore")).text()).includes("不列出的内容"));
  assert.equal((await call("/s/site/")).status, 200);
  r = await call("/s/site/assets/main.js", "GET", undefined, {
    origin: "null",
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/javascript/);
  assert.equal(r.headers.get("access-control-allow-origin"), "null");
  assert.equal(
    (
      await call("/api/v1/me", "GET", undefined, { root: true, origin: "null" })
    ).headers.get("access-control-allow-origin"),
    null,
  );
  assert.equal(
    (await call("/s/site/assets/style.css")).headers.get(
      "access-control-allow-origin",
    ),
    null,
  );
  assert.match(
    (await call("/s/site/")).headers.get("content-security-policy"),
    /sandbox allow-scripts/,
  );
  assert.ok(
    !(await call("/s/site/")).headers
      .get("content-security-policy")
      .includes("allow-same-origin"),
  );
  await call(
    "/api/v1/works/site",
    "PATCH",
    { revision: 1, listed: true },
    { root: true },
  );
  assert.equal((await (await call("/api/v1/works")).json()).works.length, 1);
  await call(
    "/api/v1/works/site",
    "PATCH",
    { revision: 2, published: false },
    { root: true },
  );
  for (const url of [
    "/s/site/",
    "/s/site/assets/main.js",
    "/embed/site",
    "/w/site",
    "/download/site",
  ])
    assert.equal((await call(url)).status, 404);
});
test("update preserves old files in history and rollback restores content without changing visibility", async (t) => {
  const { call } = await fixture(t);
  await call(
    "/api/v1/works/history",
    "PUT",
    { title: "v1", files },
    { root: true },
  );
  await call(
    "/api/v1/works/history",
    "PUT",
    { title: "v2", html: "<h1>v2</h1>", revision: 1 },
    { root: true },
  );
  assert.equal((await call("/s/history/assets/main.js")).status, 404);
  assert.equal(
    (
      await call(
        "/api/v1/works/history/rollback",
        "POST",
        { revision: 1, version: 1 },
        { root: true },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        "/api/v1/works/history/rollback",
        "POST",
        { revision: 2, version: 1 },
        { root: true },
      )
    ).status,
    200,
  );
  assert.equal((await call("/s/history/assets/main.js")).status, 200);
  const restored = (
    await (
      await call("/api/v1/works/history", "GET", undefined, { root: true })
    ).json()
  ).work;
  assert.equal(restored.title, "v1");
  assert.equal(restored.revision, 3);
  assert.equal(restored.listed, false);
  assert.equal(
    (
      await (
        await call("/api/v1/works/history/versions", "GET", undefined, {
          root: true,
        })
      ).json()
    ).versions.length,
    3,
  );
});
test("revoked invitations, member deactivation, password rotation and one-use dashboard grants", async (t) => {
  const { call, join, invite } = await fixture(t);
  const code = await invite("cancel");
  const invites = (
    await (
      await call("/api/v1/invites", "GET", undefined, { root: true })
    ).json()
  ).invites;
  await call("/api/v1/invites/" + invites[0].id, "DELETE", undefined, {
    root: true,
  });
  assert.equal(
    (
      await call(
        "/auth/join",
        "POST",
        {
          invite: code,
          username: "cancelled",
          password: "test-password-long-enough",
        },
        { origin },
      )
    ).status,
    410,
  );
  const { cookie } = await join("alice");
  const a = { cookie, origin };
  let token = (await (await call("/api/v1/key", "POST", {}, a)).json()).token;
  assert.equal(
    (await call("/api/v1/me", "GET", undefined, { token })).status,
    200,
  );
  const second = (await (await call("/api/v1/key", "POST", {}, a)).json())
    .token;
  assert.equal(
    (await call("/api/v1/me", "GET", undefined, { token })).status,
    401,
  );
  const link = (
    await (await call("/api/v1/dashboard-link", "POST", {}, a)).json()
  ).url;
  const grant = new URL(link).hash.slice("#code=".length);
  assert.equal(
    (await call("/auth/grant", "POST", { code: grant }, { origin })).status,
    200,
  );
  assert.equal(
    (await call("/auth/grant", "POST", { code: grant }, { origin })).status,
    410,
  );
  await call("/api/v1/members/2", "PATCH", { disabled: true }, { root: true });
  assert.equal((await call("/api/v1/me", "GET", undefined, a)).status, 401);
  assert.equal(
    (await call("/api/v1/me", "GET", undefined, { token: second })).status,
    401,
  );
  assert.equal(
    (
      await call(
        "/auth/login",
        "POST",
        { username: "alice", password: "test-password-long-enough" },
        { origin },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "/api/v1/members/1",
        "PATCH",
        { disabled: true },
        { root: true },
      )
    ).status,
    400,
  );
});
test("directory validation rejects traversal, secrets, duplicate names and oversize payloads", () => {
  for (const p of [
    "../index.html",
    "/index.html",
    "a/../index.html",
    "a\\b",
    "a/%2e%2e/index.html",
    ".env",
    "node_modules/a.js",
    "secret.pem",
    "a.sqlite",
    "a?b",
  ])
    assert.throws(() => prepareFiles([...files, { path: p, data: "YQ==" }]));
  assert.throws(() => prepareFiles([...files, files[0]]));
  assert.throws(() =>
    prepareFiles([{ path: "index.html", data: "not base64!" }]),
  );
  assert.throws(() => prepareFiles([{ path: "readme.txt", data: "YQ==" }]));
  assert.throws(() =>
    prepareFiles([
      {
        path: "index.html",
        data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
      },
    ]),
  );
  const md = prepareFiles([
    {
      path: "index.md",
      data: Buffer.from("# Hi\n\n![image](assets/pic.png)").toString("base64"),
    },
    { path: "assets/pic.png", data: "YQ==" },
  ]);
  assert.match(md.html, /src="assets\/pic.png"/);
  assert.ok(md.files.some((f) => f.path === "index.md"));
});
test("additive migration preserves legacy owners, public listings, HTML and covers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-migrate-"));
  const dbPath = path.join(dir, "db.sqlite");
  const old = new DatabaseSync(dbPath);
  old.exec(
    "CREATE TABLE works(slug TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT DEFAULT '',tags TEXT DEFAULT '[]',theme TEXT DEFAULT 'sage',html TEXT NOT NULL,published INTEGER DEFAULT 1,revision INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT,cover TEXT,cover_mime TEXT)",
  );
  old
    .prepare(
      "INSERT INTO works(slug,title,html,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .run("legacy", "旧内容", "<h1>keep me</h1>", "now", "now");
  old.close();
  const first = createApp({ token: rootToken, dbPath });
  let row = first.db.prepare("SELECT * FROM works").get();
  assert.equal(row.owner_id, 1);
  assert.equal(row.listed, 1);
  assert.equal(row.html, "<h1>keep me</h1>");
  first.db.close();
  const again = createApp({ token: rootToken, dbPath });
  assert.equal(again.db.prepare("SELECT count(*) AS n FROM works").get().n, 1);
  assert.equal(
    again.db.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
  );
  again.db.close();
  fs.rmSync(dir, { recursive: true });
});
test("public agent setup uses the configured origin without credentials or publication side effects", async (t) => {
  const { call, db } = await fixture(t);
  const headers = { Host: "untrusted.example", "X-Forwarded-Host": "untrusted.example" };
  const skillResponse = await call("/skill.md", "GET", undefined, { headers });
  assert.equal(skillResponse.status, 200);
  const skill = await skillResponse.text();
  assert.match(skill, /^---\nname: qiaomu-quickshare\ndescription: .+\nmetadata:/);
  assert.ok(skill.includes(origin + "/client/quickshare.js"));
  assert.ok(skill.includes("doctor --json"));
  const promptResponse = await call("/agent-prompt.txt", "GET", undefined, { headers });
  assert.equal(promptResponse.status, 200);
  const prompt = await promptResponse.text();
  assert.ok(prompt.includes(origin + "/skill.md"));
  assert.ok(prompt.includes("本次不自动上传文件"));
  for (const endpoint of ["/", "/publish"]) {
    const response = await call(endpoint);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.ok(page.includes("data-copy-agent"));
    assert.ok(page.includes('id="install-prompt"'));
    assert.ok(page.includes(prompt));
    assert.ok(!page.includes(rootToken));
  }
  assert.ok(!skill.includes(rootToken) && !prompt.includes(rootToken));
  assert.ok(!skill.includes("untrusted.example") && !prompt.includes("untrusted.example"));
  assert.equal(db.prepare("SELECT count(*) AS n FROM works").get().n, 0);
});

test("downloaded CLI works outside the repository with directory assets and Markdown", async (t) => {
  const { call, url } = await fixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-portable-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const cli = path.join(dir, "quickshare.js");
  fs.writeFileSync(cli, await (await call("/client/quickshare.js")).text());
  fs.mkdirSync(path.join(dir, "site/assets"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "site/index.md"),
    "# Portable\n\n![picture](assets/pic.svg)",
  );
  fs.writeFileSync(
    path.join(dir, "site/assets/pic.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  fs.writeFileSync(path.join(dir, "site/.env"), "DO_NOT_PUBLISH");
  const run = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [cli, ...args], {
        env: {
          ...process.env,
          QUICKSHARE_CONFIG: path.join(dir, "private.json"),
          QUICKSHARE_URL: url,
          QUICKSHARE_TOKEN: rootToken,
        },
      });
      let out = "",
        err = "";
      child.stdout.on("data", (x) => (out += x));
      child.stderr.on("data", (x) => (err += x));
      child.on("close", (code) => resolve({ code, out, err }));
    });
  const helpResult = await run(["--help"]);
  assert.equal(helpResult.code, 0, helpResult.err);
  assert.match(helpResult.out, /Quickshare/);
  const connection = await run(["doctor", "--json"]);
  assert.equal(connection.code, 0, connection.err);
  assert.equal(JSON.parse(connection.out).member.username, "owner");
  const result = await run([
    "publish",
    path.join(dir, "site"),
    "--slug",
    "portable",
    "--json",
  ]);
  assert.equal(result.code, 0, result.err);
  assert.match(await (await call("/s/portable/")).text(), /<h1/);
  assert.equal((await call("/s/portable/assets/pic.svg")).status, 200);
  assert.equal((await call("/s/portable/.env")).status, 404);
  const r = await run(["list", "--json"]);
  assert.equal(JSON.parse(r.out).works.length, 1);
});
