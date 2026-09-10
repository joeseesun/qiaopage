const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown } = require("../lib/markdown");
const { createApp } = require("../server");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execute = promisify(execFile);
const source =
  "# 阅读练习\n\n一句 **重点** 和 [链接](https://example.com)。\n\n## 章节\n\n| 方法 | 结果 |\n| --- | --- |\n| 发布 | HTML |\n\n- [x] 完成\n- [ ] 待办\n\n```js\nconst answer = 42;\n```\n\n## 章节\n\n> 留一点空白。";
test("Markdown renders GFM, code, distinct heading anchors and a portable document", () => {
  const { html, title } = renderMarkdown(source);
  assert.equal(title, "阅读练习");
  assert.match(html, /<table>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /<input[^>]*checked/);
  assert.match(html, /<input[^>]*disabled/);
  assert.match(html, /id="qs-heading-2"/);
  assert.match(html, /id="qs-heading-3"/);
  assert.match(html, /href="#qs-heading-3"/);
  assert.match(html, /<style>/);
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<link"));
  assert.match(
    renderMarkdown("正文", { title: "自定标题" }).html,
    /<h1>自定标题<\/h1>/,
  );
  assert.match(
    renderMarkdown("```not-a-language\n<script>alert(1)</script>\n```").html,
    /&lt;script&gt;/,
  );
});
test("Markdown strips active markup before rendering or screenshot capture", () => {
  const { html } = renderMarkdown(
    '# 安全\n<script>alert(1)</script>\n<img src="https://example.com/a.png" onerror="evil()">\n<a href="javascript:evil()">链接</a>\n<iframe src="https://example.com"></iframe>',
  );
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("<iframe"));
  assert.throws(() => renderMarkdown(""), /不能为空/);
  assert.throws(() => renderMarkdown("x".repeat(5 * 1024 * 1024 + 1)), /5 MB/);
});
test("CLI publishes and updates Markdown, exports HTML and retains existing HTML compatibility", async (t) => {
  const token = "test-markdown-token-".repeat(3);
  const { app, db } = createApp({ token, dbPath: ":memory:" });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickshare-md-"));
  t.after(
    () =>
      new Promise((resolve) =>
        server.close(() => {
          db.close();
          fs.rmSync(dir, { recursive: true });
          resolve();
        }),
      ),
  );
  const env = {
    ...process.env,
    QUICKSHARE_CONFIG: path.join(dir, "config.json"),
    QUICKSHARE_URL: `http://127.0.0.1:${server.address().port}`,
    QUICKSHARE_TOKEN: token,
  };
  const cli = (...args) =>
    execute(
      process.execPath,
      [path.join(__dirname, "../bin/quickshare.js"), ...args],
      { env },
    );
  const file = path.join(dir, "article.md");
  fs.writeFileSync(file, source);
  let r = await cli("publish", file, "--slug", "article", "--json");
  assert.equal(JSON.parse(r.stdout).work.title, "阅读练习");
  fs.writeFileSync(file, source + "\n\n追加一段。");
  r = await cli("update", "article", file, "--json");
  assert.equal(JSON.parse(r.stdout).work.revision, 2);
  const output = path.join(dir, "article.html");
  await cli("get", "article", "--output", output);
  const saved = fs.readFileSync(output, "utf8");
  assert.match(saved, /<table>/);
  assert.match(saved, /追加一段/);
  const page = await fetch(env.QUICKSHARE_URL + "/embed/article");
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /sandbox allow-scripts/,
  );
  const second = path.join(dir, "second.MARKDOWN");
  fs.writeFileSync(second, "正文");
  r = await cli(
    "publish",
    second,
    "--slug",
    "second",
    "--title",
    "手动标题",
    "--json",
  );
  assert.equal(JSON.parse(r.stdout).work.title, "手动标题");
  assert.match(
    await (await fetch(env.QUICKSHARE_URL + "/s/second/")).text(),
    /<title>手动标题<\/title>/,
  );
});
