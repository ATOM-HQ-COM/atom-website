const ATOM_STATUS_MANAGE_API_BASE = (window.ATOM_API_BASE || "https://atom-proxy.archimedes-api1.workers.dev").replace(/\/$/, "");

const STATUS_META = {
  1: { label: "Status 1 - Operational", short: "Operational", icon: "✓", color: "#2ea043", note: "All core Atom services are operating normally." },
  2: { label: "Status 2 - Degraded Performance", short: "Degraded", icon: "!", color: "#d8a426", note: "Some services may feel slower or less reliable than usual." },
  3: { label: "Status 3 - Partial/Temporary Outage", short: "Partial Outage", icon: "!", color: "#eb8f34", note: "A portion of Atom is unavailable while mitigation work is underway." },
  4: { label: "Status 4 - Major Outage", short: "Major Outage", icon: "!", color: "#d73a49", note: "A major service disruption is affecting a large portion of Atom." },
  5: { label: "Status 5 - Complete Server Outage", short: "Complete Outage", icon: "×", color: "#7c3aed", note: "Atom is currently unavailable while full restoration work continues." },
};

const STATUS_PHASES = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

const STATUS_MANAGE_TOKEN_KEY = "atom-status-manage-token";

let statusManageToken = "";
let latestStatusManageData = null;

function atomStatusManageApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (statusManageToken) headers.set("Authorization", `Bearer ${statusManageToken}`);
  return fetch(`${ATOM_STATUS_MANAGE_API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
}

function statusMeta(level) {
  return STATUS_META[level] || STATUS_META[1];
}

function phaseLabel(phase) {
  return STATUS_PHASES[String(phase || "").toLowerCase()] || "";
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

function byId(id) {
  return document.getElementById(id);
}

function setStatus(message, tone = "") {
  const el = byId("status-manage-message");
  el.textContent = message || "";
  el.classList.toggle("ok", tone === "ok");
  el.classList.toggle("error", tone === "error");
}

function setLoginStatus(message, tone = "") {
  const el = byId("status-login-message");
  el.textContent = message || "";
  el.classList.toggle("ok", tone === "ok");
  el.classList.toggle("error", tone === "error");
}

function formatDateTime(value) {
  const date = new Date(Number(value || Date.now()));
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatEta(targetTs, nowTs = Date.now()) {
  const remaining = Math.max(0, Number(targetTs || 0) - Number(nowTs || Date.now()));
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(Number(value));
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function rememberToken(token) {
  statusManageToken = token || "";
  try {
    if (statusManageToken) sessionStorage.setItem(STATUS_MANAGE_TOKEN_KEY, statusManageToken);
    else sessionStorage.removeItem(STATUS_MANAGE_TOKEN_KEY);
  } catch {}
}

function restoreToken() {
  try {
    statusManageToken = sessionStorage.getItem(STATUS_MANAGE_TOKEN_KEY) || "";
  } catch {
    statusManageToken = "";
  }
}

function showLogin() {
  byId("status-login-screen").classList.remove("hidden");
  byId("status-manage-screen").classList.add("hidden");
}

function showDashboard() {
  byId("status-login-screen").classList.add("hidden");
  byId("status-manage-screen").classList.remove("hidden");
}

function renderPreview(status) {
  const meta = statusMeta(Number(status && status.level));
  const circle = byId("manage-status-circle");
  const icon = byId("manage-status-circle-icon");
  const label = byId("manage-status-circle-label");
  const note = byId("manage-status-circle-note");
  circle.style.setProperty("--status-color", meta.color);
  icon.style.background = meta.color;
  icon.textContent = meta.icon;
  label.textContent = meta.label;
  note.textContent = meta.note;
  byId("manage-status-phase").textContent = Number(status && status.level) <= 1
    ? "Operating Normally"
    : (phaseLabel(status.phase) || "Investigating");
  const etaWrap = byId("manage-status-eta");
  if (status && status.etaAt) {
    etaWrap.classList.remove("hidden");
    const elapsed = Number(status.etaAt) <= Date.now();
    etaWrap.textContent = elapsed && Number(status.level) > 1
      ? `Estimated time to resolution: ${formatEta(status.etaAt)} remaining. The posted ETA has elapsed and restoration work is still ongoing.`
      : `${Number(status.level) <= 1 ? "Estimated time to full service restoration" : "Estimated time to resolution"}: ${formatEta(status.etaAt)} remaining.`;
  } else {
    etaWrap.classList.add("hidden");
    etaWrap.textContent = "";
  }
  const maintenance = !!(status && status.maintenanceMode);
  const maintenanceBanner = byId("manage-maintenance-banner");
  maintenanceBanner.classList.toggle("maintenance", maintenance);
  maintenanceBanner.textContent = maintenance
    ? "Maintenance mode is active. All public Atom pages are being routed to the status page."
    : "Maintenance mode is off. Visitors can still access the rest of the Atom website.";
}

function renderHistory(history) {
  byId("manage-status-history").innerHTML = (Array.isArray(history) ? history : []).map((item) => {
    const meta = statusMeta(Number(item && item.statusLevel));
    return `<span class="status-history-bar" title="${escapeHtml(`${formatDateTime(item.bucketTs)} · ${meta.label}`)}" style="background:${meta.color}"></span>`;
  }).join("");
}

function reportHtml(report) {
  const meta = statusMeta(Number(report && report.statusLevel));
  const phase = phaseLabel(report && report.phase);
  return `
    <article class="status-report">
      <div class="status-report-head">
        <div class="status-report-badge" style="background:${meta.color}">
          <span>${escapeHtml(meta.short)}</span>
          ${phase ? `<span>· ${escapeHtml(phase)}</span>` : ""}
        </div>
        <time datetime="${new Date(Number(report && report.createdAt || Date.now())).toISOString()}">${escapeHtml(formatDateTime(report && report.createdAt))}</time>
      </div>
      <p>${escapeHtml(report && report.message || "")}</p>
    </article>
  `;
}

function renderReports(data) {
  const recent = Array.isArray(data && data.reports24h) ? data.reports24h : [];
  const older = Array.isArray(data && data.olderReports) ? data.olderReports : [];
  byId("manage-reports-24h").innerHTML = recent.length ? recent.map(reportHtml).join("") : `<div class="status-empty">No status reports have been posted in the past 24 hours.</div>`;
  byId("manage-reports-older").innerHTML = older.length ? older.map(reportHtml).join("") : `<div class="status-empty">No older status reports are available.</div>`;
  byId("manage-older-summary").textContent = older.length
    ? `View older status reports (${older.length})`
    : "View older status reports";
}

function syncFormFromData(data) {
  const status = data && data.status ? data.status : { level: 1, phase: "", maintenanceMode: false, etaAt: null };
  const levelInput = document.querySelector(`input[name="status-level"][value="${Number(status.level) || 1}"]`);
  if (levelInput) levelInput.checked = true;
  document.querySelectorAll('input[name="status-phase"]').forEach((input) => {
    input.checked = String(input.value) === String(status.phase || "investigating");
  });
  byId("maintenance-toggle").checked = !!status.maintenanceMode;
  byId("status-eta-input").value = toLocalInput(status.etaAt);
  togglePhaseVisibility(Number(status.level) || 1);
  renderPreview(status);
}

function renderData(data) {
  latestStatusManageData = data;
  syncFormFromData(data);
  renderHistory(data && data.history);
  renderReports(data);
  byId("manage-last-updated").textContent = `Last updated ${formatDateTime(data && data.status && data.status.updatedAt || data.serverTime)}`;
}

function currentFormStatus() {
  const selectedLevel = Number((document.querySelector('input[name="status-level"]:checked') || {}).value || 1);
  const selectedPhase = (document.querySelector('input[name="status-phase"]:checked') || {}).value || "investigating";
  return {
    level: selectedLevel,
    phase: selectedLevel <= 1 ? "" : selectedPhase,
    maintenanceMode: byId("maintenance-toggle").checked,
    etaAt: fromLocalInput(byId("status-eta-input").value),
  };
}

function togglePhaseVisibility(level) {
  byId("phase-controls").classList.toggle("hidden", Number(level) <= 1);
}

async function loadManageData() {
  const response = await atomStatusManageApi("/api/status-manage/data", { method: "GET", cache: "no-store" });
  if (response.status === 401) {
    rememberToken("");
    showLogin();
    return false;
  }
  if (!response.ok) throw new Error("Could not load status controls.");
  const data = await response.json();
  renderData(data);
  showDashboard();
  return true;
}

async function saveStatusState() {
  const state = currentFormStatus();
  const response = await atomStatusManageApi("/api/status-manage/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (response.status === 401) {
    rememberToken("");
    showLogin();
    return;
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload && payload.error ? payload.error : "Could not save status.");
  renderData(payload.data);
  setStatus("Status settings saved.", "ok");
}

async function addReport() {
  const textarea = byId("status-report-text");
  const message = textarea.value.trim();
  if (!message) {
    setStatus("Write a status report before posting.", "error");
    return;
  }
  const response = await atomStatusManageApi("/api/status-manage/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (response.status === 401) {
    rememberToken("");
    showLogin();
    return;
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload && payload.error ? payload.error : "Could not post that status report.");
  textarea.value = "";
  renderData(payload.data);
  setStatus("Status report posted.", "ok");
}

function bindManageEvents() {
  byId("status-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoginStatus("Signing in...");
    const form = event.currentTarget;
    const response = await atomStatusManageApi("/api/status-manage/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.username.value,
        password: form.password.value,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setLoginStatus(payload && payload.error ? payload.error : "Could not sign in.", "error");
      return;
    }
    rememberToken(payload.token || "");
    form.reset();
    setLoginStatus("");
    await loadManageData().catch((err) => setLoginStatus(err.message || "Could not load the dashboard.", "error"));
  });

  document.querySelectorAll('input[name="status-level"]').forEach((input) => {
    input.addEventListener("change", () => {
      const status = currentFormStatus();
      togglePhaseVisibility(status.level);
      renderPreview(status);
    });
  });

  document.querySelectorAll('input[name="status-phase"]').forEach((input) => {
    input.addEventListener("change", () => renderPreview(currentFormStatus()));
  });

  byId("maintenance-toggle").addEventListener("change", () => renderPreview(currentFormStatus()));
  byId("status-eta-input").addEventListener("input", () => renderPreview(currentFormStatus()));

  byId("save-status-controls").addEventListener("click", async () => {
    setStatus("Saving status settings...");
    try {
      await saveStatusState();
    } catch (err) {
      setStatus(err && err.message ? err.message : "Could not save the status settings.", "error");
    }
  });

  byId("clear-status-eta").addEventListener("click", () => {
    byId("status-eta-input").value = "";
    renderPreview(currentFormStatus());
  });

  byId("post-status-report").addEventListener("click", async () => {
    setStatus("Posting status report...");
    try {
      await addReport();
    } catch (err) {
      setStatus(err && err.message ? err.message : "Could not post that status report.", "error");
    }
  });

  byId("logout-status-manage").addEventListener("click", async () => {
    rememberToken("");
    await atomStatusManageApi("/api/status-manage/logout", { method: "POST" }).catch(() => {});
    showLogin();
    setLoginStatus("Signed out.", "ok");
  });
}

restoreToken();
bindManageEvents();
showLogin();

if (statusManageToken) {
  loadManageData().catch((err) => {
    showLogin();
    setLoginStatus(err && err.message ? err.message : "Could not load the dashboard.", "error");
  });
}
