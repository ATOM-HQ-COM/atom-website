const ATOM_STATUS_API_BASE = (window.ATOM_API_BASE || "https://atom-proxy.archimedes-api1.workers.dev").replace(/\/$/, "");

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

let latestStatusSnapshot = null;

function atomStatusApi(path) {
  return `${ATOM_STATUS_API_BASE}${path}`;
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

function formatDateTime(value) {
  const date = new Date(Number(value || Date.now()));
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatPhase(status) {
  if (!status || Number(status.level) <= 1) return "Operating Normally";
  return phaseLabel(status.phase) || "Investigating";
}

function formatEta(targetTs, nowTs = Date.now()) {
  const remaining = Math.max(0, Number(targetTs || 0) - Number(nowTs || Date.now()));
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function setCircle(status) {
  const circle = document.getElementById("status-circle");
  const icon = document.getElementById("status-circle-icon");
  const label = document.getElementById("status-circle-label");
  const note = document.getElementById("status-circle-note");
  const meta = statusMeta(Number(status && status.level));
  circle.style.setProperty("--status-color", meta.color);
  icon.textContent = meta.icon;
  icon.style.background = meta.color;
  label.textContent = meta.label;
  note.textContent = meta.note;
}

function renderBanner(status) {
  const banner = document.getElementById("status-banner");
  const meta = statusMeta(Number(status && status.level));
  const maintenance = !!(status && status.maintenanceMode);
  const bits = [];
  if (maintenance) {
    bits.push("Maintenance mode is active. All public Atom pages are temporarily routed here.");
  }
  if (Number(status && status.level) <= 1) {
    bits.push("Students and visitors should be able to use Atom normally.");
  } else {
    bits.push(`Atom is currently marked ${meta.short.toLowerCase()}. Teams are actively working toward full restoration.`);
  }
  banner.classList.toggle("maintenance", maintenance);
  banner.textContent = bits.join(" ");
}

function renderPills(status) {
  const row = document.getElementById("status-pill-row");
  const etaAt = Number(status && status.etaAt || 0);
  const phase = formatPhase(status);
  const pills = [
    `<div class="status-pill"><strong>Current Phase</strong><span>${escapeHtml(phase)}</span></div>`,
  ];
  if (etaAt > 0) {
    pills.push(`<div class="status-pill"><strong>${Number(status.level) <= 1 ? "Service Window" : "Estimated Resolution"}</strong><span id="eta-pill">${escapeHtml(formatEta(etaAt))}</span></div>`);
  }
  row.innerHTML = pills.join("");
}

function renderCountdown(status) {
  const wrap = document.getElementById("status-countdown");
  const etaAt = Number(status && status.etaAt || 0);
  if (!etaAt) {
    wrap.classList.add("hidden");
    wrap.textContent = "";
    return;
  }
  wrap.classList.remove("hidden");
  const elapsed = etaAt <= Date.now();
  const lead = Number(status && status.level) <= 1
    ? "Estimated time to full service restoration"
    : "Estimated time to resolution";
  wrap.textContent = elapsed && Number(status && status.level) > 1
    ? `${lead}: ${formatEta(etaAt)} remaining. The posted ETA has elapsed and restoration work is still ongoing.`
    : `${lead}: ${formatEta(etaAt)} remaining.`;
}

function renderHistory(history) {
  const strip = document.getElementById("status-history-strip");
  const items = Array.isArray(history) ? history : [];
  strip.innerHTML = items.map((item) => {
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

function renderReports(snapshot) {
  const recentWrap = document.getElementById("status-reports-24h");
  const olderWrap = document.getElementById("status-reports-older");
  const recent = Array.isArray(snapshot && snapshot.reports24h) ? snapshot.reports24h : [];
  const older = Array.isArray(snapshot && snapshot.olderReports) ? snapshot.olderReports : [];
  recentWrap.innerHTML = recent.length ? recent.map(reportHtml).join("") : `<div class="status-empty">No status reports have been posted in the past 24 hours.</div>`;
  olderWrap.innerHTML = older.length ? older.map(reportHtml).join("") : `<div class="status-empty">No older status reports are available.</div>`;
  document.getElementById("older-reports-summary").textContent = older.length
    ? `View older status reports (${older.length})`
    : "View older status reports";
}

function renderSnapshot(snapshot) {
  latestStatusSnapshot = snapshot;
  const status = snapshot && snapshot.status ? snapshot.status : { level: 1, phase: "", maintenanceMode: false, etaAt: null };
  setCircle(status);
  renderPills(status);
  const phaseTarget = document.getElementById("status-phase-label");
  if (phaseTarget) phaseTarget.textContent = formatPhase(status);
  renderBanner(status);
  renderCountdown(status);
  renderHistory(snapshot && snapshot.history);
  renderReports(snapshot);
  document.getElementById("status-last-updated").textContent = `Last updated ${formatDateTime(status.updatedAt || snapshot.serverTime)}`;
}

async function loadStatus() {
  const response = await fetch(atomStatusApi("/api/status/public?full=1"), { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the Atom status page.");
  const data = await response.json();
  renderSnapshot(data);
}

function tickCountdown() {
  if (!latestStatusSnapshot || !latestStatusSnapshot.status || !latestStatusSnapshot.status.etaAt) return;
  renderCountdown(latestStatusSnapshot.status);
  const etaPill = document.getElementById("eta-pill");
  if (etaPill) etaPill.textContent = formatEta(latestStatusSnapshot.status.etaAt);
}

loadStatus().catch((err) => {
  const banner = document.getElementById("status-banner");
  banner.classList.remove("hidden");
  banner.textContent = err && err.message ? err.message : "Could not load Atom status right now.";
});

setInterval(tickCountdown, 1000);
setInterval(() => {
  loadStatus().catch(() => {});
}, 60000);
