import { DurableObject } from "cloudflare:workers";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/* Voice endpoints, used by the Socrates spoken tutor.

   STT is Whisper (large-v3-turbo): much better at picking words out of a
   noisy room than the browser's built-in SpeechRecognition, and it returns
   punctuated text.

   TTS is Canopy Labs' Orpheus, which sounds like a person rather than the
   flat robotic voice the browser ships. NOTE: an Orpheus model still needs
   its terms accepted once in the Groq console before it will answer; until
   then this route returns 503 and the frontend quietly falls back to browser
   speech, so Socrates always talks even if TTS is not enabled yet.
   English Orpheus voices: autumn, diana, hannah, austin, daniel, troy. */
const GROQ_STT_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TTS_ENDPOINT = "https://api.groq.com/openai/v1/audio/speech";
const STT_MODEL = "whisper-large-v3-turbo";
const TTS_MODEL = "canopylabs/orpheus-v1-english";
const TTS_DEFAULT_VOICE = "daniel";
// Cloudflare Workers have a request size ceiling; keep clips well under it.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_TTS_CHARS = 1800;
const ADMIN_SALT = "atom-admin-v1";
const DEFAULT_ADMIN_USERNAME_HASH = "666704633a6053e5fad50c78136a2f269cb23a205f1d67d7f10194dc93404e71";
const DEFAULT_ADMIN_PASSWORD_HASH = "427fe267db5d93e66245c2659c5525268ea7b2cde55db74c4734f3de760855cf";
const DEFAULT_SESSION_SECRET = "6d8c9955f1f524aa92fcbf6ff0c8d906d70f6d8e4b0c3a90b621e85c5bbce4f9";

const ALLOWED_ORIGINS = [
  "https://atom-hq.com",
  "https://www.atom-hq.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) ||
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) ||
    (origin && origin.endsWith(".github.io"));
}

function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://atom-hq.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function removedCommunityResponse(headers = {}) {
  return jsonResponse({ error: "Community chat has been removed." }, 410, headers);
}

async function readJson(request) {
  try { return await request.json(); }
  catch { return null; }
}

function pickProvider(model) {
  if (!model) return "groq";
  if (model.endsWith(":free")) return "openrouter";
  if (model.startsWith("deepseek/")) return "openrouter";
  if (model.startsWith("qwen/qwen3-coder-")) return "openrouter";
  if (model.startsWith("openrouter/")) return "openrouter";
  return "groq";
}

function getStore(env) {
  if (!env.ATOM_DATA) return null;
  const id = env.ATOM_DATA.idFromName("global");
  return env.ATOM_DATA.get(id);
}

async function storeJson(env, path, init = {}) {
  const store = getStore(env);
  if (!store) return jsonResponse({ error: "ATOM_DATA binding not configured" }, 500);
  return store.fetch(`https://atom.internal${path}`, init);
}

function base64Url(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textBytes(value) {
  return new TextEncoder().encode(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, textBytes(value)));
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function credentialsOk(env, username, password) {
  const userHash = env.ADMIN_USERNAME_HASH || DEFAULT_ADMIN_USERNAME_HASH;
  const passHash = env.ADMIN_PASSWORD_HASH || DEFAULT_ADMIN_PASSWORD_HASH;
  const gotUser = await sha256Hex(`${ADMIN_SALT}:${username || ""}`);
  const gotPass = await sha256Hex(`${ADMIN_SALT}:${password || ""}`);
  return safeEqual(gotUser, userHash) && safeEqual(gotPass, passHash);
}

function sessionSecret(env) {
  return env.ADMIN_SESSION_SECRET || DEFAULT_SESSION_SECRET;
}

async function makeSession(env) {
  const payload = base64Url(textBytes(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
    nonce: crypto.randomUUID(),
  })));
  const sig = await hmac(sessionSecret(env), payload);
  return `${payload}.${sig}`;
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function sessionOk(env, token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = await hmac(sessionSecret(env), payload);
  if (!safeEqual(sig, expected)) return false;
  let parsed;
  try { parsed = JSON.parse(decodeBase64Url(payload)); }
  catch { return false; }
  return parsed && Number(parsed.exp) > Math.floor(Date.now() / 1000);
}

function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((part) => part.trim());
  const prefix = `${name}=`;
  const found = parts.find((part) => part.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : "";
}

function authToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return cookieValue(request, "atom_admin");
}

