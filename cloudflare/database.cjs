"use strict";
const { AsyncLocalStorage } = require("node:async_hooks");
class DurableDatabase {
  constructor(storage) {
    this.storage = storage;
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
  access(fn) {
    return this.context.getStore()?.active ? fn() : this.exclusive(fn);
  }
  prepare(sql) {
    const query = (args, kind) =>
      this.access(() => {
        const rows = this.storage.sql.exec(sql, ...args).toArray();
        if (kind === "run")
          return this.storage.sql
            .exec(
              "SELECT changes() AS changes,last_insert_rowid() AS lastInsertRowid",
            )
            .one();
        return kind === "get" ? rows[0] : rows;
      });
    return {
      get: (...args) => query(args, "get"),
      all: (...args) => query(args, "all"),
      run: (...args) => query(args, "run"),
    };
  }
  exec(sql) {
    return this.access(() => {
      this.storage.sql.exec(sql).toArray();
    });
  }
  transaction(fn) {
    if (this.context.getStore()?.active) return fn();
    return this.exclusive(() =>
      this.storage.transaction(async () => {
        const scope = { active: true };
        try {
          return await this.context.run(scope, fn);
        } finally {
          scope.active = false;
        }
      }),
    );
  }
  close() {}
}
module.exports = { DurableDatabase };
