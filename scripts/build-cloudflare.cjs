"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  ejs = require("ejs"),
  { createHash } = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, ".cloudflare-build");
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, "public"), { recursive: true });
fs.cpSync(path.join(root, "public/showcase"), path.join(out, "public/assets"), {
  recursive: true,
});
fs.cpSync(path.join(root, "lib/fonts"), path.join(out, "public/fonts"), {
  recursive: true,
});
fs.mkdirSync(path.join(out, "public/client"), { recursive: true });
fs.copyFileSync(
  path.join(root, "bin/quickshare.js"),
  path.join(out, "public/client/quickshare.js"),
);
const templates = fs
  .readdirSync(path.join(root, "views/showcase"))
  .filter((name) => name.endsWith(".ejs"))
  .map(
    (name) =>
      JSON.stringify(name.slice(0, -4)) +
      ":" +
      ejs
        .compile(
          fs.readFileSync(path.join(root, "views/showcase", name), "utf8"),
          {
            client: true,
            compileDebug: false,
            _with: false,
            destructuredLocals: [
              "isHome",
              "work",
              "baseUrl",
              "portalVersion",
              "siteName",
              "agentPrompt",
              "formatDate",
              "q",
              "tags",
              "works",
              "page",
              "pages",
              "tag",
              "title",
              "description",
              "canonical",
              "message",
              "compact",
              "total",
              "filteredCount",
            ],
          },
        )
        .toString(),
  );
const version = createHash("sha256")
  .update(
    fs
      .readdirSync(path.join(root, "public/showcase"))
      .filter((name) =>
        fs.statSync(path.join(root, "public/showcase", name)).isFile(),
      )
      .sort()
      .map((name) => fs.readFileSync(path.join(root, "public/showcase", name)))
      .join("\n"),
  )
  .digest("hex")
  .slice(0, 12);
fs.writeFileSync(
  path.join(out, "templates.mjs"),
  `const templates={${templates.join(",\n")}};\nexport const portalVersion=${JSON.stringify(version)};\nexport function render(view,locals){if(!templates[view])throw new Error('Unknown template');return templates[view](locals,undefined,(name,data)=>render(name,{...locals,...data}));}\n`,
);
console.log("Cloudflare templates and static assets built.");
fs.mkdirSync(path.join(out, "worker"), { recursive: true });
fs.copyFileSync(
  require.resolve("@resvg/resvg-wasm/index_bg.wasm"),
  path.join(out, "worker/resvg.wasm"),
);
require("esbuild")
  .build({
    entryPoints: [path.join(root, "cloudflare/worker.mjs")],
    outfile: path.join(out, "worker/worker.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    external: ["cloudflare:*", "node:*"],
    define: { "process.env.NODE_ENV": '"production"' },
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire("/bundle/worker.mjs"); const __dirname = "/bundle";',
    },
    plugins: [
      {
        name: "worker-backends",
        setup(build) {
          build.onResolve(
            { filter: /^@resvg\/resvg-wasm\/index_bg\.wasm$/ },
            () => ({ path: "./resvg.wasm", external: true }),
          );
          build.onResolve(
            {
              filter:
                /^(?:@resvg\/resvg-js|@libsql\/client\/web|@aws-sdk\/client-s3|@vercel\/blob)$/,
            },
            () => ({
              path: path.join(root, "cloudflare/native-unavailable.cjs"),
            }),
          );
        },
      },
    ],
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
