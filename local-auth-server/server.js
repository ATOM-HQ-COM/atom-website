import argon2 from "argon2";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const PORT = Number(process.env.PORT || 8789);
const GUEST_MESSAGE_LIMIT = Number(process.env.ATOM_AUTH_GUEST_LIMIT || 3);
const UPSTREAM_CHAT_URL = process.env.ATOM_UPSTREAM_CHAT_URL || "https://atom-proxy.archimedes-api1.workers.dev/api/chat";
// Socrates voice endpoints live on the same Worker as /api/chat, so derive
// them from that URL rather than making people configure three variables.
const UPSTREAM_BASE = UPSTREAM_CHAT_URL.replace(/\/api\/chat\/?$/, "");
const UPSTREAM_STT_URL = process.env.ATOM_UPSTREAM_STT_URL || `${UPSTREAM_BASE}/api/stt`;
const UPSTREAM_TTS_URL = process.env.ATOM_UPSTREAM_TTS_URL || `${UPSTREAM_BASE}/api/tts`;
const COOKIE_SECURE = String(process.env.ATOM_AUTH_COOKIE_SECURE || "false").toLowerCase() === "true";
const COOKIE_SAMESITE = process.env.ATOM_AUTH_COOKIE_SAMESITE || (COOKIE_SECURE ? "lax" : "lax");
const SESSION_COOKIE = "atom_auth_session";
const GUEST_COOKIE = "atom_guest_session";
const PRIVATE_ADMIN_COOKIE = "atom_admin_tools";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const GUEST_TTL_SECONDS = 60 * 60 * 24 * 90;
const PRIVATE_ADMIN_TTL_SECONDS = 60 * 60 * 24 * 30;
const PRIVATE_ADMIN_HELPER_PATH = path.resolve(root, "local-auth-server/private-admin-tools.js");
const CONTACT_EMAIL = "atomeducationhq@gmail.com";
const MAX_CONTACT_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTACT_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function requiredKey(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) throw new Error(`${name} is required. Run npm run auth:env and paste the output into local-auth-server/.env.`);
  const bytes = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new Error(`${name} must decode to exactly 32 bytes.`);
  return bytes;
}

const EMAIL_KEY = requiredKey("ATOM_AUTH_EMAIL_KEY");
const LOOKUP_KEY = requiredKey("ATOM_AUTH_LOOKUP_KEY");
const SESSION_SECRET = requiredKey("ATOM_AUTH_SESSION_SECRET");
const ADMIN_TOKEN = String(process.env.ATOM_AUTH_ADMIN_TOKEN || "").trim();

