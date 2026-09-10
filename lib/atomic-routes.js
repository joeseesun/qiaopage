"use strict";
// Account mutations finish their database transaction before sending credentials or success.
module.exports = function atomicRoutes(app, db, identity) {
  return new Proxy(app, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (!["post", "patch", "delete"].includes(key))
        return typeof value === "function" ? value.bind(target) : value;
      return (...args) => {
        const handler = args.pop();
        return value.call(target, ...args, async (req, res) => {
          const json = res.json,
            status = res.statusCode,
            headers = res.getHeaders();
          let body,
            responded = false;
          res.json = function (value) {
            body = value;
            responded = true;
            return this;
          };
          try {
            await db.transaction(async () => {
              if (req.member && (await identity(req))?.id !== req.member.id)
                return res.status(401).json({ error: "当前连接已失效。" });
              await handler(req, res);
            });
          } catch (error) {
            res.statusCode = status;
            for (const key of res.getHeaderNames()) res.removeHeader(key);
            for (const [key, value] of Object.entries(headers))
              res.setHeader(key, value);
            throw error;
          } finally {
            res.json = json;
          }
          if (responded) return res.json(body);
        });
      };
    },
  });
};
