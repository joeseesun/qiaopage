import { DurableObject } from "cloudflare:workers";
import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { httpServerHandler } from "cloudflare:node";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import server from "../server.js";
import database from "./database.cjs";
import storage from "../lib/storage/objects.js";
import { render, portalVersion } from "../.cloudflare-build/templates.mjs";
let wasmReady;
export class Quickshare extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
  }
  async initialize(origin) {
    wasmReady ||= initWasm(wasm);
    await wasmReady;
    const fonts = await Promise.all(
      [400, 600].map(async (weight) => {
        const response = await this.env.ASSETS.fetch(
          new Request(`https://assets.internal/fonts/NotoSansSC-${weight}.ttf`),
        );
        if (!response.ok) throw new Error("Font resource missing");
        return new Uint8Array(await response.arrayBuffer());
      }),
    );
    const renderSvg = (svg) => {
      const renderer = new Resvg(svg, {
        font: { fontBuffers: fonts, defaultFontFamily: "Noto Sans SC" },
      });
      let image;
      try {
        image = renderer.render();
        return Buffer.from(image.asPng());
      } finally {
        image?.free();
        renderer.free();
      }
    };
    const runtime = await server.createApp({
      token: this.env.QUICKSHARE_TOKEN,
      baseUrl: this.env.BASE_URL || origin,
      database: new database.DurableDatabase(this.ctx.storage),
      objects: new storage.R2Objects(this.env.OBJECTS),
      render,
      portalVersion,
      renderSvg,
    });
    const http = createServer(runtime.app);
    http.listen(0);
    this.handler = httpServerHandler(http);
  }
  async fetch(request) {
    if (new URL(request.url).pathname.startsWith("/__ops/recovery")) {
      const secret = this.env.QUICKSHARE_RECOVERY_TOKEN;
      const supplied = request.headers.get("Authorization") || "";
      if (
        !secret ||
        secret.length < 32 ||
        !timingSafeEqual(
          createHash("sha256").update(supplied).digest(),
          createHash("sha256")
            .update("Bearer " + secret)
            .digest(),
        )
      )
        return new Response("Not found", { status: 404 });
      const route = new URL(request.url).pathname;
      const json = (value) =>
        Response.json(value, {
          headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
        });
      if (route === "/__ops/recovery" && request.method === "GET")
        return json({ bookmark: await this.ctx.storage.getCurrentBookmark() });
      if (route === "/__ops/recovery" && request.method === "POST") {
        if (Number(request.headers.get("Content-Length")) > 1024)
          return new Response("Too large", { status: 413 });
        const text = await request.text();
        if (text.length > 1024)
          return new Response("Too large", { status: 413 });
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          return new Response("Invalid request", { status: 400 });
        }
        if (
          typeof body.bookmark !== "string" ||
          !/^[a-z0-9-]{20,100}$/.test(body.bookmark)
        )
          return new Response("Invalid bookmark", { status: 400 });
        return json({
          undo: await this.ctx.storage.onNextSessionRestoreBookmark(
            body.bookmark,
          ),
        });
      }
      if (route === "/__ops/recovery/restart" && request.method === "POST")
        this.ctx.abort("Operator requested recovery restart");
      return new Response("Not found", { status: 404 });
    }
    this.ready ||= this.ctx.blockConcurrencyWhile(() =>
      this.initialize(new URL(request.url).origin),
    );
    await this.ready;
    return this.handler.fetch(request);
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/fonts/") ||
      url.pathname === "/client/quickshare.js"
    )
      return env.ASSETS.fetch(request);
    return env.APP.getByName("primary").fetch(request);
  },
};
