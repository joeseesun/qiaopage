"use strict";
const path = require("node:path");
const MAX_BYTES = 8 * 1024 * 1024,
  MAX_FILES = 100;
const blocked =
  /^(?:\..*|node_modules|\.git|\.env.*|.*\.(?:pem|key|sqlite|db))$/i;
function validPath(value) {
  return (
    typeof value === "string" &&
    value.length <= 240 &&
    !/[\\\x00-\x1f\x7f?#%:]/.test(value) &&
    value
      .split("/")
      .every(
        (part) => part && part !== "." && part !== ".." && !blocked.test(part),
      )
  );
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".markdown": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
};
function prepareFiles(input, options = {}) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_FILES)
    throw new Error("一次可发布 1–100 个文件。");
  const names = new Set();
  let bytes = 0;
  const files = input.map((file) => {
    if (!file || !validPath(file.path) || names.has(file.path.toLowerCase()))
      throw new Error("文件路径无效或重复，请排除隐藏文件、密钥和数据库。");
    names.add(file.path.toLowerCase());
    if (
      typeof file.data !== "string" ||
      file.data.length > Math.ceil(MAX_BYTES / 3) * 4
    )
      throw new Error("文件内容编码不正确。");
    const data = Buffer.from(file.data, "base64");
    // A repeated-group regex can overflow V8's stack on valid 5 MiB files.
    if (data.toString("base64") !== file.data) throw new Error("文件内容编码不正确。");
    bytes += data.length;
    if (data.length > 5 * 1024 * 1024 || bytes > MAX_BYTES)
      throw new Error("单文件最多 5 MB，每次发布合计最多 8 MB。");
    return { path: file.path, data: file.data };
  });
  if (!files.some((f) => f.path === "index.html")) {
    const md = files.find((f) => /^index\.(md|markdown)$/.test(f.path));
    if (md) {
      const html = require("./markdown").renderMarkdown(
        Buffer.from(md.data, "base64").toString("utf8"),
        { title: options.title },
      ).html;
      bytes += Buffer.byteLength(html);
      files.push({
        path: "index.html",
        data: Buffer.from(html).toString("base64"),
      });
    }
  }
  if (bytes > MAX_BYTES || files.length > MAX_FILES)
    throw new Error("转换后内容超过发布上限。");
  const index = files.find((f) => f.path === "index.html");
  if (!index) throw new Error("网站目录需要 index.html 或 index.md 作为首页。");
  return {
    files,
    html: Buffer.from(index.data, "base64").toString("utf8"),
    bytes,
  };
}
module.exports = { prepareFiles, validPath, types, MAX_BYTES, MAX_FILES };
