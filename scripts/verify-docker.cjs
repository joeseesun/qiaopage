"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickshare-docker-"));
const envFile = path.join(dir, ".env.docker");
const project = `quickshare-verify-${process.pid}`;
let token;
const environment = { ...process.env };
for (const key of ["QUICKSHARE_TOKEN", "BASE_URL", "QUICKSHARE_PORT", "COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_PROFILES", "DATABASE_URL", "DATABASE_AUTH_TOKEN", "OBJECT_STORE", "OBJECTS_PATH", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION", "S3_PREFIX", "S3_FORCE_PATH_STYLE"]) delete environment[key];
const compose = (...args) => execFileSync("docker", ["compose", "-f", path.join(root, "docker-compose.yml"), "--env-file", envFile, "-p", project, ...args], { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000 });
async function main() {
  try {
    fs.copyFileSync(path.join(root, "scripts/setup.js"), path.join(dir, "setup.js"));
    const setup = () => execFileSync("docker", ["run", "--rm", "--user", `${process.getuid()}:${process.getgid()}`, "-v", `${dir}:/workspace`, "-w", "/workspace", "node:24.20.0-bookworm-slim", "node", "setup.js", "--docker"], { encoding: "utf8", timeout: 120000 });
    setup();
    const original = fs.readFileSync(envFile, "utf8");
    assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
    setup();
    assert.equal(fs.readFileSync(envFile, "utf8"), original, "setup must preserve existing credentials");
    token = original.match(/^QUICKSHARE_TOKEN=(.+)$/m)[1];
    assert.equal(token.length, 64);
    fs.appendFileSync(envFile, "QUICKSHARE_PORT=0\n");
    compose("up", "-d", "--build", "--wait", "--wait-timeout", "90");
    let url;
    const connect = () => { url = `http://${compose("port", "quickshare", "3000").trim()}`; };
    connect();
    const call = (route, method = "GET", body, auth = true) => fetch(url + route, {
      method, signal: AbortSignal.timeout(15000),
      headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(compose("exec", "-T", "quickshare", "id", "-u").trim(), "1000");
    for (const route of ["/", "/healthz", "/publish", "/skill.md", "/client/quickshare.js"]) assert.equal((await call(route)).status, 200, route);
    assert.equal((await call("/api/v1/me", "GET", undefined, false)).status, 401);
    const html = '<!doctype html><html lang="zh"><head><title>容器验收</title></head><body><h1>Hello, Docker.</h1></body></html>';
    assert.equal((await call("/api/v1/works/container-test", "PUT", { title: "容器验收", html })).status, 201);
    const source = await call("/s/container-test/", "GET", undefined, false);
    assert.equal(await source.text(), html);
    assert.match(source.headers.get("content-security-policy"), /sandbox/);
    assert.doesNotMatch(source.headers.get("content-security-policy"), /allow-same-origin/);
    const previewResponse = await call("/api/v1/works/container-test/sharing");
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    const png = Buffer.from(preview.preview.image.split(",")[1], "base64");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    const backup = JSON.parse(compose("exec", "-T", "quickshare", "node", "scripts/migrate-storage.js", "--backup-only", "--backup", "/app/data/recovery-check"));
    assert.ok(backup.objects >= 2);
    assert.equal(backup.mode, "backup");
    const before = await (await call("/api/v1/account")).json();
    // Recreate the container, not merely the Node process, while preserving its volume.
    compose("up", "-d", "--force-recreate", "--wait", "--wait-timeout", "90");
    connect();
    assert.equal(await (await call("/s/container-test/", "GET", undefined, false)).text(), html);
    assert.deepEqual(await (await call("/api/v1/account")).json(), before);
    assert.equal((await call("/api/v1/works/container-test", "PUT", { title: "conflict", html })).status, 409);
    assert.equal((await call("/api/v1/works/container-test", "PUT", { title: "更新", html, revision: 1 })).status, 200);
    console.log("Docker verified: Docker-only setup, private credentials, non-root, health, UI routes, CLI/Skill download, authentication, exact-source publishing, sandbox, PNG rendering, persistent accounts/content, revision conflicts and updates.");
  } finally {
    try { compose("down", "--volumes", "--remove-orphans"); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
