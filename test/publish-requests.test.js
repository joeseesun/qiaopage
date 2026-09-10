"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");
const { createServer } = require("node:http");
const { randomUUID, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const token = "publish-request-admin-".repeat(3);
const content = { title: "Hello World", html: "<!doctype html><h1>Hello</h1>" };
async function fixture(t, options = {}) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  const runtime = await createApp({ token, dbPath: ":memory:", baseUrl: url, ...options });
  server.on("request", runtime.app);
  t.after(() => new Promise(resolve => { server.close(() => { runtime.db.close(); resolve(); }); server.closeIdleConnections(); }));
  const call = (endpoint, body, auth = token, method = body === undefined ? "GET" : "POST") => fetch(url + endpoint, {
    method, headers: { Origin: url, "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer " + auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function guest() {
    const invite = await (await call("/api/v1/invites", { label: "发布测试" })).json();
    const key = randomBytes(32).toString("hex");
    assert.equal((await call("/auth/accept", { invite: invite.code, apiToken: key }, null)).status, 201);
    return key;
  }
  return { ...runtime, url, call, guest };
}

test("server allocates unique addresses, isolates request IDs by member, and preserves links on update", async t => {
  const { call, guest, db } = await fixture(t);
  const a = await guest(), b = await guest(), requestId = randomUUID();
  const first = await call("/api/v1/works", { ...content, requestId }, a);
  assert.equal(first.status, 201);
  const { work } = await first.json();
  assert.match(work.slug, /^hello-world-[a-z2-9]{10}$/);
  assert.equal(work.listed, false);
  const second = await call("/api/v1/works", { ...content, requestId }, b);
  assert.equal(second.status, 201);
  assert.notEqual((await second.json()).work.slug, work.slug);
  assert.equal((await call("/api/v1/works/" + work.slug, undefined, b)).status, 404);
  assert.equal((await call("/api/v1/works/" + work.slug, { ...content, title: "新名字", revision: 1 }, a, "PUT")).status, 200);
  const repeated = await call("/api/v1/works", { requestId, html: content.html, title: content.title }, a);
  assert.equal(repeated.status, 200);
  const replay = await repeated.json();
  assert.equal(replay.replayed, true);
  assert.equal(replay.work.url, work.url);
  assert.equal(replay.work.title, "新名字");
  assert.equal(replay.work.revision, 2);
  assert.equal(db.prepare("SELECT count(*) n FROM works").get().n, 2);
  assert.equal(db.isTransaction, false);
});

test("concurrent retries create one site, changed requests reject, and validation does not consume an ID", async t => {
  const { call, db } = await fixture(t);
  const requestId = randomUUID(), payload = { ...content, requestId };
  const results = await Promise.all(Array.from({ length: 8 }, () => call("/api/v1/works", payload)));
  assert.equal(results.filter(r => r.status === 201).length, 1);
  const works = await Promise.all(results.map(r => r.json()));
  assert.equal(new Set(works.map(r => r.work.slug)).size, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM versions").get().n, 1);
  const changed = await call("/api/v1/works", { ...payload, html: "<h1>different</h1>" });
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).code, "REQUEST_CHANGED");
  assert.equal((await call("/api/v1/works", { ...content, requestId: randomUUID() }, null)).status, 401);
  const invalidId = randomUUID();
  assert.equal((await call("/api/v1/works", { ...content, requestId: invalidId, title: "" })).status, 400);
  assert.equal((await call("/api/v1/works", { ...content, requestId: invalidId })).status, 201);
  assert.equal(db.prepare("SELECT count(*) n FROM publish_requests").get().n, 2);
  assert.equal(db.isTransaction, false);
});

test("automatic collisions retry inside the transaction; custom addresses never overwrite existing sites", async t => {
  let suffix = "aaaaaaaaaa";
  const { call, db } = await fixture(t, { slugSuffix: () => { const value = suffix; suffix = "bbbbbbbbbb"; return value; } });
  await call("/api/v1/works/hello-world-aaaaaaaaaa", { ...content, html: "<h1>Existing</h1>" }, token, "PUT");
  const created = await call("/api/v1/works", { ...content, requestId: randomUUID() });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).work.slug, "hello-world-bbbbbbbbbb");
  const taken = await call("/api/v1/works", { ...content, slug: "hello-world-aaaaaaaaaa", requestId: randomUUID() });
  assert.equal(taken.status, 409);
  assert.equal((await taken.json()).code, "SLUG_TAKEN");
  assert.equal((await (await call("/api/v1/works/hello-world-aaaaaaaaaa")).json()).work.html, "<h1>Existing</h1>");
  assert.equal((await call("/api/v1/works", { ...content, requestId: randomUUID() })).status, 503);
  assert.equal(db.prepare("SELECT count(*) n FROM works").get().n, 2);
  assert.equal(db.isTransaction, false);
});

