"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto");
const { createApp } = require("../server");
test("private chunk uploads enforce integrity, limits, ownership, retry and canonical revision checks", async (t) => {
  const token = "chunk-test-admin-".repeat(4),
    runtime = await createApp({
      token,
      dbPath: ":memory:",
      streamResponses: true,
      baseUrl: "http://quickshare.test",
    });
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    runtime.db.close();
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (p, b, m = b ? "POST" : "GET", key = token) =>
    fetch(base + p, {
      method: m,
      headers: {
        Origin: "http://quickshare.test",
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
      body: b ? JSON.stringify(b) : undefined,
    });
  const payload = {
      title: "Chunked",
      html: "<h1>Original</h1>",
      requestId: "chunked-create-0001",
    },
    bytes = Buffer.from(JSON.stringify(payload));
  const parameters = {
    method: "POST",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  assert.equal(
    (await call("/api/v1/uploads", parameters, "POST", "invalid")).status,
    401,
  );
  const start = await call("/api/v1/uploads", parameters);
  assert.equal(start.status, 201);
  const { id } = await start.json(),
    path = "/api/v1/uploads/" + id;
  assert.equal((await call(path + "/complete", {})).status, 409);
  assert.equal((await call(path + "/chunks/0", { data: "abcd" })).status, 400);
  assert.equal(
    (await call(path + "/chunks/0", { data: bytes.toString("base64") })).status,
    200,
  );
  assert.equal(
    (await call(path + "/chunks/0", { data: bytes.toString("base64") })).status,
    200,
  );
  assert.equal(
    (
      await call(path + "/chunks/0", {
        data: Buffer.alloc(bytes.length, 65).toString("base64"),
      })
    ).status,
    409,
  );
  const invite = await (
      await call("/api/v1/invites", { label: "Upload isolation" })
    ).json(),
    guest = "c".repeat(64);
  assert.equal(
    (
      await call(
        "/auth/accept",
        { invite: invite.code, apiToken: guest },
        "POST",
        guest,
      )
    ).status,
    201,
  );
  assert.equal((await call(path + "/complete", {}, "POST", guest)).status, 404);
  assert.equal((await call(path, undefined, "DELETE", guest)).status, 404);
  const completed = await call(path + "/complete", {});
  assert.equal(completed.status, 201);
  const { work } = await completed.json();
  assert.equal((await call(path + "/complete", {})).status, 200);
  assert.equal(
    await (await call("/s/" + work.slug + "/")).text(),
    payload.html,
  );
  assert.equal(
    (
      await call("/api/v1/uploads", {
        ...parameters,
        bytes: 16 * 1024 * 1024 + 1,
      })
    ).status,
    400,
  );
  assert.equal((await call("/api/v1/uploads", parameters)).status, 201);
  assert.equal((await call("/api/v1/uploads", parameters)).status, 429);
  assert.equal((await call(path, undefined, "DELETE")).status, 200);
  assert.equal((await call(path + "/complete", {})).status, 404);
  await runtime.db.prepare("UPDATE uploads SET expires=0").run();
  const expired = await (
      await call("/api/v1/uploads", { ...parameters, sha256: "a".repeat(64) })
    ).json(),
    bad = "/api/v1/uploads/" + expired.id;
  await call(bad + "/chunks/0", { data: bytes.toString("base64") });
  assert.equal((await call(bad + "/complete", {})).status, 400);
  assert.equal(
    (
      await call(
        "/api/v1/works/" + work.slug,
        {
          title: "Large",
          html: "<h1>large</h1>",
          files: [
            {
              path: "index.html",
              data: Buffer.from("<h1>large</h1>").toString("base64"),
            },
            {
              path: "large.txt",
              data: Buffer.alloc(5 * 1024 * 1024, 42).toString("base64"),
            },
          ],
          revision: 1,
        },
        "PUT",
      )
    ).status,
    200,
  );
  const large = await call("/s/" + work.slug + "/large.txt");
  assert.equal(large.headers.get("content-length"), null);
  assert.deepEqual(
    Buffer.from(await large.arrayBuffer()),
    Buffer.alloc(5 * 1024 * 1024, 42),
  );
});
