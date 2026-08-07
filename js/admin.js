const ADMIN_API_BASE = (window.ATOM_API_BASE || "https://atom-proxy.archimedes-api1.workers.dev").replace(/\/$/, "");

function defaultAdminAuthApiBase() {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return `${location.protocol}//${location.hostname}:8789`;
  }
  return "https://auth.atom-hq.com";
}

const ADMIN_AUTH_API_BASE = (window.ATOM_AUTH_API_BASE || defaultAdminAuthApiBase()).replace(/\/$/, "");

let adminToken = "";
let adminData = { pageViews: 0, chatMessages: 0, contacts: [] };
let adminEditing = false;
let authMetrics = null;
const localTools = {
  unlocked: false,
  helperAvailable: false,
  helperLoaded: false,
  helperLoading: null,
};

const byId = (id) => document.getElementById(id);

function adminApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (adminToken) headers.set("Authorization", `Bearer ${adminToken}`);
  return fetch(`${ADMIN_API_BASE}${path}`, { ...options, headers, credentials: "include" });
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function formatDate(value) {
  const date = new Date(Number(value || Date.now()));
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function toLocalInput(value) {
  const date = new Date(Number(value || Date.now()));
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function setStatus(id, message) {
  const el = byId(id);
  if (el) el.textContent = message || "";
}

function adminShortcutReady() {
  const active = document.activeElement;
  const tag = active && active.tagName;
  return !active || (!active.isContentEditable && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT");
}

function isBackslashKey(event) {
  return event.code === "Backslash" || event.code === "IntlBackslash" || event.key === "\\";
}

function showLogin(message) {
  byId("login-screen").classList.remove("hidden");
  byId("admin-screen").classList.add("hidden");
  adminToken = "";
  adminEditing = false;
  setStatus("login-status", message || "");
}

function showAdmin() {
  byId("login-screen").classList.add("hidden");
  byId("admin-screen").classList.remove("hidden");
}

function renderContacts() {
  const list = byId("contacts-list");
  const contacts = Array.isArray(adminData.contacts) ? adminData.contacts : [];
  byId("contact-count-display").textContent = formatNumber(contacts.length);
  byId("contact-count-pill").textContent = formatNumber(contacts.length);

  if (contacts.length === 0) {
    list.innerHTML = `<div class="admin-empty">No contact messages yet.</div>`;
    return;
  }

  list.innerHTML = contacts.map((contact) => {
    const id = escapeHtml(contact.id || "");
    const name = escapeHtml(contact.name || "");
    const message = escapeHtml(contact.message || "");
    const reply = String(contact.reply || "");
    const thread = Array.isArray(contact.thread) && contact.thread.length
      ? contact.thread
      : [{ sender: "user", message: contact.message || "", createdAt: contact.createdAt }];
    const createdAt = Number(contact.createdAt || Date.now());
    const repliedAt = Number(contact.repliedAt || 0);
    const acknowledgedAt = Number(contact.acknowledgedAt || 0);
    const replyLabel = reply ? (acknowledgedAt ? "Seen" : "Sent") : "";
    const threadHtml = thread.map((item) => `
      <article class="contact-thread-message ${item.sender === "admin" ? "team" : "guest"}">
        <div class="admin-thread-meta">
          <strong>${item.sender === "admin" ? "Atom Team" : name || "User"}</strong>
          <span>${formatDate(item.createdAt)}</span>
        </div>
        <p>${escapeHtml(item.message || "")}</p>
      </article>
    `).join("");

    return `
      <article class="contact-record" data-id="${id}">
        <div class="contact-view">
          <div class="contact-record-head">
            <div>
              <h3>${name || "Anonymous"}</h3>
              ${replyLabel ? `<span class="reply-state ${acknowledgedAt ? "seen" : ""}">${replyLabel}</span>` : ""}
            </div>
            <time datetime="${new Date(createdAt).toISOString()}">${formatDate(createdAt)}</time>
          </div>
          <p class="contact-original">${message}</p>
          <div class="admin-reply-preview contact-thread">
            <span>Conversation${repliedAt ? ` · latest reply ${formatDate(repliedAt)}` : ""}</span>
            <div class="contact-thread-list">${threadHtml}</div>
          </div>
          <div class="reply-box hidden">
            <textarea class="admin-textarea reply-input" rows="4" placeholder="Write the next reply..."></textarea>
            <div class="reply-actions">
              <button class="btn btn-ghost reply-cancel" type="button">Cancel</button>
              <button class="btn btn-glow reply-send" type="button">Send reply</button>
            </div>
            <div class="contact-status reply-status" aria-live="polite"></div>
          </div>
          <button class="btn btn-contact reply-open" type="button">Reply</button>
        </div>
        <div class="contact-edit-grid">
          <label>
            <span class="admin-label">Name</span>
            <input class="admin-field contact-name" type="text" value="${name}">
          </label>
          <label class="wide">
            <span class="admin-label">Received</span>
            <input class="admin-field contact-created" type="datetime-local" value="${toLocalInput(createdAt)}">
          </label>
          <label class="wide">
            <span class="admin-label">Message</span>
            <textarea class="admin-textarea contact-message">${message}</textarea>
          </label>
        </div>
      </article>
    `;
  }).join("");
}

function renderAdmin() {
  byId("admin-dashboard").classList.toggle("admin-editing", adminEditing);
  byId("page-views-display").textContent = formatNumber(adminData.pageViews);
  byId("chat-messages-display").textContent = formatNumber(adminData.chatMessages);
  byId("page-views-input").value = Number(adminData.pageViews || 0);
  byId("chat-messages-input").value = Number(adminData.chatMessages || 0);
  renderAuthMetrics(authMetrics);
  renderContacts();
}

function setAuthUsersNote(message) {
  const note = byId("auth-users-note");
  if (!note) return;
  note.textContent = message || "";
  note.hidden = !message;
}

function renderAuthMetrics(metrics) {
  const display = byId("auth-users-display");
  const input = byId("auth-users-input");
  if (!display || !input) return;

  authMetrics = metrics || null;
  if (!metrics) {
    display.textContent = "--";
    input.value = "";
    setAuthUsersNote(localTools.unlocked
      ? "Local auth users are unavailable right now."
      : "Press \\ to unlock local auth users");
    return;
  }

  display.textContent = formatNumber(metrics.totalUsers);
  input.value = Number(metrics.totalUsers || 0);
  setAuthUsersNote("");
}

async function refreshLocalToolsStatus() {
  try {
    const response = await fetch(`${ADMIN_AUTH_API_BASE}/api/admin/tools/status`, {
      credentials: "include",
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(out.error || "Could not check local admin tools.");
    localTools.unlocked = !!out.unlocked;
    localTools.helperAvailable = !!out.helperAvailable;
  } catch {
    localTools.unlocked = false;
    localTools.helperAvailable = false;
    localTools.helperLoaded = false;
    return;
  }

  if (localTools.unlocked && localTools.helperAvailable) {
    try {
      await ensureLocalToolsHelper();
    } catch (err) {
      setStatus("save-status", err.message || "Could not load the private admin tools from this machine.");
    }
  }
}

async function ensureLocalToolsHelper() {
  if (!localTools.unlocked || !localTools.helperAvailable) return false;
  if (localTools.helperLoaded) return true;
  if (localTools.helperLoading) return localTools.helperLoading;

  localTools.helperLoading = (async () => {
    const response = await fetch(`${ADMIN_AUTH_API_BASE}/api/admin/tools/helper`, {
      credentials: "include",
    });
    const source = await response.text();
    if (!response.ok) {
      throw new Error(source || "Could not load the private admin tools from this machine.");
    }
    const script = document.createElement("script");
    script.text = `${source}\n//# sourceURL=atom-private-admin-tools.js`;
    document.head.appendChild(script);
    localTools.helperLoaded = true;
    return true;
  })().finally(() => {
    localTools.helperLoading = null;
  });

  return localTools.helperLoading;
}

async function unlockLocalTools() {
  const token = window.prompt("Enter ATOM_AUTH_ADMIN_TOKEN from local-auth-server/.env") || "";
  if (!token.trim()) return false;

  try {
    const response = await fetch(`${ADMIN_AUTH_API_BASE}/api/admin/tools/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(out.error || "Could not unlock local admin tools.");

    localTools.unlocked = true;
    localTools.helperAvailable = !!out.helperAvailable;
    if (localTools.helperAvailable) {
      try {
        await ensureLocalToolsHelper();
        setStatus("save-status", "Local admin tools unlocked on this browser.");
      } catch (err) {
        setStatus("save-status", err.message || "Local auth users unlocked, but the private editing helper could not load.");
      }
    } else {
      setStatus("save-status", "Local auth users unlocked. Private editing helper is not installed on this machine.");
    }

    await loadAuthMetrics();
    return true;
  } catch (err) {
    localTools.unlocked = false;
    localTools.helperAvailable = false;
    localTools.helperLoaded = false;
    renderAuthMetrics(null);
    setAuthUsersNote(
      String(err.message || "").toLowerCase().includes("unauthorized")
        ? "Wrong ATOM_AUTH_ADMIN_TOKEN."
        : (err.message || "Local auth metric unavailable")
    );
    return false;
  }
}

async function loadAuthMetrics() {
  try {
    const response = await fetch(`${ADMIN_AUTH_API_BASE}/api/admin/metrics`, {
      credentials: "include",
    });
    const out = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localTools.unlocked = false;
      renderAuthMetrics(null);
      return;
    }
    if (!response.ok) throw new Error(out.error || "Could not load local auth metrics.");
    localTools.unlocked = true;
    renderAuthMetrics(out);
  } catch (err) {
    renderAuthMetrics(null);
    setAuthUsersNote(err.message || "Local auth metric unavailable");
  }
}

async function loadAdminData() {
  const response = await adminApi("/api/admin/data");
  const out = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin("");
    return;
  }
  if (!response.ok) throw new Error(out.error || "Could not load admin data.");

  adminData = {
    pageViews: Number(out.pageViews || 0),
    chatMessages: Number(out.chatMessages || 0),
    contacts: Array.isArray(out.contacts) ? out.contacts : [],
  };
  showAdmin();
  renderAdmin();
  await refreshLocalToolsStatus();
  await loadAuthMetrics();
}

function collectContacts() {
  return [...document.querySelectorAll(".contact-record")].map((record) => ({
    id: record.dataset.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: record.querySelector(".contact-name").value.trim(),
    message: record.querySelector(".contact-message").value.trim(),
    createdAt: fromLocalInput(record.querySelector(".contact-created").value),
  }));
}

async function sendContactReply(record) {
  const button = record.querySelector(".reply-send");
  const status = record.querySelector(".reply-status");
  const reply = record.querySelector(".reply-input").value.trim();
  status.textContent = "";
  if (!reply) {
    status.textContent = "Write a reply first.";
    return;
  }

  button.disabled = true;
  button.textContent = "Sending...";
  try {
    const response = await adminApi("/api/admin/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.dataset.id, reply }),
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(out.error || "Could not send reply.");
    await loadAdminData();
    setStatus("save-status", "Reply sent.");
  } catch (err) {
    status.textContent = err.message || "Could not send reply.";
  } finally {
    button.disabled = false;
    button.textContent = "Send reply";
  }
}

async function saveAuthMetricsOverride() {
  if (!localTools.unlocked) return authMetrics;
  const input = byId("auth-users-input");
  if (!input) return authMetrics;

  const response = await fetch(`${ADMIN_AUTH_API_BASE}/api/admin/metrics/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ totalUsers: Number(input.value || 0) }),
  });
  const out = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(out.error || "Could not save local auth users.");
  renderAuthMetrics(out);
  return out;
}

async function saveAdminData() {
  const button = byId("save-admin");
  button.disabled = true;
  setStatus("save-status", "Saving...");

  try {
    await saveAuthMetricsOverride();
    const payload = {
      pageViews: Number(byId("page-views-input").value || 0),
      chatMessages: Number(byId("chat-messages-input").value || 0),
      contacts: collectContacts(),
    };
    const response = await adminApi("/api/admin/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(out.error || "Could not save values.");
    adminData = out.data || payload;
    adminEditing = false;
    renderAdmin();
    setStatus("save-status", "Saved.");
  } catch (err) {
    setStatus("save-status", err.message || "Could not save values.");
  } finally {
    button.disabled = false;
  }
}

async function loginAdmin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Signing in...";
  setStatus("login-status", "");

  try {
    const response = await adminApi("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(out.error || "Could not sign in.");
    adminToken = out.token || "";
    form.reset();
    await loadAdminData();
  } catch (err) {
    showLogin(err.message || "Could not sign in.");
  } finally {
    button.disabled = false;
    button.textContent = "Sign in";
  }
}

async function logoutAdmin() {
  try {
    await adminApi("/api/admin/logout", { method: "POST" });
  } catch {}
  adminEditing = false;
  showLogin("");
}

function toggleAdminEditing() {
  if (byId("admin-screen").classList.contains("hidden") || !localTools.unlocked) return false;
  adminEditing = !adminEditing;
  setStatus("save-status", "");
  renderAdmin();
  if (adminEditing) byId("page-views-input").focus();
  return true;
}

window.__atomAdminBridge = {
  canUseHotkeys: () => adminShortcutReady(),
  isAdminVisible: () => !byId("admin-screen").classList.contains("hidden"),
  isUnlocked: () => localTools.unlocked,
  isEditing: () => adminEditing,
  toggleEditing: () => toggleAdminEditing(),
};

document.addEventListener("DOMContentLoaded", () => {
  byId("admin-login-form").addEventListener("submit", loginAdmin);
  byId("refresh-admin").addEventListener("click", () => loadAdminData().catch((err) => setStatus("save-status", err.message)));
  byId("logout-admin").addEventListener("click", logoutAdmin);
  byId("save-admin").addEventListener("click", saveAdminData);
  byId("contacts-list").addEventListener("click", (event) => {
    const record = event.target.closest(".contact-record");
    if (!record) return;
    if (event.target.closest(".reply-open")) {
      record.querySelector(".reply-box").classList.remove("hidden");
      record.querySelector(".reply-input").focus();
    }
    if (event.target.closest(".reply-cancel")) {
      record.querySelector(".reply-box").classList.add("hidden");
    }
    if (event.target.closest(".reply-send")) {
      sendContactReply(record);
    }
  });
  byId("cancel-edit").addEventListener("click", () => {
    adminEditing = false;
    setStatus("save-status", "");
    renderAdmin();
  });

  document.addEventListener("keydown", (event) => {
    if (event.repeat || !isBackslashKey(event) || !adminShortcutReady()) return;
    if (byId("admin-screen").classList.contains("hidden")) return;

    event.preventDefault();
    if (localTools.unlocked) {
      Promise.all([
        localTools.helperAvailable ? ensureLocalToolsHelper() : Promise.resolve(false),
        loadAuthMetrics(),
      ]).then(() => {
        setStatus("save-status", localTools.helperAvailable
          ? "Local admin tools are already unlocked on this browser."
          : "Local auth users are already unlocked on this browser.");
      }).catch((err) => {
        setStatus("save-status", err.message || "Could not refresh local admin tools.");
      });
      return;
    }

    unlockLocalTools().catch((err) => {
      setStatus("save-status", err.message || "Could not unlock local admin tools.");
    });
  });

  loadAdminData().catch(() => showLogin(""));
});
