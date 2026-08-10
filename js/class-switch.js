/* ========================================================================
   Atom Education, subject switcher.

   Renders the segmented control that sits at the top of every Atom Education
   subject page. Built from the shared class list so a new subject appears on
   every page at once, rather than being copied into five files by hand.

   The host element declares where it is:
     <div data-class-switch="physics" data-base="../"></div>
   ======================================================================== */

(function () {
  const host = document.querySelector("[data-class-switch]");
  if (!host || !window.ATOM_CLASSES) return;

  const current = host.getAttribute("data-class-switch");
  const base = host.getAttribute("data-base") || "";
  const G = window.CLASS_GLYPHS || {};

  // Only the five teaching subjects get course pages. Socrates and Kepler are
  // models rather than subjects, so they belong on the Models page instead.
  const subjects = window.ATOM_CLASSES.filter((c) => !c.universal && c.id !== "kepler");

  const links = subjects
    .map((c) => {
      // Physics is the course that actually exists, and lives at the root of
      // /course/; the rest are subdirectories under it.
      const href = c.id === "physics" ? base : base + c.id + "/";
      const isCurrent = c.id === current;
      const tutor = c.tutors && c.tutors[0];
      return (
        `<a href="${href}"` +
        (isCurrent ? ' aria-current="page"' : "") +
        (tutor ? ` data-tier="${tutor.id}"` : "") +
        `><span class="cs-glyph" aria-hidden="true">${G[c.icon] || ""}</span>` +
        `${c.name}</a>`
      );
    })
    .join("");

  host.className = "class-switch-wrap";
  host.innerHTML =
    '<div class="class-switch-label">Atom Education</div>' +
    '<nav class="class-switch" aria-label="Choose a subject">' + links + "</nav>";
})();
