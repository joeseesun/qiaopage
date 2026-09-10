"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  { randomBytes } = require("node:crypto"),
  dotenv = require("dotenv");
const [provider, name = "quickshare-agent"] = process.argv.slice(2);
if (
  !["cloudflare", "vercel"].includes(provider) ||
  !/^[a-z][a-z0-9-]{2,40}$/.test(name)
)
  throw new Error(
    "Usage: node scripts/install-cloud.cjs cloudflare|vercel [project-name]",
  );
process.chdir(path.resolve(__dirname, ".."));
const file = ".env." + provider,
  cli = provider === "vercel" ? ["--yes", "vercel@59.15.1"] : ["wrangler"];
function run(args, options = {}) {
  const result = spawnSync("npx", [...cli, ...args], {
    encoding: "utf8",
    stdio:
      options.input !== undefined
        ? ["pipe", "inherit", "inherit"]
        : options.capture
          ? ["ignore", "pipe", "inherit"]
          : "inherit",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      "CLI step failed. Resolve the reported login, terms or configuration issue and rerun; existing resources and secrets are preserved.",
    );
  return result.stdout;
}
function read() {
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {};
}
function save(values) {
  fs.writeFileSync(
    file,
    Object.entries(values)
      .map(([key, value]) => key + "=" + JSON.stringify(value))
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  fs.chmodSync(file, 0o600);
}
try {
  if (provider === "cloudflare") {
    run(["whoami"]);
    const config = JSON.parse(fs.readFileSync("wrangler.jsonc"));
    // A custom installation gets its own config, DO namespace and R2 bucket.
    config.name = name;
    config.r2_buckets[0].bucket_name = name + "-objects";
    const configFile = ".wrangler-install.json";
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
    const listing = run(["r2", "bucket", "list"], { capture: true });
    const buckets = [...listing.matchAll(/^name:\s+(\S+)/gm)].map(match=>({name:match[1]}));
    if (
      !buckets.some(
        (bucket) => bucket.name === config.r2_buckets[0].bucket_name,
      )
    )
      run(["r2", "bucket", "create", config.r2_buckets[0].bucket_name]);
    const env = read();
    if (!env.QUICKSHARE_TOKEN)
      env.QUICKSHARE_TOKEN = randomBytes(32).toString("hex");
    save(env);
    run(["deploy", "--config", configFile, "--secrets-file", file]);
    console.log(
      "Cloudflare deployed. Keep " +
        file +
        " private. The CLI output above contains the site URL.",
    );
  } else {
    run(["link", "--yes", "--project", name]);
    const prior = read();
    run(["env", "pull", file, "--environment", "production"]);
    let env = read();
    if (!env.TURSO_DATABASE_URL && !env.DATABASE_URL)
      run([
        "integration",
        "add",
        "tursocloud/database",
        "--name",
        name,
        "--plan",
        "starter",
        "-m",
        "region=hnd1",
        "--no-env-pull",
      ]);
    if (!env.BLOB_READ_WRITE_TOKEN && !env.BLOB_STORE_ID)
      run(["blob", "create-store", name, "--access", "private", "--yes"]);
    run(["env", "pull", file, "--environment", "production"]);
    env = read();
    if (!env.OBJECT_STORE) {
      env.OBJECT_STORE = "vercel-blob";
      run(["env", "add", "OBJECT_STORE", "production"], {input: env.OBJECT_STORE});
    }
    if (!env.QUICKSHARE_TOKEN) {
      env.QUICKSHARE_TOKEN =
        prior.QUICKSHARE_TOKEN || randomBytes(32).toString("hex");
      save(env);
      run(["env", "add", "QUICKSHARE_TOKEN", "production"], {
        input: env.QUICKSHARE_TOKEN,
      });
    }
    save(env);
    run(["deploy", "--prod", "--yes"]);
    console.log(
      "Vercel deployed. Keep " +
        file +
        " private. Database and private Blob storage survive redeploys.",
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
