const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createApp } = require("../server");
const token = "test-only-token-".repeat(4);
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickshare-test-"));
  const runtime = await createApp({ token, dbPath: path.join(dir, "test.sqlite") });
  const server = await new Promise((resolve) => {
    const s = runtime.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(
    () =>
      new Promise((resolve) =>
        server.close(() => {
          runtime.db.close();
          fs.rmSync(dir, { recursive: true });
          resolve();
        }),
      ),
  );
  const call = (endpoint, method = "GET", body, auth = true, headers = {}) =>
    fetch(url + endpoint, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { call, dir, url, ...runtime };
}
const sample = {
  listed: true,
  title: "色彩实验室",
  description: "交互颜色工具",
  tags: ["设计"],
  html: '<!doctype html><title>Demo</title><button onclick="this.textContent=42">Try</button>',
};
test("authenticated publication, conflict protection, filtering, unpublish and restore", async (t) => {
  const { call } = await fixture(t);
  assert.equal(
    (
      await call("/api/v1/works/demo", "PUT", sample, false, {
        Cookie: "auth=true",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "/api/pages/demo/protect",
        "POST",
        { isProtected: false },
        false,
      )
    ).status,
    404,
  );
  let res = await call("/api/v1/works/demo", "PUT", sample);
  assert.equal(res.status, 201);
  let work = (await res.json()).work;
  assert.equal(work.revision, 1);
  assert.equal(work.html, undefined);
  assert.equal((await call("/api/v1/works/demo", "PUT", sample)).status, 409);
  assert.equal(
    (await call("/api/v1/works/demo", "GET", undefined, false)).status,
    401,
  );
  assert.equal(
    (await call("/api/v1/works?all=true", "GET", undefined, false)).status,
    401,
  );
  assert.equal(
    (
      await (
        await call("/api/v1/works?q=颜色&tag=" + encodeURIComponent("设计"))
      ).json()
    ).works.length,
    1,
  );
  assert.equal(
    (await (await call("/api/v1/works?q=absent")).json()).works.length,
    0,
  );
  res = await call("/api/v1/works/demo", "PUT", {
    ...sample,
    revision: 1,
    title: "更新作品",
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).work.revision, 2);
  assert.equal(
    (
      await call("/api/v1/works/demo", "PATCH", {
        published: false,
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/api/v1/works/demo", "PATCH", {
        published: false,
        revision: 2,
      })
    ).status,
    200,
  );
  assert.equal((await (await call("/api/v1/works")).json()).works.length, 0);
  for (const p of ["/w/demo", "/embed/demo", "/download/demo"])
    assert.equal((await call(p)).status, 404);
  res = await call("/api/v1/works/demo", "PATCH", {
    published: true,
    revision: 3,
  });
  assert.equal(res.status, 200);
  assert.equal((await call("/embed/demo")).status, 200);
});
test("validation, HTML sandbox, safe metadata and download", async (t) => {
  const { call } = await fixture(t);
  for (const invalid of [
    { title: 2 },
    { tags: ["x".repeat(31)] },
    { published: "true" },
    { html: [] },
    { theme: "bad" },
  ])
    assert.equal(
      (await call("/api/v1/works/demo", "PUT", { ...sample, ...invalid }))
        .status,
      400,
    );
  assert.equal((await call("/api/v1/works/UPPER", "PUT", sample)).status, 400);
  assert.equal(
    (
      await call("/api/v1/works/demo", "PUT", {
        ...sample,
        title: "<script>alert(1)</script>",
      })
    ).status,
    201,
  );
  const home = await (await call("/explore")).text();
  assert.ok(home.includes("&lt;script&gt;"));
  assert.ok(!home.includes("<script>alert(1)</script>"));
  const embed = await call("/embed/demo");
  assert.equal(await embed.text(), sample.html);
  assert.match(
    embed.headers.get("content-security-policy"),
    /sandbox allow-scripts/,
  );
  assert.ok(
    !embed.headers.get("content-security-policy").includes("allow-same-origin"),
  );
  assert.match(
    (await call("/download/demo")).headers.get("content-disposition"),
    /^attachment/,
  );
  assert.doesNotMatch(await (await call("/sitemap.xml")).text(), /\/(w|s)\/demo/);
});
test("CLI publishes, updates, exports and preserves private login credentials", async (t) => {
  const { url, dir, call } = await fixture(t);
  const config = path.join(dir, "config.json"),
    file = path.join(dir, "demo.html");
  fs.writeFileSync(file, sample.html);
  const cli = (args, input) =>
    new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [path.join(__dirname, "../bin/quickshare.js"), ...args],
        {
          env: {
            ...process.env,
            QUICKSHARE_CONFIG: config,
            QUICKSHARE_TOKEN: "",
            QUICKSHARE_URL: "",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => resolve({ code, out, err }));
      child.stdin.end(input);
    });
  let r = await cli(["login", "--url", url, "--token-stdin"], token);
  assert.equal(r.code, 0, r.err);
  assert.ok(!r.out.includes(token));
  assert.equal(fs.statSync(config).mode & 0o777, 0o600);
  r = await cli([
    "publish",
    file,
    "--slug",
    "demo",
    "--title",
    sample.title,
    "--json",
  ]);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).work.revision, 1);
  r = await cli(["publish", file, "--slug", "demo"]);
  assert.equal(r.code, 1);
  r = await cli(["update", "demo", file, "--title", "第二版", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).work.revision, 2);
  assert.equal((await cli(["unpublish", "demo"])).code, 0);
  assert.equal((await (await call("/api/v1/works")).json()).works.length, 0);
  assert.equal((await cli(["restore", "demo"])).code, 0);
  const exported = path.join(dir, "saved.html");
  assert.equal((await cli(["get", "demo", "--output", exported])).code, 0);
  assert.equal(fs.readFileSync(exported, "utf8"), sample.html);
  assert.equal((await cli(["get", "demo", "--output", exported])).code, 1);
  r = await cli(["list", "--json"]);
  assert.equal(JSON.parse(r.out).works.length, 1);
});
test("database survives a runtime restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickshare-persist-"));
  const dbPath = path.join(dir, "db.sqlite");
  let runtime = await createApp({ token, dbPath });
  runtime.db
    .prepare(
      "INSERT INTO works(slug,title,html,created_at,updated_at) VALUES(?,?,?,?,?)",
    )
    .run("retained", "Retained", "<h1>Hello</h1>", "now", "now");
  runtime.db.close();
  runtime = await createApp({ token, dbPath });
  assert.equal(
    runtime.db.prepare("SELECT title FROM works WHERE slug=?").get("retained")
      .title,
    "Retained",
  );
  runtime.db.close();
  fs.rmSync(dir, { recursive: true });
});
test("cover bytes are private until published and invalid uploads fail", async (t) => {
  const { call } = await fixture(t);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=";
  assert.equal(
    (
      await call("/api/v1/works/demo", "PUT", {
        ...sample,
        cover: { data: Buffer.from("<script>").toString("base64") },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/api/v1/works/demo", "PUT", {
        ...sample,
        cover: { data: png },
      })
    ).status,
    201,
  );
  let response = await call("/cover/demo");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /image\/png/);
  assert.ok(
    Buffer.from(await response.arrayBuffer()).equals(
      Buffer.from(png, "base64"),
    ),
  );
  const publicList = await (await call("/api/v1/works")).json();
  assert.equal(publicList.works[0].cover, undefined);
  await call("/api/v1/works/demo", "PATCH", { published: false, revision: 1 });
  assert.equal((await call("/cover/demo")).status, 404);
});
test("gallery paginates many projects and retains search in page links", async (t) => {
  const { call, db } = await fixture(t);
  const insert = db.prepare(
    "INSERT INTO works(slug,title,html,created_at,updated_at) VALUES(?,?,?,?,?)",
  );
  for (let i = 0; i < 26; i++)
    insert.run(
      "work-" + i,
      "Gallery " + i,
      "<h1>Example</h1>",
      "2026-09-09T00:00:00Z",
      "2026-09-09T00:00:00Z",
    );
  const page2 = await (await call("/explore?q=Gallery&page=2")).text();
  assert.equal((page2.match(/class="work-card"/g) || []).length, 12);
  assert.match(page2, /2 \/ 3/);
  assert.match(page2, /q=Gallery/);
  const page3 = await (await call("/explore?q=Gallery&page=3")).text();
  assert.equal((page3.match(/class="work-card"/g) || []).length, 2);
});
