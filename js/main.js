/* ========================================================================
   Atom, Shared UI: tier data, mobile menu, scroll reveal. Dark theme only.
   ======================================================================== */

const ATOM_API_BASE = (window.ATOM_API_BASE || "https://atom-proxy.archimedes-api1.workers.dev").replace(/\/$/, "");

function atomApi(path) {
  return `${ATOM_API_BASE}${path}`;
}

function postAtomEvent(path, payload) {
  try {
    fetch(atomApi(path), {
      method: "POST",
      headers: payload ? { "Content-Type": "application/json" } : {},
      body: payload ? JSON.stringify(payload) : undefined,
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

window.atomApi = atomApi;
window.postAtomEvent = postAtomEvent;

const CONTACT_EMAIL = "atomeducationhq@gmail.com";
const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;

window.ATOM_CONTACT_EMAIL = CONTACT_EMAIL;
window.ATOM_CONTACT_MAILTO = CONTACT_MAILTO;

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-contact-open]").forEach((el) => {
    if (el.tagName === "A") {
      el.setAttribute("href", CONTACT_MAILTO);
      return;
    }

    el.addEventListener("click", () => {
      window.location.href = CONTACT_MAILTO;
    });
  });

  if (location.hash === "#contact") {
    window.location.href = CONTACT_MAILTO;
  }
});

// ------------------ Tier definitions ------------------
// Live in js/atom-classes.js now (window.ATOM_CLASSES / window.ATOM_TIERS),
// so every page shares one registry of classes and tutors.

// ------------------ Mobile nav menu ------------------
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".menu-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
    links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => links.classList.remove("open")));
  }
});

// ------------------ Cursor spotlight cards ------------------
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".cta-band").forEach((card) => {
    card.classList.add("spotlight-card");
    if (!card.style.getPropertyValue("--tier-color")) card.style.setProperty("--tier-color", "#22d3ee");
  });

  const attachSpotlight = (card) => {
    const onMove = (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--sx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--sy", `${event.clientY - rect.top}px`);
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerenter", () => {
      card.style.setProperty("--spot-opacity", "0.55");
      card.style.setProperty("--border-opacity", "1");
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--spot-opacity", "0");
      card.style.setProperty("--border-opacity", "0");
    });
  };
  document.querySelectorAll(".spotlight-card").forEach(attachSpotlight);
});

// ------------------ Analytics ------------------
document.addEventListener("DOMContentLoaded", () => {
  if (location.pathname.replace(/\/+$/, "") === "/admin") return;
  postAtomEvent("/api/events/page-view", { path: location.pathname, referrer: document.referrer || "" });
});

// ------------------ Scroll reveal ------------------
document.addEventListener("DOMContentLoaded", () => {
  const els = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window) || els.length === 0) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  els.forEach((e) => io.observe(e));
});

// ------------------ Tier badge (status label) ------------------
function badgeClass(tier) {
  if (!tier.available) return "coming";
  return tier.prerelease ? "prerelease" : "available";
}
function badgeText(tier) {
  if (!tier.available) return "Coming Soon";
  return tier.prerelease ? "Pre-Release Available" : "Available";
}

// ------------------ Tier cards (landing grid) ------------------
// `tiers` defaults to the physics four so existing callers keep working.
window.renderTierCards = function (container, opts = {}) {
  const { onSelect, tiers } = opts;
  const list = tiers || window.ATOM_TIERS;
  container.innerHTML = "";
  list.forEach((tier) => {
    const card = document.createElement("div");
    card.className = "tier-card card";
    if (!tier.available) card.classList.add("disabled");
    card.style.setProperty("--tier-color", tier.color);
    card.innerHTML = `
      <span class="glow"></span>
      <div class="tier-icon">${tier.initial}</div>
      <div class="tier-name">${tier.name}</div>
      <div class="tier-level">${tier.level}</div>
      <div class="tier-desc">${tier.description}</div>
      <span class="tier-badge ${badgeClass(tier)}">${badgeText(tier)}</span>
    `;
    if (onSelect && tier.available) card.addEventListener("click", () => onSelect(tier));
    container.appendChild(card);
  });
};

// ------------------ Tier rows (compact modal) ------------------
window.renderTierRows = function (container, opts = {}) {
  const { onSelect, tiers, activeId } = opts;
  const list = tiers || window.ATOM_TIERS;
  container.innerHTML = "";
  list.forEach((tier) => {
    const row = document.createElement("div");
    row.className = "tier-row";
    if (!tier.available) row.classList.add("disabled");
    if (activeId && tier.id === activeId) row.classList.add("active");
    row.style.setProperty("--tier-color", tier.color);
    row.innerHTML = `
      <div class="r-icon">${tier.initial}</div>
      <div class="r-body">
        <div class="r-name">${tier.name}</div>
        <div class="r-level">${tier.level}</div>
      </div>
      <span class="r-badge ${badgeClass(tier)}">${badgeText(tier)}</span>
    `;
    if (onSelect && tier.available) row.addEventListener("click", () => onSelect(tier));
    container.appendChild(row);
  });
};

