"use strict";
const { put, get } = require("@vercel/blob");
const { keyFor, validKey, verify } = require("./objects");
class BlobObjects {
  constructor(prefix = "quickshare/objects/") {
    this.prefix = prefix;
  }
  async put(bytes) {
    bytes = Buffer.from(bytes);
    const key = keyFor(bytes);
    await put(this.prefix + key, bytes, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/octet-stream",
    });
    return key;
  }
  async get(key) {
    const result = await get(this.prefix + validKey(key), {
      access: "private",
      useCache: false,
    });
    return verify(
      key,
      result?.statusCode === 200 &&
        Buffer.from(await new Response(result.stream).arrayBuffer()),
    );
  }
}
module.exports = { BlobObjects };
