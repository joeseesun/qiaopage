"use strict";
const { execFileSync } = require("node:child_process"),
  { createServer } = require("node:http");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { createApp } = require("../server"),
  { connectDatabase } = require("../lib/storage/database"),
  { S3Objects } = require("../lib/storage/s3");
const { CreateBucketCommand } = require("@aws-sdk/client-s3"),
  { exportBackup } = require("../lib/storage/maintenance");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qs-backends-")),
  prefix = `qs-backends-${process.pid}`,
  containers = [],
  runtimes = [];
const admin = randomBytes(32).toString("hex"),
  accessKeyId = "quicksharetest",
  secretAccessKey = randomBytes(32).toString("hex");
const envFile = path.join(directory, "minio.env");
fs.writeFileSync(
  envFile,
  `MINIO_ROOT_USER=${accessKeyId}\nMINIO_ROOT_PASSWORD=${secretAccessKey}\n`,
  { mode: 0o600 },
);
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180000,
  }).trim();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  try {
    const sqlName = prefix + "-sql",
      s3Name = prefix + "-s3";
    containers.push(sqlName);
    docker(
      "run",
      "-d",
      "--name",
      sqlName,
      "-p",
      "127.0.0.1::8080",
      "-e",
      "SQLD_HTTP_LISTEN_ADDR=0.0.0.0:8080",
      "ghcr.io/tursodatabase/libsql-server@sha256:6dd3eb276d9d3604e4a48ac4a999a2e267814732d57d7e94c04ba71482333a67",
    );
    containers.push(s3Name);
    docker(
      "run",
      "-d",
      "--name",
      s3Name,
      "--env-file",
      envFile,
      "-p",
      "127.0.0.1::9000",
      "minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e",
      "server",
      "/data",
    );
    let sqlUrl = "http://" + docker("port", sqlName, "8080/tcp"),
      endpoint = "http://" + docker("port", s3Name, "9000/tcp");
    for (const url of [sqlUrl, endpoint + "/minio/health/live"]) {
      let ready = false;
      for (let n = 0; n < 80; n++) {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
          if (r.status < 500) {
            ready = true;
            break;
          }
        } catch {}
        await pause(250);
      }
      assert.ok(ready, "backend startup");
    }
    const storage = () =>
      new S3Objects({
        endpoint,
        bucket: "quickshare-test",
        accessKeyId,
        secretAccessKey,
        region: "us-east-1",
        forcePathStyle: true,
      });
    const initial = storage();
    await initial.client.send(
      new CreateBucketCommand({ Bucket: "quickshare-test" }),
    );
    initial.close();
    async function app() {
      const server = createServer();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `http://127.0.0.1:${server.address().port}`;
      let runtime;
      const database = connectDatabase(null, { DATABASE_URL: sqlUrl }),
        objects = storage();
      try {
        runtime = await createApp({
          token: admin,
          baseUrl: url,
          database,
          objects,
        });
      } catch (error) {
        server.close();
        database.close();
        objects.close();
        throw error;
      }
      server.on("request", runtime.app);
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await new Promise((resolve) => server.close(resolve));
        runtime.database.close();
        runtime.objects.close();
      };
      runtimes.push(close);
      const call = (
        route,
        body,
        method = body ? "POST" : "GET",
        token = admin,
      ) =>
        fetch(url + route, {
          method,
          signal: AbortSignal.timeout(30000),
          headers: {
            Origin: url,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      return { ...runtime, call, close };
    }
    console.log("Checking concurrent remote operations");
    const [a, b] = await Promise.all([app(), app()]);
    const invite = await (
      await a.call("/api/v1/invites", { label: "Backend QA" })
    ).json();
    const guest = randomBytes(32).toString("hex");
    const accepts = await Promise.all([
      a.call(
        "/auth/accept",
        { invite: invite.code, apiToken: guest },
        "POST",
        guest,
      ),
      b.call(
        "/auth/accept",
        { invite: invite.code, apiToken: guest },
        "POST",
        guest,
      ),
    ]);
    assert.deepEqual(accepts.map((r) => r.status).sort(), [200, 201]);
    assert.equal(
      (await (await b.call("/api/v1/me", undefined, "GET", guest)).json())
        .member.admin,
      false,
    );
    const html = "<!doctype html><h1>Remote storage</h1>",
      requestId = randomUUID();
    const publication = {
      title: "Remote",
      requestId,
      files: [
        { path: "index.html", data: Buffer.from(html).toString("base64") },
        {
          path: "large.txt",
          data: Buffer.alloc(1024 * 1024, 42).toString("base64"),
        },
      ],
    };
    const publications = await Promise.all([
      a.call("/api/v1/works", publication, "POST", guest),
      b.call("/api/v1/works", publication, "POST", guest),
    ]);
    assert.deepEqual(publications.map((r) => r.status).sort(), [200, 201]);
    const result = await publications[0].json(),
      slug = result.work.slug;
    const updates = await Promise.all([
      a.call(
        `/api/v1/works/${slug}`,
        { title: "A", html: "<h1>A</h1>", revision: 1 },
        "PUT",
        guest,
      ),
      b.call(
        `/api/v1/works/${slug}`,
        { title: "B", html: "<h1>B</h1>", revision: 1 },
        "PUT",
        guest,
      ),
    ]);
    assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
    const visibility = await Promise.all([
      a.call(
        `/api/v1/works/${slug}`,
        { published: false, revision: 2 },
        "PATCH",
        guest,
      ),
      b.call(
        `/api/v1/works/${slug}`,
        { published: false, revision: 2 },
        "PATCH",
        guest,
      ),
    ]);
    assert.deepEqual(visibility.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await a.call(`/s/${slug}/`)).status, 404);
    assert.equal(
      (
        await a.call(
          `/api/v1/works/${slug}`,
          { published: true, revision: 3 },
          "PATCH",
          guest,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await a.call(
          `/api/v1/works/${slug}/rollback`,
          { revision: 4, version: 1 },
          "POST",
          guest,
        )
      ).status,
      200,
    );
    assert.equal(await (await b.call(`/s/${slug}/`)).text(), html);
    assert.equal(
      (await b.call(`/s/${slug}/large.txt`)).headers.get("content-length"),
      String(1024 * 1024),
    );
    const raw = await a.repository.raw(slug);
    assert.equal(raw.html, "");
    assert.equal(raw.files, "[]");
    console.log("Checking portable backup");
    await exportBackup(a.repository, path.join(directory, "backup"));
    const restored = await createApp({
      token: admin,
      dbPath: path.join(directory, "backup/quickshare.sqlite"),
    });
    try {
      assert.equal((await restored.repository.get(slug)).html, html);
    } finally {
      restored.db.close();
    }
    await a.close();
    await b.close();
    console.log("Checking backend restart");
    docker("restart", sqlName, s3Name);
    sqlUrl = "http://" + docker("port", sqlName, "8080/tcp");
    endpoint = "http://" + docker("port", s3Name, "9000/tcp");
    await pause(1000);
    const c = await app();
    assert.equal(await (await c.call(`/s/${slug}/`)).text(), html);
    assert.equal(
      (await (await c.call("/api/v1/me", undefined, "GET", guest)).json())
        .member.registered,
      false,
    );
    const expired = await c.database
      .prepare("SELECT key FROM auth_attempts")
      .all();
    assert.ok(
      expired.length > 0,
      "authentication attempts persist across instances and restart",
    );
    await c.database.prepare("DELETE FROM auth_attempts").run();
    const d = await app();
    const attempts = await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        (index % 2 ? c : d).call("/auth/login", {
          username: "missing",
          password: "incorrect-password",
        }),
      ),
    );
    assert.equal(
      attempts.filter((response) => response.status === 401).length,
      15,
    );
    assert.equal(
      attempts.filter((response) => response.status === 429).length,
      1,
    );
    console.log(
      "Remote backend verification passed: concurrent app initialization, libSQL HTTP transactions, one-use invitations, idempotency, S3 assets, concurrent revisions, unpublish/restore, portable backup and backend restarts.",
    );
  } finally {
    for (const close of runtimes.reverse()) await close();
    for (const name of containers.reverse()) {
      try {
        docker("rm", "-f", name);
      } catch {}
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
