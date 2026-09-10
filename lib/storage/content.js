"use strict";
const { validPath } = require("../files");
const fields = [
  "html",
  "files",
  "title",
  "description",
  "tags",
  "theme",
  "cover",
  "cover_mime",
  "file_count",
  "byte_size",
  "content_ref",
  "content_bytes",
];
const snapshot = (row) =>
  JSON.stringify(Object.fromEntries(fields.map((key) => [key, row[key]])));
class ContentStore {
  constructor(objects) {
    this.objects = objects;
  }
  async pack(row) {
    const html = await this.objects.put(Buffer.from(row.html));
    const sourceFiles = JSON.parse(row.files || "[]");
    for (const file of sourceFiles)
      if (!validPath(file.path)) throw new Error("Invalid stored file path");
    const files = [];
    for (let offset = 0; offset < sourceFiles.length; offset += 4) {
      const batch = await Promise.allSettled(
        sourceFiles.slice(offset, offset + 4).map(async (file) => ({
          path: file.path,
          ref: await this.objects.put(Buffer.from(file.data, "base64")),
        })),
      );
      const failure = batch.find((item) => item.status === "rejected");
      if (failure) throw failure.reason;
      files.push(...batch.map((item) => item.value));
    }
    const cover = row.cover
      ? await this.objects.put(Buffer.from(row.cover, "base64"))
      : null;
    const content_ref = await this.objects.put(
      Buffer.from(JSON.stringify({ version: 1, html, files, cover })),
    );
    const content_bytes = Buffer.byteLength(
      snapshot({ ...row, content_ref: undefined, content_bytes: undefined }),
    );
    return {
      ...row,
      html: "",
      files: "[]",
      cover: null,
      content_ref,
      content_bytes,
    };
  }
  async manifest(row) {
    const manifest = JSON.parse(await this.objects.get(row.content_ref));
    if (manifest.version !== 1 || !Array.isArray(manifest.files))
      throw new Error("Unsupported content manifest");
    return manifest;
  }
  async unpack(row, { files = true, images = true } = {}) {
    if (!row) return row;
    const result = { ...row };
    if (row.content_ref) {
      const manifest = await this.manifest(row);
      result.html = (await this.objects.get(manifest.html)).toString("utf8");
      result.cover =
        images && manifest.cover
          ? (await this.objects.get(manifest.cover)).toString("base64")
          : null;
      result.files = files
        ? JSON.stringify(
            await Promise.all(
              manifest.files.map(async (file) => ({
                path: file.path,
                data: (await this.objects.get(file.ref)).toString("base64"),
              })),
            ),
          )
        : "[]";
    }
    if (images && row.share_image_ref)
      result.share_image = (
        await this.objects.get(row.share_image_ref)
      ).toString("base64");
    return result;
  }
  async file(row, name) {
    if (row.content_ref) {
      const manifest = await this.manifest(row),
        file = manifest.files.find((file) => file.path === name);
      const ref = file?.ref || (name === "index.html" ? manifest.html : null);
      return ref ? this.objects.get(ref) : null;
    }
    const file = JSON.parse(row.files || "[]").find(
      (file) => file.path === name,
    );
    return file
      ? Buffer.from(file.data, "base64")
      : name === "index.html"
        ? Buffer.from(row.html)
        : null;
  }
}
module.exports = { ContentStore, snapshot };
