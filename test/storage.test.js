"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createHash } = require("node:crypto");
const { createApp } = require("../server");
const {
  MemoryObjects,
  FileObjects,
  R2Objects,
} = require("../lib/storage/objects");
const { exportBackup } = require("../lib/storage/maintenance");
const token = "storage-test-admin-token-".repeat(3);
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qs-storage-"));
  const runtime = await createApp({
    token,
    dbPath: path.join(directory, "quickshare.sqlite"),
    ...options,
  });
  const server = await new Promise((resolve) => {
    const s = runtime.app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    runtime.db.close();
    runtime.objects.close?.();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const call = (
    route,
    body,
    method = body ? "PUT" : "GET",
    credential = token,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { ...runtime, directory, base, call };
}
const page = { title: "Original", html: "<!doctype html><h1>Original</h1>" };
async function legacy(runtime, slug, text, revision = 1) {
  const now = new Date().toISOString();
  await runtime.db
    .prepare(
      "INSERT INTO works(slug,title,html,created_at,updated_at,owner_id,listed,revision,files,file_count,byte_size) VALUES(?,?,?,?,?,1,0,?,?,2,?)",
    )
    .run(
      slug,
      slug,
      text,
      now,
      now,
      revision,
      JSON.stringify([
        {
          path: "asset.txt",
          data: Buffer.from("资源 " + text).toString("base64"),
        },
      ]),
      Buffer.byteLength(text),
    );
  const row = await runtime.repository.raw(slug);
  const fields = [
    "html",
    "files",
    "title",
    "description",
    "tags",
    "theme",
    "cover",
    "cover_mime",
    "file_count",
    "byte_size",
  ];
  await runtime.db
    .prepare(
      "INSERT INTO versions(slug,revision,snapshot,created_at) VALUES(?,?,?,?)",
    )
    .run(
      slug,
      revision,
      JSON.stringify(Object.fromEntries(fields.map((k) => [k, row[k]]))),
      now,
    );
}
test("new content and history leave only small references in SQLite, while source and assets stay exact", async (t) => {
  const r = await fixture(t);
  const html = "<!doctype html><h1>Exact</h1>" + " ".repeat(2 * 1024 * 1024);
  const asset = Buffer.alloc(1024 * 1024, 42);
  let response = await r.call("/api/v1/works/big", {
    title: "Large",
    files: [
      { path: "index.html", data: Buffer.from(html).toString("base64") },
      { path: "asset.bin.txt", data: asset.toString("base64") },
    ],
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.work.content_ref, undefined);
  assert.equal(body.work.share_image_ref, undefined);
  const raw = await r.repository.raw("big");
  assert.equal(raw.html, "");
  assert.equal(raw.files, "[]");
  assert.match(raw.content_ref, /^[a-f0-9]{64}$/);
  const version = await r.db
    .prepare("SELECT * FROM versions WHERE slug='big'")
    .get();
  assert.ok(Buffer.byteLength(version.snapshot) < 2000);
  assert.ok(version.byte_size > 2 * 1024 * 1024);
  assert.equal(
    await (await r.call("/s/big/", undefined, "GET", null)).text(),
    html,
  );
  assert.deepEqual(
    Buffer.from(
      await (
        await r.call("/s/big/asset.bin.txt", undefined, "GET", null)
      ).arrayBuffer(),
    ),
    asset,
  );
  assert.equal(
    fs.statSync(r.objects.filename(raw.content_ref)).mode & 0o777,
    0o600,
  );
  await r.call("/api/v1/works/big", { ...page, revision: 1 });
  assert.equal(
    (
      await r.call(
        "/api/v1/works/big/rollback",
        { revision: 2, version: 1 },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(await (await r.call("/s/big/")).text(), html);
});
test("failed object writes cannot change the live site or its revision; retries reuse immutable objects", async (t) => {
  class Faulty extends MemoryObjects {
    async put(bytes) {
      if (this.fail && ++this.attempt === 2)
        throw new Error("Injected object failure");
      return super.put(bytes);
    }
  }
  const objects = new Faulty(),
    r = await fixture(t, { objects });
  assert.equal((await r.call("/api/v1/works/stable", page)).status, 201);
  const before = await r.repository.raw("stable");
  objects.fail = true;
  objects.attempt = 0;
  const changed = { title: "New", html: "<h1>New</h1>", revision: 1 };
  assert.equal((await r.call("/api/v1/works/stable", changed)).status, 500);
  assert.deepEqual(await r.repository.raw("stable"), before);
  assert.equal(await (await r.call("/s/stable/")).text(), page.html);
  objects.fail = false;
  assert.equal((await r.call("/api/v1/works/stable", changed)).status, 200);
  assert.equal(
    (
      await r.db
        .prepare("SELECT count(*) n FROM versions WHERE slug='stable'")
        .get()
    ).n,
    2,
  );
});
test("revocation and revision changes during object upload are rechecked before commit", async (t) => {
  class Paused extends MemoryObjects {
    async put(bytes) {
      if (this.pause) {
        const wait = this.pause;
        this.pause = null;
        this.started();
        await wait;
      }
      return super.put(bytes);
    }
  }
  const objects = new Paused(),
    r = await fixture(t, { objects });
  const memberToken = "b".repeat(64);
  await r.db
    .prepare(
      "INSERT INTO members(id,username,api_hash,created_at) VALUES(2,'friend',?,?)",
    )
    .run(
      createHash("sha256").update(memberToken).digest("hex"),
      new Date().toISOString(),
    );
  assert.equal(
    (await r.call("/api/v1/works/stable", page, "PUT", memberToken)).status,
    201,
  );
  let release;
  const started = new Promise((resolve) => (objects.started = resolve));
  objects.pause = new Promise((resolve) => (release = resolve));
  const pending = r.call(
    "/api/v1/works/stable",
    { ...page, html: "changed", revision: 1 },
    "PUT",
    memberToken,
  );
  await started;
  await r.db.prepare("UPDATE members SET disabled=1 WHERE id=2").run();
  release();
  assert.equal((await pending).status, 401);
  assert.equal((await r.repository.raw("stable")).revision, 1);
  await r.db.prepare("UPDATE members SET disabled=0 WHERE id=2").run();
  const secondStarted = new Promise((resolve) => (objects.started = resolve));
  objects.pause = new Promise((resolve) => (release = resolve));
  const pending2 = r.call(
    "/api/v1/works/stable",
    { ...page, html: "changed again", revision: 1 },
    "PUT",
    memberToken,
  );
  await secondStarted;
  assert.equal(
    (
      await r.call(
        "/api/v1/works/stable",
        { revision: 1, published: false },
        "PATCH",
        memberToken,
      )
    ).status,
    200,
  );
  release();
  assert.equal((await pending2).status, 409);
  assert.equal((await r.repository.raw("stable")).published, 0);
});
test("legacy migration is resumable and backup restores accounts, full files and old versions", async (t) => {
  const r = await fixture(t);
  await legacy(r, "first", "<h1>第一版</h1>");
  await legacy(r, "second", "<h1>第二站</h1>");
  const accounts = await r.db.prepare("SELECT * FROM members").all();
  const put = r.objects.put.bind(r.objects);
  let count = 0;
  r.objects.put = async (bytes) => {
    if (++count === 4) throw new Error("Interrupted migration");
    return put(bytes);
  };
  await assert.rejects(() => r.repository.migrate(), /Interrupted/);
  assert.equal(await (await r.call("/s/first/")).text(), "<h1>第一版</h1>");
  assert.equal(await (await r.call("/s/second/")).text(), "<h1>第二站</h1>");
  r.objects.put = put;
  await r.repository.migrate();
  assert.deepEqual(await r.repository.migrate(), {
    works: 0,
    versions: 0,
    images: 0,
  });
  assert.deepEqual(await r.db.prepare("SELECT * FROM members").all(), accounts);
  assert.equal((await r.repository.raw("first")).html, "");
  assert.equal(
    await (await r.call("/s/first/asset.txt")).text(),
    "资源 <h1>第一版</h1>",
  );
  await r.call("/api/v1/works/first", { ...page, revision: 1 });
  const backupDir = path.join(r.directory, "backup");
  const backup = await exportBackup(r.repository, backupDir);
  assert.ok(backup.objects > 0);
  const restored = await createApp({
    token,
    dbPath: path.join(backupDir, "quickshare.sqlite"),
  });
  try {
    assert.deepEqual(
      await restored.db.prepare("SELECT * FROM members").all(),
      accounts,
    );
    assert.equal((await restored.repository.get("first")).html, page.html);
    const old = JSON.parse(
      (
        await restored.db
          .prepare(
            "SELECT snapshot FROM versions WHERE slug='first' AND revision=1",
          )
          .get()
      ).snapshot,
    );
    assert.equal((await restored.content.unpack(old)).html, "<h1>第一版</h1>");
  } finally {
    restored.db.close();
  }
});
test("storage limits count logical history, and rejected uploads do not write more objects", async (t) => {
  const objects = new MemoryObjects(),
    r = await fixture(t, { objects });
  await r.call("/api/v1/works/full", page);
  await r.db
    .prepare("UPDATE versions SET byte_size=? WHERE slug='full'")
    .run(150 * 1024 * 1024);
  const before = objects.objects.size;
  assert.equal(
    (
      await r.call("/api/v1/works/full", {
        ...page,
        html: "should never be written",
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(objects.objects.size, before);
  assert.equal((await r.repository.raw("full")).revision, 1);
});
test("a missing or corrupt object fails closed instead of returning empty content", async (t) => {
  const objects = new MemoryObjects(),
    r = await fixture(t, { objects });
  await r.call("/api/v1/works/demo", page);
  const manifest = await r.content.manifest(await r.repository.raw("demo"));
  objects.objects.set(manifest.html, Buffer.from("tampered"));
  assert.equal((await r.call("/s/demo/")).status, 500);
  await assert.rejects(
    () => exportBackup(r.repository, path.join(r.directory, "bad-backup")),
    /corrupt/,
  );
  assert.equal(
    fs.existsSync(path.join(r.directory, "bad-backup", "backup.json")),
    false,
  );
});
test("Cloudflare R2 binding stores survive a local Workers runtime restart", async (t) => {
  const { Miniflare } = require("miniflare");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qs-r2-"));
  const config = {
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    r2Buckets: ["CONTENT"],
    r2Persist: directory,
    compatibilityDate: "2026-07-30",
  };
  let mf = new Miniflare(config);
  t.after(async () => {
    await mf.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  let objects = new R2Objects(await mf.getR2Bucket("CONTENT"));
  const bytes = Buffer.from("持久化资源");
  const key = await objects.put(bytes);
  assert.deepEqual(await objects.get(key), bytes);
  await mf.dispose();
  mf = new Miniflare(config);
  objects = new R2Objects(await mf.getR2Bucket("CONTENT"));
  assert.deepEqual(await objects.get(key), bytes);
  await assert.rejects(() => objects.get("../escape"), /Invalid object key/);
});

test("failed index transactions never return invitation credentials or partial writes", async (t) => {
  const r = await fixture(t);
  const transaction = r.database.transaction.bind(r.database);
  r.database.transaction = (fn) =>
    transaction(async () => {
      await fn();
      throw new Error("Injected commit failure");
    });
  const response = await r.call(
    "/api/v1/invites",
    { label: "must roll back" },
    "POST",
  );
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("set-cookie"), null);
  const body = await response.json();
  assert.equal(body.code, undefined);
  assert.equal(body.invite, undefined);
  assert.equal(r.db.prepare("SELECT count(*) n FROM invites").get().n, 0);
  r.database.transaction = transaction;
  assert.equal(
    (await r.call("/api/v1/invites", { label: "retry" }, "POST")).status,
    201,
  );
});

test("database facade isolates reads until an asynchronous transaction rolls back", async () => {
  const { connectDatabase } = require("../lib/storage/database");
  const db = connectDatabase(":memory:", {});
  try {
    await db.exec(
      "CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES(1)",
    );
    let release, entered;
    const started = new Promise((resolve) => (entered = resolve));
    const hold = new Promise((resolve) => (release = resolve));
    const pending = db.transaction(async () => {
      await db.prepare("UPDATE sample SET value=2").run();
      entered();
      await hold;
      throw new Error("rollback");
    });
    const rejected = assert.rejects(pending, /rollback/);
    await started;
    const read = db.prepare("SELECT value FROM sample").get();
    release();
    await rejected;
    assert.equal((await read).value, 1);
  } finally {
    db.close();
  }
});

test("migration CLI plans, backs up, converts and resumes without changing site identity", async (t) => {
  const r = await fixture(t);
  await legacy(r, "cli-migration", "<h1>原始内容</h1>");
  const { execFileSync } = require("node:child_process");
  const env = {
    ...process.env,
    DB_PATH: path.join(r.directory, "quickshare.sqlite"),
    QUICKSHARE_TOKEN: token,
    DATABASE_URL: "",
    OBJECT_STORE: "filesystem",
    OBJECTS_PATH: path.join(r.directory, "objects"),
  };
  const command = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [path.join(__dirname, "../scripts/migrate-storage.js"), ...args],
        { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  assert.equal(command().pending.works, 1);
  assert.equal(
    command("--apply", "--backup", path.join(r.directory, "cli-backup"))
      .migrated.works,
    1,
  );
  assert.equal(command().pending.works, 0);
  assert.equal(
    command("--apply", "--backup", path.join(r.directory, "cli-backup-2"))
      .migrated.works,
    0,
  );
  assert.equal(
    (await r.repository.get("cli-migration")).html,
    "<h1>原始内容</h1>",
  );
});
