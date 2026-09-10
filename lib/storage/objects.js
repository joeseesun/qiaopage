"use strict";
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const keyFor = (bytes) => createHash("sha256").update(bytes).digest("hex");
function validKey(key) {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("Invalid object key");
  return key;
}
function verify(key, bytes) {
  if (!bytes || keyFor(bytes) !== validKey(key))
    throw new Error("Stored object is missing or corrupt");
  return bytes;
}
class FileObjects {
  constructor(directory) {
    this.directory = path.resolve(directory);
  }
  filename(key) {
    return path.join(this.directory, validKey(key).slice(0, 2), key);
  }
  async put(bytes) {
    bytes = Buffer.from(bytes);
    const key = keyFor(bytes),
      filename = this.filename(key);
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = filename + "." + randomBytes(12).toString("hex") + ".tmp";
    try {
      const file = await fs.open(temporary, "wx", 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await fs.link(temporary, filename);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      await this.get(key);
      const directory = await fs.open(path.dirname(filename), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return key;
  }
  async get(key) {
    return verify(key, await fs.readFile(this.filename(key)));
  }
}
class MemoryObjects {
  constructor() {
    this.objects = new Map();
  }
  async put(bytes) {
    const key = keyFor(bytes);
    this.objects.set(key, Buffer.from(bytes));
    return key;
  }
  async get(key) {
    return Buffer.from(verify(key, this.objects.get(validKey(key))));
  }
}
class R2Objects {
  constructor(bucket, prefix = "quickshare/objects/") {
    this.bucket = bucket;
    this.prefix = prefix;
  }
  async put(bytes) {
    bytes = Buffer.from(bytes);
    const key = keyFor(bytes);
    await this.bucket.put(this.prefix + key, bytes, {
      sha256: key,
      httpMetadata: { contentType: "application/octet-stream" },
    });
    return key;
  }
  async get(key) {
    const value = await this.bucket.get(this.prefix + validKey(key));
    return verify(key, value && Buffer.from(await value.arrayBuffer()));
  }
}
module.exports = {
  FileObjects,
  MemoryObjects,
  R2Objects,
  keyFor,
  validKey,
  verify,
};
