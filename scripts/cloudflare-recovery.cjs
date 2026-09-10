"use strict";
const fs = require("node:fs");
const [command, file] = process.argv.slice(2);
const base = process.env.QUICKSHARE_URL,
  token = process.env.QUICKSHARE_RECOVERY_TOKEN;
if (!base || !token || !["checkpoint", "restore"].includes(command) || !file)
  throw new Error(
    "Set QUICKSHARE_URL and QUICKSHARE_RECOVERY_TOKEN; use checkpoint FILE or restore FILE",
  );
const call = (route, body) =>
  fetch(base + route, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
(async () => {
  if (command === "checkpoint") {
    const response = await call("/__ops/recovery");
    if (!response.ok)
      throw new Error("Checkpoint failed: HTTP " + response.status);
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...(await response.json()),
        base,
        createdAt: new Date().toISOString(),
      }),
      { mode: 0o600, flag: "wx" },
    );
    console.log("Recovery checkpoint saved privately.");
    return;
  }
  const saved = JSON.parse(fs.readFileSync(file));
  if (saved.base !== base)
    throw new Error("Checkpoint belongs to another installation");
  const response = await call("/__ops/recovery", { bookmark: saved.bookmark });
  if (!response.ok) throw new Error("Recovery failed: HTTP " + response.status);
  const { undo } = await response.json();
  fs.writeFileSync(
    file + ".undo-" + Date.now(),
    JSON.stringify({ base, bookmark: undo }),
    { mode: 0o600, flag: "wx" },
  );
  // The deliberate abort terminates this request. Verify the next session, not this response.
  await call("/__ops/recovery/restart", {}).catch(() => {});
  const health = await fetch(base + "/healthz", {
    signal: AbortSignal.timeout(60000),
  });
  if (!health.ok) throw new Error("Recovery restart needs inspection");
  console.log(
    "Recovery restart completed; verify account and content readback before resuming publishing.",
  );
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
