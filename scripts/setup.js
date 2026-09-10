const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const docker = process.argv.includes("--docker");
const file = docker ? ".env.docker" : ".env";
const port = docker ? 8090 : 3000;
if (fs.existsSync(file)) console.log(`${file} already exists; preserved.`);
else {
  fs.writeFileSync(
    file,
    `HOST=127.0.0.1\nPORT=${port}\nBASE_URL=http://127.0.0.1:${port}\nQUICKSHARE_TOKEN=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log(docker
    ? "Created private .env.docker. Run docker compose --env-file .env.docker up -d --build."
    : "Created private .env. Run npm run dev.");
}
