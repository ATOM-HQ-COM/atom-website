import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.resolve(root, "local-auth-server/.env");

function secret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64");
}

if (fs.existsSync(envPath)) {
  const cleaned = fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim() || /^[A-Z0-9_]+=/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*$/, "\n");
  fs.writeFileSync(envPath, cleaned, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  console.log(`Existing ${envPath} left in place, cleaned, and chmodded to 600.`);
  process.exit(0);
}

const body = `PORT=8789
ATOM_UPSTREAM_CHAT_URL=https://atom-proxy.archimedes-api1.workers.dev/api/chat
ATOM_AUTH_ALLOWED_ORIGINS=https://atom-hq.com,https://www.atom-hq.com,http://localhost:8000,http://127.0.0.1:8000
ATOM_AUTH_DB_PATH=./local-auth-server/data/atom-auth.sqlite
ATOM_AUTH_COOKIE_SECURE=false
ATOM_AUTH_COOKIE_SAMESITE=lax
ATOM_AUTH_EMAIL_KEY=${secret()}
ATOM_AUTH_LOOKUP_KEY=${secret()}
ATOM_AUTH_SESSION_SECRET=${secret()}
ATOM_AUTH_ADMIN_TOKEN=${secret(48)}
`;

fs.writeFileSync(envPath, body, { mode: 0o600, flag: "wx" });
console.log(`Created ${envPath} with mode 600.`);
