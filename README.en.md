<div align="center">

# QiaoPage

**From your agent. To the web.**

Turn agent-created HTML, Markdown, and static folders into links you can keep updating.

[中文](README.md) · **English**

[Live home](https://quickshare-agent-test.vercel.app) · [Play a published game](https://quickshare-agent-test.vercel.app/s/site-jqutfay8tx/) · [Cloud installation](docs/cloud-install.md)

![QiaoPage publishing workflow](docs/assets/hero.png)

</div>

## Keep publishing in the conversation

You made something with AI. Now send someone a link.

Install QiaoPage on your own infrastructure, copy its setup prompt into your agent, and ask it to publish a file or static build folder. Later, ask it to update that site: the URL stays the same. Web, CLI, and agents manage the same content.

Invite friends with an individual prompt. Each invitation creates a separate member identity and publishing space; setting a username and password is optional. The live demo lets anyone browse the home and sample sites. Publishing requires an invitation from that instance's administrator or your own installation.

| Capability | Result |
| --- | --- |
| HTML, Markdown, and static folders | Share interactive tools, reports, and small websites |
| Stable URLs | Title, account, and content edits preserve existing links |
| Safe updates | Idempotent publication retries, revision checks, version recovery, unpublish/restore |
| Agent management | Read identity and permissions; manage sites, share cards, account, and authorized invitations |
| Optional sharing metadata | OG title, description, cover, and opt-in search indexing |
| Self-hosted storage | Docker/VPS, Cloudflare Workers, or Vercel; portable backups and recovery |

Source HTML is preserved by default. No watermark, platform footer, or promotional content is added. Share enhancement and indexing are opt-in; original metadata wins.

## Try real examples

[Palette Lab](https://quickshare-agent-test.vercel.app/s/site-5dmzyhdc49/) · [Focus Clock](https://quickshare-agent-test.vercel.app/s/site-zgg3w7ghz2/) · [Memory Tiles](https://quickshare-agent-test.vercel.app/s/site-jqutfay8tx/)

Each demo is published byte-for-byte from [examples/](examples/). The Chinese README includes desktop/mobile screenshots and a product tour.

## Quick start: Docker

Requires Docker and Compose v2. No host Node.js installation is needed. Initial build time depends on your network and machine.

```sh
git clone https://github.com/joeseesun/qiaopage.git
cd qiaopage

docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" -w /workspace \
  node:24.20.0-bookworm-slim node scripts/setup.js --docker

docker compose --env-file .env.docker up -d --build --wait
```

Open http://127.0.0.1:8090. Generate a private, one-use administrator login link valid for five minutes:

```sh
docker compose --env-file .env.docker exec -T quickshare \
  node bin/quickshare.js dashboard --url http://127.0.0.1:3000
```

There is no default password. Keep the generated `.env.docker` administrator secret private. Public installations require HTTPS and an exact `BASE_URL`. Persistent volumes retain data across container rebuilds. See [Docker installation and backups](DOCKER_INSTALL.md).

### Cloudflare or Vercel

From a cloned repository, with Node.js 24+:

```sh
npm ci --ignore-scripts
npm run install:cloudflare -- qiaopage
# OR
npm run install:vercel -- qiaopage
```

Official CLI installers provision or reuse resources and preserve credentials. You need your own platform account and must complete login, terms, and any billing activation yourself. Keep an existing installation's project name when upgrading. Cloudflare uses SQLite Durable Objects + private R2; Vercel uses Turso + private Blob. Browser deploy buttons are not yet verified; use the CLI paths. See [cloud instructions](docs/cloud-install.md).

For local development: `npm ci`, `npm run setup`, `npm start`, then open http://127.0.0.1:3000. Run `node bin/quickshare.js dashboard` in another terminal to get an administrator login link.

## Agent and CLI usage

Copy the prompt from your instance or use your personal invitation prompt. Your agent reads that server's `/skill.md`, installs the standalone CLI, redeems the code through stdin, and stores credentials privately. Setup does not publish any files automatically.

After connecting, use the installed CLI path:

```sh
node quickshare.js whoami --json
node quickshare.js publish ./dist
node quickshare.js update RETURNED_SLUG ./dist
node quickshare.js list --json
node quickshare.js account --json
```

Replace `RETURNED_SLUG` with the actual publication result. Without an explicit configured instance, the CLI stops instead of sending credentials to another server. The `quickshare` command, `qiaomu-quickshare` Skill ID, environment variables, and private configuration paths are retained for compatibility with existing Quickshare installations. No data migration is needed for the rebrand.

## Limits and trust

- Static hosting only; no server-side execution. Build frontend apps locally and publish their static output.
- Up to 100 files / 8 MiB total per upload, 5 MiB per file, and 100 sites per member. Large uploads are chunked automatically.
- Unlisted means absent from the gallery, not private: anyone with the link can view a published site.
- User HTML runs in an opaque sandbox. Management cookies, localStorage, and Service Workers are unavailable. Use relative asset paths.
- Default SQLite uses a single instance and persistent storage. Never use an ephemeral filesystem for persistent data.
- Code is ISC-licensed; hosting, domains, and storage may incur provider charges. There is no promise of permanent free hosting.
- Installation currently builds from source. Prebuilt container images and browser deployment buttons are planned, not shipped.

## Verification and contributions

56 automated tests and real Chrome desktop/390px acceptance checks passed for this launch. CI verifies Node, Docker, libSQL/MinIO, and native Workers. Both cloud deployments have passed upload, persistence, and recovery checks; see [verification scope](docs/verification.md).

```sh
npm run check
npm test
npm run verify:ui          # Chrome required
npm run verify:docker     # Docker required
npm run verify:backends
npm run verify:cloudflare
```

Contributions and reproducible installation feedback are welcome. Follow [CONTRIBUTING](CONTRIBUTING.md), [Code of conduct](CODE_OF_CONDUCT.md), and [SECURITY](SECURITY.md). Never post tokens, invitation links, databases, or private files in an issue.

QiaoPage evolved from [Quickshare](https://github.com/joeseesun/quickshare), with an agent-first workflow inspired by [here.now](https://here.now/). Code retains the ISC license; bundled Geist and Noto Sans SC fonts retain SIL OFL licensing. See [NOTICE](NOTICE.md).

Made and maintained by **[向阳乔木 / Joe](https://x.com/vista8)**. [Website](https://qiaomu.ai) · [Blog](https://blog.qiaomu.ai) · [Projects](https://tuijian.qiaomu.ai) · [GitHub](https://github.com/joeseesun/)