function wholeNumber(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

async function requireAdmin(request, env) {
  return sessionOk(env, authToken(request));
}

async function proxyStoreResponse(env, path, cors, init = {}) {
  const response = await storeJson(env, path, init);
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function handleChat(request, env, cors, origin) {
  let body;
  try { body = await request.json(); }
  catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, cors);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: "messages[] required" }, 400, cors);
  }
  body.max_tokens = Math.min(body.max_tokens || 512, 12000);

  const provider = pickProvider(body.model);
  let endpoint, headers;
  if (provider === "openrouter") {
    if (!env.OPENROUTER_API_KEY) {
      return jsonResponse({ error: "OPENROUTER_API_KEY secret not set on this Worker" }, 500, cors);
    }
    endpoint = OPENROUTER_ENDPOINT;
    headers = {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": origin || "https://atom.local",
      "X-Title": "Atom Physics Tutor",
    };
  } else {
    if (!env.GROQ_API_KEY) {
      return jsonResponse({ error: "GROQ_API_KEY secret not set on this Worker" }, 500, cors);
    }
    endpoint = GROQ_ENDPOINT;
    headers = {
      "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "X-Provider": provider, ...cors },
  });
}

/* ---------------- Socrates voice: speech to text ----------------
   Takes the raw recorded clip as multipart/form-data under `file` and hands
   it straight to Whisper. The audio is streamed through rather than buffered
   into a string, so a long clip does not blow the Worker's memory. */
async function handleStt(request, env, cors) {
  if (!env.GROQ_API_KEY) {
    return jsonResponse({ error: "GROQ_API_KEY secret not set on this Worker" }, 500, cors);
  }

  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: "Clip too long. Keep it under about a minute." }, 413, cors);
  }

  let inbound;
  try { inbound = await request.formData(); }
  catch { return jsonResponse({ error: "Expected multipart/form-data with a `file` field." }, 400, cors); }

  const file = inbound.get("file");
  if (!file || typeof file === "string") {
    return jsonResponse({ error: "No audio file in the request." }, 400, cors);
  }

  const form = new FormData();
  form.append("file", file, "clip.webm");
  form.append("model", STT_MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");
  // A nudge that biases Whisper toward academic vocabulary, which otherwise
  // gets mangled ("Lagrangian" -> "the grandian", "titration" -> "tight ration").
  form.append(
    "prompt",
    "A student talking to a tutor about physics, chemistry, biology, mathematics or programming."
  );
  const language = inbound.get("language");
  if (typeof language === "string" && language) form.append("language", language);

  const upstream = await fetch(GROQ_STT_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

/* ---------------- Socrates voice: text to speech ----------------
   Returns audio bytes straight through. On any upstream failure we answer
   with JSON rather than broken audio so the frontend can tell the difference
   and fall back to browser speech. */
async function handleTts(request, env, cors) {
  if (!env.GROQ_API_KEY) {
    return jsonResponse({ error: "GROQ_API_KEY secret not set on this Worker" }, 500, cors);
  }

  const body = await readJson(request);
  const input = String((body && body.input) || "").trim();
  if (!input) return jsonResponse({ error: "input required" }, 400, cors);

  const voice = String((body && body.voice) || TTS_DEFAULT_VOICE);
  const upstream = await fetch(GROQ_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice,
      input: input.slice(0, MAX_TTS_CHARS),
      response_format: "wav",
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    // 400 here usually means the playai-tts terms have not been accepted yet.
    return jsonResponse(
      {
        error: "tts_unavailable",
        status: upstream.status,
        detail: detail.slice(0, 400),
      },
      upstream.status === 400 ? 503 : upstream.status,
      cors
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "audio/wav",
      "Cache-Control": "no-store",
      ...cors,
    },
  });
}

async function handleContact(request, env, cors) {
  const body = await readJson(request);
  const name = String(body && body.name || "").trim();
  const email = String(body && body.email || "").trim();
  const message = String(body && body.message || "").trim();
  const anonymous = !!(body && body.anonymous);
  if (!message) {
    return jsonResponse({ error: "Message is required" }, 400, cors);
  }
  if (!anonymous && !name) {
    return jsonResponse({ error: "Name is required unless you submit anonymously" }, 400, cors);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400, cors);
  }
  return proxyStoreResponse(env, "/contact", cors, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: anonymous ? "Anonymous" : name, email: anonymous ? "" : email, message }),
  });
}

async function handleLogin(request, env, cors) {
  const body = await readJson(request);
  const ok = await credentialsOk(env, body && body.username, body && body.password);
  if (!ok) return jsonResponse({ error: "Invalid username or password" }, 401, cors);
  const token = await makeSession(env);
  return jsonResponse({ ok: true, token }, 200, {
    ...cors,
    "Set-Cookie": `atom_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=43200`,
  });
}

