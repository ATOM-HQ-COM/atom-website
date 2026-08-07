import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] || "";
if (!["local", "production"].includes(mode)) {
  console.error("Usage: node scripts/set-auth-mode.mjs local|production");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.resolve(root, "local-auth-server/.env");

if (!fs.existsSync(envPath)) {
  console.error("local-auth-server/.env does not exist. Run npm run auth:init first.");
  process.exit(1);
}

const settings = mode === "production"
  ? {
      ATOM_AUTH_ALLOWED_ORIGINS: "https://atom-hq.com,https://www.atom-hq.com",
      ATOM_AUTH_COOKIE_SECURE: "true",
      ATOM_AUTH_COOKIE_SAMESITE: "lax",
    }
  : {
      ATOM_AUTH_ALLOWED_ORIGINS: "https://atom-hq.com,https://www.atom-hq.com,http://localhost:8000,http://127.0.0.1:8000",
      ATOM_AUTH_COOKIE_SECURE: "false",
      ATOM_AUTH_COOKIE_SAMESITE: "lax",
    };

let env = fs.readFileSync(envPath, "utf8");
for (const [key, value] of Object.entries(settings)) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  env = pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\s*$/, "\n")}${line}\n`;
}

fs.writeFileSync(envPath, env, { mode: 0o600 });
fs.chmodSync(envPath, 0o600);
console.log(`Set local auth mode to ${mode}.`);

