# Quickshare Agent

Read README.md, DOCKER_INSTALL.md and docs/portable-deployment.md before meaningful changes.

- Preserve user changes. Use codex/ feature branches and PRs; never push directly to main.
- Runtime: server.js; accounts/session/CSRF in lib/accounts.js; file validation in lib/files.js.
- Every mutation requires an authenticated member. Enforce ownership on reads, histories, restores and writes. Only admins manage invitations and friends.
- Keep secrets, private paths and runtime data out of Git/logs/URLs. Browser auth uses HttpOnly, SameSite=Strict, Secure on HTTPS, plus exact Origin validation. CLI uses personal Bearer tokens. One-use grants use URL fragments and hashed storage.
- Preserve opaque sandbox isolation. Never add allow-same-origin, top navigation or service worker privileges casually.
- Publishing preserves source HTML by default. Sharing enhancement and search indexing are explicit opt-ins. No watermark, attribution or promotions added to user content.
- Stable slugs, idempotent publishing, revision CAS, atomic versions and recoverable unpublish/restore are required. Use additive migrations.
- Run npm run check and npm test. Docker changes require npm run verify:docker. UI changes require npm run verify:ui and actual desktop/390px screenshot inspection.
- Cloudflare uses SQLite Durable Objects + R2; Vercel uses libSQL + private Blob. Cloud changes require native runtime, authorization, full-size uploads, redeploy persistence and recovery verification. CLI verification is not a browser deploy-button test. Keep private repository visibility unchanged.
- Report local, committed, pushed, CI, deployed and live-tested states separately.
