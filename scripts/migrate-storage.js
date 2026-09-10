"use strict";
require("dotenv").config({ quiet: true });
if (!process.env.DATABASE_URL && process.env.TURSO_DATABASE_URL) process.env.DATABASE_URL = process.env.TURSO_DATABASE_URL;
if (!process.env.DATABASE_AUTH_TOKEN && process.env.TURSO_AUTH_TOKEN) process.env.DATABASE_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
const path = require("node:path");
const { parseArgs } = require("node:util");
const { randomBytes } = require("node:crypto");
const { createApp } = require("../server");
const { exportBackup } = require("../lib/storage/maintenance");
async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean" },
      backup: { type: "string" },
      "backup-only": { type: "boolean" },
    },
  });
  if (!process.env.DATABASE_URL) {
    if (
      !process.env.DB_PATH ||
      process.env.DB_PATH === ":memory:" ||
      !require("node:fs").statSync(process.env.DB_PATH).isFile()
    )
      throw new Error(
        "Set DB_PATH to an existing SQLite database or DATABASE_URL",
      );
  }
  if (
    process.env.DATABASE_URL &&
    (values.apply || values["backup-only"]) &&
    !values.backup
  )
    throw new Error("Remote database backup requires --backup PATH");
  // createApp performs only additive schema setup; this command never opens an HTTP listener.
  const runtime = await createApp();
  try {
    const pending = {
      works: (
        await runtime.db
          .prepare("SELECT count(*) n FROM works WHERE content_ref IS NULL")
          .get()
      ).n,
      versions: (
        await runtime.db
          .prepare(
            "SELECT count(*) n FROM versions WHERE json_extract(snapshot,'$.content_ref') IS NULL",
          )
          .get()
      ).n,
      images: (
        await runtime.db
          .prepare(
            "SELECT count(*) n FROM works WHERE share_image IS NOT NULL AND share_image_ref IS NULL",
          )
          .get()
      ).n,
    };
    if (!values.apply && !values["backup-only"])
      return console.log(JSON.stringify({ mode: "plan", pending }));
    const destination = path.resolve(
      values.backup ||
        path.join(
          path.dirname(process.env.DB_PATH),
          "backups",
          `storage-${Date.now()}-${randomBytes(4).toString("hex")}`,
        ),
    );
    await require("node:fs/promises").mkdir(path.dirname(destination), {
      recursive: true,
      mode: 0o700,
    });
    const backup = await exportBackup(runtime.repository, destination);
    const migrated = values["backup-only"]
      ? undefined
      : await runtime.repository.migrate();
    console.log(
      JSON.stringify({
        mode: values["backup-only"] ? "backup" : "migrate",
        backup: destination,
        objects: backup.objects,
        migrated,
      }),
    );
  } finally {
    runtime.db.close();
    runtime.objects.close?.();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
