(function () {
  const path = location.pathname.replace(/index\.html$/, "").replace(/\/+$/, "") || "/";
  const exempt = path === "/status" || path === "/status-manage";
  if (exempt) return;

  const API_BASE = (window.ATOM_API_BASE || "https://atom-proxy.archimedes-api1.workers.dev").replace(/\/$/, "");
  const CACHE_KEY = "atom-status-gate-cache-v1";
  const CACHE_TTL_MS = 30000;

  function redirectToStatus() {
    const target = `${location.origin}/status/`;
    if (location.href !== target) location.replace(target);
  }

  function applyState(payload) {
    if (payload && payload.status && payload.status.maintenanceMode) redirectToStatus();
  }

  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (cached && Number(cached.checkedAt || 0) + CACHE_TTL_MS > Date.now()) {
      applyState(cached.payload);
      return;
    }
  } catch {}

  fetch(`${API_BASE}/api/status/public`, { cache: "no-store", credentials: "omit" })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), payload }));
      } catch {}
      applyState(payload);
    })
    .catch(() => {});
}());