const dbPath = path.resolve(root, process.env.ATOM_AUTH_DB_PATH || "./local-auth-server/data/atom-auth.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email_lookup TEXT NOT NULL UNIQUE,
    email_ciphertext TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at);
  CREATE TABLE IF NOT EXISTS admin_overrides (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS site_counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS site_counter_overrides (
    name TEXT PRIMARY KEY,
    offset INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    recipient_token TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    message_attachments TEXT,
    created_at INTEGER NOT NULL,
    reply TEXT,
    reply_attachments TEXT,
    replied_at INTEGER,
    acknowledged_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS contacts_created_at_idx ON contacts(created_at DESC);
  CREATE INDEX IF NOT EXISTS contacts_recipient_token_idx ON contacts(recipient_token);
  CREATE TABLE IF NOT EXISTS contact_thread_messages (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    message TEXT NOT NULL,
    attachments TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS contact_thread_contact_idx ON contact_thread_messages(contact_id, created_at);
`);

const insertUser = db.prepare(`
  INSERT INTO users (id, email_lookup, email_ciphertext, password_hash, created_at, last_login_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const userByLookup = db.prepare("SELECT * FROM users WHERE email_lookup = ?");
const userById = db.prepare("SELECT * FROM users WHERE id = ?");
const touchLogin = db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?");
const totalUsersCount = db.prepare("SELECT COUNT(*) AS count FROM users");
const usersSinceCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE created_at >= ?");
const adminOverrideByKey = db.prepare("SELECT value FROM admin_overrides WHERE key = ?");
const upsertAdminOverride = db.prepare(`
  INSERT INTO admin_overrides (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);
const siteCounterByName = db.prepare("SELECT value FROM site_counters WHERE name = ?");
const siteCounterOffsetByName = db.prepare("SELECT offset FROM site_counter_overrides WHERE name = ?");
const incrementSiteCounterStmt = db.prepare(`
  INSERT INTO site_counters (name, value)
  VALUES (?, 1)
  ON CONFLICT(name) DO UPDATE SET
    value = value + 1
`);
const upsertSiteCounterOffset = db.prepare(`
  INSERT INTO site_counter_overrides (name, offset)
  VALUES (?, ?)
  ON CONFLICT(name) DO UPDATE SET
    offset = excluded.offset
`);
const contactsListStmt = db.prepare(`
  SELECT
    id,
    recipient_token AS recipientToken,
    name,
    email,
    message,
    message_attachments AS messageAttachments,
    created_at AS createdAt,
    reply,
    reply_attachments AS replyAttachments,
    replied_at AS repliedAt,
    acknowledged_at AS acknowledgedAt
  FROM contacts
  ORDER BY created_at DESC
`);
const contactByIdStmt = db.prepare(`
  SELECT
    id,
    recipient_token AS recipientToken,
    name,
    email,
    message,
    message_attachments AS messageAttachments,
    created_at AS createdAt,
    reply,
    reply_attachments AS replyAttachments,
    replied_at AS repliedAt,
    acknowledged_at AS acknowledgedAt
  FROM contacts
  WHERE id = ?
`);
const contactExistsStmt = db.prepare("SELECT id FROM contacts WHERE id = ?");
const contactByIdAndTokenStmt = db.prepare("SELECT id FROM contacts WHERE id = ? AND recipient_token = ?");
const contactsForReplacementStmt = db.prepare(`
  SELECT
    id,
    email,
    recipient_token AS recipientToken,
    message_attachments AS messageAttachments,
    reply,
    reply_attachments AS replyAttachments,
    replied_at AS repliedAt,
    acknowledged_at AS acknowledgedAt
  FROM contacts
`);
const threadByContactStmt = db.prepare(`
  SELECT
    id,
    sender,
    message,
    attachments,
    created_at AS createdAt
  FROM contact_thread_messages
  WHERE contact_id = ?
  ORDER BY created_at ASC
  LIMIT 120
`);
const firstThreadByContactStmt = db.prepare(`
  SELECT
    id,
    sender,
    attachments
  FROM contact_thread_messages
  WHERE contact_id = ?
  ORDER BY created_at ASC
  LIMIT 1
`);
const repliesByTokenStmt = db.prepare(`
  SELECT
    id,
    recipient_token AS recipientToken,
    reply,
    reply_attachments AS replyAttachments,
    replied_at AS repliedAt
  FROM contacts
  WHERE recipient_token = ?
    AND ((reply IS NOT NULL AND reply != '') OR reply_attachments IS NOT NULL)
    AND acknowledged_at IS NULL
  ORDER BY replied_at DESC
`);
const insertContactStmt = db.prepare(`
  INSERT INTO contacts (
    id,
    recipient_token,
    name,
    email,
    message,
    message_attachments,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertThreadMessageStmt = db.prepare(`
  INSERT INTO contact_thread_messages (
    id,
    contact_id,
    sender,
    message,
    attachments,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?)
`);
const updateContactReplyStmt = db.prepare(`
  UPDATE contacts
  SET reply = ?, reply_attachments = ?, replied_at = ?, acknowledged_at = NULL
  WHERE id = ?
`);
const updateContactAcknowledgedStmt = db.prepare(`
  UPDATE contacts
  SET acknowledged_at = ?
  WHERE id = ? AND recipient_token = ?
`);
const deleteThreadsByContactStmt = db.prepare("DELETE FROM contact_thread_messages WHERE contact_id = ?");
const deleteContactStmt = db.prepare("DELETE FROM contacts WHERE id = ?");
const deleteAllContactsStmt = db.prepare("DELETE FROM contacts");
const deleteOrphanThreadsStmt = db.prepare(`
  DELETE FROM contact_thread_messages
  WHERE contact_id NOT IN (SELECT id FROM contacts)
`);
const updateFirstThreadStmt = db.prepare(`
  UPDATE contact_thread_messages
  SET message = ?, created_at = ?
  WHERE id = ?
`);
const replaceContactStmt = db.prepare(`
  INSERT OR REPLACE INTO contacts (
    id,
    recipient_token,
    name,
    email,
    message,
    message_attachments,
    created_at,
    reply,
    reply_attachments,
    replied_at,
    acknowledged_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const allowedOrigins = new Set(String(process.env.ATOM_AUTH_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean));

function originAllowed(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function emailProblem(email) {
  if (!email) return "Email is required.";
  if (email.length > 320) return "Email is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return "";
}

function passwordProblem(password) {
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 256) return "Password is too long.";
  return "";
}

function wholeNumber(value, fallback = 0) {
  const out = Math.floor(Number(value));
  return Number.isFinite(out) && out >= 0 ? out : fallback;
}

function wholeInteger(value, fallback = 0) {
  const out = Math.floor(Number(value));
  return Number.isFinite(out) ? out : fallback;
}

function trimmed(value, max = 0) {
  const out = String(value || "").trim();
  return max > 0 ? out.slice(0, max) : out;
}

function clampedDisplayCount(actual, offset = 0) {
  return Math.max(0, wholeNumber(actual) + wholeInteger(offset));
}

function dataUrlByteSize(dataUrl) {
  const comma = String(dataUrl || "").indexOf(",");
  if (comma < 0) return NaN;
  const base64 = String(dataUrl).slice(comma + 1).replace(/\s+/g, "");
  if (!base64 || /[^A-Za-z0-9+/=]/.test(base64)) return NaN;
  const padding = base64.endsWith("==") ? 2 : (base64.endsWith("=") ? 1 : 0);
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}

function parseAttachments(value) {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      name: trimmed(item && item.name, 200),
      type: trimmed(item && item.type, 80).toLowerCase(),
      size: wholeInteger(item && item.size),
      dataUrl: String(item && item.dataUrl || "").trim(),
    })).filter((item) => item.type && item.dataUrl);
  } catch {
    return [];
  }
}

function serializeAttachments(list) {
  return Array.isArray(list) && list.length ? JSON.stringify(list) : null;
}

function normalizeAttachments(input) {
  if (!Array.isArray(input) || input.length === 0) return [];
  const attachments = [];
  let totalBytes = 0;

  input.forEach((raw, index) => {
    const type = trimmed(raw && raw.type, 80).toLowerCase();
    const dataUrl = String(raw && raw.dataUrl || "").trim();
    const name = trimmed(raw && raw.name, 200) || `image-${index + 1}`;
    if (!ALLOWED_CONTACT_IMAGE_TYPES.has(type)) {
      throw new Error("Only PNG, JPG, WEBP, GIF, and AVIF images are allowed.");
    }
    if (!dataUrl.startsWith(`data:${type};base64,`)) {
      throw new Error("One of the selected images is invalid.");
    }
    const size = dataUrlByteSize(dataUrl);
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error("One of the selected images is invalid.");
    }
    totalBytes += size;
    if (totalBytes > MAX_CONTACT_IMAGE_BYTES) {
      throw new Error("Images must total 10 MB or less.");
    }
    attachments.push({ name, type, size, dataUrl });
  });

  return attachments;
}

function hasMessageContent(text, attachments) {
  return !!trimmed(text) || (Array.isArray(attachments) && attachments.length > 0);
}

function adminOverrideNumber(key) {
  const row = adminOverrideByKey.get(key);
  return row ? wholeInteger(row.value, NaN) : NaN;
}

function userDisplayOffset(actualTotalUsers) {
  const offset = adminOverrideNumber("display_total_users_offset");
  if (Number.isFinite(offset)) return offset;

  const legacyDisplayTotal = adminOverrideNumber("display_total_users");
  if (!Number.isFinite(legacyDisplayTotal)) return 0;

  const migratedOffset = legacyDisplayTotal - actualTotalUsers;
  upsertAdminOverride.run("display_total_users_offset", String(migratedOffset), Date.now());
  return migratedOffset;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function hmac(value, secret = SESSION_SECRET) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signPayload(payload, ttlSeconds) {
  const body = base64url(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }));
  return `${body}.${hmac(body)}`;
}

function verifyPayload(token) {
  if (!token || !String(token).includes(".")) return null;
  const [body, sig] = String(token).split(".");
  if (!safeEqual(sig, hmac(body))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || Number(parsed.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function emailLookup(email) {
  return hmac(normalizeEmail(email), LOOKUP_KEY);
}

function encryptEmail(email) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", EMAIL_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(normalizeEmail(email), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptEmail(value) {
  const [ivB64, tagB64, dataB64] = String(value || "").split(".");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", EMAIL_KEY, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    path: "/",
    maxAge: maxAgeSeconds * 1000,
  };
}

function setSessionCookie(res, userId) {
  res.cookie(SESSION_COOKIE, signPayload({ sub: userId, kind: "user" }, SESSION_TTL_SECONDS), cookieOptions(SESSION_TTL_SECONDS));
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

function getUser(req) {
  const parsed = verifyPayload(req.cookies[SESSION_COOKIE]);
  if (!parsed || parsed.kind !== "user" || !parsed.sub) return null;
  return userById.get(String(parsed.sub)) || null;
}

function guestFromRequest(req) {
  const parsed = verifyPayload(req.cookies[GUEST_COOKIE]);
  if (parsed && parsed.kind === "guest" && parsed.id) {
    return { id: String(parsed.id), count: Math.max(0, Number(parsed.count || 0)) };
  }
  return { id: crypto.randomUUID(), count: 0 };
}

function setGuestCookie(res, guest) {
  res.cookie(GUEST_COOKIE, signPayload({ kind: "guest", id: guest.id, count: Math.max(0, Number(guest.count || 0)) }, GUEST_TTL_SECONDS), cookieOptions(GUEST_TTL_SECONDS));
}

function hasPrivateAdminSession(req) {
  const parsed = verifyPayload(req.cookies[PRIVATE_ADMIN_COOKIE]);
  return !!(parsed && parsed.kind === "private_admin_tools");
}

function setPrivateAdminCookie(res) {
  res.cookie(PRIVATE_ADMIN_COOKIE, signPayload({ kind: "private_admin_tools" }, PRIVATE_ADMIN_TTL_SECONDS), cookieOptions(PRIVATE_ADMIN_TTL_SECONDS));
}

function clearPrivateAdminCookie(res) {
  res.clearCookie(PRIVATE_ADMIN_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

function publicUser(user) {
  return {
    id: user.id,
    email: decryptEmail(user.email_ciphertext),
    createdAt: Number(user.created_at || 0),
  };
}

function authStatus(req, res) {
  const user = getUser(req);
  const guest = guestFromRequest(req);
  setGuestCookie(res, guest);
  return {
    authenticated: !!user,
    user: user ? publicUser(user) : null,
    guest: {
      count: guest.count,
      limit: GUEST_MESSAGE_LIMIT,
      remaining: Math.max(0, GUEST_MESSAGE_LIMIT - guest.count),
    },
  };
}

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    res.status(503).json({ error: "ATOM_AUTH_ADMIN_TOKEN is not configured." });
    return false;
  }
  if (hasPrivateAdminSession(req)) return true;
  const got = String(req.get("x-atom-admin-token") || "").trim();
  if (!safeEqual(got, ADMIN_TOKEN)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function privateAdminHelperAvailable() {
  return fs.existsSync(PRIVATE_ADMIN_HELPER_PATH);
}

function contactInboxRemovedPayload() {
  return {
    error: `Contact inbox has been removed. Email ${CONTACT_EMAIL} instead.`,
    email: CONTACT_EMAIL,
  };
}

function siteCounterValue(name) {
  const row = siteCounterByName.get(name);
  return wholeNumber(row && row.value);
}

function siteCounterOffset(name) {
  const row = siteCounterOffsetByName.get(name);
  return wholeInteger(row && row.offset);
}

function displaySiteCounter(name, actualValue = siteCounterValue(name)) {
  return Math.max(0, wholeNumber(actualValue) + siteCounterOffset(name));
}

function setSiteCounterDisplay(name, displayValue) {
  const actualValue = siteCounterValue(name);
  const offset = wholeNumber(displayValue) - actualValue;
  upsertSiteCounterOffset.run(name, offset);
}

function incrementSiteCounter(name) {
  incrementSiteCounterStmt.run(name);
  const actualValue = siteCounterValue(name);
  const displayValue = displaySiteCounter(name, actualValue);
  return { actualValue, displayValue };
}

function contactThread(contactId) {
  const id = String(contactId || "").slice(0, 80);
  if (!id) return [];
  const rows = threadByContactStmt.all(id).map((row) => ({
    id: row.id,
    sender: row.sender,
    message: row.message,
    attachments: parseAttachments(row.attachments),
    createdAt: Number(row.createdAt || 0),
  }));
  if (rows.length) return rows;

  const contact = contactByIdStmt.get(id);
  if (!contact) return [];

  const fallback = [{
    id: `${id}:initial`,
    sender: "user",
    message: contact.message,
    attachments: parseAttachments(contact.messageAttachments),
    createdAt: Number(contact.createdAt || 0),
  }];
  if (contact.reply || contact.replyAttachments) {
    fallback.push({
      id: `${id}:reply`,
      sender: "admin",
      message: contact.reply,
      attachments: parseAttachments(contact.replyAttachments),
      createdAt: Number(contact.repliedAt || Date.now()),
    });
  }
  return fallback;
}

function contactRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipientToken: row.recipientToken,
    name: row.name,
    email: row.email,
    message: row.message,
    messageAttachments: parseAttachments(row.messageAttachments),
    createdAt: Number(row.createdAt || 0),
    reply: row.reply || "",
    replyAttachments: parseAttachments(row.replyAttachments),
    repliedAt: row.repliedAt ? Number(row.repliedAt) : null,
    acknowledgedAt: row.acknowledgedAt ? Number(row.acknowledgedAt) : null,
    thread: contactThread(row.id),
  };
}

function siteSnapshot() {
  return {
    pageViews: displaySiteCounter("pageViews"),
    chatMessages: displaySiteCounter("chatMessages"),
    gameUsers: displaySiteCounter("gameUsers"),
    gameMinutes: displaySiteCounter("gameMinutes"),
    socratesUsers: displaySiteCounter("socratesUsers"),
    socratesMinutes: displaySiteCounter("socratesMinutes"),
    keplerUsers: displaySiteCounter("keplerUsers"),
    keplerMinutes: displaySiteCounter("keplerMinutes"),
    contacts: [],
  };
}

function visibleUserMetrics(now = Date.now()) {
  const actualTotalUsers = wholeNumber(totalUsersCount.get().count);
  const totalUsers = clampedDisplayCount(actualTotalUsers, userDisplayOffset(actualTotalUsers));
  return {
    totalUsers,
    usersLast24h: wholeNumber(usersSinceCount.get(now - 24 * 60 * 60 * 1000).count),
    usersLast7d: wholeNumber(usersSinceCount.get(now - 7 * 24 * 60 * 60 * 1000).count),
    guestLimit: GUEST_MESSAGE_LIMIT,
  };
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    callback(originAllowed(origin) ? null : new Error(`Origin not allowed: ${origin}`), origin || true);
  },
}));
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });

app.get("/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

app.get("/api/auth/status", (req, res) => {
  res.json({ ok: true, ...authStatus(req, res) });
});

app.get("/api/admin/tools/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    unlocked: hasPrivateAdminSession(req),
    moduleAvailable: privateAdminHelperAvailable(),
  });
});

app.post("/api/admin/tools/unlock", (req, res) => {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: "ATOM_AUTH_ADMIN_TOKEN is not configured." });
  }
  const token = String(req.body && req.body.token || "").trim();
  if (!safeEqual(token, ADMIN_TOKEN)) {
    clearPrivateAdminCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }
  setPrivateAdminCookie(res);
  res.set("Cache-Control", "no-store");
  return res.json({
    ok: true,
    unlocked: true,
    moduleAvailable: privateAdminHelperAvailable(),
  });
});

app.get("/api/admin/tools/module", (req, res) => {
  if (!hasPrivateAdminSession(req)) return res.status(401).json({ error: "Unauthorized" });
  if (!privateAdminHelperAvailable()) {
    return res.status(404).json({ error: "Private admin tools are not installed on this machine." });
  }
  res.set("Cache-Control", "no-store");
  res.type("application/javascript").send(fs.readFileSync(PRIVATE_ADMIN_HELPER_PATH, "utf8"));
});

app.post("/api/auth/signup", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String(req.body && req.body.password || "");
  const problem = emailProblem(email) || passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const lookup = emailLookup(email);
  if (userByLookup.get(lookup)) return res.status(409).json({ error: "An account already exists for that email." });

  const now = Date.now();
  const user = {
    id: crypto.randomUUID(),
    emailLookup: lookup,
    emailCiphertext: encryptEmail(email),
    passwordHash: await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    }),
    createdAt: now,
  };

  insertUser.run(user.id, user.emailLookup, user.emailCiphertext, user.passwordHash, user.createdAt, now);
  setSessionCookie(res, user.id);
  res.status(201).json({ ok: true, user: { id: user.id, email, createdAt: now } });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String(req.body && req.body.password || "");
  const problem = emailProblem(email) || passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const user = userByLookup.get(emailLookup(email));
  if (!user || !(await argon2.verify(user.password_hash, password))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  touchLogin.run(Date.now(), user.id);
  setSessionCookie(res, user.id);
  res.json({ ok: true, user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const body = req.body && typeof req.body === "object" ? { ...req.body } : {};
  const atomAuth = body._atomAuth && typeof body._atomAuth === "object" ? body._atomAuth : {};
  delete body._atomAuth;

  const user = getUser(req);
  const guest = guestFromRequest(req);
  const countGuestMessage = !user && atomAuth.countGuestMessage === true;

  if (countGuestMessage && guest.count >= GUEST_MESSAGE_LIMIT) {
    setGuestCookie(res, guest);
    return res.status(402).json({
      error: "signup_required",
      code: "signup_required",
      message: "Create an Atom account to keep using the AI tutor.",
      guest: { count: guest.count, limit: GUEST_MESSAGE_LIMIT, remaining: 0 },
    });
  }

  try {
    const upstream = await fetch(UPSTREAM_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    if (upstream.ok && countGuestMessage) guest.count += 1;
    setGuestCookie(res, guest);
    const headers = { "Content-Type": upstream.headers.get("content-type") || "application/json" };
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    res.status(upstream.status).set(headers).send(text);
  } catch (err) {
    setGuestCookie(res, guest);
    res.status(502).json({ error: err.message || "Could not reach the upstream AI proxy." });
  }
});

/* ---------------- Socrates voice passthrough ----------------
   Both routes stream bytes rather than parsing them: the transcription body
   is multipart audio and the speech response is a WAV. express.json() is
   scoped above so it does not try to parse either. */
app.post("/api/stt", chatLimiter, async (req, res) => {
  try {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 9 * 1024 * 1024) {
        return res.status(413).json({ error: "Clip too long." });
      }
      chunks.push(chunk);
    }
    const upstream = await fetch(UPSTREAM_STT_URL, {
      method: "POST",
      headers: { "Content-Type": req.headers["content-type"] || "application/octet-stream" },
      body: Buffer.concat(chunks),
    });
    const text = await upstream.text();
    res.status(upstream.status)
      .set("Content-Type", upstream.headers.get("content-type") || "application/json")
      .send(text);
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not reach the transcription service." });
  }
});

app.post("/api/tts", chatLimiter, async (req, res) => {
  try {
    const upstream = await fetch(UPSTREAM_TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const type = upstream.headers.get("content-type") || "application/json";
    res.status(upstream.status).set("Content-Type", type).set("Cache-Control", "no-store");
    if (type.startsWith("audio/")) {
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } else {
      res.send(await upstream.text());
    }
  } catch (err) {
    res.status(502).json({ error: err.message || "Could not reach the speech service." });
  }
});

app.get("/api/admin/metrics", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...visibleUserMetrics() });
});

app.post("/api/admin/metrics/override", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const actualTotalUsers = wholeNumber(totalUsersCount.get().count);
  const totalUsers = wholeNumber(req.body && req.body.totalUsers);
  upsertAdminOverride.run("display_total_users_offset", String(totalUsers - actualTotalUsers), Date.now());
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...visibleUserMetrics() });
});

app.post("/api/site/page-view", (req, res) => {
  const counter = incrementSiteCounter("pageViews");
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, value: counter.displayValue, actualValue: counter.actualValue, displayValue: counter.displayValue });
});

app.post("/api/site/chat-message", (req, res) => {
  const counter = incrementSiteCounter("chatMessages");
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, value: counter.displayValue, actualValue: counter.actualValue, displayValue: counter.displayValue });
});

app.post("/api/site/contact", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(410).json(contactInboxRemovedPayload());
});

app.post("/api/site/replies/check", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(410).json(contactInboxRemovedPayload());
});

app.post("/api/site/replies/ack", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(410).json(contactInboxRemovedPayload());
});

app.post("/api/site/replies/respond", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(410).json(contactInboxRemovedPayload());
});

app.get("/api/site/admin/data", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.set("Cache-Control", "no-store");
  res.json(siteSnapshot());
});

app.post("/api/site/admin/data", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const pageViews = wholeNumber(body.pageViews);
  const chatMessages = wholeNumber(body.chatMessages);
  const gameUsers = wholeNumber(body.gameUsers);
  const gameMinutes = wholeNumber(body.gameMinutes);
  const socratesUsers = wholeNumber(body.socratesUsers);
  const socratesMinutes = wholeNumber(body.socratesMinutes);
  const keplerUsers = wholeNumber(body.keplerUsers);
  const keplerMinutes = wholeNumber(body.keplerMinutes);

  setSiteCounterDisplay("pageViews", pageViews);
  setSiteCounterDisplay("chatMessages", chatMessages);
  setSiteCounterDisplay("gameUsers", gameUsers);
  setSiteCounterDisplay("gameMinutes", gameMinutes);
  setSiteCounterDisplay("socratesUsers", socratesUsers);
  setSiteCounterDisplay("socratesMinutes", socratesMinutes);
  setSiteCounterDisplay("keplerUsers", keplerUsers);
  setSiteCounterDisplay("keplerMinutes", keplerMinutes);

  res.set("Cache-Control", "no-store");
  res.json({ ok: true, data: siteSnapshot() });
});

app.post("/api/site/admin/reply", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.set("Cache-Control", "no-store");
  res.status(410).json(contactInboxRemovedPayload());
});

app.post("/api/site/admin/delete-contact", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.set("Cache-Control", "no-store");
  res.status(410).json(contactInboxRemovedPayload());
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || "Server error" });
});

app.listen(PORT, () => {
  console.log(`Atom local auth gateway listening on http://127.0.0.1:${PORT}`);
  console.log(`SQLite auth DB: ${dbPath}`);
});
