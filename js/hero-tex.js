/* ========================================================================
   Atom, hero headline typeset as real LaTeX.

   The headline is set in Computer Modern by MathJax, so it reads as a
   genuine LaTeX title. Each word is typeset as its own run inside a
   flex-wrapping line, so the headline wraps to the viewport like normal
   text instead of overflowing on one line. "science tutor" keeps the
   brand accent. The plain-text version stays as a fallback for screen
   readers, search, and the brief window before MathJax loads.
   ======================================================================== */

(function () {
  const host = document.getElementById("hero-tex");
  const h1 = host && host.closest("h1");
  if (!host || !h1) return;

  const ACCENT = "#3d7bff";
  const PHRASE = host.getAttribute("data-phrase") || "";
  // Words rendered in the brand accent colour.
  const ACCENT_WORDS = new Set(["science", "tutor"]);

  function texEscape(word) {
    // Keep punctuation with the word; escape TeX specials just in case.
    return word.replace(/([#$%&_{}])/g, "\\$1");
  }

  PHRASE.split(/\s+/).filter(Boolean).forEach((word) => {
    const bare = word.replace(/[.,;:!?]+$/, "").toLowerCase();
    const colored = ACCENT_WORDS.has(bare);
    const body = "\\text{" + texEscape(word) + "}";
    const tex = colored ? "\\color{" + ACCENT + "}{" + body + "}" : body;

    const span = document.createElement("span");
    span.className = "hero-tex-word";
    span.textContent = "\\(" + tex + "\\)";
    host.appendChild(span);
  });

  function typeset() {
    if (!(window.MathJax && window.MathJax.typesetPromise)) return false;
    window.MathJax.typesetPromise([host])
      .then(() => h1.classList.add("tex-ready"))
      .catch(() => {});
    return true;
  }

  if (!typeset()) {
    let tries = 0;
    const t = setInterval(() => {
      if (typeset() || ++tries > 80) clearInterval(t);
    }, 100);
  }
})();
