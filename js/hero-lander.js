/* ========================================================================
   Atom — moon-landing hero.

   A grainy lunar scene: a lander drops from above, its legs deploy on the
   way down, the descent engine washes the ground with a soft glow, and it
   sets down — once. It does not loop; a page load replays it.

   Kept deliberately restrained so it reads as an illustration, not a pile of
   primitives: one warm light source (sun, upper right); smooth metal on the
   lander; a soft translucent engine wash instead of a hard beam; legs that
   fold out as it lands. Film grain over the whole frame.
   ======================================================================== */

(function () {
  const host = document.getElementById("lander-scene");
  if (!host) return;

  const NS = "http://www.w3.org/2000/svg";
  const W = 1440, H = 860;

  const rnd = (() => { let s = 24681; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const rr = (a, b) => a + (b - a) * rnd();
  const fx = (n) => Math.round(n * 10) / 10;

  let svg;
  const mk = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(el);
    return el;
  };

  svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("class", "lander-svg");
  svg.setAttribute("aria-hidden", "true");
  host.appendChild(svg);

  const defs = mk("defs", {});
  const grad = (id, stops, attrs, type) => {
    const g = mk(type || "linearGradient", Object.assign({ id }, attrs || {}), defs);
    stops.forEach((s) => mk("stop", { offset: s[0], "stop-color": s[1], "stop-opacity": s[2] == null ? 1 : s[2] }, g));
    return g;
  };
  const blur = (id, dev) => { const f = mk("filter", { id, x: "-90%", y: "-90%", width: "280%", height: "280%" }, defs); mk("feGaussianBlur", { stdDeviation: dev }, f); };

  /* ------ scene constants ------ */
  const SUN = { x: 1258, y: 120 };
  const GROUND = 600;   // pad-contact y at the lander
  const LX = 1010;
  const DROP = 540;

  /* ------ gradients ------ */
  grad("sky", [["0%", "#050609"], ["46%", "#0a0d18"], ["80%", "#15182a"], ["100%", "#2a2038"]], { x1: 0, y1: 0, x2: 0, y2: 1 });
  grad("dawn", [["0%", "#f0c49a", 0.4], ["30%", "#8a63b4", 0.16], ["100%", "#0a0d18", 0]], { cx: "0.84", cy: "0.68", r: "0.6" }, "radialGradient");
  grad("sun", [["0%", "#fffef9"], ["42%", "#ffe7bb"], ["76%", "#ffbe84"], ["100%", "#ff9d5a", 0]], { cx: "0.5", cy: "0.5", r: "0.5" }, "radialGradient");
  grad("corona", [["0%", "#fff3da", 0.45], ["36%", "#ffd49c", 0.18], ["68%", "#8fccff", 0.07], ["100%", "#8fccff", 0]], { cx: "0.5", cy: "0.5", r: "0.5" }, "radialGradient");
  grad("earth", [["0%", "#b3e2ff"], ["45%", "#3079c6"], ["100%", "#123a6b"]], { cx: "0.36", cy: "0.3", r: "0.72" }, "radialGradient");
  grad("earthGlow", [["0%", "#8fccff", 0.5], ["60%", "#3d7bff", 0.12], ["100%", "#3d7bff", 0]], { cx: "0.5", cy: "0.5", r: "0.5" }, "radialGradient");

  // Ground: cool, a touch warmer/lighter on the sun (right) side, plus a
  // sunlit strip along the horizon.
  grad("ground", [["0%", "#454b60"], ["52%", "#343a4d"], ["100%", "#222634"]], { x1: 0.05, y1: 0, x2: 0.85, y2: 0.5 });
  grad("horizonLit", [["0%", "#6f6a86", 0.0], ["70%", "#8a7fa6", 0.35], ["100%", "#c9a9d6", 0.55]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  grad("bowl", [["0%", "#333b4e"], ["45%", "#171a24"], ["100%", "#0a0c12"]], { cx: "0.5", cy: "0.32", r: "0.62" }, "radialGradient");

  // Lander — smooth brushed metal, lit from the right.
  grad("hull", [["0%", "#828da1"], ["34%", "#c3cbd9"], ["62%", "#f6f8fc"], ["86%", "#e2e8f1"], ["100%", "#c0c8d5"]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  grad("collar", [["0%", "#6c7488"], ["50%", "#aab3c3"], ["100%", "#7c8698"]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  grad("foil", [["0%", "#7f611f"], ["38%", "#d8b95e"], ["66%", "#f4e2a4"], ["100%", "#b98f3c"]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  grad("bell", [["0%", "#161922"], ["50%", "#333a49"], ["100%", "#0e1017"]], { x1: 0, y1: 0, x2: 1, y2: 0 });
  grad("leg", [["0%", "#7c8698"], ["45%", "#c4ccda"], ["100%", "#828da1"]], { x1: 0, y1: 0, x2: 1, y2: 0 });

  // Engine wash + glows.
  grad("wash", [["0%", "#bff0ff", 0.55], ["45%", "#5cc6ea", 0.24], ["100%", "#5cc6ea", 0]], { x1: 0, y1: 0, x2: 0, y2: 1 });
  grad("pool", [["0%", "#a9ecff", 0.5], ["55%", "#4bb6dd", 0.18], ["100%", "#4bb6dd", 0]], { cx: "0.5", cy: "0.5", r: "0.5" }, "radialGradient");
  grad("eglow", [["0%", "#eafcff", 0.95], ["45%", "#66d6f2", 0.55], ["100%", "#66d6f2", 0]], { cx: "0.5", cy: "0.5", r: "0.5" }, "radialGradient");
  grad("dust", [["0%", "#c4ccd8", 0.7], ["60%", "#a7afbe", 0.3], ["100%", "#a7afbe", 0]], { cx: "0.5", cy: "0.5", r: "0.5" }, "radialGradient");

  blur("b6", "6"); blur("b3", "2.2"); blur("b14", "14"); blur("b28", "28");
  (function () {
    const f = mk("filter", { id: "grain" }, defs);
    mk("feTurbulence", { type: "fractalNoise", baseFrequency: "0.8", numOctaves: "2", stitchTiles: "stitch", result: "n" }, f);
    mk("feColorMatrix", { in: "n", type: "matrix", values: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.7 0" }, f);
  })();
  (function () {
    const f = mk("filter", { id: "mottle" }, defs);
    mk("feTurbulence", { type: "fractalNoise", baseFrequency: "0.01 0.024", numOctaves: "3", seed: "11", stitchTiles: "stitch", result: "n" }, f);
    mk("feColorMatrix", { in: "n", type: "matrix", values: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.42 0" }, f);
  })();

  /* ------ sky ------ */
  mk("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#sky)" });
  mk("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#dawn)" });
  const starG = mk("g", {});
  for (let i = 0; i < 120; i++) {
    const x = rr(0, W), y = rr(0, 450);
    if (Math.hypot(x - SUN.x, y - SUN.y) < 250) continue;
    const st = mk("circle", { cx: fx(x), cy: fx(y), r: fx(rr(0.4, 1.5)), fill: "#eef4ff", opacity: fx(rr(0.25, 0.9)) }, starG);
    if (rnd() < 0.3) mk("animate", { attributeName: "opacity", values: "0.2;0.9;0.2", dur: fx(rr(3, 6)) + "s", begin: fx(rr(0, 5)) + "s", repeatCount: "indefinite" }, st);
  }

  /* ------ sun ------ */
  mk("circle", { cx: SUN.x, cy: SUN.y, r: 330, fill: "url(#corona)" });
  mk("circle", { cx: SUN.x, cy: SUN.y, r: 70, fill: "url(#sun)", filter: "url(#b6)" });
  mk("circle", { cx: SUN.x, cy: SUN.y, r: 28, fill: "#fffef7" });

  /* ------ earth ------ */
  (function () {
    const cx = 660, cy = 150, R = 40, g = mk("g", {});
    mk("circle", { cx, cy, r: 86, fill: "url(#earthGlow)" }, g);
    mk("circle", { cx, cy, r: R, fill: "url(#earth)" }, g);
    const cp = mk("clipPath", { id: "ec" }, defs); mk("circle", { cx, cy, r: R }, cp);
    const eg = mk("g", { "clip-path": "url(#ec)" }, g);
    mk("path", { d: `M ${cx - 34} ${cy - 4} q 22 -14 42 -2 q 12 10 -4 17 q -30 8 -38 -15 z`, fill: "#33a06e", opacity: 0.92 }, eg);
    mk("path", { d: `M ${cx - 8} ${cy + 13} q 18 -6 32 6 q -8 12 -27 7 q -12 -6 -5 -13 z`, fill: "#2b9364", opacity: 0.85 }, eg);
    mk("ellipse", { cx: cx - 4, cy: cy - 17, rx: 25, ry: 6, fill: "#fff", opacity: 0.45 }, eg);
    mk("path", { d: `M ${cx} ${cy - R} A ${R} ${R} 0 0 0 ${cx} ${cy + R} A ${R * 0.5} ${R} 0 0 1 ${cx} ${cy - R} Z`, fill: "#050a14", opacity: 0.45 }, eg);
    mk("circle", { cx, cy, r: R, fill: "none", stroke: "#c4ebff", "stroke-opacity": 0.5, "stroke-width": 1.4 }, g);
  })();

  /* ------ distant hills ------ */
  mk("path", { d: "M0 508 L170 466 L280 498 L400 452 L520 494 L640 470 L780 502 L920 474 L1080 506 L1220 480 L1340 504 L1440 486 L1440 560 L0 560 Z", fill: "#191d2d", opacity: 0.9 });
  // Sunlit haze on the horizon.
  mk("rect", { x: 0, y: 470, width: W, height: 70, fill: "url(#horizonLit)", opacity: 0.5 });

  /* ------ ground ------ */
  const groundTop = "M0 540 C 260 518, 520 552, 760 534 C 1010 514, 1250 552, 1440 534 L1440 " + H + " L0 " + H + " Z";
  mk("path", { d: groundTop, fill: "url(#ground)" });
  const gclip = mk("clipPath", { id: "gclip" }, defs); mk("path", { d: groundTop }, gclip);
  const surf = mk("g", { "clip-path": "url(#gclip)" });

  // Broad soft shading so the plain isn't flat: a lit swell under the sun and
  // a cool trough on the left.
  mk("ellipse", { cx: 1180, cy: 560, rx: 520, ry: 150, fill: "#5a5f78", opacity: 0.16, filter: "url(#b28)" }, surf);
  mk("ellipse", { cx: 240, cy: 720, rx: 460, ry: 170, fill: "#0c0e16", opacity: 0.3, filter: "url(#b28)" }, surf);
  mk("rect", { x: 0, y: 520, width: W, height: H - 520, filter: "url(#mottle)", opacity: 0.4, style: "mix-blend-mode:overlay;" }, surf);
  // Sunlit rim along the ground's leading edge.
  mk("path", { d: "M0 540 C 260 518, 520 552, 760 534 C 1010 514, 1250 552, 1440 534", fill: "none", stroke: "#b9a6cc", "stroke-width": 2, opacity: 0.4 }, surf);

  // Craters — dimensional: radial bowl (lit upper rim), deep far-side shadow,
  // thin bright sun-rim, soft ejecta.
  function crater(x, y, r) {
    const g = mk("g", {}, surf), ry = r * 0.34;
    mk("ellipse", { cx: x, cy: y, rx: r * 1.55, ry: ry * 1.7, fill: "#5a6178", opacity: 0.10, filter: "url(#b6)" }, g);
    mk("ellipse", { cx: x, cy: y, rx: r, ry: ry, fill: "url(#bowl)" }, g);
    mk("ellipse", { cx: x - r * 0.16, cy: y + ry * 0.34, rx: r * 0.66, ry: ry * 0.56, fill: "#07080d", opacity: 0.55 }, g);
    mk("path", { d: `M ${x - r * 0.96} ${y - ry * 0.16} A ${r} ${ry} 0 0 1 ${x + r * 0.96} ${y - ry * 0.16}`, fill: "none", stroke: "#9aa2b8", "stroke-width": Math.max(1.4, r * 0.045), opacity: 0.5 }, g);
  }
  [[168, 726, 70], [430, 800, 50], [92, 812, 38], [566, 690, 30], [706, 812, 78],
   [322, 672, 24], [1260, 730, 60], [1372, 806, 42], [1140, 806, 34], [1424, 656, 30],
   [246, 636, 18], [610, 640, 16], [872, 636, 22], [1052, 700, 20], [980, 792, 26]].forEach((c) => crater(c[0], c[1], c[2]));

  // Rocks — lit right face, dark left, cast shadow to the lower-left.
  function rock(x, y, s, back) {
    const g = mk("g", { transform: `translate(${x} ${y}) scale(${s})` }, surf);
    mk("ellipse", { cx: -12, cy: 9, rx: 36, ry: 9, fill: "#07080d", opacity: back ? 0.26 : 0.42, filter: "url(#b3)" }, g);
    mk("path", { d: "M-28 5 C -34 -14 -20 -30 3 -30 C 24 -30 34 -15 30 4 L 27 7 L -26 7 Z", fill: back ? "#2c3242" : "#3a4153" }, g);
    mk("path", { d: "M-28 5 C -34 -14 -20 -30 3 -30 C 9 -30 14 -28 18 -24 L 3 7 L -26 7 Z", fill: back ? "#232836" : "#282e3c" }, g);
    mk("path", { d: "M3 -30 C 24 -30 34 -15 30 4 L 19 5 C 21 -12 14 -24 3 -30 Z", fill: back ? "#49536b" : "#5a6379" }, g);
  }
  rock(300, 654, 0.8, true); rock(1336, 686, 1.0, true);
  rock(150, 748, 1.5, false); rock(566, 812, 1.9, false);

  /* ------ soft ground light pool under the engine (during descent) ------ */
  const pool = mk("ellipse", { cx: LX, cy: GROUND + 2, rx: 60, ry: 16, fill: "url(#pool)", opacity: 0, filter: "url(#b6)" });

  /* ============================ LANDER ============================
     Local origin (0,0) = centre of body bottom. Body rises in -y; engine and
     legs go down in +y. Placed by a wrapper group and animated. */
  const move = mk("g", { id: "lander-move" });

  // Body ground-shadow, so it sits on the surface.
  const bodyShadow = mk("ellipse", { cx: 0, cy: 62, rx: 120, ry: 20, fill: "#07080d", opacity: 0, filter: "url(#b14)" }, move);
  move.appendChild(bodyShadow);
  move.removeChild(bodyShadow); // (re-added below, after legs, so ordering is intentional)

  // Soft engine wash (translucent cone) + throat glow — NO hard beam.
  const wash = mk("g", { id: "wash", opacity: 0 }, move);
  mk("path", { d: "M-14 26 L14 26 L58 250 L-58 250 Z", fill: "url(#wash)", filter: "url(#b14)" }, wash);
  const throat = mk("ellipse", { cx: 0, cy: 30, rx: 18, ry: 8, fill: "url(#eglow)", filter: "url(#b3)", opacity: 0.9 }, wash);

  const lander = mk("g", { id: "lander" }, move);

  // --- rear legs (behind body): drawn first, smaller, darker ---
  const backLegs = [];
  [-1, 1].forEach((d) => {
    const g = mk("g", { transform: `translate(${d * 20} -14)` }, lander);
    mk("path", { d: "M-3 0 L3 0 L4 78 L-4 78 Z", fill: "#5a627a" }, g);
    mk("ellipse", { cx: 0, cy: 80, rx: 11, ry: 4, fill: "#5a627a" }, g);
    backLegs.push({ g, d });
  });

  // --- engine bell ---
  mk("path", { d: "M-18 -6 L18 -6 L32 42 L-32 42 Z", fill: "url(#bell)" }, lander);
  for (let i = -26; i <= 26; i += 8) mk("line", { x1: i * 0.6, y1: -4, x2: i, y2: 40, stroke: "#0a0c12", "stroke-width": 1, opacity: 0.4 }, lander);
  mk("ellipse", { cx: 0, cy: 42, rx: 32, ry: 7, fill: "#0a0c12" }, lander);
  mk("ellipse", { cx: 0, cy: 42, rx: 20, ry: 4, fill: "#05070c" }, lander);
  mk("ellipse", { cx: 0, cy: -6, rx: 18, ry: 5, fill: "#2a3140" }, lander);

  // --- front legs: hinged groups that DEPLOY (rotate out + extend) ---
  const frontLegs = [];
  [-1, 1].forEach((d) => {
    // Pivot up on the lower body; the leg is drawn pointing straight down and
    // is rotated/scaled to deploy.
    const g = mk("g", {}, lander);
    mk("circle", { cx: 0, cy: 0, r: 5, fill: "#8b95a8" }, g);            // hinge knuckle
    mk("path", { d: "M-4.5 0 L4.5 0 L3 96 L-3 96 Z", fill: "url(#leg)" }, g);  // main strut
    mk("path", { d: "M-4.5 0 L-1.5 0 L-2 96 L-4 96 Z", fill: "#e9eef6", opacity: 0.7 }, g); // lit edge
    mk("path", { d: "M2 18 L14 40 L11 44 L0 26 Z", fill: "#98a2b4" }, g);  // side brace
    mk("ellipse", { cx: 0, cy: 98, rx: 17, ry: 6, fill: "#aeb8c8" }, g);   // footpad
    mk("ellipse", { cx: 0, cy: 94, rx: 11, ry: 4, fill: "#d6dde8" }, g);   // pad cap
    frontLegs.push({ g, d, px: d * 30, py: -26 });
  });

  // --- body ---
  const bodyPath = "M-46 0 L-46 -152 C-46 -182 -26 -198 0 -198 C26 -198 46 -182 46 -152 L46 0 Z";
  mk("path", { d: bodyPath, fill: "url(#hull)", stroke: "#79839a", "stroke-width": 1 }, lander);
  mk("path", { d: "M-46 -150 L-46 0 L-24 0 C-35 -58 -35 -112 -27 -150 Z", fill: "#5a6274", opacity: 0.45 }, lander); // left ambient shadow
  mk("path", { d: "M41 -158 C46 -150 46 -138 46 -126 L46 -14 C46 -8 44 -6 42 -6 C46 -72 46 -112 41 -158 Z", fill: "#ffffff", opacity: 0.65 }, lander); // right specular

  // Collar rings (mechanical joints top and bottom of the mid-section).
  mk("rect", { x: -46, y: -8, width: 92, height: 9, rx: 3, fill: "url(#collar)" }, lander);

  // Foil (MLI) lower band — clean, only a few soft creases.
  mk("path", { d: "M-46 -52 L46 -52 L46 -6 C46 0 -46 0 -46 -6 Z", fill: "url(#foil)" }, lander);
  [-30, -12, 8, 26].forEach((x) => mk("path", { d: `M ${x} -50 q ${fx(rr(-2, 2))} 12 0 24 q ${fx(rr(-2, 2))} 10 ${fx(rr(-2, 2))} 20`, fill: "none", stroke: "#8a6d2a", "stroke-width": 1, opacity: 0.45 }, lander));
  mk("path", { d: "M-46 -52 L46 -52", stroke: "#7a5f22", "stroke-width": 1, opacity: 0.5 }, lander);

  // Panel seams + rivets.
  [-122, -98, -76].forEach((y) => mk("line", { x1: -44, y1: y, x2: 44, y2: y, stroke: "#aab4c6", "stroke-width": 1, opacity: 0.5 }, lander));
  for (let i = -40; i <= 40; i += 10) mk("circle", { cx: i, cy: -98, r: 1, fill: "#8b95a8", opacity: 0.55 }, lander);

  // Window band + reflection.
  mk("rect", { x: -30, y: -174, width: 60, height: 18, rx: 9, fill: "#111a27" }, lander);
  mk("rect", { x: -30, y: -174, width: 60, height: 18, rx: 9, fill: "none", stroke: "#39cfee", "stroke-width": 1, opacity: 0.6 }, lander);
  mk("path", { d: "M-18 -172 L-8 -160", stroke: "#a9f0ff", "stroke-width": 2.4, opacity: 0.65 }, lander);

  // Atom roundel + ATOM wordmark.
  const roundel = mk("g", { transform: "translate(0 -122)" }, lander);
  mk("circle", { r: 17, fill: "#132238" }, roundel);
  mk("circle", { r: 17, fill: "none", stroke: "#fff", "stroke-width": 1, opacity: 0.5 }, roundel);
  [0, 60, 120].forEach((a) => mk("ellipse", { rx: 13, ry: 5.2, fill: "none", stroke: "#3ad0ee", "stroke-width": 1.5, transform: `rotate(${a})` }, roundel));
  mk("circle", { r: 2.6, fill: "#8ff0ff" }, roundel);
  const word = mk("text", { x: 0, y: -90, "text-anchor": "middle", fill: "#37415a", "font-family": "'Poiret One','Sora',sans-serif", "font-size": "17", "letter-spacing": "1.5", "font-weight": "400" }, lander);
  word.textContent = "ATOM";

  // Re-add the body ground-shadow at the very back of the move group.
  move.insertBefore(bodyShadow, move.firstChild);

  /* ------ dust sheet ------ */
  const dustG = mk("g", { id: "dust", opacity: 0, transform: `translate(${LX} ${GROUND + 4})` });
  const scorch = mk("ellipse", { cx: 0, cy: 0, rx: 110, ry: 22, fill: "#0b0d14", opacity: 0, filter: "url(#b6)" }, dustG);
  const sheets = [];
  for (let i = 0; i < 12; i++) {
    const dir = i % 2 ? 1 : -1;
    const el = mk("ellipse", { cx: 0, cy: fx(rr(-3, 5)), rx: 18, ry: fx(rr(6, 11)), fill: "url(#dust)" }, dustG);
    sheets.push({ el, dir, speed: rr(0.75, 1.25), delay: rr(0, 0.22), yr: parseFloat(el.getAttribute("ry")) });
  }

  /* ------ assemble ------ */
  svg.appendChild(starG);
  svg.appendChild(surf);
  svg.appendChild(pool);
  svg.appendChild(move);
  svg.appendChild(dustG);

  // Foreground rocks the lander passes behind on the way down.
  const fg = mk("g", { "clip-path": "url(#gclip)" });
  [[840, 806, 2.6], [1220, 830, 3.0]].forEach(([x, y, s]) => {
    const g = mk("g", { transform: `translate(${x} ${y}) scale(${s})` }, fg);
    mk("ellipse", { cx: -14, cy: 10, rx: 40, ry: 10, fill: "#07080d", opacity: 0.45, filter: "url(#b3)" }, g);
    mk("path", { d: "M-30 6 C -38 -16 -20 -34 4 -34 C 26 -34 38 -16 32 6 L 28 8 L -28 8 Z", fill: "#333949" }, g);
    mk("path", { d: "M-30 6 C -38 -16 -20 -34 4 -34 C 10 -34 16 -31 20 -26 L 2 8 L -28 8 Z", fill: "#222836" }, g);
    mk("path", { d: "M4 -34 C 26 -34 38 -16 32 6 L 20 6 C 22 -12 14 -26 4 -34 Z", fill: "#525b72" }, g);
  });
  svg.appendChild(fg);

  // Grain + vignette.
  mk("rect", { x: 0, y: 0, width: W, height: H, filter: "url(#grain)", opacity: 0.4, style: "mix-blend-mode:soft-light; pointer-events:none;" });
  grad("vig", [["0%", "#050609", 0], ["64%", "#050609", 0.1], ["100%", "#050609", 0.58]], { cx: "0.72", cy: "0.42", r: "0.82" }, "radialGradient");
  mk("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#vig)", style: "pointer-events:none;" });

  /* ------ animation ------ */
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BODY_Y = GROUND - 60;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, t) => a + (b - a) * t;

  // legP: 0 = stowed (legs vertical, tucked, short), 1 = deployed (splayed, full).
  function setLegs(legP) {
    const splay = lerp(3, 34, legP);       // degrees out from vertical
    const len = lerp(0.68, 1, legP);       // telescopic extension
    frontLegs.forEach((L) => {
      L.g.setAttribute("transform", `translate(${L.px} ${L.py}) rotate(${fx(L.d * splay)}) scale(1 ${fx(len)})`);
    });
    backLegs.forEach((L) => {
      L.g.setAttribute("transform", `translate(${L.d * 20} -14) rotate(${fx(L.d * splay * 0.7)}) scale(1 ${fx(len)})`);
    });
  }

  function render(ty, sway, washA, dustP, legP, poolA, shadowA) {
    move.setAttribute("transform", `translate(${fx(LX + sway)} ${fx(BODY_Y + ty)})`);
    wash.setAttribute("opacity", washA.toFixed(3));
    if (washA > 0) throat.setAttribute("opacity", (0.6 + 0.4 * Math.random()).toFixed(2));
    bodyShadow.setAttribute("opacity", shadowA.toFixed(3));
    setLegs(legP);
    pool.setAttribute("opacity", poolA.toFixed(3));
    pool.setAttribute("rx", fx(lerp(40, 74, poolA)));
    const vis = Math.min(1, dustP * 3), fade = Math.max(0, 1 - Math.max(0, dustP - 0.4) / 0.6);
    dustG.setAttribute("opacity", (vis * fade).toFixed(3));
    scorch.setAttribute("opacity", (Math.min(1, dustP * 2) * 0.55).toFixed(3));
    sheets.forEach((s) => {
      const p = Math.max(0, dustP - s.delay), spread = 18 + p * 140 * s.speed;
      s.el.setAttribute("rx", fx(spread));
      s.el.setAttribute("ry", fx(s.yr * (1 + p * 0.6)));
      s.el.setAttribute("transform", `translate(${fx(s.dir * spread * 0.7)} ${fx(-p * 6)})`);
    });
  }

  if (reduce) { render(0, 0, 0, 0, 1, 0, 0.5); return; }

  const T_DESCEND = 3600, T_TOUCH = 520, T_SETTLE = 2000;
  const END = T_DESCEND + T_TOUCH + T_SETTLE;
  let t0 = null;
  function loop(now) {
    if (t0 == null) t0 = now;
    const t = now - t0;
    let ty, sway = 0, washA = 0, dustP = 0, legP = 0, poolA = 0, shadowA = 0;

    if (t < T_DESCEND) {
      const p = easeOut(t / T_DESCEND), pr = t / T_DESCEND;
      ty = -DROP + p * DROP;
      sway = Math.sin(t / 330) * 6 * (1 - p);
      washA = (0.5 + 0.5 * (0.6 + 0.4 * Math.sin(t / 50))) * Math.min(1, pr / 0.15);
      legP = Math.min(1, Math.max(0, (pr - 0.45) / 0.4));    // deploy in the second half
      poolA = Math.max(0, (pr - 0.5) / 0.5) * 0.7;
      shadowA = Math.max(0, (pr - 0.6) / 0.4) * 0.5;
      move.setAttribute("opacity", Math.min(1, t / 220).toFixed(3));
    } else if (t < T_DESCEND + T_TOUCH) {
      const p = (t - T_DESCEND) / T_TOUCH;
      ty = Math.sin(p * Math.PI) * -6;
      washA = 0.75 * (1 - p);
      dustP = p * 0.45;
      legP = 1; poolA = lerp(0.7, 0, p); shadowA = 0.5;
    } else if (t < END) {
      const p = (t - T_DESCEND - T_TOUCH) / T_SETTLE;
      ty = 0; dustP = 0.45 + p * 0.55; legP = 1; shadowA = 0.5;
    } else {
      render(0, 0, 0, 0, 1, 0, 0.5);    // landed, frozen
      return;
    }
    render(ty, sway, washA, dustP, legP, poolA, shadowA);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
