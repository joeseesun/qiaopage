"use strict";
const fs = require("node:fs"),
  assert = require("node:assert/strict"),
  { randomBytes, randomUUID } = require("node:crypto");
const base = process.env.QUICKSHARE_URL || process.env.BASE_URL,
  admin = process.env.QUICKSHARE_TOKEN;
if (!base || !admin)
  throw new Error("Set QUICKSHARE_URL and QUICKSHARE_TOKEN privately");
const call = (route, body, method = body ? "POST" : "GET", token = admin) =>
  fetch(base + route, {
    method,
    signal: AbortSignal.timeout(60000),
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
(async () => {
  for (const route of [
    "/",
    "/publish",
    "/explore",
    "/healthz",
    "/skill.md",
    "/client/quickshare.js",
    "/assets/portal.css",
  ])
    assert.equal((await call(route)).status, 200, route);
  const statePath = process.env.QUICKSHARE_TEST_STATE;
  if (statePath && fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath));
    assert.equal(
      (await call("/api/v1/me", undefined, "GET", state.guest)).status,
      200,
    );
    assert.equal(
      await (await call("/s/" + state.slug + "/")).text(),
      state.html,
    );
    console.log("Deployment restart readback passed.");
    return;
  }
  const invite = await (
    await call("/api/v1/invites", { label: "Deployment verification" })
  ).json();
  assert.ok(invite.code);
  const guest = randomBytes(32).toString("hex");
  const accepted = await Promise.all([
    call(
      "/auth/accept",
      { invite: invite.code, apiToken: guest },
      "POST",
      guest,
    ),
    call(
      "/auth/accept",
      { invite: invite.code, apiToken: guest },
      "POST",
      guest,
    ),
  ]);
  assert.deepEqual(accepted.map((r) => r.status).sort(), [200, 201]);
  assert.equal(
    (await call("/api/v1/members", undefined, "GET", guest)).status,
    403,
  );
  const html =
    '<!doctype html><html lang="zh"><head><title>部署验收</title></head><body><h1>Hello，Quickshare</h1></body></html>';
  const body = {
    title: "Deployment verification",
    requestId: randomUUID(),
    files: [
      { path: "index.html", data: Buffer.from(html).toString("base64") },
      {
        path: "asset.txt",
        data: Buffer.alloc(1024 * 1024, 42).toString("base64"),
      },
    ],
  };
  const writes = await Promise.all([
    call("/api/v1/works", body, "POST", guest),
    call("/api/v1/works", body, "POST", guest),
  ]);
  assert.deepEqual(writes.map((r) => r.status).sort(), [200, 201]);
  const { work } = await writes[0].json(),
    slug = work.slug;
  const page = await call("/s/" + slug + "/");
  assert.equal(await page.text(), html);
  assert.match(page.headers.get("content-security-policy"), /sandbox/);
  assert.doesNotMatch(
    page.headers.get("content-security-policy"),
    /allow-same-origin/,
  );
  assert.deepEqual(
    Buffer.from(await (await call("/s/" + slug + "/asset.txt")).arrayBuffer()),
    Buffer.alloc(1024 * 1024, 42),
  );
  const updates = await Promise.all([
    call(
      "/api/v1/works/" + slug,
      { title: "A", html: "<h1>A</h1>", revision: 1 },
      "PUT",
      guest,
    ),
    call(
      "/api/v1/works/" + slug,
      { title: "B", html: "<h1>B</h1>", revision: 1 },
      "PUT",
      guest,
    ),
  ]);
  assert.deepEqual(updates.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await call(
        "/api/v1/works/" + slug + "/rollback",
        { revision: 2, version: 1 },
        "POST",
        guest,
      )
    ).status,
    200,
  );
  assert.equal(await (await call("/s/" + slug + "/")).text(), html);
  const preview = await call(
    "/api/v1/works/" + slug + "/sharing",
    undefined,
    "GET",
    guest,
  );
  assert.equal(preview.status, 200);
  const png = Buffer.from(
    (await preview.json()).preview.image.split(",")[1],
    "base64",
  );
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const account = await (
    await call("/api/v1/account", undefined, "GET", guest)
  ).json();
  const changed = await call(
    "/api/v1/account",
    {
      username: "qa-" + randomBytes(5).toString("hex"),
      password: randomBytes(24).toString("hex"),
      revision: account.account.revision,
    },
    "PATCH",
    guest,
  );
  assert.equal(changed.status, 200, await changed.text());
  if (statePath)
    fs.writeFileSync(statePath, JSON.stringify({ guest, slug, html }), {
      mode: 0o600,
      flag: "wx",
    });
  console.log(
    "Deployment verification passed: routes, invitations, identity, publishing, idempotency, revision conflicts, restore, exact assets, sandbox, OG PNG and account update.",
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
