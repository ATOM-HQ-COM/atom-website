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
const MAX_CONTACT_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTACT_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const ADMIN_SALT = "atom-admin-v1";
const DEFAULT_ADMIN_USERNAME_HASH = "666704633a6053e5fad50c78136a2f269cb23a205f1d67d7f10194dc93404e71";
const DEFAULT_ADMIN_PASSWORD_HASH = "427fe267db5d93e66245c2659c5525268ea7b2cde55db74c4734f3de760855cf";
const DEFAULT_SESSION_SECRET = "6d8c9955f1f524aa92fcbf6ff0c8d906d70f6d8e4b0c3a90b621e85c5bbce4f9";
const STATUS_ADMIN_SALT = "atom-status-admin-v1";
const DEFAULT_STATUS_ADMIN_USERNAME_HASH = "1da33e82a64de4c1c50b8661238411dcd82ebdef3633630836caf606c5b944f9";
const DEFAULT_STATUS_ADMIN_PASSWORD_HASH = "f4cca373467b4c29bd0a442222c29228f8370b299d76b4bad7b4017a3ebf4554";
const DEFAULT_STATUS_SESSION_SECRET = "7da6f18b6acbe66581d4d2fe0b6f0c6680ff030bdf7cb695afc5d245588e0e6d";
const STATUS_LEVELS = new Set([1, 2, 3, 4, 5]);
const STATUS_PHASES = new Set(["investigating", "identified", "monitoring", "resolved"]);
const STATUS_BUCKET_MS = 5 * 60 * 1000;
const STATUS_24H_MS = 24 * 60 * 60 * 1000;
const STATUS_HISTORY_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;

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

async function statusCredentialsOk(env, username, password) {
  const userHash = env.STATUS_ADMIN_USERNAME_HASH || DEFAULT_STATUS_ADMIN_USERNAME_HASH;
  const passHash = env.STATUS_ADMIN_PASSWORD_HASH || DEFAULT_STATUS_ADMIN_PASSWORD_HASH;
  const gotUser = await sha256Hex(`${STATUS_ADMIN_SALT}:${username || ""}`);
  const gotPass = await sha256Hex(`${STATUS_ADMIN_SALT}:${password || ""}`);
  return safeEqual(gotUser, userHash) && safeEqual(gotPass, passHash);
}

function sessionSecret(env) {
  return env.ADMIN_SESSION_SECRET || DEFAULT_SESSION_SECRET;
}

function statusSessionSecret(env) {
  return env.STATUS_ADMIN_SESSION_SECRET || DEFAULT_STATUS_SESSION_SECRET;
}

async function makeSignedSession(secret, maxAgeSeconds = 60 * 60 * 12) {
  const payload = base64Url(textBytes(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
    nonce: crypto.randomUUID(),
  })));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

async function makeSession(env) {
  return makeSignedSession(sessionSecret(env));
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function tokenOkWithSecret(secret, token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = await hmac(secret, payload);
  if (!safeEqual(sig, expected)) return false;
  let parsed;
  try { parsed = JSON.parse(decodeBase64Url(payload)); }
  catch { return false; }
  return parsed && Number(parsed.exp) > Math.floor(Date.now() / 1000);
}

async function sessionOk(env, token) {
  return tokenOkWithSecret(sessionSecret(env), token);
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

function statusAuthToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return cookieValue(request, "atom_status_admin");
}

function syncKeyOk(request, env) {
  const expected = String(env.ATOM_SYNC_KEY || "").trim();
  const got = String(request.headers.get("x-atom-sync-key") || "").trim();
  return !!expected && safeEqual(got, expected);
}

function adminControlKey(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(request.headers.get("x-atom-admin-token") || "").trim();
}

function adminControlOk(request, env) {
  const expected = String(env.ATOM_AUTH_ADMIN_TOKEN || "").trim();
  const got = adminControlKey(request);
  return !!expected && !!got && safeEqual(expected, got);
}

function wholeNumber(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function wholeInteger(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? number : fallback;
}

function trimmed(value, max = 0) {
  const out = String(value || "").trim();
  return max > 0 ? out.slice(0, max) : out;
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

const POLL_COLOR_FALLBACKS = ["#1e3f6e", "#b5761f", "#2f855a", "#8b3a62", "#5b5fc7", "#c2410c"];

function normalizePollColor(value, index = 0) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  return POLL_COLOR_FALLBACKS[index % POLL_COLOR_FALLBACKS.length];
}

function parsePollOptions(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => ({
      id: trimmed(item && item.id, 80) || crypto.randomUUID(),
      label: trimmed(item && (item.label || item.name || item.text), 160) || `Option ${index + 1}`,
      color: normalizePollColor(item && item.color, index),
    })).filter((item) => item.label).slice(0, 12);
  } catch {
    return [];
  }
}

function normalizePollOptions(input) {
  const options = parsePollOptions(input)
    .map((item, index) => ({
      id: item.id,
      label: item.label,
      color: normalizePollColor(item.color, index),
    }))
    .filter((item) => item.label)
    .slice(0, 12);
  if (options.length < 2) {
    throw new Error("Create at least two poll options.");
  }
  return options;
}

