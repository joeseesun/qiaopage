"use strict";
const { ensureColumns } = require("./database");
const { snapshot } = require("./content");
// Object I/O finishes before an atomic index transaction begins.
class WorkRepository {
  constructor(db, content) {
    this.db = db;
    this.content = content;
  }
  async initialize() {
    await this.db.transaction(async () => {
      await ensureColumns(this.db, "works", {
        content_ref: "TEXT",
        content_bytes: "INTEGER",
        share_image_ref: "TEXT",
      });
      await ensureColumns(this.db, "versions", { byte_size: "INTEGER" });
    });
  }
  async raw(slug) {
    return await this.db.prepare("SELECT * FROM works WHERE slug=?").get(slug);
  }
  async get(slug, options) {
    return this.content.unpack(await this.raw(slug), options);
  }
  async used(owner) {
    return (
      await this.db
        .prepare(
          "SELECT COALESCE(sum(COALESCE(v.byte_size,length(v.snapshot))),0) AS n FROM versions v JOIN works w ON w.slug=v.slug WHERE w.owner_id=?",
        )
        .get(owner)
    ).n;
  }
  async saveVersion(row) {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO versions(slug,revision,snapshot,created_at,byte_size) VALUES(?,?,?,?,?)",
      )
      .run(
        row.slug,
        row.revision,
        snapshot(row),
        row.updated_at,
        row.content_bytes ?? Buffer.byteLength(snapshot(row)),
      );
  }
  async transaction(fn) {
    return await this.db.transaction(fn);
  }
  // Explicit, resumable migration. Old inline records remain readable until individually switched.
  async migrate() {
    let works = 0,
      versions = 0,
      images = 0;
    for (const { slug } of await this.db
      .prepare("SELECT slug FROM works")
      .all()) {
      const row = await this.raw(slug);
      if (!row.content_ref) {
        const packed = await this.content.pack(row);
        const changed = await this.db
          .prepare(
            "UPDATE works SET html='',files='[]',cover=NULL,content_ref=?,content_bytes=? WHERE slug=? AND revision=? AND content_ref IS NULL",
          )
          .run(packed.content_ref, packed.content_bytes, slug, row.revision);
        works += changed.changes;
      }
      if (row.share_image && !row.share_image_ref) {
        const ref = await this.content.objects.put(
          Buffer.from(row.share_image, "base64"),
        );
        images += (
          await this.db
            .prepare(
              "UPDATE works SET share_image=NULL,share_image_ref=? WHERE slug=? AND share_revision=? AND share_image_ref IS NULL",
            )
            .run(ref, slug, row.share_revision)
        ).changes;
      }
    }
    for (const entry of await this.db
      .prepare("SELECT slug,revision FROM versions")
      .all()) {
      const row = await this.db
        .prepare("SELECT snapshot FROM versions WHERE slug=? AND revision=?")
        .get(entry.slug, entry.revision);
      const data = JSON.parse(row.snapshot);
      if (data.content_ref) continue;
      const packed = await this.content.pack(data);
      versions += (
        await this.db
          .prepare(
            "UPDATE versions SET snapshot=?,byte_size=? WHERE slug=? AND revision=? AND snapshot=?",
          )
          .run(
            snapshot(packed),
            Buffer.byteLength(row.snapshot),
            entry.slug,
            entry.revision,
            row.snapshot,
          )
      ).changes;
    }
    return { works, versions, images };
  }
}
module.exports = { WorkRepository };
