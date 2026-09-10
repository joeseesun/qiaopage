"use strict";
// Express 4 does not forward rejected async route promises to its error handler.
module.exports = function asyncRoutes(app) {
  const wrap = (value) =>
    Array.isArray(value)
      ? value.map(wrap)
      : typeof value === "function" && value.length < 4
        ? function (req, res, next) {
            Promise.resolve()
              .then(() => value(req, res, next))
              .catch(next);
          }
        : value;
  for (const method of [
    "use",
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "head",
  ]) {
    const original = app[method].bind(app);
    app[method] = (...args) => original(...args.map(wrap));
  }
  return app;
};
