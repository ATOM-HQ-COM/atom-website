import Database from "better-sqlite3";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(root, "local-auth-server/.env") });
const dbPath = path.resolve(root, process.env.ATOM_AUTH_DB_PATH || "./local-auth-server/data/atom-auth.sqlite");

const db = new Database(dbPath, { fileMustExist: true });
const overrideTableExists = !!db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table' AND name = 'admin_overrides'
`).get();
const actualTotalUsers = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count || 0);

function wholeInteger(value, fallback = NaN) {
  const out = Math.floor(Number(value));
  return Number.isFinite(out) ? out : fallback;
}

let offset = overrideTableExists
  ? wholeInteger((db.prepare("SELECT value FROM admin_overrides WHERE key = ?").get("display_total_users_offset") || {}).value)
  : NaN;

if (!Number.isFinite(offset) && overrideTableExists) {
  const legacyDisplayTotal = wholeInteger((db.prepare("SELECT value FROM admin_overrides WHERE key = ?").get("display_total_users") || {}).value);
  if (Number.isFinite(legacyDisplayTotal)) {
    offset = legacyDisplayTotal - actualTotalUsers;
    db.prepare(`
      INSERT INTO admin_overrides (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run("display_total_users_offset", String(offset), Date.now());
  }
}

const metrics = {
  totalUsers: Math.max(0, actualTotalUsers + (Number.isFinite(offset) ? offset : 0)),
};

console.log(JSON.stringify(metrics, null, 2));
