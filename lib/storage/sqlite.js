"use strict";
const { connectDatabase, ensureColumns } = require("./database");
async function openDatabase(dbPath, provided, env = process.env) {
  const db = provided || connectDatabase(dbPath, env);
  try {
    if (db.raw)
      db.raw.exec(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000",
      );
    await db.transaction(async () => {
      await db.exec(`
    CREATE TABLE IF NOT EXISTS works (
      slug TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', theme TEXT NOT NULL DEFAULT 'sage', html TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cover TEXT, cover_mime TEXT
    );`);
      await ensureColumns(db, "works", {
        share_enabled: "INTEGER NOT NULL DEFAULT 0",
        search_indexable: "INTEGER NOT NULL DEFAULT 0",
        share_title: "TEXT NOT NULL DEFAULT ''",
        share_description: "TEXT NOT NULL DEFAULT ''",
        share_image: "TEXT",
        share_image_mime: "TEXT",
        share_revision: "INTEGER NOT NULL DEFAULT 0",
        owner_id: "INTEGER NOT NULL DEFAULT 1",
        listed: "INTEGER NOT NULL DEFAULT 1",
        files: "TEXT NOT NULL DEFAULT '[]'",
        file_count: "INTEGER NOT NULL DEFAULT 1",
        byte_size: "INTEGER NOT NULL DEFAULT 0",
      });
      await db.exec(
        "CREATE TABLE IF NOT EXISTS versions(slug TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(slug,revision))",
      );
      await db.exec(`CREATE TABLE IF NOT EXISTS publish_requests (
    member_id INTEGER NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
    slug TEXT NOT NULL REFERENCES works(slug), PRIMARY KEY(member_id,request_id)
  )`);
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
module.exports = { openDatabase };
