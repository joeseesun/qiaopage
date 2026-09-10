"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");
const { FileObjects } = require("./objects");
async function exportBackup(repository, destination) {
  await fs.mkdir(destination, { mode: 0o700 }); // Never overwrite a previous recovery point.
  const databasePath = path.join(destination, "quickshare.sqlite");
  if (repository.db.raw) await backup(repository.db.raw, databasePath);
  else {
    const tables = await repository.db.transaction(async () => {
      const schema = await repository.db
        .prepare(
          "SELECT name,sql,type FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC,name",
        )
        .all();
      const result = [];
      for (const entry of schema) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry.name))
          throw new Error("Unsupported database identifier");
        result.push({
          ...entry,
          rows:
            entry.type === "table"
              ? await repository.db
                  .prepare(`SELECT * FROM "${entry.name}"`)
                  .all()
              : [],
        });
      }
      return result;
    });
    const copy = new DatabaseSync(databasePath);
    try {
      copy.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
      for (const table of tables.filter((table) => table.type === "table")) {
        copy.exec(table.sql);
        for (const row of table.rows) {
          const columns = Object.keys(row);
          copy
            .prepare(
              `INSERT INTO "${table.name}" (${columns.map((column) => '"' + column.replaceAll('"', '""') + '"').join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
            )
            .run(...Object.values(row));
        }
      }
      for (const entry of tables.filter((table) => table.type !== "table"))
        copy.exec(entry.sql);
      if (copy.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Backup foreign key check failed");
      copy.exec("COMMIT");
    } finally {
      copy.close();
    }
  }
  await fs.chmod(databasePath, 0o600);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const objects = new FileObjects(path.join(destination, "objects"));
  await fs.mkdir(objects.directory, { mode: 0o700 });
  const copied = new Set(),
    traversed = new Set();
  async function copy(key) {
    if (copied.has(key)) return;
    const bytes = await repository.content.objects.get(key);
    if ((await objects.put(bytes)) !== key)
      throw new Error("Backup object integrity check failed");
    copied.add(key);
    return bytes;
  }
  async function manifest(key) {
    if (!key || traversed.has(key)) return;
    const data = JSON.parse((await copy(key)) || (await objects.get(key)));
    traversed.add(key);
    if (data.version !== 1) throw new Error("Unsupported backup manifest");
    await copy(data.html);
    if (data.cover) await copy(data.cover);
    for (const file of data.files) await copy(file.ref);
  }
  try {
    for (const row of db
      .prepare("SELECT content_ref,share_image_ref FROM works")
      .all()) {
      await manifest(row.content_ref);
      if (row.share_image_ref) await copy(row.share_image_ref);
    }
    for (const row of db.prepare("SELECT snapshot FROM versions").all())
      await manifest(JSON.parse(row.snapshot).content_ref);
    const result = {
      format: 1,
      createdAt: new Date().toISOString(),
      objects: copied.size,
    };
    await fs.writeFile(
      path.join(destination, "backup.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    return result;
  } finally {
    db.close();
  }
}
module.exports = { exportBackup };
