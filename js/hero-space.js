/* ========================================================================
   Atom hero deck v3.

   - 4 plates crossfade on a staggered timer (8s first slide, 5s the rest)
   - Per-slide copy: eyebrow, headline, quote, CTAs, note
   - Lazy loading: plate 0 loads immediately, plates 1-3 load before needed
   - Scroll parallax on the scene container
   - Edge arrows (visible on hover) with timer reset
   - Credits overlay
   ======================================================================== */

(function () {

  /* ── Slide content ─────────────────────────────────────────────────── */
  var SLIDES = [
    {
      duration: 8000,
      // Slide 0 copy lives in the HTML — we read it on init and restore it.
      // Set html: null to signal "use original markup".
      html: null
    },
    {
      duration: 7500,
      eyebrow: "Now available",
      h1: '<span class="accent">Kepler</span> found what the researchers overlooked.',
      ctaPrimary: { label: "Try Kepler", href: "chat/" },
      ctaGhost:   { label: "See all models", href: "#tiers" },
      note: "14 missed exoplanet candidates, spotted by our most powerful model. Patent pending. A paper on the findings has already been submitted to Zenodo."
    },
    {
      duration: 7500,
      eyebrow: "Five sciences. Twenty tutors.",
      h1: 'Twenty tutors. Every subject. <span class="accent">No account needed</span>.',
      ctaPrimary: { label: "Pick a subject", href: "#tiers" },
      ctaGhost:   { label: "Start chatting",  href: "chat/" },
      note: "Physics, chemistry, biology, math, and coding, each with tutors named after the scientists who built the field, from Aristotle to Gauss."
    },
    {
      duration: 7500,
      eyebrow: "Built for understanding.",
      h1: 'Built for students who want to <span class="accent">understand</span>, not just get the answer.',
      ctaPrimary: { label: "Start chatting", href: "chat/" },
      ctaGhost:   { label: "See the models", href: "#tiers" },
      note: "Step by step, from first principles. Real LaTeX, every variable shown, every move explained."
    }
  ];

  var ARROW_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>';

  function buildCopy(slide) {
    var out = '';
    if (slide.eyebrow) {
      out += '<span class="hero-eyebrow">' + slide.eyebrow + '</span>';
    }
    out += '<h1 class="hero-h1"><span class="hero-plain">' + slide.h1 + '</span></h1>';
    out += '<p class="lead lead-quote"><em>“Free AI Tutors that Meet You Where You Are”</em></p>';
    out += '<div class="hero-cta">';
    out += '<a href="' + slide.ctaPrimary.href + '" class="btn btn-glow btn-lg">'
        +  slide.ctaPrimary.label + ' ' + ARROW_SVG + '</a>';
    out += '<a href="' + slide.ctaGhost.href + '" class="btn btn-ghost btn-lg">'
        +  slide.ctaGhost.label + '</a>';
    out += '</div>';
    out += '<p class="hero-note">' + slide.note + '</p>';
    return out;
  }

  /* ── DOM refs ───────────────────────────────────────────────────────── */
  var scene   = document.getElementById("space-scene");
  if (!scene) return;
  var hero    = scene.closest(".hero-space");
  if (!hero) return;

  var plates  = scene.querySelectorAll(".deck-plate");
  var copy    = hero.querySelector(".hero-copy");
  var total   = plates.length;
  var current = 0;
  var timer   = null;

  // Save the original HTML copy for slide 0
  SLIDES[0].html = copy ? copy.innerHTML : "";

  /* ── Lazy-load images ──────────────────────────────────────────────── */
  // Plate 0: load immediately
  plates[0].style.backgroundImage = "url('" + plates[0].dataset.bg + "')";

  // Plates 1-3: load progressively after page is idle, well before their turn
  function lazyLoadPlate(i, delay) {
    setTimeout(function () {
      if (plates[i] && plates[i].dataset.bg) {
        plates[i].style.backgroundImage = "url('" + plates[i].dataset.bg + "')";
      }
    }, delay);
  }
  lazyLoadPlate(1, 3000);   // loads 3s after page ready — well before the 8s first transition
  lazyLoadPlate(2, 8000);   // loads 8s in — before its 13s turn
  lazyLoadPlate(3, 13000);  // loads 13s in — before its 18s turn

  /* ── Copy swap ─────────────────────────────────────────────────────── */
  function swapCopy(index) {
    if (!copy) return;
    copy.classList.add("copy-exit");
    setTimeout(function () {
      // Clear any pending MathJax typesetting before touching the DOM,
      // so MathJax doesn't try replaceChild on about-to-be-detached nodes.
      if (window.MathJax && window.MathJax.typesetClear) {
        try { window.MathJax.typesetClear([copy]); } catch (e) {}
      }
      var slide = SLIDES[index];
      // Use loose != so both null AND undefined fall through to buildCopy.
      // (slide.html is undefined for slides 1-3; strict !== null would be true
      // for undefined, setting innerHTML = undefined → literal "undefined" text.)
      copy.innerHTML = (slide.html != null) ? slide.html : buildCopy(slide);
      copy.classList.remove("copy-exit");
    }, 500);
  }

  /* ── Plate crossfade ────────────────────────────────────────────────── */
  function goTo(index) {
    if (index === current) return;
    plates[current].classList.remove("deck-active");
    plates[current].style.animation = "none";
    current = index;
    void plates[current].offsetWidth;  // reflow to restart animation
    plates[current].style.animation = "";
    plates[current].classList.add("deck-active");
    swapCopy(current);
  }

  function next() { goTo((current + 1) % total); }
  function prev() { goTo((current - 1 + total) % total); }

  /* ── Variable-duration timer chain ──────────────────────────────────── */
  function scheduleNext() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      next();
      scheduleNext();
    }, SLIDES[current].duration);
  }
  scheduleNext();

  function resetTimer() {
    clearTimeout(timer);
    scheduleNext();
  }

  /* ── Edge arrows ─────────────────────────────────────────────────────── */
  var arrowL = hero.querySelector(".deck-arrow--left");
  var arrowR = hero.querySelector(".deck-arrow--right");
  if (arrowL) arrowL.addEventListener("click", function (e) { e.stopPropagation(); prev(); resetTimer(); });
  if (arrowR) arrowR.addEventListener("click", function (e) { e.stopPropagation(); next(); resetTimer(); });

  /* ── Credits overlay ─────────────────────────────────────────────────── */
  var infoBtn  = hero.querySelector(".deck-info-btn");
  var credits  = document.getElementById("deck-credits");
  var closeBtn = credits ? credits.querySelector(".deck-credits__close") : null;
  if (infoBtn && credits) {
    infoBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      credits.hidden = !credits.hidden;
    });
    if (closeBtn) closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      credits.hidden = true;
    });
    document.addEventListener("click", function (e) {
      if (!credits.hidden && !credits.contains(e.target) && e.target !== infoBtn) {
        credits.hidden = true;
      }
    });
  }

  /* ── Fade in ─────────────────────────────────────────────────────────── */
  requestAnimationFrame(function () { scene.classList.add("is-ready"); });

  /* ── Scroll parallax ─────────────────────────────────────────────────── */
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = window.scrollY || window.pageYOffset || 0;
      if (y > hero.offsetHeight + 240) return;
      scene.style.transform = "translate3d(0," + (y * 0.3).toFixed(1) + "px,0)";
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

})();
