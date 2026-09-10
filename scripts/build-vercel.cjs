"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
esbuild
  .build({
    entryPoints: [path.join(root, "vercel/handler.cjs")],
    outfile: path.join(root, ".vercel-build/handler.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    external: [
      "highlight.js/styles/github.css",
      "@resvg/resvg-js",
      "@resvg/resvg-wasm",
      "@libsql/client/*",
      "@vercel/blob",
      "@aws-sdk/client-s3",
      "playwright",
    ],
    banner: {
      js: 'const __QS_ROOT__ = require("node:path").resolve(__dirname,"..");',
    },
    plugins: [
      {
        name: "runtime-paths",
        setup(build) {
          build.onLoad({ filter: /\.[cm]?js$/ }, (args) => {
            if (
              !args.path.startsWith(root + path.sep) ||
              args.path.includes("/node_modules/")
            )
              return;
            const relative = path.relative(root, path.dirname(args.path));
            return {
              contents: fs
                .readFileSync(args.path, "utf8")
                .replace(
                  /\b__dirname\b/g,
                  'require("node:path").join(__QS_ROOT__,' +
                    JSON.stringify(relative) +
                    ")",
                ),
              loader: "js",
            };
          });
        },
      },
    ],
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
