"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
class Database {
  constructor({ raw, client }) {
    this.raw = raw;
    this.client = client;
    this.context = new AsyncLocalStorage();
    this.queue = Promise.resolve();
  }
  async exclusive(fn) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => (release = resolve));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
  async access(fn) {
    const current = this.context.getStore();
    if (current?.active) return fn(current.client);
    return this.raw ? this.exclusive(() => fn(this.raw)) : fn(this.client);
  }
  prepare(sql) {
    const query = async (args, kind) =>
      this.access(async (client) => {
        if (this.raw) return client.prepare(sql)[kind](...args);
        const result = await client.execute({ sql, args });
        if (kind === "run")
          return {
            changes: result.rowsAffected,
            lastInsertRowid: Number(result.lastInsertRowid || 0),
          };
        const rows = result.rows.map((row) =>
          Object.fromEntries(
            result.columns.map((column) => [column, row[column]]),
          ),
        );
        return kind === "get" ? rows[0] : rows;
      });
    return {
      get: (...args) => query(args, "get"),
      all: (...args) => query(args, "all"),
      run: (...args) => query(args, "run"),
    };
  }
  exec(sql) {
    return this.access((client) =>
      this.raw ? client.exec(sql) : client.executeMultiple(sql),
    );
  }
  async transaction(fn) {
    if (this.context.getStore()?.active) return fn();
    const run = async () => {
      const client = this.raw || (await this.client.transaction("write"));
      const scope = { client, active: true };
      try {
        if (this.raw) this.raw.exec("BEGIN IMMEDIATE");
        const result = await this.context.run(scope, fn);
        if (this.raw) this.raw.exec("COMMIT");
        else await client.commit();
        return result;
      } catch (error) {
        try {
          if (this.raw) {
            if (this.raw.isTransaction) this.raw.exec("ROLLBACK");
          } else await client.rollback();
        } catch {}
        throw error;
      } finally {
        scope.active = false;
        if (!this.raw) client.close();
      }
    };
    return this.raw ? this.exclusive(run) : run();
  }
  close() {
    if (this.raw) this.raw.close();
    else this.client.close();
  }
}
function connectDatabase(dbPath, env = process.env) {
  if (env.DATABASE_URL) {
    const url = new URL(env.DATABASE_URL);
    if (
      !["https:", "libsql:"].includes(url.protocol) &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("Database URL requires TLS (except loopback tests)");
    if (url.username || url.password || url.search || url.hash)
      throw new Error("Invalid database URL");
    if (
      !env.DATABASE_AUTH_TOKEN &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new Error("Remote database requires DATABASE_AUTH_TOKEN");
    const { createClient } = require("@libsql/client/web");
    return new Database({
      client: createClient({
        url: env.DATABASE_URL,
        authToken: env.DATABASE_AUTH_TOKEN,
        intMode: "number",
      }),
    });
  }
  if (dbPath !== ":memory:")
    require("node:fs").mkdirSync(require("node:path").dirname(dbPath), {
      recursive: true,
      mode: 0o700,
    });
  return new Database({
    raw: new (require("node:sqlite").DatabaseSync)(dbPath, { timeout: 5000 }),
  });
}
module.exports = { Database, connectDatabase };
async function ensureColumns(db, table, definitions) {
  const columns = new Set(
    (await db.prepare(`PRAGMA table_info(${table})`).all()).map(
      (column) => column.name,
    ),
  );
  const changes = Object.entries(definitions)
    .filter(([name]) => !columns.has(name))
    .map(([name, type]) => `ALTER TABLE ${table} ADD COLUMN ${name} ${type};`);
  if (changes.length) await db.exec(changes.join("\n"));
}
module.exports.ensureColumns = ensureColumns;
