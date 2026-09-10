const fs = require("fs"),
  os = require("os"),
  path = require("path"),
  { spawn } = require("child_process"),
  assert = require("assert/strict");
const state = JSON.parse(fs.readFileSync(process.env.QUICKSHARE_TEST_STATE)),
  base = process.env.QUICKSHARE_URL;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-large-"));
(async () => {
  const site = path.join(dir, "site");
  fs.mkdirSync(site);
  const html =
    "<!doctype html><html><head><title>Large test</title></head><body><h1>完整文件</h1></body></html>";
  fs.writeFileSync(path.join(site, "index.html"), html);
  const asset = Buffer.alloc(5 * 1024 * 1024, 42),
    second = Buffer.alloc(3 * 1024 * 1024 - Buffer.byteLength(html), 43);
  fs.writeFileSync(path.join(site, "large.txt"), asset);
  fs.writeFileSync(path.join(site, "second.txt"), second);
  const config = path.join(dir, "config.json");
  fs.writeFileSync(config, JSON.stringify({ url: base, token: state.guest }), {
    mode: 0o600,
  });
  const child = spawn(
    process.execPath,
    [
      "bin/quickshare.js",
      "publish",
      site,
      "--title",
      "8 MB CLI verification",
      "--json",
    ],
    {
      env: {
        ...process.env,
        QUICKSHARE_CONFIG: config,
        QUICKSHARE_TOKEN: state.guest,
      },
    },
  );
  let out = "",
    error = "";
  child.stdout.on("data", (x) => (out += x));
  child.stderr.on("data", (x) => (error += x));
  const code = await new Promise((r) => child.on("exit", r));
  assert.equal(code, 0, error);
  const result = JSON.parse(out),
    slug = result.work.slug;
  for (const [file, bytes] of [
    ["", Buffer.from(html)],
    ["large.txt", asset],
    ["second.txt", second],
  ]) {
    const response = await fetch(base + "/s/" + slug + "/" + file);
    assert.equal(response.status, 200, "Readback " + file);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + state.guest,
  };
  let response = await fetch(base + "/api/v1/works/" + slug, {
    headers,
    method: "PATCH",
    body: JSON.stringify({ revision: 1, published: false }),
  });
  assert.equal(
    response.status,
    200,
    "Visibility update: " + (await response.text()),
  );
  assert.equal((await fetch(base + "/s/" + slug + "/large.txt")).status, 404);
  response = await fetch(base + "/api/v1/works/" + slug, {
    headers,
    method: "PATCH",
    body: JSON.stringify({ revision: 2, published: true }),
  });
  assert.equal(
    response.status,
    200,
    "Visibility update: " + (await response.text()),
  );
  assert.deepEqual(
    Buffer.from(
      await (await fetch(base + "/s/" + slug + "/large.txt")).arrayBuffer(),
    ),
    asset,
  );
  console.log(
    "8 MiB CLI upload, exact 5 MiB asset, unpublish and restore passed.",
  );
})()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
