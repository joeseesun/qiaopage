"use strict";
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { keyFor, validKey, verify } = require("./objects");
class S3Objects {
  constructor({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region = "auto",
    prefix = "quickshare/objects/",
    forcePathStyle = false,
  }) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey)
      throw new Error("S3 storage requires endpoint, bucket and credentials");
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
    )
      throw new Error("S3 endpoint requires HTTPS (except loopback tests)");
    if (url.username || url.password || url.search || url.hash)
      throw new Error("Invalid S3 endpoint");
    this.bucket = bucket;
    this.prefix = prefix;
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 3,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  async put(bytes) {
    bytes = Buffer.from(bytes);
    const key = keyFor(bytes);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + key,
        Body: bytes,
        ContentType: "application/octet-stream",
      }),
    );
    return key;
  }
  async get(key) {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.prefix + validKey(key),
      }),
    );
    const chunks = [];
    let size = 0;
    for await (const chunk of response.Body) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024)
        throw new Error("Stored object exceeds size limit");
      chunks.push(chunk);
    }
    return verify(key, Buffer.concat(chunks));
  }
  close() {
    this.client.destroy();
  }
}
module.exports = { S3Objects };
