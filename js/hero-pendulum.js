/* ========================================================================
   Atom, hero free-body-diagram pendulum.
   Real integrated dynamics with live force and velocity vectors:
   T (tension), mg (weight), mg sin(theta) and mg cos(theta) components, v.
   Non-interactive, decorative but physically correct.
   ======================================================================== */

(function () {
  const svg = document.getElementById("fbd-pendulum");
  if (!svg) return;

  const NS = "http://www.w3.org/2000/svg";

  // Geometry (viewBox 0 0 500 550)
  const PX = 250, PY = 60;      // pivot
  const L = 300;                 // string length in px
  const BOB_R = 26;

  // Physics
  const g = 9.81;
  const Lm = 1.0;                // metres (for dynamics)
  let theta = (55 * Math.PI) / 180;
  let omega = 0;

  // Colors
  const C_STRING = "rgba(238,242,250,0.55)";
  const C_ARC = "rgba(238,242,250,0.22)";
  const C_T = "#22d3ee";        // tension, cyan
  const C_MG = "#fbbf24";       // weight, amber
  const C_COMP = "rgba(251,191,36,0.55)"; // components, faded amber
  const C_V = "#4ade80";        // velocity, green
  const C_TEXT = "rgba(238,242,250,0.85)";

  svg.setAttribute("viewBox", "0 0 500 480");

  function make(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(el);
    return el;
  }

  // ---- defs: arrowheads + bob gradient ----
  const defs = make("defs", {});
  function arrowMarker(id, color) {
    const m = make("marker", {
      id, viewBox: "0 0 10 10", refX: "8.5", refY: "5",
      markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
    }, defs);
    make("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }, m);
  }
  arrowMarker("ah-t", C_T);
  arrowMarker("ah-mg", C_MG);
  arrowMarker("ah-comp", C_COMP);
  arrowMarker("ah-v", C_V);

  const grad = make("radialGradient", { id: "fbdBob", cx: "35%", cy: "30%", r: "75%" }, defs);
  make("stop", { offset: "0%", "stop-color": "#eaf6ff" }, grad);
  make("stop", { offset: "38%", "stop-color": "#22d3ee" }, grad);
  make("stop", { offset: "100%", "stop-color": "#2563eb" }, grad);

  const blur = make("filter", { id: "fbdGlow", x: "-60%", y: "-60%", width: "220%", height: "220%" }, defs);
  make("feGaussianBlur", { stdDeviation: "8" }, blur);

  // ---- static scenery ----
  // ceiling hatch
  const ceil = make("g", {});
  make("line", { x1: PX - 90, y1: PY, x2: PX + 90, y2: PY, stroke: "rgba(238,242,250,0.4)", "stroke-width": 3, "stroke-linecap": "round" }, ceil);
  for (let i = -80; i <= 80; i += 16) {
    make("line", { x1: PX + i, y1: PY, x2: PX + i - 9, y2: PY - 12, stroke: "rgba(238,242,250,0.22)", "stroke-width": 2, "stroke-linecap": "round" }, ceil);
  }
  make("circle", { cx: PX, cy: PY, r: 5, fill: "#22d3ee" }, ceil);

  // vertical reference (dashed) from pivot
  make("line", { x1: PX, y1: PY, x2: PX, y2: PY + L + 45, stroke: "rgba(238,242,250,0.18)", "stroke-width": 1.5, "stroke-dasharray": "5 7" });

  // swing arc: circle centred at pivot with radius L, spanning +-62deg (correct orientation)
  (function () {
    const a = (62 * Math.PI) / 180;
    const x1 = PX + L * Math.sin(-a), y1 = PY + L * Math.cos(-a);
    const x2 = PX + L * Math.sin(a),  y2 = PY + L * Math.cos(a);
    make("path", {
      d: `M ${x1} ${y1} A ${L} ${L} 0 0 0 ${x2} ${y2}`,
      fill: "none", stroke: C_ARC, "stroke-width": 1.6, "stroke-dasharray": "3 8", "stroke-linecap": "round",
    });
  })();

  // theta angle arc + label (between vertical and string)
  const angArc = make("path", { fill: "none", stroke: "#38bdf8", "stroke-width": 1.8 });
  const angLabel = make("text", {
    fill: "#38bdf8", "font-size": "17", "font-style": "italic",
    "font-family": "'JetBrains Mono', monospace",
  });
  angLabel.textContent = "θ";

  // ---- dynamic elements ----
  const stringEl = make("line", { stroke: C_STRING, "stroke-width": 2.6, "stroke-linecap": "round" });

  // component dashed guides (parallelogram)
  const guide1 = make("line", { stroke: "rgba(238,242,250,0.18)", "stroke-width": 1.2, "stroke-dasharray": "4 5" });
  const guide2 = make("line", { stroke: "rgba(238,242,250,0.18)", "stroke-width": 1.2, "stroke-dasharray": "4 5" });

  // vectors (drawn under bob glow, above guides)
  const vecComp1 = make("line", { stroke: C_COMP, "stroke-width": 2.4, "marker-end": "url(#ah-comp)", "stroke-dasharray": "6 4" }); // mg sin
  const vecComp2 = make("line", { stroke: C_COMP, "stroke-width": 2.4, "marker-end": "url(#ah-comp)", "stroke-dasharray": "6 4" }); // mg cos
  const vecMg = make("line", { stroke: C_MG, "stroke-width": 3, "marker-end": "url(#ah-mg)" });
  const vecT = make("line", { stroke: C_T, "stroke-width": 3, "marker-end": "url(#ah-t)" });
  const vecV = make("line", { stroke: C_V, "stroke-width": 3, "marker-end": "url(#ah-v)" });

  // bob
  const bobGlow = make("circle", { r: BOB_R * 1.45, fill: "url(#fbdBob)", filter: "url(#fbdGlow)", opacity: 0.5 });
  const bob = make("circle", { r: BOB_R, fill: "url(#fbdBob)", stroke: "rgba(234,246,255,0.5)", "stroke-width": 1.5 });

  // labels
  function label(color, italic) {
    const t = make("text", {
      fill: color, "font-size": "15",
      "font-family": "'JetBrains Mono', monospace",
      "font-style": italic ? "italic" : "normal",
      "font-weight": "600",
      "paint-order": "stroke",
      stroke: "rgba(6,10,20,0.85)", "stroke-width": "4",
    });
    return t;
  }
  const lblT = label(C_T, true);        lblT.textContent = "T";
  const lblMg = label(C_MG, true);      lblMg.textContent = "mg";
  const lblC1 = label(C_COMP, true);    lblC1.textContent = "mg sinθ";
  const lblC2 = label(C_COMP, true);    lblC2.textContent = "mg cosθ";
  const lblV = label(C_V, true);        lblV.textContent = "v";
  const lblL = label("rgba(238,242,250,0.6)", true); lblL.textContent = "L";

  // live theta readout lives in HTML below the SVG (LaTeX caption)
  const thetaOut = document.getElementById("pendulum-theta");

  // ---- render ----
  const MG_LEN = 74; // px length of mg vector

  function render() {
    const s = Math.sin(theta), c = Math.cos(theta);
    const bx = PX + L * s;
    const by = PY + L * c;

    // string + bob
    stringEl.setAttribute("x1", PX); stringEl.setAttribute("y1", PY);
    stringEl.setAttribute("x2", bx); stringEl.setAttribute("y2", by);
    bob.setAttribute("cx", bx); bob.setAttribute("cy", by);
    bobGlow.setAttribute("cx", bx); bobGlow.setAttribute("cy", by);

    // string length label (midpoint, offset perpendicular)
    lblL.setAttribute("x", PX + (L * 0.52) * s + 14 * c);
    lblL.setAttribute("y", PY + (L * 0.52) * c - 14 * s);

    // unit vectors: radial outward (from pivot to bob) = (s, c); tangential = (c, -s)
    // Tension: from bob toward pivot
    const tLen = MG_LEN * (1 + 0.35 * Math.abs(c)); // visual only
    setVec(vecT, bx, by, bx - s * tLen, by - c * tLen);
    lblT.setAttribute("x", bx - s * (tLen + 20) - 6);
    lblT.setAttribute("y", by - c * (tLen + 20) + 5);

    // Weight mg: straight down
    setVec(vecMg, bx, by, bx, by + MG_LEN);
    lblMg.setAttribute("x", bx + 10);
    lblMg.setAttribute("y", by + MG_LEN + 18);

    // Components of mg:
    // tangential (restoring): magnitude mg sin(theta), direction = -sign(theta) tangential
    const compTx = -c * MG_LEN * s;   // tangential unit (c, -s) scaled by -sin(theta)... see below
    // tangential direction that opposes displacement: t_hat = (c, -s) * (theta > 0 ? -1 : 1)
    // magnitude |mg sin theta| ~ MG_LEN * |s|
    const tDirX = c * (theta > 0 ? -1 : 1);
    const tDirY = -s * (theta > 0 ? -1 : 1);
    const tMag = MG_LEN * Math.abs(s);
    setVec(vecComp1, bx, by, bx + tDirX * tMag, by + tDirY * tMag);
    lblC1.setAttribute("x", bx + tDirX * (tMag + 14) - 34);
    lblC1.setAttribute("y", by + tDirY * (tMag + 14) + 22);

    // radial (along string, away from pivot): magnitude mg cos(theta)
    const rMag = MG_LEN * Math.abs(c);
    setVec(vecComp2, bx, by, bx + s * rMag, by + c * rMag);
    lblC2.setAttribute("x", bx + s * (rMag + 14) + 8);
    lblC2.setAttribute("y", by + c * (rMag + 14) + 4);

    // parallelogram guides: from tip of comp1 and tip of comp2 to tip of mg
    guide1.setAttribute("x1", bx + tDirX * tMag); guide1.setAttribute("y1", by + tDirY * tMag);
    guide1.setAttribute("x2", bx); guide1.setAttribute("y2", by + MG_LEN);
    guide2.setAttribute("x1", bx + s * rMag); guide2.setAttribute("y1", by + c * rMag);
    guide2.setAttribute("x2", bx); guide2.setAttribute("y2", by + MG_LEN);

    // Velocity: tangential, direction of motion (sign of omega along t_hat_+ = (c, -s))
    const vScale = 26;
    const vLen = Math.min(Math.abs(omega) * vScale, 95);
    if (vLen > 6) {
      vecV.setAttribute("opacity", 1);
      lblV.setAttribute("opacity", 1);
      const vdx = c * Math.sign(omega), vdy = -s * Math.sign(omega);
      setVec(vecV, bx + vdx * (BOB_R + 4), by + vdy * (BOB_R + 4), bx + vdx * (BOB_R + 4 + vLen), by + vdy * (BOB_R + 4 + vLen));
      lblV.setAttribute("x", bx + vdx * (BOB_R + vLen + 22) - 4);
      lblV.setAttribute("y", by + vdy * (BOB_R + vLen + 22) + 5);
    } else {
      vecV.setAttribute("opacity", 0);
      lblV.setAttribute("opacity", 0);
    }

    // theta arc near pivot
    const ar = 52;
    const ax1 = PX, ay1 = PY + ar;
    const ax2 = PX + ar * s, ay2 = PY + ar * c;
    const sweep = theta > 0 ? 0 : 1;
    angArc.setAttribute("d", `M ${ax1} ${ay1} A ${ar} ${ar} 0 0 ${sweep} ${ax2} ${ay2}`);
    angArc.setAttribute("opacity", Math.abs(theta) > 0.06 ? 1 : 0);
    const mid = theta / 2;
    angLabel.setAttribute("x", PX + (ar + 16) * Math.sin(mid) - 5);
    angLabel.setAttribute("y", PY + (ar + 16) * Math.cos(mid) + 6);
    angLabel.setAttribute("opacity", Math.abs(theta) > 0.12 ? 1 : 0);

    // live readout
    if (thetaOut) thetaOut.textContent = (theta * 180 / Math.PI).toFixed(0);
  }

  function setVec(el, x1, y1, x2, y2) {
    el.setAttribute("x1", x1); el.setAttribute("y1", y1);
    el.setAttribute("x2", x2); el.setAttribute("y2", y2);
  }

  // ---- integrate ----
  let last = performance.now();
  let paused = false;
  document.addEventListener("visibilitychange", () => { paused = document.hidden; last = performance.now(); });

  function step(now) {
    let dt = Math.min((now - last) / 1000, 0.032);
    last = now;
    if (!paused) {
      // RK-ish substeps for smoothness, no damping (perpetual display)
      const sub = 4;
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        const a = -(g / Lm) * Math.sin(theta);
        omega += a * h;
        theta += omega * h;
      }
      render();
    }
    requestAnimationFrame(step);
  }
  render();
  requestAnimationFrame(step);
})();