export class AtomDataV3 extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contacts_created_at_idx ON contacts(createdAt DESC);
      INSERT OR IGNORE INTO counters (name, value) VALUES ('pageViews', 0);
      INSERT OR IGNORE INTO counters (name, value) VALUES ('chatMessages', 0);
    `);
    this.ensureContactColumns();
    this.cleanupRemovedCommunityData();
  }

  fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/page-view") return this.increment("pageViews");
    if (request.method === "POST" && url.pathname === "/chat-message") return this.increment("chatMessages");
    if (request.method === "POST" && url.pathname === "/contact") return this.addContact(request);
    if (request.method === "POST" && url.pathname === "/reply") return this.replyToContact(request);
    if (request.method === "POST" && url.pathname === "/replies/check") return this.checkReplies(request);
    if (request.method === "POST" && url.pathname === "/replies/ack") return this.ackReply(request);
    if (request.method === "POST" && url.pathname === "/replies/respond") return this.respondToContact(request);
    if (url.pathname.startsWith("/community")) return removedCommunityResponse();
    if (request.method === "GET" && url.pathname === "/data") return jsonResponse(this.snapshot());
    if (request.method === "POST" && url.pathname === "/data") return this.replaceData(request);
    return jsonResponse({ error: "Not found" }, 404);
  }

  ensureContactColumns() {
    const existing = new Set(this.sql.exec("PRAGMA table_info(contacts);").toArray().map((row) => row.name));
    [
      ["recipientToken", "TEXT"],
      ["reply", "TEXT"],
      ["repliedAt", "INTEGER"],
      ["acknowledgedAt", "INTEGER"],
    ].forEach(([name, type]) => {
      if (!existing.has(name)) this.sql.exec(`ALTER TABLE contacts ADD COLUMN ${name} ${type};`);
    });
    this.sql.exec("CREATE INDEX IF NOT EXISTS contacts_recipient_token_idx ON contacts(recipientToken);");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS contact_thread_messages (
        id TEXT PRIMARY KEY,
        contactId TEXT NOT NULL,
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contact_thread_contact_idx ON contact_thread_messages(contactId, createdAt);
    `);
  }

  cleanupRemovedCommunityData() {
    this.sql.exec(`
      DROP INDEX IF EXISTS community_messages_created_at_idx;
      DROP INDEX IF EXISTS community_messages_deleted_idx;
      DROP INDEX IF EXISTS community_dm_username_idx;
      DROP INDEX IF EXISTS community_dm_deleted_idx;
      DROP TABLE IF EXISTS community_messages;
      DROP TABLE IF EXISTS community_bans;
      DROP TABLE IF EXISTS community_dm_messages;
    `);
  }

  increment(name) {
    this.sql.exec("UPDATE counters SET value = value + 1 WHERE name = ?;", name);
    const row = this.sql.exec("SELECT value FROM counters WHERE name = ?;", name).toArray()[0];
    return jsonResponse({ ok: true, value: Number(row && row.value || 0) });
  }

  async addContact(request) {
    const body = await readJson(request);
    const contact = {
      id: crypto.randomUUID(),
      recipientToken: crypto.randomUUID(),
      name: String(body && body.name || "").slice(0, 200),
      email: String(body && body.email || "").slice(0, 320),
      message: String(body && body.message || "").slice(0, 5000),
      createdAt: Date.now(),
    };
    this.sql.exec(
      "INSERT INTO contacts (id, recipientToken, name, email, message, createdAt) VALUES (?, ?, ?, ?, ?, ?);",
      contact.id,
      contact.recipientToken,
      contact.name,
      contact.email,
      contact.message,
      contact.createdAt,
    );
    this.sql.exec(
      "INSERT INTO contact_thread_messages (id, contactId, sender, message, createdAt) VALUES (?, ?, 'user', ?, ?);",
      crypto.randomUUID(),
      contact.id,
      contact.message,
      contact.createdAt,
    );
    return jsonResponse({ ok: true, contact: { id: contact.id, recipientToken: contact.recipientToken } });
  }

  snapshot() {
    const counterRows = this.sql.exec("SELECT name, value FROM counters;").toArray();
    const counters = Object.fromEntries(counterRows.map((row) => [row.name, Number(row.value || 0)]));
    const contacts = this.sql.exec("SELECT id, name, message, createdAt, reply, repliedAt, acknowledgedAt FROM contacts ORDER BY createdAt DESC;").toArray()
      .map((contact) => ({ ...contact, thread: this.contactThread(contact.id) }));
    return {
      pageViews: counters.pageViews || 0,
      chatMessages: counters.chatMessages || 0,
      contacts,
    };
  }

  contactThread(contactId) {
    const id = String(contactId || "").slice(0, 80);
    if (!id) return [];
    const rows = this.sql.exec(
      "SELECT id, sender, message, createdAt FROM contact_thread_messages WHERE contactId = ? ORDER BY createdAt ASC LIMIT 120;",
      id,
    ).toArray().map((row) => ({
      id: row.id,
      sender: row.sender,
      message: row.message,
      createdAt: Number(row.createdAt || 0),
    }));
    if (rows.length) return rows;
    const contact = this.sql.exec(
      "SELECT id, message, createdAt, reply, repliedAt FROM contacts WHERE id = ?;",
      id,
    ).toArray()[0];
    if (!contact) return [];
    const fallback = [{
      id: `${id}:initial`,
      sender: "user",
      message: contact.message,
      createdAt: Number(contact.createdAt || 0),
    }];
    if (contact.reply) {
      fallback.push({
        id: `${id}:reply`,
        sender: "admin",
        message: contact.reply,
        createdAt: Number(contact.repliedAt || Date.now()),
      });
    }
    return fallback;
  }

  async replyToContact(request) {
    const body = await readJson(request);
    const id = String(body && body.id || "").slice(0, 80);
    const reply = String(body && body.reply || "").trim().slice(0, 5000);
    if (!id || !reply) return jsonResponse({ error: "Contact and reply are required" }, 400);
    const existing = this.sql.exec("SELECT id FROM contacts WHERE id = ?;", id).toArray()[0];
    if (!existing) return jsonResponse({ error: "Contact not found" }, 404);
    this.sql.exec(
      "INSERT INTO contact_thread_messages (id, contactId, sender, message, createdAt) VALUES (?, ?, 'admin', ?, ?);",
      crypto.randomUUID(),
      id,
      reply,
      Date.now(),
    );
    this.sql.exec("UPDATE contacts SET reply = ?, repliedAt = ?, acknowledgedAt = NULL WHERE id = ?;", reply, Date.now(), id);
    const contact = this.sql.exec("SELECT id, name, message, createdAt, reply, repliedAt, acknowledgedAt FROM contacts WHERE id = ?;", id).toArray()[0];
    return jsonResponse({ ok: true, contact: { ...contact, thread: this.contactThread(id) } });
  }

  async checkReplies(request) {
    const body = await readJson(request);
    const tokens = Array.isArray(body && body.tokens) ? body.tokens.map((token) => String(token || "").slice(0, 80)).filter(Boolean).slice(0, 50) : [];
    if (tokens.length === 0) return jsonResponse({ replies: [] });
    const replies = [];
    tokens.forEach((token) => {
      this.sql.exec(
        "SELECT id, recipientToken, reply, repliedAt FROM contacts WHERE recipientToken = ? AND reply IS NOT NULL AND acknowledgedAt IS NULL ORDER BY repliedAt DESC;",
        token,
      ).toArray().forEach((row) => replies.push({ ...row, thread: this.contactThread(row.id) }));
    });
    replies.sort((a, b) => Number(b.repliedAt || 0) - Number(a.repliedAt || 0));
    return jsonResponse({ replies });
  }

  async ackReply(request) {
    const body = await readJson(request);
    const id = String(body && body.id || "").slice(0, 80);
    const token = String(body && body.recipientToken || "").slice(0, 80);
    if (!id || !token) return jsonResponse({ error: "Reply id and token are required" }, 400);
    this.sql.exec("UPDATE contacts SET acknowledgedAt = ? WHERE id = ? AND recipientToken = ?;", Date.now(), id, token);
    return jsonResponse({ ok: true });
  }

  async respondToContact(request) {
    const body = await readJson(request);
    const id = String(body && body.id || "").slice(0, 80);
    const token = String(body && body.recipientToken || "").slice(0, 80);
    const message = String(body && body.message || "").trim().slice(0, 5000);
    if (!id || !token || !message) return jsonResponse({ error: "Contact, token, and message are required" }, 400);
    const contact = this.sql.exec(
      "SELECT id FROM contacts WHERE id = ? AND recipientToken = ?;",
      id,
      token,
    ).toArray()[0];
    if (!contact) return jsonResponse({ error: "Contact thread not found" }, 404);
    this.sql.exec(
      "INSERT INTO contact_thread_messages (id, contactId, sender, message, createdAt) VALUES (?, ?, 'user', ?, ?);",
      crypto.randomUUID(),
      id,
      message,
      Date.now(),
    );
    this.sql.exec("UPDATE contacts SET acknowledgedAt = ? WHERE id = ? AND recipientToken = ?;", Date.now(), id, token);
    return jsonResponse({ ok: true, thread: this.contactThread(id) });
  }

  async replaceData(request) {
    const body = await readJson(request);
    const pageViews = wholeNumber(body && body.pageViews);
    const chatMessages = wholeNumber(body && body.chatMessages);
    const contacts = Array.isArray(body && body.contacts) ? body.contacts.slice(0, 500) : [];
    this.sql.exec("UPDATE counters SET value = ? WHERE name = 'pageViews';", pageViews);
    this.sql.exec("UPDATE counters SET value = ? WHERE name = 'chatMessages';", chatMessages);
    const oldContacts = Object.fromEntries(
      this.sql.exec("SELECT id, email, recipientToken, reply, repliedAt, acknowledgedAt FROM contacts;").toArray().map((row) => [row.id, row]),
    );
    this.sql.exec("DELETE FROM contacts;");
    contacts.forEach((item) => {
      const id = String(item && item.id || crypto.randomUUID()).slice(0, 80);
      const old = oldContacts[id] || {};
      const name = String(item && item.name || "").slice(0, 200);
      const email = String(item && item.email || old.email || "").slice(0, 320);
      const recipientToken = String(item && item.recipientToken || old.recipientToken || crypto.randomUUID()).slice(0, 80);
      const message = String(item && item.message || "").slice(0, 5000);
      const createdAt = Number.isFinite(Number(item && item.createdAt)) ? Number(item.createdAt) : Date.now();
      const reply = item && "reply" in item ? String(item.reply || "").slice(0, 5000) : old.reply || null;
      const repliedAt = Number.isFinite(Number(item && item.repliedAt)) ? Number(item.repliedAt) : old.repliedAt || null;
      const acknowledgedAt = Number.isFinite(Number(item && item.acknowledgedAt)) ? Number(item.acknowledgedAt) : old.acknowledgedAt || null;
      if (!name && !email && !message) return;
      this.sql.exec(
        "INSERT OR REPLACE INTO contacts (id, recipientToken, name, email, message, createdAt, reply, repliedAt, acknowledgedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);",
        id,
        recipientToken,
        name,
        email,
        message,
        Math.floor(createdAt),
        reply,
        repliedAt ? Math.floor(Number(repliedAt)) : null,
        acknowledgedAt ? Math.floor(Number(acknowledgedAt)) : null,
      );
    });
    return jsonResponse({ ok: true, data: this.snapshot() });
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/chat") {
      return handleChat(request, env, cors, origin);
    }

    // Socrates voice routes.
    if (request.method === "POST" && url.pathname === "/api/stt") {
      return handleStt(request, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/api/tts") {
      return handleTts(request, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/api/events/page-view") {
      return proxyStoreResponse(env, "/page-view", cors, { method: "POST" });
    }

    if (request.method === "POST" && url.pathname === "/api/events/chat-message") {
      return proxyStoreResponse(env, "/chat-message", cors, { method: "POST" });
    }

    if (request.method === "POST" && url.pathname === "/api/contact") {
      return handleContact(request, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/api/replies/check") {
      const body = await readJson(request);
      return proxyStoreResponse(env, "/replies/check", cors, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/replies/ack") {
      const body = await readJson(request);
      return proxyStoreResponse(env, "/replies/ack", cors, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/replies/respond") {
      const body = await readJson(request);
      return proxyStoreResponse(env, "/replies/respond", cors, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
    }

    if (url.pathname.startsWith("/api/community") || url.pathname.startsWith("/api/admin/community")) {
      return removedCommunityResponse(cors);
    }

    if (request.method === "POST" && url.pathname === "/api/admin/login") {
      return handleLogin(request, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/api/admin/logout") {
      return jsonResponse({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": "atom_admin=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0",
      });
    }

    if (url.pathname === "/api/admin/data") {
      if (!(await requireAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      if (request.method === "GET") return proxyStoreResponse(env, "/data", cors, { method: "GET" });
      if (request.method === "POST") {
        const body = await readJson(request);
        return proxyStoreResponse(env, "/data", cors, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        });
      }
    }

    if (request.method === "POST" && url.pathname === "/api/admin/reply") {
      if (!(await requireAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      const body = await readJson(request);
      return proxyStoreResponse(env, "/reply", cors, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
    }

    return jsonResponse({ error: "Not found" }, 404, cors);
  },
};
