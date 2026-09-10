"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  net = require("node:net");
const { spawn, execFileSync } = require("node:child_process"),
  { randomBytes } = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "qs-worker-"));
let child,
  log = "";
async function stop() {
  if (!child) return;
  const previous = child;
  child = undefined;
  previous.kill("SIGTERM");
  await new Promise((r) => previous.once("exit", r));
}
async function run(file, env) {
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [file], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(file + " failed")),
    );
    p.on("error", reject);
  });
}
(async () => {
  execFileSync(process.execPath, ["scripts/build-cloudflare.cjs"], {
    cwd: root,
    stdio: "inherit",
  });
  const port = await new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
  const base = "http://127.0.0.1:" + port,
    token = randomBytes(32).toString("hex");
  const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc")));
  config.main = path.join(root, config.main);
  config.assets.directory = path.join(root, config.assets.directory);
  delete config.build;
  fs.writeFileSync(
    path.join(temporary, "wrangler.json"),
    JSON.stringify(config),
  );
  fs.writeFileSync(
    path.join(temporary, ".dev.vars"),
    "QUICKSHARE_TOKEN=" + token + "\nBASE_URL=" + base + "\n",
    { mode: 0o600 },
  );
  async function start() {
    log = "";
    child = spawn(
      process.execPath,
      [
        path.join(root, "node_modules/wrangler/bin/wrangler.js"),
        "dev",
        "--config",
        path.join(temporary, "wrangler.json"),
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--persist-to",
        path.join(temporary, "state"),
      ],
      {
        cwd: root,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        if (
          (
            await fetch(base + "/healthz", {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        )
          return;
      } catch {}
      if (child.exitCode !== null) throw new Error("Worker exited: " + log);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Worker not ready: " + log);
  }
  const env = {
    QUICKSHARE_URL: base,
    QUICKSHARE_TOKEN: token,
    QUICKSHARE_TEST_STATE: path.join(temporary, "state.json"),
  };
  await start();
  await run("scripts/verify-deployment.cjs", env);
  await run("scripts/verify-large-upload.cjs", env);
  await stop();
  await start();
  await run("scripts/verify-deployment.cjs", env);
  console.log(
    "Cloudflare native runtime, large uploads and persistent restart passed.",
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stop();
    fs.rmSync(temporary, { recursive: true, force: true });
  });
