"use strict";
const path = require("node:path");
const { FileObjects, MemoryObjects } = require("./objects");
function objectStorage(dbPath, env = process.env) {
  if (env.DATABASE_URL && !env.OBJECT_STORE)
    throw new Error("Set OBJECT_STORE explicitly with a remote database");
  const backend = env.OBJECT_STORE || "filesystem";
  if (backend === "s3") {
    const { S3Objects } = require("./s3");
    return new S3Objects({
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      region: env.S3_REGION || "auto",
      prefix: env.S3_PREFIX || "quickshare/objects/",
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    });
  }
  if (backend !== "filesystem")
    throw new Error("Unsupported OBJECT_STORE; choose filesystem or s3");
  if (dbPath === ":memory:") {
    if (env.NODE_ENV === "production")
      throw new Error("Production requires a persistent database");
    return new MemoryObjects();
  }
  return new FileObjects(
    env.OBJECTS_PATH || path.join(path.dirname(dbPath), "objects"),
  );
}
module.exports = { objectStorage };
