"use strict";
const { Marked } = require("marked");
const hljs = require("highlight.js/lib/common");
const sanitize = require("sanitize-html");
const fs = require("node:fs");
const path = require("node:path");
const css = fs.readFileSync(path.join(__dirname, "markdown.css"), "utf8");
const highlighting = fs.readFileSync(
  require.resolve("highlight.js/styles/github.css"),
  "utf8",
);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const plain = (value) =>
  sanitize(value, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
function renderMarkdown(source, options = {}) {
  if (typeof source !== "string" || !source.trim())
    throw new Error("Markdown 内容不能为空。");
  if (Buffer.byteLength(source) > 5 * 1024 * 1024)
    throw new Error("Markdown 文件不能超过 5 MB。");
  const headings = [];
  const parser = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens),
          id = `qs-heading-${headings.length + 1}`;
        headings.push({ id, depth, text: plain(text) });
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang || "").split(/\s/)[0];
        const known = language && hljs.getLanguage(language);
        const code = known
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : escape(text);
        return `<pre><code class="hljs${known ? " language-" + escape(language) : ""}">${code}</code></pre>\n`;
      },
    },
  });
  const body = sanitize(parser.parse(source), {
    allowedTags: [...sanitize.defaults.allowedTags, "img", "input", "del"],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"],
      input: ["type", "checked", "disabled"],
      h1: ["id"],
      h2: ["id"],
      h3: ["id"],
      h4: ["id"],
      h5: ["id"],
      h6: ["id"],
      code: ["class"],
      span: ["class"],
      th: ["align"],
      td: ["align"],
    },
    allowedClasses: { code: ["hljs", /^language-/], span: [/^hljs-/] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https", "http"] },
    allowProtocolRelative: false,
    transformTags: {
      input: (tag, attrs) => ({
        tagName: "input",
        attribs: {
          type: "checkbox",
          disabled: "",
          ...(Object.hasOwn(attrs, "checked") ? { checked: "" } : {}),
        },
      }),
    },
    exclusiveFilter: (frame) =>
      frame.tag === "input" && frame.attribs.type !== "checkbox",
  });
  const title =
    options.title ||
    headings.find((h) => h.depth === 1)?.text ||
    options.fallbackTitle ||
    "未命名文档";
  const toc = headings
    .filter((h) => h.depth <= 3)
    .map(
      (h) =>
        `<a class="level-${h.depth}" href="#${h.id}">${escape(h.text)}</a>`,
    )
    .join("");
  const heading = headings.some((h) => h.depth === 1)
    ? ""
    : `<h1>${escape(title)}</h1>`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escape(title)}</title><style>${highlighting}\n${css}</style></head><body><div class="reading-layout">${headings.length > 1 ? `<aside class="toc"><nav aria-label="文章目录"><span>目录</span>${toc}</nav></aside>` : ""}<main class="document">${headings.length > 1 ? `<details class="mobile-toc"><summary>目录</summary><nav aria-label="文章目录">${toc}</nav></details>` : ""}<article>${heading}${body}</article></main></div></body></html>`;
  if (Buffer.byteLength(html) > 5 * 1024 * 1024)
    throw new Error("Markdown 渲染后超过 5 MB，请缩小文档。");
  return { html, title };
}
module.exports = { renderMarkdown };