test("publication receipts survive restart and are shared across database connections", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-receipts-"));
  const dbPath = path.join(dir, "db.sqlite"), requestId = randomUUID();
  const a = await fixture(t, { dbPath }), b = await fixture(t, { dbPath });
  const results = await Promise.all([a.call("/api/v1/works", { ...content, requestId }), b.call("/api/v1/works", { ...content, requestId })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
  const first = await results[0].json(), next = await results[1].json();
  assert.equal(first.work.slug, next.work.slug);
  const c = await fixture(t, { dbPath });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const replay = await c.call("/api/v1/works", { ...content, requestId });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).work.slug, first.work.slug);
});

test("downloaded CLI retries a lost publication response without a second site and updates the same URL", async t => {
  const { call, url, db } = await fixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-cli-request-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = path.join(dir, "quickshare.js"), file = path.join(dir, "hello.html"), config = path.join(dir, "config.json");
  fs.writeFileSync(cli, await (await fetch(url + "/client/quickshare.js")).text());
  fs.writeFileSync(file, content.html);
  let drop = true;
  const proxy = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const upstream = await fetch(url + req.url, { method: req.method, headers: { Authorization: req.headers.authorization, "Content-Type": "application/json" }, body: body.length ? body : undefined });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (req.method === "POST" && req.url === "/api/v1/works" && drop) { drop = false; res.destroy(); return; }
    res.writeHead(upstream.status, { "Content-Type": "application/json" }); res.end(bytes);
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { proxy.close(resolve); proxy.closeIdleConnections(); }));
  fs.writeFileSync(config, JSON.stringify({ url: "http://127.0.0.1:" + proxy.address().port, token }), { mode: 0o600 });
  function run(args) {
    return new Promise(resolve => {
      const env = { ...process.env, QUICKSHARE_CONFIG: config }; delete env.QUICKSHARE_TOKEN; delete env.QUICKSHARE_URL;
      const p = spawn(process.execPath, [cli, ...args, "--json"], { cwd: dir, env }); let out = "", err = "";
      p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d); p.on("close", code => resolve({ code, out, err }));
    });
  }
  assert.equal((await run(["publish", file])).code, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM works").get().n, 1);
  const retry = await run(["publish", file]); assert.equal(retry.code, 0, retry.err);
  const { work, replayed } = JSON.parse(retry.out); assert.equal(replayed, true);
  assert.equal(work.revision, 1);
  fs.writeFileSync(file, "<h1>Updated</h1>");
  const updated = await run(["update", work.slug, file, "--title", "Renamed"]); assert.equal(updated.code, 0, updated.err);
  assert.equal(JSON.parse(updated.out).work.url, work.url);
  assert.equal((await (await call("/api/v1/works/" + work.slug)).json()).work.html, "<h1>Updated</h1>");
  assert.equal(db.prepare("SELECT count(*) n FROM works").get().n, 1);
});
