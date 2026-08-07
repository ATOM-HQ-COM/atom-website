import Database from "better-sqlite3";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(root, "local-auth-server/.env") });
const dbPath = path.resolve(root, process.env.ATOM_AUTH_DB_PATH || "./local-auth-server/data/atom-auth.sqlite");

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const overrideTableExists = !!db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table' AND name = 'admin_overrides'
`).get();
const actualTotalUsers = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count || 0);
const overrideRow = overrideTableExists
  ? db.prepare("SELECT value FROM admin_overrides WHERE key = ?").get("display_total_users")
  : null;
const displayTotalUsers = overrideRow
  ? Math.max(0, Math.floor(Number(overrideRow.value)))
  : NaN;
const metrics = {
  totalUsers: Number.isFinite(displayTotalUsers) ? displayTotalUsers : actualTotalUsers,
};

console.log(JSON.stringify(metrics, null, 2));
