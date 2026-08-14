import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const action = String(process.argv[2] || "").toLowerCase();
if (!["on", "off", "status"].includes(action)) {
  console.error("Usage: node scripts/set-ai-access.mjs on|off|status");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.resolve(root, "local-auth-server/.env");

if (!fs.existsSync(envPath)) {
  console.error("local-auth-server/.env does not exist. Run npm run auth:init first.");
  process.exit(1);
}

const envText = fs.readFileSync(envPath, "utf8");
const tokenMatch = envText.match(/^ATOM_AUTH_ADMIN_TOKEN=(.*)$/m);
if (!tokenMatch || !tokenMatch[1].trim()) {
  console.error("ATOM_AUTH_ADMIN_TOKEN is missing from local-auth-server/.env.");
  process.exit(1);
}

const workerBase = String(
  process.env.ATOM_CHAT_API_BASE
  || process.env.ATOM_API_BASE
  || "https://atom-proxy.archimedes-api1.workers.dev"
).replace(/\/$/, "");

const url = `${workerBase}/api/internal/ai-access`;
const token = tokenMatch[1].trim();
const method = action === "status" ? "GET" : "POST";
const body = action === "status" ? undefined : JSON.stringify({ enabled: action === "on" });

const response = await fetch(url, {
  method,
  headers: {
    Authorization: `Bearer ${token}`,
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body } : {}),
});

const out = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(out.error || `Request failed with ${response.status}.`);
  process.exit(1);
}

console.log(`AI access is ${out.enabled === false ? "OFF" : "ON"}.`);