function emailProblem(email) {
  if (!email) return "";
  if (email.length > 320) return "Email is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return "";
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

async function requireAdmin(request, env) {
  return sessionOk(env, authToken(request));
}

async function requireStatusAdmin(request, env) {
  return tokenOkWithSecret(statusSessionSecret(env), statusAuthToken(request));
}

function authGatewayBase(env) {
  return String(env.ATOM_AUTH_BASE_URL || "https://auth.atom-hq.com").replace(/\/$/, "");
}

async function proxyAuthGateway(request, env, cors, path, options = {}) {
  const method = options.method || request.method;
  const headers = new Headers(options.headers || {});
  const requestContentType = request.headers.get("content-type");
  if (requestContentType && !headers.has("Content-Type") && method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", requestContentType);
  }
  if (options.admin) {
    if (!env.ATOM_AUTH_ADMIN_TOKEN) {
      return jsonResponse({ error: "ATOM_AUTH_ADMIN_TOKEN secret not set on this Worker" }, 500, cors);
    }
    headers.set("x-atom-admin-token", env.ATOM_AUTH_ADMIN_TOKEN);
  }

  let body = options.body;
  if (body === undefined && method !== "GET" && method !== "HEAD") {
    body = await request.text();
  }

  let upstream;
  try {
    upstream = await fetch(`${authGatewayBase(env)}${path}`, { method, headers, body });
  } catch (err) {
    return jsonResponse({ error: err.message || "Could not reach the auth gateway." }, 502, cors);
  }

  const responseHeaders = { ...cors };
  const contentType = upstream.headers.get("content-type");
  if (contentType) responseHeaders["Content-Type"] = contentType;
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) responseHeaders["Cache-Control"] = cacheControl;
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

async function proxyStoreGateway(request, env, cors, path, options = {}) {
  const method = options.method || request.method;
  const headers = new Headers(options.headers || {});
  const requestContentType = request.headers.get("content-type");
  if (requestContentType && !headers.has("Content-Type") && method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", requestContentType);
  }

  let body = options.body;
  if (body === undefined && method !== "GET" && method !== "HEAD") {
    body = await request.text();
  }

  const response = await storeJson(env, path, { method, headers, body });
  const text = await response.text();
  const responseHeaders = { ...cors };
  const contentType = response.headers.get("content-type");
  if (contentType) responseHeaders["Content-Type"] = contentType;
  const cacheControl = response.headers.get("cache-control");
  if (cacheControl) responseHeaders["Cache-Control"] = cacheControl;
  return new Response(text, { status: response.status, headers: responseHeaders });
}

async function aiAccessState(env) {
  // The AI kill-switch lives in the Durable Object, but chat itself does not
  // need the DO (the answer comes from the model provider). If the DO is
  // unreachable or over its daily limit, fail OPEN so chat keeps working
  // instead of taking the whole tutor down with it. The only cost is that the
  // "disable AI" toggle is not enforced while the DO is unavailable.
  try {
    const response = await storeJson(env, "/ai-access");
    if (!response.ok) return { ok: true, enabled: true };
    const out = await response.json().catch(() => ({}));
    return { ok: true, enabled: out.enabled !== false };
  } catch (err) {
    return { ok: true, enabled: true };
  }
}

async function requireAiEnabled(env, cors) {
  const state = await aiAccessState(env);
  if (!state.ok) {
    return jsonResponse({ error: state.error || "Could not load AI access state." }, 500, cors);
  }
  if (!state.enabled) {
    return jsonResponse({
      error: "AI messages are temporarily disabled.",
      code: "chat_disabled",
      message: "AI messages are temporarily disabled.",
    }, 503, cors);
  }
  return null;
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
  return proxyAuthGateway(request, env, cors, "/api/site/contact");
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

async function handleStatusLogin(request, env, cors) {
  const body = await readJson(request);
  const ok = await statusCredentialsOk(env, body && body.username, body && body.password);
  if (!ok) return jsonResponse({ error: "Invalid username or password" }, 401, cors);
  const token = await makeSignedSession(statusSessionSecret(env));
  return jsonResponse({ ok: true, token }, 200, {
    ...cors,
    "Set-Cookie": `atom_status_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=43200`,
  });
}

export class AtomDataV3 extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.schemaReady = false;
    this.inspectSchema();
  }

  inspectSchema() {
    const tables = new Set(this.sql.exec(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).toArray().map((row) => row.name));
    const contactColumns = tables.has("contacts")
      ? new Set(this.sql.exec("PRAGMA table_info(contacts);").toArray().map((row) => row.name))
      : new Set();
    const threadColumns = tables.has("contact_thread_messages")
      ? new Set(this.sql.exec("PRAGMA table_info(contact_thread_messages);").toArray().map((row) => row.name))
      : new Set();

    this.schemaReady = tables.has("counters")
      && tables.has("counter_overrides")
      && tables.has("contacts")
      && tables.has("contact_thread_messages")
      && tables.has("site_polls")
      && tables.has("site_poll_votes")
      && tables.has("status_reports")
      && tables.has("status_history")
      && tables.has("settings")
      && contactColumns.has("recipientToken")
      && contactColumns.has("reply")
      && contactColumns.has("messageAttachments")
      && contactColumns.has("replyAttachments")
      && contactColumns.has("repliedAt")
      && contactColumns.has("acknowledgedAt")
      && threadColumns.has("attachments");
  }

  ensureSchema() {
    if (this.schemaReady) return;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (
        name TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS counter_overrides (
        name TEXT PRIMARY KEY,
        offset INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS contacts_created_at_idx ON contacts(createdAt DESC);
      CREATE TABLE IF NOT EXISTS site_polls (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        optionsJson TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        closedAt INTEGER
      );
      CREATE INDEX IF NOT EXISTS site_polls_status_created_idx ON site_polls(status, createdAt DESC);
      CREATE TABLE IF NOT EXISTS site_poll_votes (
        id TEXT PRIMARY KEY,
        pollId TEXT NOT NULL,
        optionId TEXT NOT NULL,
        voterKey TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        UNIQUE(pollId, voterKey)
      );
      CREATE INDEX IF NOT EXISTS site_poll_votes_poll_idx ON site_poll_votes(pollId);
      CREATE TABLE IF NOT EXISTS status_reports (
        id TEXT PRIMARY KEY,
        statusLevel INTEGER NOT NULL,
        phase TEXT,
        message TEXT NOT NULL,
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS status_reports_created_idx ON status_reports(createdAt DESC);
      CREATE TABLE IF NOT EXISTS status_history (
        bucketTs INTEGER PRIMARY KEY,
        statusLevel INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.ensureContactColumns();
    this.cleanupRemovedCommunityData();
    this.ensureStatusSeed();
    this.inspectSchema();
  }

  fetch(request) {
    this.ensureSchema();
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/page-view") return this.increment("pageViews");
    if (request.method === "POST" && url.pathname === "/chat-message") return this.increment("chatMessages");
    if (request.method === "POST" && url.pathname === "/contact") return this.addContact(request);
    if (request.method === "POST" && url.pathname === "/reply") return this.replyToContact(request);
    if (request.method === "POST" && url.pathname === "/delete-contact") return this.deleteContact(request);
    if (request.method === "POST" && url.pathname === "/replies/check") return this.checkReplies(request);
    if (request.method === "POST" && url.pathname === "/replies/ack") return this.ackReply(request);
    if (request.method === "POST" && url.pathname === "/replies/respond") return this.respondToContact(request);
    if (request.method === "GET" && url.pathname === "/polls/active") return this.activePoll(url);
    if (request.method === "POST" && url.pathname === "/polls/vote") return this.voteInPoll(request);
    if (request.method === "POST" && url.pathname === "/polls/save") return this.savePoll(request);
    if (request.method === "POST" && url.pathname === "/polls/close") return this.closePoll(request);
    if (request.method === "POST" && url.pathname === "/polls/vote-control") return this.controlPollVotes(request);
    if (request.method === "GET" && url.pathname === "/status/public") {
      return jsonResponse(this.statusSnapshot({ includeOlderReports: url.searchParams.get("full") === "1" }));
    }
    if (request.method === "GET" && url.pathname === "/status/manage") return jsonResponse(this.statusSnapshot({ includeOlderReports: true }));
    if (request.method === "POST" && url.pathname === "/status/state") return this.saveStatusState(request);
    if (request.method === "POST" && url.pathname === "/status/report") return this.addStatusReport(request);
    if (url.pathname === "/ai-access") {
      if (request.method === "GET") return jsonResponse(this.aiAccessStatus());
      if (request.method === "POST") return this.setAiAccess(request);
    }
    if (url.pathname.startsWith("/community")) return removedCommunityResponse();
    if (request.method === "GET" && url.pathname === "/data") return jsonResponse(this.snapshot());
    if (request.method === "POST" && url.pathname === "/data") return this.replaceData(request);
    if (request.method === "POST" && url.pathname === "/full-sync") return this.replaceFullData(request);
    return jsonResponse({ error: "Not found" }, 404);
  }

  ensureContactColumns() {
    const existing = new Set(this.sql.exec("PRAGMA table_info(contacts);").toArray().map((row) => row.name));
    [
      ["recipientToken", "TEXT"],
      ["reply", "TEXT"],
      ["messageAttachments", "TEXT"],
      ["replyAttachments", "TEXT"],
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
    const threadColumns = new Set(this.sql.exec("PRAGMA table_info(contact_thread_messages);").toArray().map((row) => row.name));
    if (!threadColumns.has("attachments")) this.sql.exec("ALTER TABLE contact_thread_messages ADD COLUMN attachments TEXT;");
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
    this.sql.exec(`
      INSERT INTO counters (name, value)
      VALUES (?, 1)
      ON CONFLICT(name) DO UPDATE SET value = value + 1;
    `, name);
    const actualValue = this.counterValue(name);
    const displayValue = this.displayCounter(name, actualValue);
    return jsonResponse({ ok: true, value: displayValue, actualValue, displayValue });
  }

  counterValue(name) {
    const row = this.sql.exec("SELECT value FROM counters WHERE name = ?;", name).toArray()[0];
    return wholeNumber(row && row.value);
  }

  counterOffset(name) {
    const row = this.sql.exec("SELECT offset FROM counter_overrides WHERE name = ?;", name).toArray()[0];
    return wholeInteger(row && row.offset);
  }

  displayCounter(name, actualValue = this.counterValue(name)) {
    return Math.max(0, wholeNumber(actualValue) + this.counterOffset(name));
  }

  settingValue(name) {
    const row = this.sql.exec("SELECT value FROM settings WHERE name = ?;", name).toArray()[0];
    return row ? String(row.value || "") : "";
  }

  aiAccessStatus() {
    return { enabled: this.settingValue("aiEnabled") !== "0" };
  }

  async setAiAccess(request) {
    const body = await readJson(request);
    const enabled = !(body && body.enabled === false);
    this.sql.exec(
      "INSERT INTO settings (name, value) VALUES ('aiEnabled', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value;",
      enabled ? "1" : "0",
    );
    return jsonResponse({ ok: true, ...this.aiAccessStatus() });
  }

  ensureStatusSeed() {
    const raw = this.settingValue("siteStatusState");
    if (!raw) {
      const now = Date.now();
      const state = this.defaultStatusState(now);
      this.persistStatusState(state);
      this.sql.exec(
        "INSERT OR IGNORE INTO status_history (bucketTs, statusLevel) VALUES (?, ?);",
        this.statusBucket(now),
        state.level,
      );
    }
    this.pruneStatusHistory();
  }

  defaultStatusState(now = Date.now()) {
    return {
      level: 1,
      phase: "",
      maintenanceMode: false,
      etaAt: null,
      updatedAt: now,
    };
  }

  statusBucket(value = Date.now()) {
    return Math.floor(Number(value || Date.now()) / STATUS_BUCKET_MS) * STATUS_BUCKET_MS;
  }

  normalizeStatusLevel(value, fallback = 1) {
    const level = wholeInteger(value, fallback);
    return STATUS_LEVELS.has(level) ? level : fallback;
  }

  normalizeStatusPhase(level, value) {
    if (level <= 1) return "";
    const phase = trimmed(value, 32).toLowerCase();
    return STATUS_PHASES.has(phase) ? phase : "investigating";
  }

  normalizeEta(value) {
    if (value == null || value === "") return null;
    const etaAt = Math.floor(Number(value));
    return Number.isFinite(etaAt) && etaAt > 0 ? etaAt : null;
  }

  statusState() {
    const raw = this.settingValue("siteStatusState");
    if (!raw) return this.defaultStatusState();
    try {
      const parsed = JSON.parse(raw);
      return {
        level: this.normalizeStatusLevel(parsed && parsed.level, 1),
        phase: this.normalizeStatusPhase(this.normalizeStatusLevel(parsed && parsed.level, 1), parsed && parsed.phase),
        maintenanceMode: !!(parsed && parsed.maintenanceMode),
        etaAt: this.normalizeEta(parsed && parsed.etaAt),
        updatedAt: wholeInteger(parsed && parsed.updatedAt, Date.now()),
      };
    } catch {
      const state = this.defaultStatusState();
      this.persistStatusState(state);
      return state;
    }
  }

  persistStatusState(state) {
    this.sql.exec(
      "INSERT INTO settings (name, value) VALUES ('siteStatusState', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value;",
      JSON.stringify(state),
    );
  }

  pruneStatusHistory(now = Date.now()) {
    this.sql.exec("DELETE FROM status_history WHERE bucketTs < ?;", this.statusBucket(now - STATUS_HISTORY_RETENTION_MS));
  }

  backfillStatusHistory(now = Date.now(), level = this.statusState().level) {
    const currentBucket = this.statusBucket(now);
    const latest = this.sql.exec(
      "SELECT bucketTs, statusLevel FROM status_history ORDER BY bucketTs DESC LIMIT 1;"
    ).toArray()[0];
    if (!latest) {
      this.sql.exec(
        "INSERT OR IGNORE INTO status_history (bucketTs, statusLevel) VALUES (?, ?);",
        currentBucket,
        this.normalizeStatusLevel(level, 1),
      );
      this.pruneStatusHistory(now);
      return;
    }
    for (let bucket = Number(latest.bucketTs || 0) + STATUS_BUCKET_MS; bucket <= currentBucket; bucket += STATUS_BUCKET_MS) {
      this.sql.exec(
        "INSERT OR IGNORE INTO status_history (bucketTs, statusLevel) VALUES (?, ?);",
        bucket,
        this.normalizeStatusLevel(level, 1),
      );
    }
    this.pruneStatusHistory(now);
  }

  statusHistory24h(now = Date.now()) {
    const state = this.statusState();
    this.backfillStatusHistory(now, state.level);
    const currentBucket = this.statusBucket(now);
    const firstBucket = currentBucket - (287 * STATUS_BUCKET_MS);
    const rows = this.sql.exec(
      "SELECT bucketTs, statusLevel FROM status_history WHERE bucketTs >= ? AND bucketTs <= ? ORDER BY bucketTs ASC;",
      firstBucket,
      currentBucket,
    ).toArray();
    const previous = this.sql.exec(
      "SELECT statusLevel FROM status_history WHERE bucketTs < ? ORDER BY bucketTs DESC LIMIT 1;",
      firstBucket,
    ).toArray()[0];
    const rowMap = new Map(rows.map((row) => [Number(row.bucketTs), this.normalizeStatusLevel(row.statusLevel, state.level)]));
    let carry = this.normalizeStatusLevel(previous && previous.statusLevel, state.level);
    const out = [];
    for (let bucket = firstBucket; bucket <= currentBucket; bucket += STATUS_BUCKET_MS) {
      if (rowMap.has(bucket)) carry = rowMap.get(bucket);
      out.push({ bucketTs: bucket, statusLevel: carry });
    }
    return out;
  }

  statusReportsSince(sinceTs, limit = 500) {
    return this.sql.exec(
      "SELECT id, statusLevel, phase, message, createdAt FROM status_reports WHERE createdAt >= ? ORDER BY createdAt DESC LIMIT ?;",
      Math.floor(Number(sinceTs || 0)),
      wholeInteger(limit, 500),
    ).toArray().map((row) => ({
      id: row.id,
      statusLevel: this.normalizeStatusLevel(row.statusLevel, 1),
      phase: trimmed(row.phase, 32).toLowerCase(),
      message: row.message,
      createdAt: Number(row.createdAt || 0),
    }));
  }

  olderStatusReports(beforeTs, limit = 500) {
    return this.sql.exec(
      "SELECT id, statusLevel, phase, message, createdAt FROM status_reports WHERE createdAt < ? ORDER BY createdAt DESC LIMIT ?;",
      Math.floor(Number(beforeTs || Date.now())),
      wholeInteger(limit, 500),
    ).toArray().map((row) => ({
      id: row.id,
      statusLevel: this.normalizeStatusLevel(row.statusLevel, 1),
      phase: trimmed(row.phase, 32).toLowerCase(),
      message: row.message,
      createdAt: Number(row.createdAt || 0),
    }));
  }

  statusSnapshot(options = {}) {
    const now = Date.now();
    const state = this.statusState();
    const since = now - STATUS_24H_MS;
    return {
      status: state,
      history: this.statusHistory24h(now),
      reports24h: this.statusReportsSince(since),
      olderReports: options.includeOlderReports ? this.olderStatusReports(since) : [],
      serverTime: now,
    };
  }

  async saveStatusState(request) {
    const body = await readJson(request);
    const current = this.statusState();
    const now = Date.now();
    this.backfillStatusHistory(now, current.level);
    const level = this.normalizeStatusLevel(body && body.level, current.level);
    const state = {
      level,
      phase: this.normalizeStatusPhase(level, body && body.phase),
      maintenanceMode: !!(body && body.maintenanceMode),
      etaAt: this.normalizeEta(body && body.etaAt),
      updatedAt: now,
    };
    this.persistStatusState(state);
    this.sql.exec(
      "INSERT INTO status_history (bucketTs, statusLevel) VALUES (?, ?) ON CONFLICT(bucketTs) DO UPDATE SET statusLevel = excluded.statusLevel;",
      this.statusBucket(now),
      state.level,
    );
    return jsonResponse({ ok: true, data: this.statusSnapshot({ includeOlderReports: true }) });
  }

  async addStatusReport(request) {
    const body = await readJson(request);
    const message = String(body && body.message || "").trim().slice(0, 4000);
    if (!message) return jsonResponse({ error: "A status report message is required." }, 400);
    const state = this.statusState();
    const createdAt = Date.now();
    this.sql.exec(
      "INSERT INTO status_reports (id, statusLevel, phase, message, createdAt) VALUES (?, ?, ?, ?, ?);",
      crypto.randomUUID(),
      state.level,
      state.phase || null,
      message,
      createdAt,
    );
    return jsonResponse({ ok: true, data: this.statusSnapshot({ includeOlderReports: true }) });
  }

  setCounterDisplay(name, displayValue) {
    const actualValue = this.counterValue(name);
    const offset = wholeNumber(displayValue) - actualValue;
    this.sql.exec(`
      INSERT INTO counter_overrides (name, offset)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET offset = excluded.offset;
    `, name, offset);
  }

  async addContact(request) {
    const body = await readJson(request);
    const attachments = normalizeAttachments(body && body.attachments);
    const anonymous = !!(body && body.anonymous);
    const name = anonymous ? "Anonymous" : trimmed(body && body.name, 200);
    const email = anonymous ? "" : trimmed(body && body.email, 320);
    const contact = {
      id: crypto.randomUUID(),
      recipientToken: crypto.randomUUID(),
      name,
      email,
      message: String(body && body.message || "").trim().slice(0, 5000),
      createdAt: Date.now(),
    };
    if (!hasMessageContent(contact.message, attachments)) {
      return jsonResponse({ error: "Write a message or attach at least one image." }, 400);
    }
    if (!anonymous && !contact.name) {
      return jsonResponse({ error: "Name is required unless you submit anonymously." }, 400);
    }
    const invalidEmail = emailProblem(contact.email);
    if (invalidEmail) return jsonResponse({ error: invalidEmail }, 400);
    this.sql.exec(
      "INSERT INTO contacts (id, recipientToken, name, email, message, messageAttachments, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
      contact.id,
      contact.recipientToken,
      contact.name,
      contact.email,
      contact.message,
      serializeAttachments(attachments),
      contact.createdAt,
    );
    this.sql.exec(
      "INSERT INTO contact_thread_messages (id, contactId, sender, message, attachments, createdAt) VALUES (?, ?, 'user', ?, ?, ?);",
      crypto.randomUUID(),
      contact.id,
      contact.message,
      serializeAttachments(attachments),
      contact.createdAt,
    );
    return jsonResponse({ ok: true, contact: { id: contact.id, recipientToken: contact.recipientToken } });
  }

  snapshot() {
    const contacts = this.sql.exec(`
      SELECT
        id,
        recipientToken,
        name,
        email,
        message,
        messageAttachments,
        createdAt,
        reply,
        replyAttachments,
        repliedAt,
        acknowledgedAt
      FROM contacts
      ORDER BY createdAt DESC;
    `).toArray().map((row) => this.contactRecord(row));
    return {
      pageViews: this.displayCounter("pageViews"),
      chatMessages: this.displayCounter("chatMessages"),
      gameUsers: this.displayCounter("gameUsers"),
      gameMinutes: this.displayCounter("gameMinutes"),
      socratesUsers: this.displayCounter("socratesUsers"),
      socratesMinutes: this.displayCounter("socratesMinutes"),
      keplerUsers: this.displayCounter("keplerUsers"),
      keplerMinutes: this.displayCounter("keplerMinutes"),
      contacts,
      activePoll: this.pollRecord(this.activePollRow(), { includeResults: true }),
      polls: this.listPollRows().map((poll) => this.pollRecord(poll, { includeResults: true })),
    };
  }

  contactRecord(row) {
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
      thread: this.contactThread(row.id),
    };
  }

  contactThread(contactId) {
    const id = String(contactId || "").slice(0, 80);
    if (!id) return [];
    const rows = this.sql.exec(
      "SELECT id, sender, message, attachments, createdAt FROM contact_thread_messages WHERE contactId = ? ORDER BY createdAt ASC LIMIT 120;",
      id,
    ).toArray().map((row) => ({
      id: row.id,
      sender: row.sender,
      message: row.message,
      attachments: parseAttachments(row.attachments),
      createdAt: Number(row.createdAt || 0),
    }));
    if (rows.length) return rows;
    const contact = this.sql.exec(
      "SELECT id, message, messageAttachments, createdAt, reply, replyAttachments, repliedAt FROM contacts WHERE id = ?;",
      id,
    ).toArray()[0];
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

  async replyToContact(request) {
    const body = await readJson(request);
    const id = String(body && body.id || "").slice(0, 80);
    const reply = String(body && body.reply || "").trim().slice(0, 5000);
    const attachments = normalizeAttachments(body && body.attachments);
    if (!id || !hasMessageContent(reply, attachments)) {
      return jsonResponse({ error: "Write a reply or attach at least one image." }, 400);
    }
    const existing = this.sql.exec("SELECT id FROM contacts WHERE id = ?;", id).toArray()[0];
    if (!existing) return jsonResponse({ error: "Contact not found" }, 404);
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO contact_thread_messages (id, contactId, sender, message, attachments, createdAt) VALUES (?, ?, 'admin', ?, ?, ?);",
      crypto.randomUUID(),
      id,
      reply,
      serializeAttachments(attachments),
      now,
    );
    this.sql.exec(
      "UPDATE contacts SET reply = ?, replyAttachments = ?, repliedAt = ?, acknowledgedAt = NULL WHERE id = ?;",
      reply || null,
      serializeAttachments(attachments),
      now,
      id,
    );
    const contact = this.sql.exec("SELECT id, name, message, messageAttachments, createdAt, reply, replyAttachments, repliedAt, acknowledgedAt FROM contacts WHERE id = ?;", id).toArray()[0];
    return jsonResponse({
      ok: true,
      contact: {
        ...contact,
        messageAttachments: parseAttachments(contact.messageAttachments),
        replyAttachments: parseAttachments(contact.replyAttachments),
        thread: this.contactThread(id),
      },
    });
  }

  async deleteContact(request) {
    const body = await readJson(request);
    const id = String(body && body.id || "").slice(0, 80);
    if (!id) return jsonResponse({ error: "Contact is required" }, 400);
    const existing = this.sql.exec("SELECT id FROM contacts WHERE id = ?;", id).toArray()[0];
    if (!existing) return jsonResponse({ error: "Contact not found" }, 404);
    this.sql.exec("DELETE FROM contact_thread_messages WHERE contactId = ?;", id);
    this.sql.exec("DELETE FROM contacts WHERE id = ?;", id);
    return jsonResponse({ ok: true, deletedId: id });
  }

  async checkReplies(request) {
    const body = await readJson(request);
    const tokens = Array.isArray(body && body.tokens) ? body.tokens.map((token) => String(token || "").slice(0, 80)).filter(Boolean).slice(0, 50) : [];
    if (tokens.length === 0) return jsonResponse({ replies: [] });
    const replies = [];
    tokens.forEach((token) => {
      this.sql.exec(
        "SELECT id, recipientToken, reply, replyAttachments, repliedAt FROM contacts WHERE recipientToken = ? AND ((reply IS NOT NULL AND reply != '') OR replyAttachments IS NOT NULL) AND acknowledgedAt IS NULL ORDER BY repliedAt DESC;",
        token,
      ).toArray().forEach((row) => replies.push({
        ...row,
        replyAttachments: parseAttachments(row.replyAttachments),
        thread: this.contactThread(row.id),
      }));
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
    const attachments = normalizeAttachments(body && body.attachments);
    if (!id || !token || !hasMessageContent(message, attachments)) {
      return jsonResponse({ error: "Write a reply or attach at least one image." }, 400);
    }
    const contact = this.sql.exec(
      "SELECT id FROM contacts WHERE id = ? AND recipientToken = ?;",
      id,
      token,
    ).toArray()[0];
    if (!contact) return jsonResponse({ error: "Contact thread not found" }, 404);
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO contact_thread_messages (id, contactId, sender, message, attachments, createdAt) VALUES (?, ?, 'user', ?, ?, ?);",
      crypto.randomUUID(),
      id,
      message,
      serializeAttachments(attachments),
      now,
    );
    this.sql.exec("UPDATE contacts SET acknowledgedAt = ? WHERE id = ? AND recipientToken = ?;", now, id, token);
    return jsonResponse({ ok: true, thread: this.contactThread(id) });
  }

  listPollRows() {
    return this.sql.exec(`
      SELECT id, name, description, optionsJson, status, createdAt, closedAt
      FROM site_polls
      ORDER BY createdAt DESC
      LIMIT 30;
    `).toArray();
  }

  activePollRow() {
    return this.sql.exec(`
      SELECT id, name, description, optionsJson, status, createdAt, closedAt
      FROM site_polls
      WHERE status = 'active'
      ORDER BY createdAt DESC
      LIMIT 1;
    `).toArray()[0] || null;
  }

  pollById(pollId) {
    return this.sql.exec(`
      SELECT id, name, description, optionsJson, status, createdAt, closedAt
      FROM site_polls
      WHERE id = ?;
    `, pollId).toArray()[0] || null;
  }

  pollResults(pollId, options) {
    const counts = new Map(
      this.sql.exec(`
        SELECT optionId, COUNT(*) AS count
        FROM site_poll_votes
        WHERE pollId = ?
        GROUP BY optionId;
      `, pollId).toArray().map((row) => [row.optionId, wholeNumber(row.count)]),
    );
    const totalVotes = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const results = options.map((option) => {
      const votes = counts.get(option.id) || 0;
      return {
        optionId: option.id,
        votes,
        percent: totalVotes > 0 ? Math.round((votes / totalVotes) * 1000) / 10 : 0,
      };
    });
    return { totalVotes, results };
  }

  pollRecord(row, options = {}) {
    if (!row) return null;
    const pollOptions = parsePollOptions(row.optionsJson);
    const out = {
      id: row.id,
      name: row.name,
      description: row.description,
      options: pollOptions,
      status: row.status,
      createdAt: Number(row.createdAt || 0),
      closedAt: row.closedAt ? Number(row.closedAt) : null,
      hasVoted: false,
    };
    const voterKey = trimmed(options.voterKey, 160);
    if (voterKey) {
      const vote = this.sql.exec(
        "SELECT id, optionId FROM site_poll_votes WHERE pollId = ? AND voterKey = ?;",
        row.id,
        voterKey,
      ).toArray()[0];
      if (vote) {
        out.hasVoted = true;
        out.votedOptionId = vote.optionId;
      }
    }
    if (options.includeResults || out.hasVoted) {
      Object.assign(out, this.pollResults(row.id, pollOptions));
    }
    return out;
  }

  activePoll(url) {
    const voterKey = trimmed(url.searchParams.get("voterKey"), 160);
    return jsonResponse({ poll: this.pollRecord(this.activePollRow(), { voterKey }) });
  }

  async voteInPoll(request) {
    const body = await readJson(request);
    const pollId = trimmed(body && body.pollId, 80);
    const optionId = trimmed(body && body.optionId, 80);
    const voterKey = trimmed(body && body.voterKey, 160);
    if (!pollId || !optionId || !voterKey) {
      return jsonResponse({ error: "Poll, option, and voter are required." }, 400);
    }

    const row = this.pollById(pollId);
    if (!row || row.status !== "active") {
      return jsonResponse({ error: "This poll is not active." }, 404);
    }

    const options = parsePollOptions(row.optionsJson);
    if (!options.some((option) => option.id === optionId)) {
      return jsonResponse({ error: "Choose one of the poll options." }, 400);
    }

    const existing = this.sql.exec(
      "SELECT id, optionId FROM site_poll_votes WHERE pollId = ? AND voterKey = ?;",
      pollId,
      voterKey,
    ).toArray()[0];
    if (existing) {
      return jsonResponse({
        error: "You already voted in this poll.",
        alreadyVoted: true,
        poll: this.pollRecord(row, { voterKey, includeResults: true }),
      }, 409);
    }

    this.sql.exec(
      "INSERT INTO site_poll_votes (id, pollId, optionId, voterKey, createdAt) VALUES (?, ?, ?, ?, ?);",
      crypto.randomUUID(),
      pollId,
      optionId,
      voterKey,
      Date.now(),
    );
    return jsonResponse({ ok: true, poll: this.pollRecord(row, { voterKey, includeResults: true }) });
  }

  async savePoll(request) {
    const body = await readJson(request);
    const pollId = trimmed(body && body.id, 80);
    const name = trimmed(body && body.name, 180);
    const description = trimmed(body && body.description, 1200);
    let options;
    try {
      options = normalizePollOptions(body && body.options);
    } catch (err) {
      return jsonResponse({ error: err.message || "Poll options are invalid." }, 400);
    }
    if (!name) return jsonResponse({ error: "Poll name is required." }, 400);
    if (!description) return jsonResponse({ error: "Poll description is required." }, 400);

    const now = Date.now();
    const existing = pollId ? this.pollById(pollId) : null;
    this.sql.exec("UPDATE site_polls SET status = 'closed', closedAt = ? WHERE status = 'active';", now);
    if (existing) {
      this.sql.exec(
        "UPDATE site_polls SET name = ?, description = ?, optionsJson = ?, status = 'active', closedAt = NULL WHERE id = ?;",
        name,
        description,
        JSON.stringify(options),
        pollId,
      );
    } else {
      this.sql.exec(
        "INSERT INTO site_polls (id, name, description, optionsJson, status, createdAt, closedAt) VALUES (?, ?, ?, ?, 'active', ?, NULL);",
        crypto.randomUUID(),
        name,
        description,
        JSON.stringify(options),
        now,
      );
    }
    return jsonResponse({ ok: true, data: this.snapshot() });
  }

  async closePoll(request) {
    const body = await readJson(request);
    const pollId = trimmed(body && body.id, 80);
    const row = pollId ? this.pollById(pollId) : this.activePollRow();
    if (!row) return jsonResponse({ error: "Poll not found." }, 404);
    this.sql.exec("UPDATE site_polls SET status = 'closed', closedAt = ? WHERE id = ?;", Date.now(), row.id);
    return jsonResponse({ ok: true, data: this.snapshot() });
  }

  async controlPollVotes(request) {
    const body = await readJson(request);
    const pollId = trimmed(body && body.pollId, 80);
    const optionId = trimmed(body && body.optionId, 80);
    const action = trimmed(body && body.action, 32);
    if (!pollId || !optionId) {
      return jsonResponse({ error: "Poll and option are required." }, 400);
    }

    const row = this.pollById(pollId);
    if (!row || row.status !== "active") {
      return jsonResponse({ error: "Active poll not found." }, 404);
    }

    const options = parsePollOptions(row.optionsJson);
    if (!options.some((option) => option.id === optionId)) {
      return jsonResponse({ error: "Poll option not found." }, 400);
    }

    if (action === "reset") {
      this.sql.exec(
        "DELETE FROM site_poll_votes WHERE pollId = ? AND optionId = ? AND voterKey LIKE '__admin_test__:%';",
        pollId,
        optionId,
      );
    } else if (action === "increment") {
      this.sql.exec(
        "INSERT INTO site_poll_votes (id, pollId, optionId, voterKey, createdAt) VALUES (?, ?, ?, ?, ?);",
        crypto.randomUUID(),
        pollId,
        optionId,
        `__admin_test__:${optionId}:${crypto.randomUUID()}`,
        Date.now(),
      );
    } else {
      return jsonResponse({ error: "Unknown vote action." }, 400);
    }

    return jsonResponse({ ok: true, data: this.snapshot() });
  }

  async replaceData(request) {
    const body = await readJson(request);
    const pageViews = wholeNumber(body && body.pageViews);
    const chatMessages = wholeNumber(body && body.chatMessages);
    const gameUsers = wholeNumber(body && body.gameUsers);
    const gameMinutes = wholeNumber(body && body.gameMinutes);
    const socratesUsers = wholeNumber(body && body.socratesUsers);
    const socratesMinutes = wholeNumber(body && body.socratesMinutes);
    const keplerUsers = wholeNumber(body && body.keplerUsers);
    const keplerMinutes = wholeNumber(body && body.keplerMinutes);
    const contacts = Array.isArray(body && body.contacts) ? body.contacts.slice(0, 500) : [];
    this.setCounterDisplay("pageViews", pageViews);
    this.setCounterDisplay("chatMessages", chatMessages);
    this.setCounterDisplay("gameUsers", gameUsers);
    this.setCounterDisplay("gameMinutes", gameMinutes);
    this.setCounterDisplay("socratesUsers", socratesUsers);
    this.setCounterDisplay("socratesMinutes", socratesMinutes);
    this.setCounterDisplay("keplerUsers", keplerUsers);
    this.setCounterDisplay("keplerMinutes", keplerMinutes);
    const oldContacts = Object.fromEntries(
      this.sql.exec("SELECT id, email, recipientToken, messageAttachments, reply, replyAttachments, repliedAt, acknowledgedAt FROM contacts;").toArray().map((row) => [row.id, row]),
    );
    this.sql.exec("DELETE FROM contacts;");
    contacts.forEach((item) => {
      const id = String(item && item.id || crypto.randomUUID()).slice(0, 80);
      const old = oldContacts[id] || {};
      const name = String(item && item.name || "").slice(0, 200);
      const email = String(item && item.email || old.email || "").slice(0, 320);
      const recipientToken = String(item && item.recipientToken || old.recipientToken || crypto.randomUUID()).slice(0, 80);
      const message = String(item && item.message || "").slice(0, 5000);
      const messageAttachments = item && "messageAttachments" in item
        ? serializeAttachments(parseAttachments(item.messageAttachments || []))
        : (old.messageAttachments || null);
      const createdAt = Number.isFinite(Number(item && item.createdAt)) ? Number(item.createdAt) : Date.now();
      const reply = item && "reply" in item ? String(item.reply || "").slice(0, 5000) : old.reply || null;
      const replyAttachments = item && "replyAttachments" in item
        ? serializeAttachments(parseAttachments(item.replyAttachments || []))
        : (old.replyAttachments || null);
      const repliedAt = Number.isFinite(Number(item && item.repliedAt)) ? Number(item.repliedAt) : old.repliedAt || null;
      const acknowledgedAt = Number.isFinite(Number(item && item.acknowledgedAt)) ? Number(item.acknowledgedAt) : old.acknowledgedAt || null;
      if (!name && !email && !message && parseAttachments(messageAttachments).length === 0) return;
      this.sql.exec(
        "INSERT OR REPLACE INTO contacts (id, recipientToken, name, email, message, messageAttachments, createdAt, reply, replyAttachments, repliedAt, acknowledgedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        id,
        recipientToken,
        name,
        email,
        message,
        messageAttachments,
        Math.floor(createdAt),
        reply,
        replyAttachments,
        repliedAt ? Math.floor(Number(repliedAt)) : null,
        acknowledgedAt ? Math.floor(Number(acknowledgedAt)) : null,
      );
      const firstThread = this.sql.exec(
        "SELECT id FROM contact_thread_messages WHERE contactId = ? ORDER BY createdAt ASC LIMIT 1;",
        id,
      ).toArray()[0];
      if (firstThread) {
        this.sql.exec(
          "UPDATE contact_thread_messages SET message = ?, attachments = ?, createdAt = ? WHERE id = ?;",
          message,
          messageAttachments,
          Math.floor(createdAt),
          firstThread.id,
        );
      } else {
        this.sql.exec(
          "INSERT INTO contact_thread_messages (id, contactId, sender, message, attachments, createdAt) VALUES (?, ?, 'user', ?, ?, ?);",
          crypto.randomUUID(),
          id,
          message,
          messageAttachments,
          Math.floor(createdAt),
        );
      }
    });
    this.sql.exec("DELETE FROM contact_thread_messages WHERE contactId NOT IN (SELECT id FROM contacts);");
    return jsonResponse({ ok: true, data: this.snapshot() });
  }

  async replaceFullData(request) {
    const body = await readJson(request);
    const counters = body && typeof body.counters === "object" ? body.counters : {};
    const contacts = Array.isArray(body && body.contacts) ? body.contacts.slice(0, 1000) : [];
    const threads = Array.isArray(body && body.threads) ? body.threads.slice(0, 5000) : [];
    const polls = Array.isArray(body && body.polls) ? body.polls.slice(0, 100) : [];
    const pollVotes = Array.isArray(body && body.pollVotes) ? body.pollVotes.slice(0, 20000) : [];

    [
      "pageViews",
      "chatMessages",
      "gameUsers",
      "gameMinutes",
      "socratesUsers",
      "socratesMinutes",
      "keplerUsers",
      "keplerMinutes",
    ].forEach((name) => {
      this.setCounterDisplay(name, wholeNumber(counters[name]));
    });

    this.sql.exec("DELETE FROM contact_thread_messages;");
    this.sql.exec("DELETE FROM contacts;");
    this.sql.exec("DELETE FROM site_poll_votes;");
    this.sql.exec("DELETE FROM site_polls;");

    contacts.forEach((item) => {
      const id = trimmed(item && item.id, 80) || crypto.randomUUID();
      const recipientToken = trimmed(item && item.recipientToken, 80) || crypto.randomUUID();
      const name = trimmed(item && item.name, 200);
      const email = trimmed(item && item.email, 320);
      const message = trimmed(item && item.message, 5000);
      const messageAttachments = serializeAttachments(parseAttachments(item && item.messageAttachments));
      const createdAt = Number.isFinite(Number(item && item.createdAt)) ? Math.floor(Number(item.createdAt)) : Date.now();
      const reply = item && "reply" in item ? trimmed(item.reply, 5000) : null;
      const replyAttachments = serializeAttachments(parseAttachments(item && item.replyAttachments));
      const repliedAt = Number.isFinite(Number(item && item.repliedAt)) ? Math.floor(Number(item.repliedAt)) : null;
      const acknowledgedAt = Number.isFinite(Number(item && item.acknowledgedAt)) ? Math.floor(Number(item.acknowledgedAt)) : null;
      if (!name && !email && !message && parseAttachments(messageAttachments).length === 0) return;
      this.sql.exec(
        "INSERT INTO contacts (id, recipientToken, name, email, message, messageAttachments, createdAt, reply, replyAttachments, repliedAt, acknowledgedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
        id,
        recipientToken,
        name,
        email,
        message,
        messageAttachments,
        createdAt,
        reply,
        replyAttachments,
        repliedAt,
        acknowledgedAt,
      );
    });

    threads.forEach((item) => {
      const id = trimmed(item && item.id, 80) || crypto.randomUUID();
      const contactId = trimmed(item && item.contactId, 80);
      const sender = trimmed(item && item.sender, 16) || "user";
      const message = trimmed(item && item.message, 5000);
      const attachments = serializeAttachments(parseAttachments(item && item.attachments));
      const createdAt = Number.isFinite(Number(item && item.createdAt)) ? Math.floor(Number(item.createdAt)) : Date.now();
      if (!contactId) return;
      this.sql.exec(
        "INSERT INTO contact_thread_messages (id, contactId, sender, message, attachments, createdAt) VALUES (?, ?, ?, ?, ?, ?);",
        id,
        contactId,
        sender,
        message,
        attachments,
        createdAt,
      );
    });

    polls.forEach((item) => {
      const id = trimmed(item && item.id, 80) || crypto.randomUUID();
      const name = trimmed(item && item.name, 180);
      const description = trimmed(item && item.description, 1200);
      const optionsJson = JSON.stringify(parsePollOptions(item && item.options));
      const status = trimmed(item && item.status, 16) || "closed";
      const createdAt = Number.isFinite(Number(item && item.createdAt)) ? Math.floor(Number(item.createdAt)) : Date.now();
      const closedAt = Number.isFinite(Number(item && item.closedAt)) ? Math.floor(Number(item.closedAt)) : null;
      if (!name || !description) return;
      this.sql.exec(
        "INSERT INTO site_polls (id, name, description, optionsJson, status, createdAt, closedAt) VALUES (?, ?, ?, ?, ?, ?, ?);",
        id,
        name,
        description,
        optionsJson,
        status,
        createdAt,
        closedAt,
      );
    });

    pollVotes.forEach((item) => {
      const id = trimmed(item && item.id, 80) || crypto.randomUUID();
      const pollId = trimmed(item && item.pollId, 80);
      const optionId = trimmed(item && item.optionId, 80);
      const voterKey = trimmed(item && item.voterKey, 160);
      const createdAt = Number.isFinite(Number(item && item.createdAt)) ? Math.floor(Number(item.createdAt)) : Date.now();
      if (!pollId || !optionId || !voterKey) return;
      this.sql.exec(
        "INSERT OR IGNORE INTO site_poll_votes (id, pollId, optionId, voterKey, createdAt) VALUES (?, ?, ?, ?, ?);",
        id,
        pollId,
        optionId,
        voterKey,
        createdAt,
      );
    });

    this.sql.exec("DELETE FROM contact_thread_messages WHERE contactId NOT IN (SELECT id FROM contacts);");
    return jsonResponse({
      ok: true,
      counts: {
        contacts: this.sql.exec("SELECT COUNT(*) AS count FROM contacts;").toArray()[0]?.count || 0,
        threads: this.sql.exec("SELECT COUNT(*) AS count FROM contact_thread_messages;").toArray()[0]?.count || 0,
        polls: this.sql.exec("SELECT COUNT(*) AS count FROM site_polls;").toArray()[0]?.count || 0,
        pollVotes: this.sql.exec("SELECT COUNT(*) AS count FROM site_poll_votes;").toArray()[0]?.count || 0,
      },
      data: this.snapshot(),
    });
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
      const blocked = await requireAiEnabled(env, cors);
      if (blocked) return blocked;
      return handleChat(request, env, cors, origin);
    }

    // Socrates voice routes.
    if (request.method === "POST" && url.pathname === "/api/stt") {
      const blocked = await requireAiEnabled(env, cors);
      if (blocked) return blocked;
      return handleStt(request, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/api/tts") {
      const blocked = await requireAiEnabled(env, cors);
      if (blocked) return blocked;
      return handleTts(request, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/api/events/page-view") {
      return proxyStoreGateway(request, env, cors, "/page-view");
    }

    if (request.method === "POST" && url.pathname === "/api/events/chat-message") {
      return proxyStoreGateway(request, env, cors, "/chat-message");
    }

    if (request.method === "POST" && url.pathname === "/api/contact") {
      return proxyStoreGateway(request, env, cors, "/contact");
    }

    if (request.method === "POST" && url.pathname === "/api/replies/check") {
      return proxyStoreGateway(request, env, cors, "/replies/check");
    }

    if (request.method === "POST" && url.pathname === "/api/replies/ack") {
      return proxyStoreGateway(request, env, cors, "/replies/ack");
    }

    if (request.method === "POST" && url.pathname === "/api/replies/respond") {
      return proxyStoreGateway(request, env, cors, "/replies/respond");
    }

    if (request.method === "GET" && url.pathname === "/api/polls/active") {
      return proxyStoreGateway(request, env, cors, `/polls/active${url.search}`);
    }

    if (request.method === "POST" && url.pathname === "/api/polls/vote") {
      return proxyStoreGateway(request, env, cors, "/polls/vote");
    }

    if (request.method === "GET" && url.pathname === "/api/status/public") {
      return proxyStoreGateway(request, env, cors, `/status/public${url.search}`);
    }

    if (request.method === "POST" && url.pathname === "/api/status-manage/login") {
      return handleStatusLogin(request, env, cors);
    }

    if (request.method === "POST" && url.pathname === "/api/status-manage/logout") {
      return jsonResponse({ ok: true }, 200, {
        ...cors,
        "Set-Cookie": "atom_status_admin=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0",
      });
    }

    if (url.pathname === "/api/status-manage/data") {
      if (!(await requireStatusAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      if (request.method === "GET") return proxyStoreGateway(request, env, cors, "/status/manage");
    }

    if (request.method === "POST" && url.pathname === "/api/status-manage/state") {
      if (!(await requireStatusAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/status/state");
    }

    if (request.method === "POST" && url.pathname === "/api/status-manage/report") {
      if (!(await requireStatusAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/status/report");
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
      if (request.method === "GET") return proxyStoreGateway(request, env, cors, "/data");
      if (request.method === "POST") return proxyStoreGateway(request, env, cors, "/data");
    }

    if (request.method === "POST" && url.pathname === "/api/admin/reply") {
      if (!(await requireAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/reply");
    }

    if (request.method === "POST" && url.pathname === "/api/admin/delete-contact") {
      if (!(await requireAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/delete-contact");
    }

    if (request.method === "POST" && url.pathname === "/api/admin/polls/save") {
      if (!(await requireAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/polls/save");
    }

    if (request.method === "POST" && url.pathname === "/api/admin/polls/close") {
      if (!(await requireAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/polls/close");
    }

    if (request.method === "POST" && url.pathname === "/api/admin/polls/vote-control") {
      if (!(await requireAdmin(request, env))) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/polls/vote-control");
    }

    if (request.method === "POST" && url.pathname === "/api/internal/sync-site-data") {
      if (!syncKeyOk(request, env)) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      return proxyStoreGateway(request, env, cors, "/full-sync");
    }

    if (url.pathname === "/api/internal/ai-access") {
      if (!adminControlOk(request, env)) return jsonResponse({ error: "Unauthorized" }, 401, cors);
      if (request.method === "GET") return proxyStoreGateway(request, env, cors, "/ai-access");
      if (request.method === "POST") return proxyStoreGateway(request, env, cors, "/ai-access");
    }

    return jsonResponse({ error: "Not found" }, 404, cors);
  },
};
