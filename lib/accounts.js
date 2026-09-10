"use strict";
const {
  createHash,
  randomBytes,
  timingSafeEqual,
  scrypt,
} = require("node:crypto");
const { installPrompt } = require("./agent");
const { promisify } = require("node:util");
const derive = promisify(scrypt);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("hex");
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
function accounts(app, db, token, baseUrl) {
  db.exec(`CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT, api_hash TEXT, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    INSERT OR IGNORE INTO members(id,username,created_at) VALUES(1,'owner',datetime('now'));
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY, label TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS grants(hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS api_keys(hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_grants(hash TEXT PRIMARY KEY, member_id INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  // Additive migrations preserve existing members, invitation hashes and credentials.
  const addColumn = (table, name, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === name))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  };
  addColumn("members", "account_revision", "INTEGER NOT NULL DEFAULT 0");
  addColumn("members", "note", "TEXT NOT NULL DEFAULT ''");
  addColumn("invites", "invite_id", "TEXT");
  addColumn("invites", "member_id", "INTEGER");
  addColumn("invites", "created_at", "TEXT");
  addColumn("invites", "revoked", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`UPDATE invites SET invite_id=lower(hex(randomblob(12))) WHERE invite_id IS NULL;
    UPDATE invites SET created_at=datetime(expires/1000-604800,'unixepoch') WHERE created_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS invites_stable_id ON invites(invite_id);
    CREATE UNIQUE INDEX IF NOT EXISTS invites_member ON invites(member_id) WHERE member_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS recovery_grants(hash TEXT PRIMARY KEY);`);
  app.set("trust proxy", "loopback");
  const secure = baseUrl.startsWith("https:");
  const cookieName = secure ? "__Host-quickshare" : "quickshare_session";
  const cookieValue = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || "";
  function identity(req) {
    if (req.headers.authorization) {
      const value = req.headers.authorization;
      if (
        timingSafeEqual(
          Buffer.from(hash(value)),
          Buffer.from(hash("Bearer " + token)),
        )
      ) {
        const owner = db.prepare("SELECT username,password IS NOT NULL AS registered FROM members WHERE id=1").get();
        return { id: 1, username: owner.username, admin: true, registered: !!owner.registered };
      }
      if (!value.startsWith("Bearer ")) return null;
      const member = db
        .prepare(
          "SELECT id,username,password IS NOT NULL AS registered FROM members WHERE disabled=0 AND (api_hash=? OR id IN (SELECT member_id FROM api_keys WHERE hash=?))",
        )
        .get(hash(value.slice(7)), hash(value.slice(7)));
      return member ? { ...member, registered: !!member.registered, admin: member.id === 1 } : null;
    }
    const member = db
      .prepare(
        "SELECT m.id,m.username,m.password IS NOT NULL AS registered FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.hash=? AND s.expires>? AND m.disabled=0",
      )
      .get(hash(cookieValue(req)), Date.now());
    return member ? { ...member, registered: !!member.registered, admin: member.id === 1 } : null;
  }
  function sameOrigin(req, res, next) {
    if (req.get("origin") !== new URL(baseUrl).origin)
      return res.status(403).json({ error: "请从本站页面操作。" });
    next();
  }
  function guard(req, res, next) {
    req.member = identity(req);
    if (!req.member)
      return res.status(401).json({ error: "请先登录，或配置你的 CLI 令牌。" });
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && !req.headers.authorization)
      return sameOrigin(req, res, next);
    next();
  }
  const admin = (req, res, next) =>
    req.member?.admin
      ? next()
      : res.status(403).json({ error: "只有管理员可以邀请或管理成员。" });
  function session(res, id) {
    const value = secret(),
      now = Date.now();
    db.prepare("DELETE FROM sessions WHERE expires<?").run(now);
    db.prepare(
      "DELETE FROM sessions WHERE member_id=? AND hash NOT IN (SELECT hash FROM sessions WHERE member_id=? ORDER BY expires DESC LIMIT 9)",
    ).run(id, id);
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(value),
      id,
      now + 7 * 86400000,
    );
    res.cookie(cookieName, value, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 86400000,
    });
  }
  const attempts = new Map();
  function limit(req, res, next) {
    const key = req.ip,
      now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const record = attempts.get(key) || { count: 0, until: now + 60000 };
    record.count++;
    attempts.set(key, record);
    if (record.count > 15 || attempts.size > 10000)
      return res.status(429).json({ error: "操作太频繁，请一分钟后再试。" });
    next();
  }
  async function passwordHash(password) {
    const salt = secret();
    return salt + ":" + (await derive(password, salt, 64)).toString("hex");
  }
  const validPassword = (value) =>
    typeof value === "string" && value.length >= 12 && value.length <= 200;
  app.use(
    "/auth",
    (req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    require("express").json({ limit: "8kb" }),
  );
  app.post(
    "/auth/login",
    sameOrigin,
    limit,
    wrap(async (req, res) => {
      const { username, password } = req.body;
      if (typeof username !== "string" || !validPassword(password))
        return res.status(401).json({ error: "用户名或密码不正确。" });
      const member = db
        .prepare("SELECT * FROM members WHERE username=? AND disabled=0")
        .get(username.toLowerCase());
      const [salt, digest] = (
        member?.password || "invalid:" + hash("invalid").repeat(2)
      ).split(":");
      const computed = await derive(password, salt, 64);
      if (
        !member?.password ||
        !timingSafeEqual(computed, Buffer.from(digest, "hex"))
      )
        return res.status(401).json({ error: "用户名或密码不正确。" });
      session(res, member.id);
      res.json({ ok: true });
    }),
  );
  const inviteHash = (value) => hash(typeof value === "string" ? value.trim().replace(/[\s-]/g, "").toLowerCase() : "");
  const usableInvite = (value) => db.prepare("SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?").get(inviteHash(value), Date.now());
  const validApiToken = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  function addKey(memberId, apiToken) {
    if (db.prepare("SELECT count(*) AS n FROM api_keys WHERE member_id=?").get(memberId).n >= 10)
      throw Object.assign(new Error("已连接的 Agent 达到上限，请在账号设置重新生成令牌后重试。"), {status: 409});
    db.prepare("INSERT INTO api_keys VALUES(?,?,?)").run(hash(apiToken), memberId, Date.now());
  }
  app.post("/auth/accept", sameOrigin, limit, (req, res) => {
    const {invite, apiToken} = req.body;
    if (typeof invite !== "string" || (apiToken !== undefined && !validApiToken(apiToken)))
      return res.status(400).json({error: "邀请码或连接参数无效。"});
    const existing = identity(req);
    // A retry after a lost response proves possession of the previously activated private key.
    if (existing && apiToken && req.headers.authorization === "Bearer " + apiToken)
      return res.json({ok: true, member: existing});
    if (existing) return res.status(409).json({error: "你已连接发布空间，无需再次使用邀请。"});
    const invitation = usableInvite(invite);
    if (!invitation) return res.status(410).json({error: "邀请已使用、撤销或过期，请联系邀请人。"});
    if (db.prepare("SELECT count(*) AS n FROM members").get().n >= 30)
      return res.status(409).json({error: "成员人数已达上限。"});
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare("INSERT INTO members(username,created_at) VALUES(?,?)").run("friend-" + randomBytes(6).toString("hex"), new Date().toISOString());
      const id = Number(result.lastInsertRowid);
      if (apiToken) addKey(id, apiToken);
      db.prepare("UPDATE members SET note=? WHERE id=?").run(invitation.label, id);
      db.prepare("UPDATE invites SET used=1,member_id=? WHERE hash=?").run(id, inviteHash(invite));
      db.exec("COMMIT");
      if (!apiToken) session(res, id);
      res.status(201).json({ok: true});
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.status === 409) return res.status(409).json({error: error.message});
      throw error;
    }
  });
  app.post("/auth/connect", sameOrigin, limit, (req, res) => {
    const {code, apiToken} = req.body;
    if (typeof code !== "string" || !validApiToken(apiToken))
      return res.status(400).json({error: "连接码或连接参数无效。"});
    const existing = identity(req);
    if (existing && req.headers.authorization === "Bearer " + apiToken)
      return res.json({ok: true, member: existing});
    const grant = db.prepare("SELECT g.*,EXISTS(SELECT 1 FROM recovery_grants r WHERE r.hash=g.hash) AS recovery FROM agent_grants g JOIN members m ON m.id=g.member_id WHERE g.hash=? AND g.expires>? AND m.disabled=0").get(hash(code.trim()), Date.now());
    if (!grant) return res.status(410).json({error: "连接码已失效，请重新复制安装 Prompt。"});
    db.exec("BEGIN IMMEDIATE");
    try {
      if (grant.recovery) {
        db.prepare("DELETE FROM api_keys WHERE member_id=?").run(grant.member_id);
        db.prepare("UPDATE members SET api_hash=NULL WHERE id=?").run(grant.member_id);
        db.prepare("DELETE FROM sessions WHERE member_id=?").run(grant.member_id);
        db.prepare("DELETE FROM grants WHERE member_id=?").run(grant.member_id);
        db.prepare("DELETE FROM recovery_grants WHERE hash IN (SELECT hash FROM agent_grants WHERE member_id=?)").run(grant.member_id);
        db.prepare("DELETE FROM agent_grants WHERE member_id=?").run(grant.member_id);
      }
      addKey(grant.member_id, apiToken);
      db.prepare("DELETE FROM agent_grants WHERE hash=?").run(hash(code.trim()));
      db.exec("COMMIT");
      res.json({ok: true});
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.status === 409) return res.status(409).json({error: error.message});
      throw error;
    }
  });
  app.post(
    "/auth/join",
    sameOrigin,
    limit,
    wrap(async (req, res) => {
      const { invite, username, password } = req.body;
      if (
        typeof invite !== "string" ||
        typeof username !== "string" ||
        !/^[a-z][a-z0-9_-]{2,29}$/.test(username) ||
        !validPassword(password)
      )
        return res
          .status(400)
          .json({
            error: "用户名需为 3–30 位小写字母、数字、下划线；密码至少 12 位。",
          });
      const usable = () =>
        db
          .prepare(
            "SELECT * FROM invites WHERE hash=? AND used=0 AND expires>?",
          )
          .get(inviteHash(invite), Date.now());
      if (!usable())
        return res
          .status(410)
          .json({ error: "邀请已使用、撤销或过期，请联系邀请人。" });
      const encoded = await passwordHash(password);
      // Recheck after asynchronous password derivation; consuming the invite and creating a member is atomic.
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!usable()) {
          db.exec("ROLLBACK");
          return res.status(410).json({ error: "邀请已使用或过期。" });
        }
        if (db.prepare("SELECT count(*) AS n FROM members").get().n >= 30) {
          db.exec("ROLLBACK");
          return res.status(409).json({ error: "成员人数已达上限。" });
        }
        if (
          db.prepare("SELECT id FROM members WHERE username=?").get(username)
        ) {
          db.exec("ROLLBACK");
          return res
            .status(409)
            .json({ error: "这个用户名已被使用，请换一个。" });
        }
        const member = db
          .prepare(
            "INSERT INTO members(username,password,created_at) VALUES(?,?,?)",
          )
          .run(username, encoded, new Date().toISOString());
        const id = Number(member.lastInsertRowid);
        db.prepare("UPDATE members SET note=? WHERE id=?").run(usable().label, id);
        db.prepare("UPDATE invites SET used=1,member_id=? WHERE hash=?").run(id, inviteHash(invite));
        db.exec("COMMIT");
        session(res, Number(member.lastInsertRowid));
        res.status(201).json({ ok: true });
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }),
  );
  app.post("/auth/grant", sameOrigin, limit, (req, res) => {
    if (typeof req.body.code !== "string")
      return res.status(400).json({ error: "登录链接无效。" });
    const grant = db
      .prepare(
        "SELECT g.* FROM grants g JOIN members m ON g.member_id=m.id WHERE g.hash=? AND g.expires>? AND m.disabled=0",
      )
      .get(hash(req.body.code), Date.now());
    if (!grant)
      return res
        .status(410)
        .json({ error: "登录链接已失效，请重新运行 quickshare dashboard。" });
    db.prepare("DELETE FROM grants WHERE hash=?").run(hash(req.body.code));
    session(res, grant.member_id);
    res.json({ ok: true });
  });
  app.post("/auth/logout", sameOrigin, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE hash=?").run(hash(cookieValue(req)));
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure,
      sameSite: "strict",
      path: "/",
    });
    res.json({ ok: true });
  });
  function accountInfo(req) {
    const row = db.prepare("SELECT id,username,password IS NOT NULL AS registered,account_revision AS revision,created_at FROM members WHERE id=?").get(req.member.id);
    const credential = req.headers.authorization ? req.headers.authorization.slice(7) : "";
    const connection = !credential ? "browser_session" : hash(credential) === hash(token) ? "server_admin_token"
      : db.prepare("SELECT 1 FROM api_keys WHERE hash=? AND member_id=?").get(hash(credential), row.id) ? "agent_key" : "personal_token";
    const usage = db.prepare("SELECT count(*) AS sites,COALESCE(sum(published),0) AS published,COALESCE(sum(byte_size),0) AS bytes FROM works WHERE owner_id=?").get(row.id);
    return {account: {...row, registered: !!row.registered, role: row.id === 1 ? "admin" : "member"}, connection: {kind: connection, agentKeys: db.prepare("SELECT count(*) AS n FROM api_keys WHERE member_id=?").get(row.id).n}, usage,
      limits: {sites: 100, filesPerSite: 100, uploadBytes: 8 * 1024 * 1024, fileBytes: 5 * 1024 * 1024, agentKeys: 10},
      permissions: {manageOwnAccount: true, manageOwnSites: true, manageAllSites: row.id === 1, manageFriends: row.id === 1},
      defaults: {galleryListed: false, sharingEnabled: false, searchIndexable: false, preserveSource: true}};
  }
  // Mounted after the common API parser/guard by the caller.
  function routes() {
    app.post("/api/v1/agent-grant", (req, res) => {
      const code = secret();
      db.prepare("DELETE FROM agent_grants WHERE expires<? OR member_id=?").run(Date.now(), req.member.id);
      db.prepare("INSERT INTO agent_grants VALUES(?,?,?)").run(hash(code), req.member.id, Date.now() + 15 * 60000);
      res.json({prompt: installPrompt(baseUrl, {connect: code})});
    });
    app.post("/api/v1/dashboard-link", (req, res) => {
      const code = secret();
      db.prepare("DELETE FROM grants WHERE expires<? OR member_id=?").run(
        Date.now(),
        req.member.id,
      );
      db.prepare("INSERT INTO grants VALUES(?,?,?)").run(
        hash(code),
        req.member.id,
        Date.now() + 5 * 60000,
      );
      res.json({ url: baseUrl + "/login#code=" + code });
    });
    app.post("/api/v1/key", (req, res) => {
      const value = secret();
      db.prepare("DELETE FROM api_keys WHERE member_id=?").run(req.member.id);
      db.prepare("DELETE FROM agent_grants WHERE member_id=?").run(req.member.id);
      db.prepare("UPDATE members SET api_hash=? WHERE id=?").run(
        hash(value),
        req.member.id,
      );
      res.json({ token: value });
    });
    app.get("/api/v1/account", guard, (req, res) => res.json(accountInfo(req)));
    const updateAccount = wrap(async (req, res) => {
      const legacy = req.path === "/api/v1/password";
      const body = req.body;
      if (!body || Array.isArray(body) || Object.keys(body).some(k => !["username", "password", "revision"].includes(k)))
        return res.status(400).json({error: "仅支持修改当前账号的用户名和密码。"});
      const before = db.prepare("SELECT username,password,account_revision FROM members WHERE id=? AND disabled=0").get(req.member.id);
      if (!before) return res.status(401).json({error: "当前身份已停用。"});
      const revision = legacy && body.revision === undefined ? before.account_revision : body.revision;
      if (!Number.isSafeInteger(revision) || revision < 0)
        return res.status(400).json({error: "请先读取最新账号信息。", code: "REVISION_REQUIRED"});
      if (before.account_revision !== revision)
        return res.status(409).json({error: "账号已被修改，请重新读取后再保存。", code: "ACCOUNT_CHANGED"});
      if (body.username === undefined && body.password === undefined)
        return res.status(400).json({error: "请填写要修改的用户名或密码。"});
      if (body.username !== undefined && (typeof body.username !== "string" || !/^[a-z][a-z0-9_-]{2,29}$/.test(body.username)))
        return res.status(400).json({error: "用户名需为 3–30 位小写字母、数字、下划线或连字符。"});
      if ((legacy || body.password !== undefined) && !validPassword(body.password))
        return res.status(400).json({error: "密码需为 12–200 位。"});
      const encoded = body.password === undefined ? before.password : await passwordHash(body.password);
      // Password derivation yields: re-authenticate and recheck revision inside the write transaction.
      db.exec("BEGIN IMMEDIATE");
      try {
        if (identity(req)?.id !== req.member.id) {
          db.exec("ROLLBACK"); return res.status(401).json({error: "当前连接已失效，请重新连接。"});
        }
        const username = body.username ?? before.username;
        if (db.prepare("SELECT id FROM members WHERE username=? AND id<>?").get(username, req.member.id)) {
          db.exec("ROLLBACK"); return res.status(409).json({error: "这个用户名已被使用，请换一个。", code: "USERNAME_TAKEN"});
        }
        const saved = db.prepare("UPDATE members SET username=?,password=?,account_revision=account_revision+1 WHERE id=? AND account_revision=? AND disabled=0").run(username, encoded, req.member.id, revision);
        if (!saved.changes) {
          db.exec("ROLLBACK"); return res.status(409).json({error: "账号已被修改，请重新读取后再保存。", code: "ACCOUNT_CHANGED"});
        }
        if (body.password !== undefined) {
          for (const table of ["sessions", "grants", "agent_grants"]) db.prepare(`DELETE FROM ${table} WHERE member_id=?`).run(req.member.id);
          db.exec("DELETE FROM recovery_grants WHERE hash NOT IN (SELECT hash FROM agent_grants)");
          if (!req.headers.authorization) session(res, req.member.id);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      res.json({ok: true, ...accountInfo(req), effects: {webSessionsRevoked: body.password !== undefined, agentConnectionsPreserved: true, siteLinksPreserved: true}});
    });
    app.post("/api/v1/account/verify-password", limit, wrap(async (req, res) => {
      if (!validPassword(req.body.password)) return res.status(400).json({error: "密码需为 12–200 位。"});
      const stored = db.prepare("SELECT password FROM members WHERE id=?").get(req.member.id).password;
      if (!stored) return res.json({ok:true,valid:false});
      const [salt, digest] = stored.split(":");
      const computed = await derive(req.body.password, salt, 64);
      if (identity(req)?.id !== req.member.id) return res.status(401).json({error: "当前连接已失效。"});
      const unchanged = db.prepare("SELECT password FROM members WHERE id=?").get(req.member.id)?.password === stored;
      res.json({ok:true,valid:unchanged && timingSafeEqual(computed, Buffer.from(digest,"hex"))});
    }));
    app.patch("/api/v1/account", limit, updateAccount);
    app.post("/api/v1/password", limit, updateAccount);
    app.get("/api/v1/members", guard, admin, (req, res) =>
      res.json({
        members: db
          .prepare(
            "SELECT id,username,disabled,created_at FROM members ORDER BY id",
          )
          .all(),
      }),
    );
    app.patch("/api/v1/members/:id", admin, (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 1)
        return res.status(400).json({error: "无法修改此成员。"});
      if (req.body.note !== undefined) {
        if (typeof req.body.note !== "string" || !req.body.note.trim() || req.body.note.trim().length > 60 || req.body.disabled !== undefined)
          return res.status(400).json({error: "请填写 1–60 字的朋友备注。"});
        const changed = db.prepare("UPDATE members SET note=? WHERE id=?").run(req.body.note.trim(), id);
        return changed.changes ? res.json({ok: true}) : res.status(404).json({error: "成员不存在。"});
      }
      if (typeof req.body.disabled !== "boolean")
        return res.status(400).json({error: "请选择启用或停用。"});
      const changed = db
        .prepare("UPDATE members SET disabled=? WHERE id=?")
        .run(Number(req.body.disabled), id);
      if (!changed.changes)
        return res.status(404).json({ error: "成员不存在。" });
      db.prepare("DELETE FROM sessions WHERE member_id=?").run(id);
      db.prepare("DELETE FROM grants WHERE member_id=?").run(id);
      db.prepare("DELETE FROM agent_grants WHERE member_id=?").run(id);
      db.prepare("DELETE FROM api_keys WHERE member_id=?").run(id);
      db.prepare("UPDATE members SET api_hash=NULL WHERE id=?").run(id);
      res.json({ ok: true });
    });
    app.get("/api/v1/invites", guard, admin, (req, res) =>
      res.json({
        invites: db
          .prepare(
            "SELECT hash AS id,label,expires,used FROM invites WHERE expires>? ORDER BY expires DESC",
          )
          .all(Date.now()),
      }),
    );
    function invitationResult(code) {
      return {
        url: baseUrl + "/join#invite=" + code,
        code: code.match(/.{4}/g).join("-"),
        prompt: installPrompt(baseUrl, {invite: code}),
      };
    }
    function inviteLimit(res, except = "") {
      if (db.prepare("SELECT count(*) AS n FROM members").get().n >= 30) {
        res.status(409).json({error: "当前小圈子版本最多 30 位成员。"});
        return true;
      }
      if (db.prepare("SELECT count(*) AS n FROM invites WHERE used=0 AND expires>? AND invite_id<>?").get(Date.now(), except).n >= 30) {
        res.status(409).json({error: "待使用邀请已达 30 个，请先撤销旧邀请。"});
        return true;
      }
      return false;
    }
    app.post("/api/v1/invites", admin, (req, res) => {
      const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
      if (!label || label.length > 60)
        return res.status(400).json({error: "请填写 1–60 字的朋友备注。"});
      if (inviteLimit(res)) return;
      const code = randomBytes(16).toString("hex"),
        id = randomBytes(12).toString("hex"), expires = Date.now() + 7 * 86400000;
      db.prepare("INSERT INTO invites(hash,label,expires,invite_id,created_at) VALUES(?,?,?,?,?)").run(hash(code),label,expires,id,new Date().toISOString());
      res.status(201).json({...invitationResult(code), expires, id});
    });
    app.post("/api/v1/invites/:id/reissue", admin, (req, res) => {
      const invite = db.prepare("SELECT * FROM invites WHERE invite_id=?").get(req.params.id);
      if (!invite) return res.status(404).json({error: "邀请不存在。"});
      if (invite.member_id || (invite.used && !invite.revoked))
        return res.status(409).json({error: "朋友已加入，请使用恢复连接。"});
      if (inviteLimit(res, invite.invite_id)) return;
      const code = randomBytes(16).toString("hex"), expires = Date.now() + 7 * 86400000;
      db.prepare("UPDATE invites SET hash=?,expires=?,used=0,revoked=0 WHERE invite_id=?").run(hash(code),expires,invite.invite_id);
      res.json({...invitationResult(code), expires, id: invite.invite_id});
    });
    app.delete("/api/v1/invites/:id", admin, (req, res) => {
      // Keep a readable record while making every copy of the old invite unusable.
      const result = db.prepare("UPDATE invites SET used=1,revoked=1 WHERE (hash=? OR invite_id=?) AND used=0").run(req.params.id,req.params.id);
      if (!result.changes) return res.status(409).json({error: "邀请已使用或已撤销，请刷新列表。"});
      res.json({ok: true});
    });
    app.get("/api/v1/friends", guard, admin, (req, res) => {
      const members = db.prepare(`SELECT m.id AS member_id,m.username,m.note,m.disabled,m.created_at,
        i.invite_id,(SELECT count(*) FROM works w WHERE w.owner_id=m.id) AS works_count
        FROM members m LEFT JOIN invites i ON i.member_id=m.id WHERE m.id<>1`).all();
      const invitations = db.prepare("SELECT invite_id,label,expires,revoked,created_at FROM invites WHERE member_id IS NULL AND (used=0 OR revoked=1)").all();
      const friends = [
        ...members.map(m => ({id: m.invite_id || "member-" + m.member_id, member_id: m.member_id,
          note: m.note || m.username, state: m.disabled ? "disabled" : "joined", works_count: m.works_count, created_at: m.created_at})),
        ...invitations.map(i => ({id:i.invite_id, note:i.label, state:i.revoked ? "revoked" : i.expires <= Date.now() ? "expired" : "pending",
          expires:i.expires, created_at:i.created_at, works_count:0})),
      ].sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
      res.json({friends});
    });
    app.post("/api/v1/members/:id/recovery", admin, (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 1)
        return res.status(400).json({error: "请选择一位朋友。"});
      const member = db.prepare("SELECT id,disabled FROM members WHERE id=?").get(id);
      if (!member) return res.status(404).json({error: "成员不存在。"});
      if (member.disabled) return res.status(409).json({error: "请先启用这位朋友，再恢复连接。"});
      const code = secret(), expires = Date.now() + 86400000;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM agent_grants WHERE member_id=?").run(id);
        db.exec("DELETE FROM recovery_grants WHERE hash NOT IN (SELECT hash FROM agent_grants)");
        db.prepare("INSERT INTO agent_grants VALUES(?,?,?)").run(hash(code),id,expires);
        db.prepare("INSERT INTO recovery_grants VALUES(?)").run(hash(code));
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      res.json({prompt:installPrompt(baseUrl,{connect:code,recovery:true}),expires});
    });
  }
  return { guard, identity, routes, accountInfo };
}
module.exports = { accounts };
