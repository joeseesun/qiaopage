"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const { createServer } = require("node:http");
const { createApp } = require("../server");
const { metadata, enhance, card } = require("../lib/sharing");
const token = "sharing-fixture-admin-".repeat(3);
const html = '<!doctype html><html lang="zh"><head><title>原始标题</title><script>const fake="</head><meta property=og:title content=FAKE>"</script></head><body><h1>原始正文</h1></body></html>';
async function fixture(t) {
  const server = createServer(); await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const runtime = await createApp({ token, dbPath: ":memory:", baseUrl: url }); server.on("request", runtime.app);
  t.after(() => new Promise(r => { server.close(() => { runtime.db.close(); r(); }); server.closeIdleConnections(); }));
  const call = (endpoint, body, method = body === undefined ? "GET" : "PATCH", key = token) => fetch(url + endpoint, { method, headers: { "Content-Type": "application/json", Origin: url, ...(key ? { Authorization: "Bearer " + key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  await call("/api/v1/works/demo", { title: "作品", html }, "PUT");
  const settings = { revision: 1, shareRevision: 0, enabled: true, indexable: false, title: "分享标题", description: "简洁介绍" };
  return { ...runtime, call, url, settings };
}
test("sharing opt-in is reversible, preserves raw source/version/visibility and uses genuine head metadata", async t => {
  const { call, db, settings } = await fixture(t);
  const before = db.prepare("SELECT * FROM works").get();
  assert.equal(await (await call("/s/demo/")).text(), html);
  assert.equal((await call("/s/demo/")).headers.get("x-robots-tag"), "noindex");
  assert.equal((await call("/social/demo")).status, 404);
  const save = await call("/api/v1/works/demo/sharing", settings); assert.equal(save.status, 200);
  const enhanced = await (await call("/s/demo/")).text();
  assert.equal(metadata(enhanced).tags["og:title"], "分享标题");
  assert.match(enhanced, /og:image:width/);
  assert.ok(enhanced.endsWith('</head><body><h1>原始正文</h1></body></html>'));
  assert.equal(await (await call("/download/demo")).text(), html);
  assert.equal(await (await call("/embed/demo")).text(), html);
  const after = db.prepare("SELECT * FROM works").get();
  for (const k of ["html", "files", "title", "description", "revision", "listed", "owner_id", "updated_at"]) assert.equal(after[k], before[k], k);
  const png = await call("/social/demo"); assert.equal(png.headers.get("content-type"), "image/png");
  const bytes = Buffer.from(await png.arrayBuffer()); assert.equal(bytes.readUInt32BE(16), 1200); assert.equal(bytes.readUInt32BE(20), 630);
  assert.equal((await call("/api/v1/works/demo/sharing", settings)).status, 409);
  assert.equal((await call("/api/v1/works/demo/sharing", { ...settings, shareRevision: 1, enabled: false })).status, 200);
  assert.equal(await (await call("/s/demo/")).text(), html);
  assert.equal((await call("/social/demo")).status, 404);
});
test("search opt-in is independent of gallery and enhancement; noindex, canonical and unpublished states govern sitemap", async t => {
  const { call, settings } = await fixture(t);
  assert.doesNotMatch(await (await call("/sitemap.xml")).text(), /\/s\/demo/);
  assert.equal((await call("/api/v1/works/demo/sharing", { ...settings, enabled: false, indexable: true })).status, 200);
  assert.equal((await call("/s/demo/")).headers.get("x-robots-tag"), null);
  assert.match((await call("/s/demo/")).headers.get("link"), /rel="canonical"/);
  assert.match(await (await call("/sitemap.xml")).text(), /\/s\/demo\//);
  for (const route of ["/w/demo", "/embed/demo", "/download/demo", "/dashboard", "/join", "/login"]) assert.equal((await call(route)).headers.get("x-robots-tag"), "noindex", route);
  assert.equal((await call("/")).headers.get("x-robots-tag"), null);
  assert.match(await (await call("/")).text(), /og:image/);
  assert.match(await (await call("/publish")).text(), /rel="canonical"/);
  assert.doesNotMatch(await (await call("/robots.txt")).text(), /Disallow: \/(s|embed|download)/);
  await call("/api/v1/works/demo", { title: "作品", html: html.replace("<head>", '<head><meta name="robots" content="noindex">'), revision: 1 }, "PUT");
  assert.equal((await call("/s/demo/")).headers.get("x-robots-tag"), "noindex");
  assert.doesNotMatch(await (await call("/sitemap.xml")).text(), /\/s\/demo/);
  await call("/api/v1/works/demo", { title: "作品", html: html.replace("<head>", '<head><link rel="canonical" href="https://example.com/original">'), revision: 2 }, "PUT");
  assert.doesNotMatch(await (await call("/sitemap.xml")).text(), /\/s\/demo/);
  await call("/api/v1/works/demo", { revision: 3, published: false });
  assert.equal((await call("/s/demo/")).status, 404);
  assert.equal((await call("/social/demo")).status, 404);
});
test("sharing preview and mutations enforce ownership, validation and content revision conflicts", async t => {
  const { call, settings } = await fixture(t);
  const invite = await (await call("/api/v1/invites", { label: "分享验证" }, "POST")).json();
  const guest = randomBytes(32).toString("hex");
  assert.equal((await call("/auth/accept", { invite: invite.code, apiToken: guest }, "POST", null)).status, 201);
  for (const [route, body, method] of [["sharing", undefined, "GET"], ["sharing-preview", settings, "POST"], ["sharing", settings, "PATCH"]]) {
    assert.equal((await call(`/api/v1/works/demo/${route}`, body, method, guest)).status, 404);
    assert.equal((await call(`/api/v1/works/demo/${route}`, body, method, null)).status, 401);
  }
  for (const bad of [{ enabled: "true" }, { title: "a".repeat(101) }, { image: "PHN2Zz4=" }, { image: 42 }]) assert.equal((await call("/api/v1/works/demo/sharing", { ...settings, ...bad })).status, 400);
  const preview = await call("/api/v1/works/demo/sharing-preview", settings, "POST");
  assert.equal(preview.status, 200); assert.match((await preview.json()).preview.image, /^data:image\/png;base64,/);
  assert.equal((await (await call("/api/v1/works/demo/sharing")).json()).enabled, false);
  await call("/api/v1/works/demo", { title: "Changed", html, revision: 1 }, "PUT");
  assert.equal((await call("/api/v1/works/demo/sharing", settings)).status, 409);
  const png = card("封面").toString("base64");
  assert.equal((await call("/api/v1/works/demo/sharing", { ...settings, revision: 2, image: png })).status, 200);
  assert.equal(Buffer.from(await (await call("/social/demo")).arrayBuffer()).toString("base64"), png);
});
test("author metadata wins, hostile text stays escaped, no-head HTML works, and child files are untouched", async t => {
  const { call, settings, url } = await fixture(t);
  const original = '<html><head><!-- <meta property="og:title" content="fake"> --><meta property="og:title" content="Author &amp; friends"><meta property="og:image" content="./cover.png"><meta name="twitter:card" content="summary"><link rel="canonical" href="https://example.com/"></head><body>Body</body></html>';
  const row = { html: original, slug: "demo", share_enabled: 1, share_revision: 1, revision: 1, share_description: '\"><script>alert(1)</script>', title: "Fallback" };
  const output = enhance(row, url), m = metadata(output);
  assert.equal(m.tags["og:title"], "Author & friends"); assert.equal(m.tags["og:image"], "./cover.png"); assert.equal(m.tags["twitter:card"], "summary"); assert.equal(m.tags.canonical, "https://example.com/");
  assert.equal((output.match(/property="og:title"/g) || []).length, 2); // one comment and one actual tag
  assert.ok(!output.includes('<script>alert(1)</script>'));
  assert.equal(metadata(enhance({ ...row, html: "<!doctype html><h1>Hello</h1>" }, url)).tags["og:title"], "Fallback");
  await call("/api/v1/works/demo", { title: "目录", revision: 1, files: [{ path: "index.html", data: Buffer.from(html).toString("base64") }, { path: "other.html", data: Buffer.from("<h1>Other</h1>").toString("base64") }] }, "PUT");
  await call("/api/v1/works/demo/sharing", { ...settings, revision: 2 });
  assert.equal(await (await call("/s/demo/other.html")).text(), "<h1>Other</h1>");
  assert.match(await (await call("/s/demo/index.html")).text(), /og:title/);
  await call("/api/v1/works/demo/rollback", { revision: 2, version: 1 }, "POST");
  assert.equal((await (await call("/api/v1/works/demo/sharing")).json()).enabled, true);
});
test("standalone CLI reads and explicitly changes sharing without changing source or silently enabling indexing", async t => {
  const { call, url } = await fixture(t);
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const { spawn } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-sharing-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(dir, "quickshare.js"), config = path.join(dir, "config.json");
  fs.writeFileSync(cli, await (await call("/client/quickshare.js")).text());
  fs.writeFileSync(config, JSON.stringify({ url, token }), { mode: 0o600 });
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--json"], { cwd: dir, env: { ...process.env, QUICKSHARE_CONFIG: config, QUICKSHARE_TOKEN: "", QUICKSHARE_URL: "" } });
    let out = "", error = ""; child.stdout.on("data", d => out += d); child.stderr.on("data", d => error += d);
    child.on("error", reject); child.on("close", code => code ? reject(Error(error)) : resolve(JSON.parse(out)));
  });
  assert.equal((await run(["sharing", "demo"])).enabled, false);
  const changed = await run(["sharing", "demo", "--share-enabled", "true", "--title", "Agent 分享"]);
  assert.equal(changed.enabled, true); assert.equal(changed.indexable, false);
  assert.equal(changed.preview.title, "Agent 分享");
  const disabled = await run(["sharing", "demo", "--share-enabled", "false", "--indexable", "true"]);
  assert.equal(disabled.enabled, false); assert.equal(disabled.indexable, true);
  assert.equal(await (await call("/s/demo/")).text(), html);
  await assert.rejects(run(["sharing", "demo", "--indexable", "maybe"]), /true or false/);
});