// ------------------ Class rows (compact modal) ------------------
// Same shape as the tier rows, but one entry per subject. Used by the chat
// page's "pick a path" gate and by its top-left dropdown.
window.CLASS_GLYPHS = {
  atom:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="10" ry="4.3"/><ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.3" transform="rotate(120 12 12)"/></svg>',
  flask:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v6.2L3.6 18A2.4 2.4 0 0 0 5.7 21.6h12.6A2.4 2.4 0 0 0 20.4 18L15 8.2V2"/><path d="M8 2h8"/><path d="M6.6 14.5h10.8"/></svg>',
  leaf:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20c8.5 1 16-4.6 16-15C11 4 3 9.5 4 20z"/><path d="M4 20C7 14 11.5 10.5 17 8.5"/></svg>',
  sigma:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4H6l6 8-6 8h12"/></svg>',
  code:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 17-5-5 5-5"/><path d="m15 7 5 5-5 5"/></svg>',
  // Socrates: a speech mark, because this one you talk to.
  bust:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4.2 4.2 0 0 0-4.2 4.2v1.3A3.6 3.6 0 0 0 6 10.6c0 1.2.6 2.3 1.6 3v1.1"/><path d="M12 2a4.2 4.2 0 0 1 4.2 4.2v1.3A3.6 3.6 0 0 1 18 10.6c0 1.2-.6 2.3-1.6 3v1.1"/><path d="M7.6 14.7C5.4 15.6 4 17.6 4 20v2h16v-2c0-2.4-1.4-4.4-3.6-5.3"/><path d="M10 9.4h4"/></svg>',
  // Kepler: a ringed planet, for the exoplanet hunter.
  planet:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6"/><ellipse cx="12" cy="12" rx="11" ry="4" transform="rotate(-28 12 12)"/></svg>',
};

window.renderClassRows = function (container, opts = {}) {
  const { onSelect, activeId } = opts;
  container.innerHTML = "";
  (window.ATOM_CLASSES || []).forEach((cls) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "class-row";
    if (activeId && cls.id === activeId) row.classList.add("active");
    // Socrates is a different kind of thing, not a sixth subject.
    if (cls.universal) row.setAttribute("data-universal", "");
    // Kepler is the flagship; it gets the silver treatment, not Socrates gold.
    if (cls.flagship) row.setAttribute("data-flagship", "");
    row.style.setProperty("--tier-color", cls.accent);
    row.style.setProperty("--tier-soft", cls.accentSoft);
    row.innerHTML = `
      <span class="class-row-glyph">${window.CLASS_GLYPHS[cls.icon] || ""}</span>
      <span class="class-row-body">
        <span class="class-row-name">${cls.name}${cls.universal ? `<span class="class-row-crown">${cls.flagship ? "Flagship" : "All subjects"}</span>` : ""}</span>
        <span class="class-row-tag">${cls.tagline}</span>
      </span>
      <span class="class-row-tutors">${cls.tutors
        .map((t) => `<i style="--d:${t.color}" title="${t.name}"></i>`)
        .join("")}</span>
    `;
    if (onSelect) row.addEventListener("click", () => onSelect(cls));
    container.appendChild(row);
  });
};

/* ==================================================================
   Home page quick compare: a fanned deck of tutor cards.

   One card is in focus; the rest sit behind it, scaled down and faded
   out, like a stack of documents. Tabs above pick the class, arrows and
   dots below move within it, and it advances on its own every 5s unless
   the pointer is somewhere over the deck. Every transition, whether
   automatic, arrow, dot or tab, runs through the same crossfade.
   ================================================================== */
/* Home page quick compare.

   One SLIDE per class, and each slide is the original four-across grid of
   tutor cards. The five slides are stacked on top of one another: the front
   one is fully visible, the ones behind are scaled down and pushed back so
   their edges show, like a stack of sheets. The CLASS rotates every 5s
   (paused while the pointer is over the deck), and tabs, dots, arrows and
   clicking a slide behind all move through the same crossfade. */
