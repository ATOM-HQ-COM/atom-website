/* ========================================================================
   Atom, Models page.

   Replaces the old layout, which stacked a full comparison table plus four
   "pick this one if" cards for all five classes on a single page. Everything
   is driven off the shared class data, and only one class is shown at a
   time, so the page is short enough to actually read.

     - Socrates and Kepler are featured at the top: they are not one rank
       inside a subject, they are their own thing.
     - A tab strip switches the class below; the four models for that class
       render as cards with a compact spec table underneath.
     - The tab is reflected in the URL hash, so /compare/#biology deep-links
       straight to that class (the header Models menu relies on this).
   ======================================================================== */

(function () {
  const host = document.getElementById("models-root");
  if (!host || !window.ATOM_CLASSES) return;

  const CLASSES = window.ATOM_CLASSES;
  const G = window.CLASS_GLYPHS || {};
  const byId = (id) => CLASSES.find((c) => c.id === id);
  const SUBJECTS = CLASSES.filter((c) => !c.universal && c.id !== "kepler");

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  const ARROW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" width="13" height="13">' +
    '<path d="M5 12h13M12 5l7 7-7 7"/></svg>';

  const chatHref = (cls, tutor) =>
    "../chat/?class=" + cls.id + (tutor ? "&tier=" + tutor.id : "");

  /* ------------------------------------------------------------ featured */
  function featureCard(cls) {
    const t = cls.tutors[0];
    const f = t.facts || {};
    const facts = Object.keys(f)
      .map((k) => `<span>${esc(k)} <b>${esc(f[k])}</b></span>`)
      .join("");
    return (
      `<article class="model-feature card" id="${cls.id}" data-tier="${t.id}">` +
      `<div class="mf-token" aria-hidden="true">${esc(t.initial)}</div>` +
      `<h3>${esc(cls.name)}</h3>` +
      `<div class="mf-role">${esc(t.level)}</div>` +
      `<div class="mf-body">` +
      `<p>${esc(t.description)}</p>` +
      `<div class="mf-facts">${facts}</div>` +
      `<a class="btn btn-glow" href="${chatHref(cls, t)}">Open ${esc(cls.name)}</a>` +
      `</div></article>`
    );
  }

  /* ------------------------------------------------------------- per class */
  function modelCard(cls, t) {
    return (
      `<a class="model-card card" data-tier="${t.id}" href="${chatHref(cls, t)}">` +
      `<div class="mc-top">` +
      `<span class="mc-token" aria-hidden="true">${esc(t.initial)}</span>` +
      // Two block children rather than nested spans, so the name and level
      // sit on their own lines instead of colliding at the card edge.
      `<div class="mc-title">` +
      `<span class="mc-name">${esc(t.name)}</span>` +
      `<span class="mc-level">${esc(t.short || t.level)}</span>` +
      `</div>` +
      `</div>` +
      `<p class="mc-desc">${esc(t.description)}</p>` +
      `<span class="mc-cta">Talk to ${esc(t.name)} ${ARROW}</span>` +
      `</a>`
    );
  }

  function specTable(cls) {
    const rows = [
      ["Level", (t) => t.level],
      ["Best for", (t) => (t.facts || {}).best],
      [cls.depthLabel || "Depth", (t) => (t.facts || {}).depth],
      ["Style", (t) => (t.facts || {}).style],
      ["Diagrams", (t) => (t.canDiagram ? "Yes" : "—")],
      ["Video walkthroughs", (t) => (t.canVideo ? "Yes" : "—")],
    ];
    const head =
      `<tr><th scope="col">&nbsp;</th>` +
      cls.tutors.map((t) => `<th scope="col" data-tier="${t.id}">${esc(t.name)}</th>`).join("") +
      `</tr>`;
    const body = rows
      .map(
        ([label, get]) =>
          `<tr><th scope="row">${esc(label)}</th>` +
          cls.tutors.map((t) => `<td>${esc(get(t) || "—")}</td>`).join("") +
          `</tr>`
      )
      .join("");
    return (
      `<div class="models-spec-wrap"><table class="model-spec">` +
      `<thead>${head}</thead><tbody>${body}</tbody></table></div>`
    );
  }

  function renderClass(cls) {
    document.getElementById("models-class").innerHTML =
      `<div class="models-class-head">` +
      `<h3>${esc(cls.name)}</h3><p>${esc(cls.blurb || cls.tagline)}</p></div>` +
      `<div class="model-grid">${cls.tutors.map((t) => modelCard(cls, t)).join("")}</div>` +
      specTable(cls);
  }

  /* ----------------------------------------------------------------- build */
  const socrates = byId("socrates");
  const kepler = byId("kepler");
  const featured = [socrates, kepler].filter(Boolean).map(featureCard).join("");

  host.innerHTML =
    `<div class="model-feature-grid">${featured}</div>` +
    `<div class="models-head">` +
    `<span class="section-eyebrow">Every subject</span>` +
    `<h2>Four models per class.</h2>` +
    `<p>Same subject, four depths. Pick the one that matches where you actually are &mdash; ` +
    `you can switch mid-conversation without losing the thread.</p>` +
    `</div>` +
    `<div class="models-tabs" role="tablist" aria-label="Choose a class">` +
    SUBJECTS.map((c, i) => {
      const t = c.tutors[0];
      return (
        `<button type="button" role="tab" data-class="${c.id}" data-tier="${t.id}" ` +
        `aria-selected="${i === 0}" id="tab-${c.id}">` +
        `<span class="mt-glyph" aria-hidden="true">${G[c.icon] || ""}</span>${esc(c.name)}</button>`
      );
    }).join("") +
    `</div>` +
    `<div id="models-class"></div>`;

  const tabs = Array.from(host.querySelectorAll(".models-tabs button"));

  function select(id, push) {
    const cls = SUBJECTS.find((c) => c.id === id) || SUBJECTS[0];
    tabs.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.class === cls.id)));
    renderClass(cls);
    if (push && history.replaceState) history.replaceState(null, "", "#" + cls.id);
  }

  tabs.forEach((b) => b.addEventListener("click", () => select(b.dataset.class, true)));

  // A #socrates / #kepler hash targets a feature card, so only scroll for those;
  // a subject hash selects that tab instead.
  function fromHash() {
    const h = (location.hash || "").replace("#", "");
    if (SUBJECTS.some((c) => c.id === h)) select(h, false);
    else select(SUBJECTS[0].id, false);
  }
  window.addEventListener("hashchange", fromHash);
  fromHash();
})();
