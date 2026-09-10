"use strict";
const { Parser } = require("htmlparser2");
const { renderSvg } = require("./render-svg");
const { createHash } = require("node:crypto");
const escape = (s) =>
  String(s ?? "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
function metadata(html) {
  const tags = Object.create(null);
  let inHead = false,
    inTitle = false,
    title = "",
    insert = -1,
    htmlEnd = 0,
    stopped = false,
    templateDepth = 0;
  const parser = new Parser(
    {
      onprocessinginstruction(name) {
        if (name.toLowerCase() === "!doctype") htmlEnd = parser.endIndex + 1;
      },
      onopentag(name, attrs) {
        if (name === "template") templateDepth++;
        if (templateDepth) return;
        if (name === "html") htmlEnd = parser.endIndex + 1;
        if (name === "head") inHead = true;
        if (name === "body") stopped = true;
        if (stopped) return;
        if (name === "title") inTitle = true;
        if (name === "meta") {
          const key = (attrs.property || attrs.name || "").toLowerCase();
          if (!(key in tags)) tags[key] = attrs.content || "";
          if (
            ["robots", "googlebot", "bingbot"].includes(key) &&
            /\b(noindex|none)\b/i.test(attrs.content || "")
          )
            tags.noindex = true;
        }
        if (
          name === "link" &&
          (attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical") &&
          !("canonical" in tags)
        )
          tags.canonical = attrs.href || "";
      },
      ontext(text) {
        if (inTitle && !stopped) title += text;
      },
      onclosetag(name) {
        if (name === "template" && templateDepth) {
          templateDepth--;
          return;
        }
        if (templateDepth) return;
        if (name === "title") inTitle = false;
        if (name === "head" && inHead) {
          insert = parser.startIndex;
          inHead = false;
          stopped = true;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return { tags, title: title.trim(), insert, htmlEnd };
}
function safeUrl(value, base) {
  try {
    const u = new URL(value, base);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
function effective(row, baseUrl) {
  const source = metadata(row.html),
    t = source.tags,
    url = `${baseUrl}/s/${row.slug}/`;
  return {
    title: t["og:title"] || row.share_title || source.title || row.title,
    description:
      t["og:description"] ||
      row.share_description ||
      t.description ||
      row.description ||
      "",
    image:
      "og:image" in t
        ? safeUrl(t["og:image"], url)
        : `${baseUrl}/social/${row.slug}?v=${row.revision}-${row.share_revision}`,
    url: (t.canonical && safeUrl(t.canonical, url)) || url,
    source,
    locked: {
      title: "og:title" in t,
      description: "og:description" in t,
      image: "og:image" in t,
    },
  };
}
function enhance(row, baseUrl) {
  if (!row.share_enabled) return row.html;
  const m = effective(row, baseUrl),
    { tags, insert, htmlEnd } = m.source;
  const values = {
    description: m.description,
    "og:title": m.title,
    "og:description": m.description,
    "og:type": "website",
    "og:url": m.url,
    "og:image": m.image,
    "twitter:card": "summary_large_image",
    "twitter:title": m.title,
    "twitter:description": m.description,
    "twitter:image": m.image,
  };
  if (!("og:image" in tags)) {
    values["og:image:alt"] = m.title;
    if (!row.share_image && !row.cover) {
      values["og:image:width"] = "1200";
      values["og:image:height"] = "630";
      values["og:image:type"] = "image/png";
    }
  }
  let added = "\n";
  if (!m.source.title) added += `<title>${escape(m.title)}</title>`;
  for (const [key, value] of Object.entries(values))
    if (!(key in tags))
      added += `<meta ${key.startsWith("og:") ? "property" : "name"}="${key}" content="${escape(value)}">`;
  if (!("canonical" in tags))
    added += `<link rel="canonical" href="${escape(m.url)}">`;
  added += "\n";
  return insert >= 0
    ? row.html.slice(0, insert) + added + row.html.slice(insert)
    : row.html.slice(0, htmlEnd) +
        `<head>${added}</head>` +
        row.html.slice(htmlEnd);
}
function indexable(row) {
  return Boolean(
    row.published && row.search_indexable && !metadata(row.html).tags.noindex,
  );
}
const cache = new Map();
function card(title, description = "", renderer = renderSvg) {
  const key = createHash("sha256")
    .update(title + "\0" + description)
    .digest("hex");
  if (cache.has(key)) return cache.get(key);
  const wrap = (s, max, lines) => {
    const result = [];
    let line = "",
      width = 0;
    for (const c of Array.from(s.replace(/\s+/g, " ").trim())) {
      const w = c.charCodeAt(0) > 255 ? 1 : 0.56;
      if (width + w > max && !/[，。！？；：、,.!?;:）】」》]/.test(c)) {
        result.push(line);
        line = "";
        width = 0;
      }
      if (result.length === lines) {
        result[lines - 1] = result[lines - 1].slice(0, -1) + "…";
        return result;
      }
      line += c;
      width += w;
    }
    if (line) result.push(line);
    return result;
  };
  const titleLines = wrap(title, 16, 3),
    descLines = wrap(description, 33, 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#fafafa"/><rect x="32" y="32" width="1136" height="566" rx="24" fill="white" stroke="#e5e5e5"/><path d="M92 108h48" stroke="#171717" stroke-width="6"/><g font-family="Noto Sans SC" fill="#171717" font-size="60" font-weight="600">${titleLines.map((s, i) => `<text x="92" y="${216 + i * 82}">${escape(s)}</text>`).join("")}</g><g font-family="Noto Sans SC" fill="#737373" font-size="28">${descLines.map((s, i) => `<text x="92" y="${484 + i * 42}">${escape(s)}</text>`).join("")}</g></svg>`;
  const bytes = renderer(svg);
  if (cache.size >= 16) cache.delete(cache.keys().next().value);
  cache.set(key, bytes);
  return bytes;
}
function image(row, baseUrl, renderer) {
  if (row.share_image)
    return {
      mime: row.share_image_mime,
      bytes: Buffer.from(row.share_image, "base64"),
    };
  if (row.cover)
    return { mime: row.cover_mime, bytes: Buffer.from(row.cover, "base64") };
  const m = effective(row, baseUrl);
  return { mime: "image/png", bytes: card(m.title, m.description, renderer) };
}
function validate(body, row) {
  const next = { ...row };
  for (const [key, col] of [
    ["enabled", "share_enabled"],
    ["indexable", "search_indexable"],
  ]) {
    if (typeof body[key] !== "boolean")
      throw Error("分享增强和搜索收录必须为布尔值。");
    next[col] = Number(body[key]);
  }
  for (const [key, col, max] of [
    ["title", "share_title", 100],
    ["description", "share_description", 600],
  ]) {
    if (typeof body[key] !== "string" || body[key].length > max)
      throw Error(`分享${key === "title" ? "标题" : "简介"}过长或格式不正确。`);
    next[col] = body[key].trim();
  }
  if (body.image !== undefined) {
    if (body.image === null) {
      next.share_image = null;
      next.share_image_mime = null;
    } else {
      if (
        typeof body.image !== "string" ||
        body.image.length > 2800000 ||
        !/^[a-zA-Z0-9+/]*={0,2}$/.test(body.image)
      )
        throw Error("封面需为 2 MB 内的 PNG、JPEG 或 WebP。");
      const bytes = Buffer.from(body.image, "base64");
      const mime = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? "image/jpeg"
          : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP"
            ? "image/webp"
            : null;
      if (!mime || bytes.length > 2 * 1024 * 1024)
        throw Error("封面需为 2 MB 内的 PNG、JPEG 或 WebP。");
      next.share_image = bytes.toString("base64");
      next.share_image_mime = mime;
    }
  }
  return next;
}
function installSharing({
  app,
  db,
  guard,
  owns,
  find,
  baseUrl,
  content,
  authenticated,
  renderSvg: renderer = renderSvg,
}) {
  const result = (row) => {
    const m = effective(row, baseUrl);
    let previewImage = m.image;
    if (!m.locked.image) {
      const img = image(row, baseUrl, renderer);
      previewImage = `data:${img.mime};base64,${img.bytes.toString("base64")}`;
    }
    return {
      revision: row.revision,
      shareRevision: row.share_revision,
      enabled: Boolean(row.share_enabled),
      indexable: Boolean(row.search_indexable),
      title: row.share_title,
      description: row.share_description,
      hasImage: Boolean(row.share_image),
      preview: {
        title: m.title,
        description: m.description,
        image: previewImage,
        locked: m.locked,
        noindex: Boolean(m.source.tags.noindex),
      },
    };
  };
  const owned = async (req, res, next) => {
    const row = await find(req.params.slug);
    if (!row || !owns(req, row))
      return res.status(404).json({ error: "作品不存在。" });
    res.locals.sharingRow = row;
    res.set("Cache-Control", "no-store");
    next();
  };
  app.get("/api/v1/works/:slug/sharing", guard, owned, async (req, res) =>
    res.json(result(res.locals.sharingRow)),
  );
  app.post("/api/v1/works/:slug/sharing-preview", owned, async (req, res) => {
    try {
      res.json(result(validate(req.body, res.locals.sharingRow)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  app.patch("/api/v1/works/:slug/sharing", owned, async (req, res) => {
    const row = res.locals.sharingRow;
    if (
      req.body.revision !== row.revision ||
      req.body.shareRevision !== row.share_revision
    )
      return res
        .status(409)
        .json({ error: "内容或分享设置已更新，请重新打开管理后再保存。" });
    let next;
    try {
      next = validate(req.body, row);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const imageRef = next.share_image
      ? await content.objects.put(Buffer.from(next.share_image, "base64"))
      : null;

    const saved = await db.transaction(async () => {
      if (!(await authenticated(req))) return null;
      return await db
        .prepare(
          "UPDATE works SET share_enabled=?,search_indexable=?,share_title=?,share_description=?,share_image=NULL,share_image_ref=?,share_image_mime=?,share_revision=share_revision+1 WHERE slug=? AND revision=? AND share_revision=?",
        )
        .run(
          next.share_enabled,
          next.search_indexable,
          next.share_title,
          next.share_description,
          imageRef,
          next.share_image_mime,
          row.slug,
          row.revision,
          row.share_revision,
        );
    });
    if (!saved) return res.status(401).json({ error: "当前连接已失效。" });
    if (!saved.changes)
      return res
        .status(409)
        .json({ error: "内容或分享设置已更新，请重新打开管理后再保存。" });
    res.json(result(await find(row.slug)));
  });
  app.get("/social/quickshare.png", async (req, res) =>
    res
      .type("png")
      .set("Cache-Control", "public, max-age=3600")
      .send(
        card(
          "QiaoPage · 做好了，就分享。",
          "把 AI 做好的作品，变成一个随时能打开的链接。",
          renderer,
        ),
      ),
  );
  app.get("/social/:slug", async (req, res) => {
    const row = await find(req.params.slug);
    if (!row || !row.published || !row.share_enabled)
      return res.status(404).end();
    if (!indexable(row)) res.set("X-Robots-Tag", "noindex");
    const img = image(row, baseUrl, renderer);
    res
      .type(img.mime)
      .set({
        "Cache-Control": "public, max-age=0, must-revalidate",
        ETag: `"${createHash("sha256")
          .update(img.bytes)
          .update(String(row.share_revision) + ":" + row.revision)
          .digest("hex")}"`,
      })
      .send(img.bytes);
  });
}
module.exports = {
  escape,
  safeUrl,
  metadata,
  effective,
  enhance,
  indexable,
  card,
  installSharing,
};
