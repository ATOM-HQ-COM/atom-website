/* ========================================================================
   Atom, header mega menu.

   Builds the Chat / Atom Education / Models dropdowns from the shared class
   data in atom-classes.js, so adding a class or a tutor there flows into the
   navigation automatically and nothing has to be kept in sync by hand.

   Shape (following the Cyera pattern the design references):
     - one or two large feature cards on the left
     - a titled list of destinations on the right

   Behaviour:
     - opens on hover on pointer devices, with a short close delay and an
       invisible bridge above the panel so the pointer can travel from the
       trigger onto the panel without it snapping shut
     - opens on click / Enter for keyboard and touch
     - Escape closes and returns focus to the trigger
     - below 860px the panel collapses into the mobile drawer as a plain
       nested list, so the same markup serves both
   ======================================================================== */

(function () {
  const root = document.querySelector(".nav-links");
  if (!root || !window.ATOM_CLASSES) return;

  const CLASSES = window.ATOM_CLASSES;
  const G = window.CLASS_GLYPHS || {};
  const byId = (id) => CLASSES.find((c) => c.id === id);

  // Pages sit at the site root or one directory down; every generated href is
  // written relative to the page doing the rendering.
  const BASE = root.getAttribute("data-nav-base") || "";
  const href = (p) => BASE + p;

  const ARROW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" width="13" height="13">' +
    '<path d="M5 12h13M12 5l7 7-7 7"/></svg>';
  const CHEV =
    '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="m6 9 6 6 6-6"/></svg>';

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  /* A large feature card. `tier` sets the --plate tokens so the artwork
     picks up that model's colour from the theme. */
  function card(opts) {
    return (
      `<a class="mega-card" href="${opts.href}"` +
      (opts.tier ? ` data-tier="${opts.tier}"` : "") +
      `>` +
      `<span class="mega-card-art" aria-hidden="true">${opts.glyph || ""}</span>` +
      `<h4>${esc(opts.title)}</h4>` +
      `<p>${esc(opts.text)}</p>` +
      `<span class="mega-go">${esc(opts.cta)} ${ARROW}</span>` +
      `</a>`
    );
  }

  function listItem(opts) {
    return (
      `<li><a href="${opts.href}"` +
      (opts.tier ? ` data-tier="${opts.tier}"` : "") +
      `>` +
      `<span class="mega-glyph" aria-hidden="true">${opts.glyph || ""}</span>` +
      `<span><span class="mega-name">${esc(opts.name)}</span>` +
      (opts.sub ? `<span class="mega-sub">${esc(opts.sub)}</span>` : "") +
      `</span></a></li>`
    );
  }

  function panel(featureHtml, colTitle, itemsHtml, footHtml) {
    return (
      `<div class="mega" role="group">` +
      `<div class="mega-inner">` +
      `<div class="mega-feature">${featureHtml}</div>` +
      `<div class="mega-list">` +
      `<div class="mega-col-title">${esc(colTitle)}</div>` +
      `<ul class="mega-links">${itemsHtml}</ul>` +
      `</div></div>` +
      (footHtml ? `<div class="mega-foot">${footHtml}</div>` : "") +
      `</div>`
    );
  }

  // The five teaching subjects, in order; Socrates and Kepler are featured
  // separately rather than listed as ordinary classes.
  const SUBJECTS = CLASSES.filter((c) => !c.universal && c.id !== "kepler");
  const socrates = byId("socrates");
  const kepler = byId("kepler");
  const tutorOf = (cls) => (cls && cls.tutors && cls.tutors[0]) || null;

  /* ---------------------------------------------------------------- CHAT */
  /* Every link carries ?class=, which the chat app reads on load, so picking
     a class here drops straight into the conversation instead of showing the
     class picker again. */
  function chatMenu() {
    const feats = [];
    if (kepler) {
      feats.push(
        card({
          href: href("chat/?class=kepler"),
          tier: tutorOf(kepler) ? tutorOf(kepler).id : "kepler",
          glyph: G[kepler.icon] || "",
          title: kepler.name,
          text: kepler.blurb || kepler.tagline || "",
          cta: "Open Kepler",
        })
      );
    }
    if (socrates) {
      feats.push(
        card({
          href: href("chat/?class=socrates"),
          tier: tutorOf(socrates) ? tutorOf(socrates).id : "socrates",
          glyph: G[socrates.icon] || "",
          title: socrates.name,
          text: socrates.blurb || socrates.tagline || "",
          cta: "Talk to Socrates",
        })
      );
    }
    const items = SUBJECTS.map((c) =>
      listItem({
        href: href("chat/?class=" + c.id),
        tier: tutorOf(c) ? tutorOf(c).id : "",
        glyph: G[c.icon] || "",
        name: c.name,
        sub: c.tagline,
      })
    ).join("");
    return panel(
      feats.join(""),
      "Start a class",
      items,
      `<a href="${href("chat/")}">Open the chat and choose there ${ARROW}</a>`
    );
  }

  /* ----------------------------------------------------- ATOM EDUCATION */
  const physics = byId("physics");
  function eduMenu() {
    const feat = physics
      ? card({
          href: href("course/"),
          tier: tutorOf(physics) ? tutorOf(physics).id : "",
          glyph: G[physics.icon] || "",
          title: "Physics",
          text: "The full course and the companion book, free to read online.",
          cta: "Open Physics",
        })
      : "";
    const items = SUBJECTS.filter((c) => c.id !== "physics")
      .map((c) =>
        listItem({
          href: href("course/" + c.id + "/"),
          tier: tutorOf(c) ? tutorOf(c).id : "",
          glyph: G[c.icon] || "",
          name: c.name,
          sub: "Coming soon",
        })
      )
      .join("");
    return panel(feat, "Other subjects", items);
  }

  /* -------------------------------------------------------------- MODELS */
  function modelsMenu() {
    const feats = [];
    if (socrates) {
      feats.push(
        card({
          href: href("compare/#socrates"),
          tier: tutorOf(socrates) ? tutorOf(socrates).id : "socrates",
          glyph: G[socrates.icon] || "",
          title: socrates.name,
          text: "One tutor for every subject, worked out loud and by voice.",
          cta: "About Socrates",
        })
      );
    }
    if (kepler) {
      feats.push(
        card({
          href: href("compare/#kepler"),
          tier: tutorOf(kepler) ? tutorOf(kepler).id : "kepler",
          glyph: G[kepler.icon] || "",
          title: kepler.name,
          text: "The flagship physics model, for work that needs the most depth.",
          cta: "About Kepler",
        })
      );
    }
    const items = SUBJECTS.map((c) =>
      listItem({
        href: href("compare/#" + c.id),
        tier: tutorOf(c) ? tutorOf(c).id : "",
        glyph: G[c.icon] || "",
        name: c.name,
        sub: (c.tutors ? c.tutors.length : 0) + " models",
      })
    ).join("");
    return panel(
      feats.join(""),
      "Compare by subject",
      items,
      `<a href="${href("compare/")}">See every model side by side ${ARROW}</a>`
    );
  }

  const BUILDERS = { chat: chatMenu, education: eduMenu, models: modelsMenu };

  /* ---------------------------------------------------------- behaviour */
  const items = Array.from(root.querySelectorAll("li[data-menu]"));
  if (!items.length) return;

  const panels = [];

  items.forEach((li) => {
    const key = li.getAttribute("data-menu");
    const build = BUILDERS[key];
    const link = li.querySelector("a");
    if (!build || !link) return;

    li.classList.add("has-menu");

    // The label becomes a button that owns the panel, with the original link
    // kept as the panel's first destination via the footer / feature cards.
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "menu-trigger" + (link.classList.contains("active") ? " active" : "");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.innerHTML = esc(link.textContent.trim()) + CHEV;
    li.insertBefore(trigger, link);
    link.remove();

    li.insertAdjacentHTML("beforeend", build());
    const mega = li.querySelector(".mega");
    panels.push({ li, trigger, mega, home: link.getAttribute("href") });

    let closeTimer = null;
    const open = () => {
      clearTimeout(closeTimer);
      panels.forEach((p) => p.li !== li && close(p));
      li.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
      clamp(mega);
    };
    const scheduleClose = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => close({ li, trigger }), 140);
    };

    // Hover only where hovering is meaningful; touch uses the click path.
    if (window.matchMedia("(hover: hover) and (min-width: 861px)").matches) {
      li.addEventListener("mouseenter", open);
      li.addEventListener("mouseleave", scheduleClose);
    }
    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (li.classList.contains("open")) {
        close({ li, trigger });
        // A second press on an already-open menu follows the original link.
        if (window.matchMedia("(hover: hover)").matches) location.href = link.getAttribute("href");
      } else {
        open();
      }
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && li.classList.contains("open")) {
        close({ li, trigger });
        trigger.focus();
      }
    });
    // Tabbing out of the panel closes it.
    li.addEventListener("focusout", (e) => {
      if (!li.contains(e.relatedTarget)) scheduleClose();
    });
  });

  function close(p) {
    p.li.classList.remove("open");
    p.trigger.setAttribute("aria-expanded", "false");
  }

  /* Keep a wide panel inside the viewport. The panel is centred on its
     trigger by default, which overflows for triggers near an edge. */
  function clamp(mega) {
    if (!mega || window.innerWidth <= 860) return;
    mega.style.marginLeft = "0px";
    const r = mega.getBoundingClientRect();
    const pad = 16;
    let shift = 0;
    if (r.right > window.innerWidth - pad) shift = window.innerWidth - pad - r.right;
    else if (r.left < pad) shift = pad - r.left;
    if (shift) mega.style.marginLeft = shift + "px";
  }

  document.addEventListener("click", (e) => {
    panels.forEach((p) => {
      if (!p.li.contains(e.target)) close(p);
    });
  });
  window.addEventListener("resize", () => panels.forEach((p) => close(p)));
})();
