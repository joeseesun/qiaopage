"use strict";
const { createApp } = require("../server");
let runtime;
module.exports = async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL && process.env.TURSO_DATABASE_URL) process.env.DATABASE_URL = process.env.TURSO_DATABASE_URL;
    if (!process.env.DATABASE_AUTH_TOKEN && process.env.TURSO_AUTH_TOKEN) process.env.DATABASE_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
    process.env.OBJECT_STORE ||= "vercel-blob";
    if (!process.env.DATABASE_URL || process.env.OBJECT_STORE !== "vercel-blob")
      throw new Error(
        "Configure a persistent database and private Vercel Blob store before deploying.",
      );
    runtime ||= createApp({
      baseUrl:
        process.env.BASE_URL ||
        "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL,
      streamResponses: true,
    }).catch((error) => {
      runtime = undefined;
      throw error;
    });
    return (await runtime).app(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({ error: "服务尚未配置完成。请检查部署环境变量。" }),
    );
  }
};
