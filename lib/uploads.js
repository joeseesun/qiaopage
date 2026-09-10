"use strict";
const { randomUUID, createHash } = require("node:crypto");
const CHUNK_BYTES = 512 * 1024,
  MAX_BYTES = 16 * 1024 * 1024;
// Private staging is bounded per member and expires in an hour. The canonical
// publisher still validates ownership, content, quotas, and revision conflicts.
async function uploads(app, atomic, db, publish) {
  await db.exec(`CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY, member_id INTEGER NOT NULL, method TEXT NOT NULL, slug TEXT,
    bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads(expires);
    CREATE TABLE IF NOT EXISTS upload_chunks (
    upload_id TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY(upload_id,part));`);
  const find = (req) =>
    db
      .prepare("SELECT * FROM uploads WHERE id=? AND member_id=? AND expires>?")
      .get(req.params.id, req.member.id, Date.now());
  atomic.post("/api/v1/uploads", async (req, res) => {
    const { method, slug, bytes, sha256 } = req.body;
    if (
      !["POST", "PUT"].includes(method) ||
      (method === "PUT" &&
        (typeof slug !== "string" ||
          !/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug))) ||
      !Number.isInteger(bytes) ||
      bytes < 1 ||
      bytes > MAX_BYTES ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      return res.status(400).json({ error: "上传参数无效。" });
    await db
      .prepare(
        "DELETE FROM upload_chunks WHERE upload_id IN (SELECT id FROM uploads WHERE expires<=?)",
      )
      .run(Date.now());
    await db.prepare("DELETE FROM uploads WHERE expires<=?").run(Date.now());
    const count = await db
      .prepare("SELECT count(*) AS n FROM uploads WHERE member_id=?")
      .get(req.member.id);
    if (count.n >= 2)
      return res.status(429).json({ error: "请先完成或取消正在进行的上传。" });
    const id = randomUUID();
    await db
      .prepare("INSERT INTO uploads VALUES(?,?,?,?,?,?,?)")
      .run(
        id,
        req.member.id,
        method,
        method === "PUT" ? slug : null,
        bytes,
        sha256,
        Date.now() + 3600000,
      );
    res.status(201).json({ id, chunkBytes: CHUNK_BYTES });
  });
  atomic.post("/api/v1/uploads/:id/chunks/:part", async (req, res) => {
    const upload = await find(req),
      part = Number(req.params.part),
      data = req.body.data;
    if (!upload) return res.status(404).json({ error: "上传不存在或已过期。" });
    const count = Math.ceil(upload.bytes / CHUNK_BYTES);
    if (
      !Number.isInteger(part) ||
      part < 0 ||
      part >= count ||
      typeof data !== "string" ||
      data.length > Math.ceil(CHUNK_BYTES / 3) * 4
    )
      return res.status(400).json({ error: "上传分块无效。" });
    const bytes = Buffer.from(data, "base64");
    if (
      bytes.toString("base64") !== data ||
      bytes.length !== Math.min(CHUNK_BYTES, upload.bytes - part * CHUNK_BYTES)
    )
      return res.status(400).json({ error: "上传分块大小或编码无效。" });
    const old = await db
      .prepare("SELECT data FROM upload_chunks WHERE upload_id=? AND part=?")
      .get(upload.id, part);
    if (old && old.data !== data)
      return res.status(409).json({ error: "分块内容已改变，请重新上传。" });
    if (!old)
      await db
        .prepare("INSERT INTO upload_chunks VALUES(?,?,?)")
        .run(upload.id, part, data);
    res.json({ ok: true });
  });
  atomic.delete("/api/v1/uploads/:id", async (req, res) => {
    if (!(await find(req)))
      return res.status(404).json({ error: "上传不存在或已过期。" });
    await db
      .prepare("DELETE FROM upload_chunks WHERE upload_id=?")
      .run(req.params.id);
    await db.prepare("DELETE FROM uploads WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/v1/uploads/:id/complete", async (req, res) => {
    const upload = await find(req);
    if (!upload) return res.status(404).json({ error: "上传不存在或已过期。" });
    const parts = await db
      .prepare(
        "SELECT part,data FROM upload_chunks WHERE upload_id=? ORDER BY part",
      )
      .all(upload.id);
    if (parts.length !== Math.ceil(upload.bytes / CHUNK_BYTES))
      return res.status(409).json({ error: "上传尚未完成。" });
    const bytes = Buffer.concat(
      parts.map((p) => Buffer.from(p.data, "base64")),
    );
    if (
      bytes.length !== upload.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== upload.sha256
    )
      return res.status(400).json({ error: "上传校验失败。" });
    let body;
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "上传内容不是 JSON。" });
    }
    if (!body || Array.isArray(body) || typeof body !== "object")
      return res.status(400).json({ error: "上传内容无效。" });
    req.body = body;
    req.method = upload.method;
    req.params.slug = upload.slug;
    return publish(req, res);
  });
}
module.exports = { uploads, CHUNK_BYTES, MAX_BYTES };