window.initClassCompare = function (root) {
  if (!root || !window.ATOM_CLASSES) return;

  const AUTO_MS = 5000;
  const tabsEl = root.querySelector("[data-cc-tabs]");
  const deckEl = root.querySelector("[data-cc-deck]");
  const dotsEl = root.querySelector("[data-cc-dots]");
  const prevEl = root.querySelector("[data-cc-prev]");
  const nextEl = root.querySelector("[data-cc-next]");
  if (!tabsEl || !deckEl || !dotsEl) return;

  const CLASSES = window.ATOM_CLASSES;
  let index = 0;
  let hovered = false;
  let timer = null;
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const chatHref = root.dataset.chatHref || "chat/";

  function goChat(classId, tutorId) {
    try {
      localStorage.setItem("atom-class", classId);
      if (tutorId) localStorage.setItem("atom-tier", tutorId);
    } catch {}
    window.location.href = `${chatHref}?class=${classId}${tutorId ? `&tier=${tutorId}` : ""}`;
  }

  function badgeClassOf(t) { return t.prerelease ? "prerelease" : "available"; }
  function badgeTextOf(t) { return t.prerelease ? "Pre-Release Available" : "Available"; }

  // The original tutor card, unchanged: token, name, sub, three facts, badge.
  function cardMarkup(tutor, cls) {
    const f = tutor.facts || {};
    const facts = `
      <dl>
        <div><dt>Best for</dt><dd>${f.best || ""}</dd></div>
        <div><dt>${cls.depthLabel || "Depth"}</dt><dd>${f.depth || ""}</dd></div>
        <div><dt>Style</dt><dd>${f.style || ""}</dd></div>
      </dl>`;

    if (cls.universal) {
      // Wide single card: there is room for the description here, which is
      // what actually sells what the model does differently. The flagship
      // (Kepler) drops the little facts box and lets the pitch carry it.
      return `
        <span class="glow"></span>
        <div class="tier-icon compare-token">${tutor.initial}</div>
        <div>
          <h4 class="tier-name compare-name">${tutor.name}</h4>
          <span>${tutor.short}</span>
        </div>
        ${cls.flagship ? "" : facts}
        ${cls.flagship && cls.headline ? `<span class="kepler-discovery"><b>${cls.headline}</b></span>` : ""}
        <p class="compare-uni-desc">${tutor.description}</p>
        <span class="tier-badge available">${cls.badge || (cls.voice ? "Speak to it" : "Available")}</span>
      `;
    }

    return `
      <span class="glow"></span>
      <div class="tier-icon compare-token">${tutor.initial}</div>
      <div>
        <h4 class="tier-name compare-name">${tutor.name}</h4>
        <span>${tutor.short}</span>
      </div>
      ${facts}
      <span class="tier-badge ${badgeClassOf(tutor)}">${badgeTextOf(tutor)}</span>
    `;
  }

  // Cursor-following spotlight, in that tutor's own colour.
  function attachSpotlight(card) {
    card.addEventListener("pointermove", (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--sx", e.clientX - rect.left + "px");
      card.style.setProperty("--sy", e.clientY - rect.top + "px");
    });
    card.addEventListener("pointerenter", () => {
      if (!card.closest(".cc-slide").classList.contains("is-focus")) return;
      card.style.setProperty("--spot-opacity", "0.55");
      card.style.setProperty("--border-opacity", "1");
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--spot-opacity", "0");
      card.style.setProperty("--border-opacity", "0");
    });
  }

  function build() {
    deckEl.innerHTML = "";
    CLASSES.forEach((cls, i) => {
      const slide = document.createElement("div");
      slide.className = "cc-slide";
      slide.style.setProperty("--tc", cls.accent);
      slide.dataset.class = cls.id;

      const label = document.createElement("div");
      label.className = "cc-slide-label";
      label.innerHTML =
        `<span class="cc-slide-glyph">${window.CLASS_GLYPHS[cls.icon] || ""}</span>` +
        `${cls.name} <em>${cls.tagline}</em>`;
      slide.appendChild(label);

      const grid = document.createElement("div");
      grid.className = "compare-scan-grid";
      // Socrates is one tutor, not four, so its card spans the whole row
      // instead of leaving three empty columns.
      if (cls.universal) grid.classList.add("is-universal");
      cls.tutors.forEach((tutor) => {
        const card = document.createElement("article");
        card.className = "compare-scan-card card";
        card.dataset.tier = tutor.id;
        card.style.setProperty("--tc", tutor.color);
        card.style.setProperty("--tier-color", tutor.color);
        card.innerHTML = cardMarkup(tutor, cls);
        attachSpotlight(card);
        grid.appendChild(card);
      });
      slide.appendChild(grid);

      // A slide that is behind just comes forward; on the focused slide the
      // click goes through to that tutor's chat.
      slide.addEventListener("click", (e) => {
        if (!slide.classList.contains("is-focus")) { go(i); return; }
        const card = e.target.closest(".compare-scan-card");
        goChat(cls.id, card ? card.dataset.tier : "");
      });

      deckEl.appendChild(slide);
    });

    dotsEl.innerHTML = "";
    tabsEl.innerHTML = "";
    CLASSES.forEach((cls, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "cc-dot";
      dot.style.setProperty("--tc", cls.accent);
      dot.setAttribute("aria-label", `Show ${cls.name}`);
      dot.addEventListener("click", () => go(i));
      dotsEl.appendChild(dot);

      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "cc-tab";
      tab.setAttribute("role", "tab");
      tab.style.setProperty("--tc", cls.accent);
      tab.innerHTML = `<span class="cc-tab-glyph">${window.CLASS_GLYPHS[cls.icon] || ""}</span>${cls.name}`;
      tab.addEventListener("click", () => go(i));
      tabsEl.appendChild(tab);
    });
  }

  // Slides are absolutely positioned, so the deck needs an explicit height.
  // Measure the focused slide rather than hard-coding it, so the two grid
  // breakpoints (4 across, 2 across, 1 across) all size correctly.
  function sizeDeck() {
    const slide = deckEl.children[index];
    if (!slide) return;
    const h = slide.offsetHeight;
    if (h) deckEl.style.height = h + "px";
  }

  function paint() {
    const slides = Array.from(deckEl.children);
    slides.forEach((slide, i) => {
      const offset = i - index;
      slide.classList.toggle("is-focus", offset === 0);
      const depth = Math.min(Math.abs(offset), 4);
      if (offset === 0) {
        slide.style.opacity = "1";
        slide.style.transform = "translateY(0) scale(1)";
        slide.style.filter = "none";
        slide.style.zIndex = "40";
        slide.style.pointerEvents = "auto";
      } else if (offset > 0) {
        // Waiting behind: inset on both sides and nudged down so the edges
        // of the stack peek out under the front slide.
        slide.style.opacity = String(Math.max(0.1, 0.46 - (depth - 1) * 0.12));
        slide.style.transform = `translateY(${depth * 17}px) scale(${1 - depth * 0.045})`;
        slide.style.filter = `blur(${depth * 1.1}px)`;
        slide.style.zIndex = String(40 - depth);
        slide.style.pointerEvents = depth === 1 ? "auto" : "none";
      } else {
        // Already shown: lifts and fades out.
        slide.style.opacity = "0";
        slide.style.transform = `translateY(${-depth * 26}px) scale(${1 + depth * 0.015})`;
        slide.style.filter = "blur(7px)";
        slide.style.zIndex = String(10 - depth);
        slide.style.pointerEvents = "none";
      }
      slide.querySelectorAll(".compare-scan-card").forEach((c) => {
        c.style.setProperty("--spot-opacity", "0");
        c.style.setProperty("--border-opacity", "0");
      });
    });

    Array.from(dotsEl.children).forEach((d, i) => d.classList.toggle("active", i === index));
    Array.from(tabsEl.children).forEach((t, i) => {
      t.classList.toggle("active", i === index);
      t.setAttribute("aria-selected", i === index ? "true" : "false");
    });

    const cls = CLASSES[index];
    root.style.setProperty("--class-accent", cls.accent);
    root.style.setProperty("--class-soft", cls.accentSoft);
    const note = root.querySelector("[data-cc-note]");
    if (note) note.textContent = cls.blurb;
    sizeDeck();
  }

  function go(next) {
    index = ((next % CLASSES.length) + CLASSES.length) % CLASSES.length;
    paint();
    restart();
  }

  function restart() {
    if (timer) clearInterval(timer);
    if (reduceMotion) return;
    timer = setInterval(() => {
      if (hovered) return;
      index = (index + 1) % CLASSES.length;
      paint();
    }, AUTO_MS);
  }

  if (prevEl) prevEl.addEventListener("click", (e) => { e.stopPropagation(); go(index - 1); });
  if (nextEl) nextEl.addEventListener("click", (e) => { e.stopPropagation(); go(index + 1); });

  const stage = root.querySelector("[data-cc-stage]") || deckEl;
  stage.addEventListener("pointerenter", () => { hovered = true; });
  stage.addEventListener("pointerleave", () => { hovered = false; });

  window.addEventListener("resize", sizeDeck);
  if ("ResizeObserver" in window) {
    new ResizeObserver(sizeDeck).observe(deckEl.children[0] || deckEl);
  }

  build();
  paint();
  // Fonts and images can settle after first paint and change the height.
  setTimeout(sizeDeck, 120);
  setTimeout(sizeDeck, 600);
  restart();
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-class-compare]").forEach((root) => window.initClassCompare(root));
});
