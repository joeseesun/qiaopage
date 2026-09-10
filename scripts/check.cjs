"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
function check(file) {
  if (fs.statSync(file).isDirectory()) {
    for (const entry of fs.readdirSync(file)) check(path.join(file, entry));
  } else if (/\.(?:[cm]?js)$/.test(file))
    execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}
for (const file of [
  "server.js",
  "api",
  "vercel",
  "cloudflare",
  "lib",
  "bin",
  "scripts",
  "test",
  "public/showcase",
])
  check(file);
