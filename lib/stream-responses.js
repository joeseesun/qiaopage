"use strict";
const { Readable } = require("node:stream");
// Vercel limits buffered responses. Preserve bytes and security headers while streaming.
module.exports = function streamResponses(req, res, next) {
  const send = res.send;
  res.send = function (body) {
    const bytes = Buffer.isBuffer(body)
      ? body
      : typeof body === "string"
        ? Buffer.from(body)
        : null;
    if (
      !bytes ||
      bytes.length < 3 * 1024 * 1024 ||
      [204, 304].includes(this.statusCode)
    )
      return send.call(this, body);
    if (!this.getHeader("Content-Type"))
      this.type(
        Buffer.isBuffer(body) ? "application/octet-stream" : "text/html",
      );
    this.removeHeader("Content-Length");
    if (req.method === "HEAD") {
      this.end();
      return this;
    }
    Readable.from(
      (function* () {
        for (let offset = 0; offset < bytes.length; offset += 65536)
          yield bytes.subarray(offset, offset + 65536);
      })(),
    ).pipe(this);
    return this;
  };
  next();
};
