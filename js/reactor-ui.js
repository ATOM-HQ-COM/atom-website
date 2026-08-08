/* ==========================================================================
   Atom, Criticality - control room UI
   Canvas cutaway of the plant, instrument panel, trends, market, controls.
   Physics lives in reactor-sim.js; this file only reads and renders it.
   ========================================================================== */

(function () {
  "use strict";

  const RS = window.ReactorSim;
  if (!RS) return;
  const root = document.getElementById("rg-console");
  if (!root) return;

  const { Reactor, PLANT, SETPOINTS, BETA, clamp, lerp } = RS;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;

  /* ====================================================================== */
  /*  Small helpers                                                         */
  /* ====================================================================== */

  const fmtMoney = (v) => {
    const a = Math.abs(v);
    const s = v < 0 ? "-$" : "$";
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return s + (a / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return s + (a / 1e3).toFixed(0) + "k";
    return s + a.toFixed(0);
  };
  const fmtClock = (hour) => {
    const day = Math.floor(hour / 24) + 1;
    const h = Math.floor(hour % 24);
    const m = Math.floor((hour % 1) * 60);
    return "Day " + day + " · " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  };

  // Colour of the core, from cold blue through operating white-gold to the
  // orange and white of a core that is being destroyed.
  function coreColour(tf, alpha) {
    const stops = [
      [20,   [26, 56, 116]],
      [300,  [60, 140, 220]],
      [600,  [118, 214, 252]],
      [850,  [196, 240, 255]],
      [1000, [255, 240, 198]],   // normal operating temperature
      [1200, [255, 204, 118]],
      [1500, [255, 148, 58]],
      [2000, [255, 92, 44]],
      [2600, [252, 58, 58]],
      [3000, [255, 236, 226]],
    ];
    let i = 0;
    while (i < stops.length - 2 && tf > stops[i + 1][0]) i++;
    const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
    const u = clamp((tf - t0) / (t1 - t0), 0, 1);
    const c = c0.map((v, k) => Math.round(lerp(v, c1[k], u)));
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha == null ? 1 : alpha})`;
  }

  /* ====================================================================== */
  /*  Plant cutaway                                                         */
  /* ====================================================================== */

  const W = 1080, H = 700;

  // vessel geometry, design space
  const V = {
    cx: 250, left: 158, right: 342, top: 108, bot: 534,
    coreL: 186, coreR: 314, coreTop: 342, coreBot: 470,
    lvl0y: 205,        // y of 0 inches
    pxPerIn: 0.855,
  };
  const levelY = (inches) => clamp(V.lvl0y - inches * V.pxPerIn, V.top + 6, V.bot - 6);

  class PlantView {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext("2d");
      this.bubbles = [];
      this.plume = [];
      this.t = 0;
      this.shake = 0;
      for (let i = 0; i < 190; i++) {
        this.bubbles.push({
          x: V.coreL + Math.random() * (V.coreR - V.coreL),
          y: V.coreTop + Math.random() * (V.coreBot - V.coreTop),
          r: 1 + Math.random() * 2.6,
          v: 24 + Math.random() * 46,
        });
      }
      for (let i = 0; i < 46; i++) this.plume.push({ p: Math.random(), s: 0.4 + Math.random() * 0.8, o: (Math.random() - 0.5) * 26 });
      this.fit();
      window.addEventListener("resize", () => this.fit());
    }

    fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.c.clientWidth || W;
      this.c.width = Math.round(w * dpr);
      this.c.height = Math.round(w * (H / W) * dpr);
      this.scale = (w * dpr) / W;
    }

    /* ------------------------------------------------------- primitives */

    pipe(pts, width, stroke, inner) {
      const g = this.ctx;
      g.lineCap = "round"; g.lineJoin = "round";
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineWidth = width; g.strokeStyle = stroke; g.stroke();
      if (inner) { g.lineWidth = Math.max(width - 3, 1); g.strokeStyle = inner; g.stroke(); }
    }

    flow(pts, width, colour, speed, phase, alpha) {
      if (speed <= 0.002) return;
      const g = this.ctx;
      g.save();
      g.globalAlpha = alpha == null ? 0.9 : alpha;
      g.lineCap = "butt"; g.lineJoin = "round";
      g.setLineDash([9, 15]);
      g.lineDashOffset = -phase * (60 + speed * 260);
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.lineWidth = width; g.strokeStyle = colour; g.stroke();
      g.restore();
    }

    label(text, x, y, colour, size, align) {
      const g = this.ctx;
      g.font = (size || 10) + "px 'JetBrains Mono', monospace";
      g.fillStyle = colour || "rgba(200,218,245,0.5)";
      g.textAlign = align || "left";
      g.textBaseline = "middle";
      g.fillText(text, x, y);
      g.textAlign = "left";
    }

    // label with a dark pill behind it, for text that sits over busy artwork
    tag(text, x, y, colour, size, align) {
      const g = this.ctx;
      const s = size || 9;
      g.font = s + "px 'JetBrains Mono', monospace";
      const w = g.measureText(text).width + 8;
      const ax = align === "center" ? x - w / 2 : align === "right" ? x - w : x - 4;
      g.beginPath();
      g.roundRect(ax, y - s * 0.78, w, s * 1.56, 3);
      g.fillStyle = "rgba(6,11,21,0.78)"; g.fill();
      this.label(text, align === "center" ? x : align === "right" ? x - 4 : x, y, colour, s, align);
    }

    valve(x, y, open, size) {
      const g = this.ctx, s = size || 7;
      g.save();
      g.translate(x, y);
      g.beginPath();
      g.moveTo(-s, -s); g.lineTo(0, 0); g.lineTo(-s, s); g.closePath();
      g.moveTo(s, -s); g.lineTo(0, 0); g.lineTo(s, s); g.closePath();
      g.fillStyle = open > 0.5 ? "rgba(52,211,153,0.85)" : "rgba(244,72,95,0.85)";
      g.fill();
      g.lineWidth = 1; g.strokeStyle = "rgba(255,255,255,0.35)"; g.stroke();
      g.restore();
    }

    /* ------------------------------------------------------------- draw */

    draw(r, dt) {
      const g = this.ctx;
      this.t += dt;
      const t = this.t;

      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      g.clearRect(0, 0, W, H);

      // camera shake on violent events
      const violence = clamp((r.pressure - 8) / 5, 0, 1) + clamp(r.damage.melt / 60, 0, 1) + (r.damage.containmentBreach ? 1 : 0);
      this.shake = lerp(this.shake, violence * 3.2, 0.1);
      if (this.shake > 0.05) g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);

      this.drawBackdrop(r, t);
      this.drawContainment(r, t);
      this.drawVessel(r, t, dt);
      this.drawSteamPlant(r, t);
      this.drawCoolingTower(r, t);
      this.drawReadouts(r);
    }

    drawBackdrop(r, t) {
      const g = this.ctx;
      // ground line
      g.fillStyle = "rgba(120,160,220,0.06)";
      g.fillRect(0, 668, W, 2);
      // faint grid
      g.strokeStyle = "rgba(120,160,220,0.035)";
      g.lineWidth = 1;
      for (let x = 0; x <= W; x += 45) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 668); g.stroke(); }
      for (let y = 0; y <= 668; y += 45) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    }

    /* ---- reactor building, drywell, suppression pool ---- */
    drawContainment(r, t) {
      const g = this.ctx;

      // secondary containment (reactor building)
      g.save();
      g.beginPath();
      g.moveTo(38, 664); g.lineTo(38, 96); g.lineTo(250, 26); g.lineTo(462, 96); g.lineTo(462, 664);
      g.closePath();
      const bg = g.createLinearGradient(0, 26, 0, 664);
      bg.addColorStop(0, "rgba(30,46,78,0.55)");
      bg.addColorStop(1, "rgba(11,18,32,0.75)");
      g.fillStyle = bg; g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = r.damage.containmentBreach ? "rgba(244,72,95,0.9)" : "rgba(140,175,235,0.35)";
      g.stroke();
      g.restore();

      // drywell bulb
      g.save();
      g.beginPath();
      g.moveTo(96, 596);
      g.lineTo(96, 300);
      g.bezierCurveTo(96, 150, 170, 74, 250, 74);
      g.bezierCurveTo(330, 74, 404, 150, 404, 300);
      g.lineTo(404, 596);
      g.closePath();
      const dw = clamp(r.drywellP / SETPOINTS.drywellFail, 0, 1);
      const dg = g.createLinearGradient(0, 74, 0, 596);
      dg.addColorStop(0, `rgba(${30 + dw * 150},${44 - dw * 20},${74 - dw * 30},0.5)`);
      dg.addColorStop(1, "rgba(8,14,26,0.6)");
      g.fillStyle = dg; g.fill();
      g.lineWidth = 3;
      g.strokeStyle = r.damage.containmentBreach
        ? "rgba(244,72,95,0.95)"
        : `rgba(${140 + dw * 110},${175 - dw * 100},${235 - dw * 160},${0.5 + dw * 0.45})`;
      g.stroke();
      if (dw > 0.5) { g.shadowBlur = 22 * dw; g.shadowColor = "rgba(244,72,95,0.6)"; g.stroke(); g.shadowBlur = 0; }
      g.restore();

      // corium on the drywell floor after a vessel breach
      if (r.damage.vesselBreach) {
        const spread = clamp(r.damage.melt / 55, 0.15, 1);
        g.save();
        g.beginPath();
        g.ellipse(250, 592, 20 + 130 * spread, 8 + 12 * spread, 0, 0, TAU);
        const cg = g.createRadialGradient(250, 592, 2, 250, 592, 150 * spread + 20);
        cg.addColorStop(0, "rgba(255,240,200,0.95)");
        cg.addColorStop(0.4, "rgba(255,140,40,0.85)");
        cg.addColorStop(1, "rgba(180,30,10,0.15)");
        g.fillStyle = cg; g.fill();
        g.restore();
        this.tag("CORIUM", 250, 596, "rgba(255,190,120,0.95)", 9, "center");
      }

      // suppression pool (torus)
      const poolTop = 604;
      g.save();
      g.beginPath();
      g.roundRect(58, poolTop, 384, 52, 12);
      g.fillStyle = "rgba(10,17,30,0.9)"; g.fill();
      g.clip();
      const heat = clamp((r.poolT - 32) / 160, 0, 1);
      const pg = this.ctx.createLinearGradient(0, poolTop, 0, poolTop + 52);
      pg.addColorStop(0, `rgba(${60 + heat * 190},${150 - heat * 80},${230 - heat * 150},0.75)`);
      pg.addColorStop(1, `rgba(${20 + heat * 120},${70 - heat * 30},${150 - heat * 100},0.9)`);
      g.fillStyle = pg;
      g.fillRect(58, poolTop + 12, 384, 40);
      // ripples
      g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        for (let x = 58; x <= 442; x += 6) {
          const y = poolTop + 13 + i * 3 + Math.sin(x * 0.06 + t * (1.6 + i * 0.5) + i) * 1.6;
          x === 58 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.stroke();
      }
      // SRV discharge boiling
      if (r.srvOpenFrac > 0.02) {
        for (let i = 0; i < 26; i++) {
          const px = 330 + Math.sin(i * 3.7 + t * 2) * 34;
          const py = poolTop + 48 - ((t * 60 * r.srvOpenFrac + i * 9) % 36);
          g.beginPath();
          g.arc(px, py, 1.4 + Math.random() * 1.6, 0, TAU);
          g.fillStyle = "rgba(255,255,255,0.55)"; g.fill();
        }
      }
      g.restore();
      g.lineWidth = 1.5; g.strokeStyle = "rgba(140,175,235,0.3)";
      g.beginPath(); g.roundRect(58, poolTop, 384, 52, 12); g.stroke();
      this.label("SUPPRESSION POOL  " + r.poolT.toFixed(0) + "°C", 66, poolTop + 44, "rgba(200,225,255,0.55)", 9);

      // SRV discharge line from the dome down into the pool
      const srvPts = [[330, 126], [352, 126], [352, 600]];
      this.pipe(srvPts, 7, "rgba(90,120,170,0.5)", "rgba(16,24,42,0.9)");
      this.flow(srvPts, 5, "rgba(235,245,255,0.9)", r.srvFlow, t, 0.85);
      this.valve(352, 178, r.srvOpenFrac > 0.02 ? 1 : 0, 6);
      this.tag("SRV", 352, 106, r.srvOpenFrac > 0.02 ? "rgba(251,191,36,0.95)" : "rgba(200,225,255,0.5)", 8, "center");

      // hardened vent stack
      if (r.ctl.vent > 1) {
        const vp = [[404, 560], [470, 560], [470, 120]];
        this.pipe(vp, 5, "rgba(90,120,170,0.45)");
        this.flow(vp, 3.5, "rgba(190,220,255,0.8)", r.ctl.vent / 100, t, 0.7);
        this.label("VENT", 476, 130, "rgba(251,191,36,0.7)", 9);
      }

      this.label("REACTOR BUILDING", 250, 50, "rgba(200,225,255,0.34)", 9, "center");
      this.tag("DRYWELL " + (r.drywellP * 10).toFixed(2) + " bar", 104, 300,
        r.drywellP > 0.42 ? "rgba(255,150,160,0.95)" : "rgba(200,225,255,0.5)", 9);
    }

    /* ---- reactor pressure vessel ---- */
    drawVessel(r, t, dt) {
      const g = this.ctx;
      const yL = levelY(r.level);
      const uncovered = r.level < PLANT.tafLevel;

      // ---- vessel shell ----
      g.save();
      g.beginPath();
      g.moveTo(V.left, V.top + 46);
      g.bezierCurveTo(V.left, V.top - 22, V.right, V.top - 22, V.right, V.top + 46);
      g.lineTo(V.right, V.bot - 46);
      g.bezierCurveTo(V.right, V.bot + 22, V.left, V.bot + 22, V.left, V.bot - 46);
      g.closePath();
      g.save(); g.clip();

      // steam space
      const sg = g.createLinearGradient(0, V.top, 0, yL);
      sg.addColorStop(0, "rgba(180,205,240,0.20)");
      sg.addColorStop(1, "rgba(210,230,255,0.07)");
      g.fillStyle = sg;
      g.fillRect(V.left, V.top - 30, V.right - V.left, yL - V.top + 30);
      // swirling steam
      g.globalAlpha = clamp(r.steamGen * 0.5, 0.05, 0.5);
      for (let i = 0; i < 8; i++) {
        const px = V.left + 16 + ((i * 37 + t * 22) % (V.right - V.left - 30));
        const py = V.top + 26 + ((i * 19 + t * 9) % Math.max(yL - V.top - 34, 12));
        g.beginPath(); g.arc(px, py, 9 + (i % 3) * 4, 0, TAU);
        g.fillStyle = "rgba(230,242,255,0.10)"; g.fill();
      }
      g.globalAlpha = 1;

      // water
      const wg = g.createLinearGradient(0, yL, 0, V.bot);
      wg.addColorStop(0, "rgba(70,150,235,0.62)");
      wg.addColorStop(1, "rgba(24,64,140,0.80)");
      g.fillStyle = wg;
      g.beginPath();
      g.moveTo(V.left - 4, yL);
      for (let x = V.left - 4; x <= V.right + 4; x += 5) {
        g.lineTo(x, yL + Math.sin(x * 0.09 + t * 2.6) * (1.4 + r.void * 3.4));
      }
      g.lineTo(V.right + 4, V.bot + 30); g.lineTo(V.left - 4, V.bot + 30);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(180,225,255,0.8)"; g.lineWidth = 1.4;
      g.beginPath();
      for (let x = V.left - 4; x <= V.right + 4; x += 5) {
        const y = yL + Math.sin(x * 0.09 + t * 2.6) * (1.4 + r.void * 3.4);
        x === V.left - 4 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();

      // ---- core ----
      this.drawCore(r, t, dt, yL, uncovered);

      g.restore();  // un-clip

      // shell outline
      g.lineWidth = 5;
      g.strokeStyle = r.damage.vesselBreach ? "rgba(244,72,95,0.95)" : "rgba(150,180,225,0.62)";
      g.stroke();
      g.lineWidth = 1.6; g.strokeStyle = "rgba(215,235,255,0.30)"; g.stroke();
      if (r.pressure > 8.2) {
        g.shadowBlur = clamp((r.pressure - 8.2) * 9, 0, 40);
        g.shadowColor = "rgba(244,72,95,0.75)";
        g.lineWidth = 4; g.strokeStyle = "rgba(244,72,95,0.5)"; g.stroke();
        g.shadowBlur = 0;
      }
      g.restore();

      // ---- steam separators and dryers ----
      g.save();
      g.strokeStyle = "rgba(170,200,240,0.42)"; g.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        const x = V.left + 20 + i * 36;
        g.beginPath();
        g.moveTo(x, 196); g.lineTo(x + 9, 176); g.lineTo(x + 18, 196);
        g.moveTo(x, 182); g.lineTo(x + 9, 162); g.lineTo(x + 18, 182);
        g.stroke();
      }
      g.restore();
      this.label("DRYERS / SEPARATORS", V.cx, 152, "rgba(200,225,255,0.34)", 8, "center");

      // ---- water level scale ----
      const marks = [
        [SETPOINTS.levelHigh8, "L8", "rgba(251,191,36,0.8)"],
        [0, "NORMAL", "rgba(180,225,255,0.55)"],
        [SETPOINTS.levelLow3, "L3", "rgba(251,191,36,0.8)"],
        [SETPOINTS.levelLow2, "L2", "rgba(251,146,60,0.85)"],
        [SETPOINTS.levelLow1, "L1", "rgba(244,72,95,0.85)"],
        [PLANT.tafLevel, "TAF", "rgba(244,72,95,0.95)"],
      ];
      marks.forEach(([lv, name, col]) => {
        const y = levelY(lv);
        g.strokeStyle = col; g.lineWidth = 1;
        g.setLineDash([3, 4]);
        g.beginPath(); g.moveTo(V.right + 24, y); g.lineTo(V.right + 40, y); g.stroke();
        g.setLineDash([]);
        this.label(name, V.right + 43, y, col, 8);
      });
      // indicated level pointer
      const yI = levelY(r.levelInd);
      g.fillStyle = "rgba(52,211,153,0.95)";
      g.beginPath(); g.moveTo(V.left - 6, yI); g.lineTo(V.left - 17, yI - 5); g.lineTo(V.left - 17, yI + 5); g.closePath(); g.fill();
      this.tag("LEVEL " + r.levelInd.toFixed(0) + '"', V.cx, V.top + 26,
        r.level < PLANT.tafLevel ? "rgba(255,120,135,0.98)" : "rgba(52,211,153,0.95)", 10, "center");

      // ---- control rod drives ----
      const insert = 1 - clamp(r.ctl.rods / 100, 0, 1);
      g.save();
      for (let i = 0; i < 9; i++) {
        const x = V.coreL + 8 + i * ((V.coreR - V.coreL - 16) / 8);
        const rodTop = V.coreBot - insert * (V.coreBot - V.coreTop);
        // drive housing
        this.pipe([[x, V.bot + 8], [x, V.bot + 62]], 3, "rgba(120,150,200,0.35)");
        // rod blade inside the core
        g.beginPath();
        g.roundRect(x - 2.6, rodTop, 5.2, V.coreBot + 10 - rodTop, 2);
        g.fillStyle = "rgba(24,34,56,0.95)"; g.fill();
        g.strokeStyle = "rgba(170,200,245,0.55)"; g.lineWidth = 1; g.stroke();
      }
      g.restore();
      this.tag((r.scrammed ? "SCRAM · RODS " : "CONTROL RODS ") + r.ctl.rods.toFixed(0) + "% OUT",
        V.cx, V.bot + 34, r.scrammed ? "rgba(255,140,150,0.95)" : "rgba(200,225,255,0.6)", 9, "center");

      // ---- recirculation loop ----
      const recPts = [[V.left + 4, 452], [116, 452], [116, 322], [V.left + 4, 322]];
      this.pipe(recPts, 9, "rgba(90,120,170,0.55)", "rgba(16,24,42,0.9)");
      this.flow(recPts, 6, "rgba(120,200,255,0.95)", r.ctl.flow / 100, t, 0.9);
      // pump
      g.save();
      g.translate(116, 392);
      g.beginPath(); g.arc(0, 0, 15, 0, TAU);
      g.fillStyle = "rgba(20,32,56,0.95)"; g.fill();
      g.lineWidth = 2; g.strokeStyle = "rgba(140,175,235,0.6)"; g.stroke();
      g.rotate(t * (r.ctl.flow / 100) * 7);
      g.strokeStyle = "rgba(120,200,255,0.9)"; g.lineWidth = 2.4;
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.moveTo(0, 0);
        g.lineTo(Math.cos(i * TAU / 3) * 11, Math.sin(i * TAU / 3) * 11);
        g.stroke();
      }
      g.restore();
      this.tag("RECIRC " + r.ctl.flow.toFixed(0) + "%", 116, 420, "rgba(200,225,255,0.6)", 9, "center");

      this.label("REACTOR PRESSURE VESSEL", V.cx, V.top - 20, "rgba(200,225,255,0.42)", 9, "center");
    }

    drawCore(r, t, dt, yL, uncovered) {
      const g = this.ctx;
      const nB = 12;
      const bw = (V.coreR - V.coreL) / nB;
      const tf = r.tFuel;
      const h = V.coreBot - V.coreTop;
      const midY = (V.coreTop + V.coreBot) / 2;

      // shroud
      g.save();
      g.strokeStyle = "rgba(150,180,225,0.32)"; g.lineWidth = 2;
      g.strokeRect(V.coreL - 8, V.coreTop - 12, V.coreR - V.coreL + 16, h + 24);
      g.restore();

      // halo around the core, so the core reads as the source of everything
      const glowR = 170 * clamp(0.62 + r.n * 0.5 + r.damage.melt / 90, 0.5, 1.9);
      const cg = g.createRadialGradient(V.cx, midY, 4, V.cx, midY, glowR);
      cg.addColorStop(0, coreColour(tf, clamp(0.5 + r.n * 0.26, 0.34, 0.82)));
      cg.addColorStop(0.45, coreColour(tf, clamp(0.20 + r.n * 0.13, 0.12, 0.34)));
      cg.addColorStop(1, coreColour(tf, 0));
      g.fillStyle = cg;
      g.fillRect(V.coreL - 110, V.coreTop - 110, V.coreR - V.coreL + 220, h + 220);

      // fuel bundles
      g.save();
      g.shadowBlur = 14 + r.n * 16;
      g.shadowColor = coreColour(tf, 0.75);
      for (let i = 0; i < nB; i++) {
        const x = V.coreL + i * bw;
        // radial power shape: hotter in the middle of the core
        const rad = 1 - Math.pow(Math.abs(i - (nB - 1) / 2) / ((nB - 1) / 2), 2) * 0.34;
        const localT = 60 + (tf - 60) * rad;
        const bg2 = g.createLinearGradient(0, V.coreTop, 0, V.coreBot);
        bg2.addColorStop(0, coreColour(localT * 0.80, 0.92));
        bg2.addColorStop(0.5, coreColour(localT, 1));
        bg2.addColorStop(1, coreColour(localT * 0.74, 0.88));
        g.fillStyle = bg2;
        g.fillRect(x + 0.8, V.coreTop, bw - 1.6, h);

        // damage: bundles go dark and slump from the centre outwards
        if (r.damage.core > 0) {
          const frac = clamp(r.damage.core / 100, 0, 1);
          if (Math.abs(i - (nB - 1) / 2) / ((nB - 1) / 2) < frac + 0.05) {
            g.shadowBlur = 0;
            g.fillStyle = "rgba(28,10,6,0.6)";
            g.fillRect(x + 0.8, V.coreTop, bw - 1.6, h * frac);
            g.shadowBlur = 14 + r.n * 16;
          }
        }
      }
      g.restore();

      // spacer grids, so the bundles read as fuel and not as a bar chart
      g.save();
      g.strokeStyle = "rgba(10,18,34,0.45)"; g.lineWidth = 1.6;
      for (let k = 1; k < 5; k++) {
        const y = V.coreTop + (h / 5) * k;
        g.beginPath(); g.moveTo(V.coreL, y); g.lineTo(V.coreR, y); g.stroke();
      }
      g.restore();

      // molten pool collecting in the lower head
      if (r.damage.melt > 1) {
        const m = clamp(r.damage.melt / 100, 0, 1);
        g.save();
        g.beginPath();
        g.ellipse(V.cx, V.bot - 12, (V.right - V.left) * 0.44 * (0.4 + m * 0.6), 8 + m * 26, 0, 0, TAU);
        const mg = g.createRadialGradient(V.cx, V.bot - 12, 2, V.cx, V.bot - 12, 90);
        mg.addColorStop(0, "rgba(255,246,210,0.98)");
        mg.addColorStop(0.45, "rgba(255,140,40,0.9)");
        mg.addColorStop(1, "rgba(190,40,10,0.25)");
        g.fillStyle = mg; g.fill();
        g.restore();
      }

      // bubbles: void fraction made visible
      const shown = Math.round(this.bubbles.length * clamp(r.void, 0, 1));
      for (let i = 0; i < this.bubbles.length; i++) {
        const b = this.bubbles[i];
        b.y -= b.v * dt * (0.4 + r.ctl.flow / 100);
        if (b.y < V.coreTop - 6) {
          b.y = V.coreBot + Math.random() * 14;
          b.x = V.coreL + Math.random() * (V.coreR - V.coreL);
        }
        if (i >= shown) continue;
        if (b.y < yL) continue;       // no bubbles above the water line
        g.beginPath();
        g.arc(b.x + Math.sin(b.y * 0.06 + t * 3) * 1.6, b.y, b.r, 0, TAU);
        g.fillStyle = "rgba(235,248,255,0.55)"; g.fill();
      }

      // uncovered fuel warning hatch
      if (uncovered) {
        const yTop = V.coreTop, yBot = Math.min(levelY(r.level), V.coreBot);
        g.save();
        g.globalAlpha = 0.35 + Math.sin(t * 5) * 0.15;
        g.fillStyle = "rgba(244,72,95,0.5)";
        g.fillRect(V.coreL, yTop, V.coreR - V.coreL, Math.max(yBot - yTop, 0));
        g.restore();
        this.tag("FUEL UNCOVERED", V.cx, V.coreTop - 24, "rgba(255,140,150,0.98)", 10, "center");
      }

      this.tag("FUEL " + r.tFuel.toFixed(0) + "°C", V.cx, V.coreBot + 18,
        tf > SETPOINTS.cladBallooning ? "rgba(255,140,150,0.95)" : "rgba(235,248,255,0.75)", 10, "center");
    }

    /* ---- turbine hall ---- */
    drawSteamPlant(r, t) {
      const g = this.ctx;
      const isolated = r.msivClosed;

      // main steam line
      const msl = [[V.right - 8, 128], [560, 128]];
      this.pipe(msl, 10, "rgba(90,120,170,0.55)", "rgba(16,24,42,0.9)");
      this.flow(msl, 6, "rgba(235,245,255,0.92)", isolated ? 0 : r.steamOut, t, 0.9);
      this.valve(500, 128, isolated ? 0 : 1, 8);
      this.label("MSIV", 500, 108, isolated ? "rgba(244,72,95,0.9)" : "rgba(200,225,255,0.45)", 9, "center");

      // to turbine
      const toT = [[560, 128], [610, 128], [610, 168]];
      this.pipe(toT, 9, "rgba(90,120,170,0.5)", "rgba(16,24,42,0.9)");
      this.flow(toT, 5.5, "rgba(235,245,255,0.9)", r.tcvFlow || 0, t, 0.9);
      this.valve(610, 150, (r.ctl.tcv > 2 && !r.tripped) ? 1 : 0, 7);
      this.label("TCV " + r.ctl.tcv.toFixed(0) + "%", 622, 150, "rgba(200,225,255,0.45)", 9);

      // bypass line down to the condenser
      const byp = [[560, 128], [560, 336], [640, 336]];
      this.pipe(byp, 7, "rgba(90,120,170,0.4)", "rgba(16,24,42,0.9)");
      this.flow(byp, 4.5, "rgba(190,225,255,0.85)", r.bypassFlow || 0, t, 0.85);
      this.valve(560, 244, r.ctl.bypass > 2 ? 1 : 0, 7);
      this.label("BYPASS " + r.ctl.bypass.toFixed(0) + "%", 570, 244,
        r.ctl.bypass > 2 ? "rgba(52,211,153,0.8)" : "rgba(200,225,255,0.4)", 9);

      // ---- turbine ----
      const spin = r.turbineSpeed;
      const casing = (path) => {
        g.beginPath();
        g.moveTo(path[0][0], path[0][1]);
        for (let i = 1; i < path.length; i++) g.lineTo(path[i][0], path[i][1]);
        g.closePath();
      };
      const hp = [[628, 194], [674, 176], [674, 240], [628, 222]];
      const lp = [[684, 168], [764, 140], [764, 276], [684, 248]];

      g.save();
      // shaft first, behind the casings
      g.beginPath(); g.moveTo(626, 208); g.lineTo(848, 208);
      g.lineWidth = 4; g.strokeStyle = "rgba(120,150,195,0.55)"; g.stroke();

      [[hp, [650], 22], [lp, [706, 730, 752], 56]].forEach(([shape, discs, maxR]) => {
        g.save();
        casing(shape);
        const tg = g.createLinearGradient(620, 140, 770, 276);
        tg.addColorStop(0, "rgba(44,64,104,0.96)");
        tg.addColorStop(1, "rgba(20,32,58,0.96)");
        g.fillStyle = tg; g.fill();
        g.clip();                                  // blades stay inside the casing
        discs.forEach((cx, i) => {
          const rr = maxR - (discs.length - 1 - i) * 9;
          g.save(); g.translate(cx, 208); g.rotate(t * spin * (6 - i * 1.4));
          g.strokeStyle = `rgba(196,228,255,${0.22 + spin * 0.42})`; g.lineWidth = 1.5;
          for (let k = 0; k < 14; k++) {
            g.beginPath();
            g.moveTo(Math.cos(k * TAU / 14) * 5, Math.sin(k * TAU / 14) * 5);
            g.lineTo(Math.cos(k * TAU / 14) * rr, Math.sin(k * TAU / 14) * rr * 0.92);
            g.stroke();
          }
          g.restore();
        });
        g.restore();
        casing(shape);
        g.lineWidth = 1.8; g.strokeStyle = "rgba(150,185,235,0.55)"; g.stroke();
      });
      g.restore();
      this.label("HP", 651, 256, "rgba(200,225,255,0.45)", 9, "center");
      this.label("LP TURBINE", 724, 292, "rgba(200,225,255,0.45)", 9, "center");

      // ---- generator ----
      const load = clamp(r.mwe / 1250, 0, 1.1);
      g.save();
      g.beginPath(); g.roundRect(846, 174, 118, 68, 10);
      const gg = g.createLinearGradient(846, 174, 964, 242);
      gg.addColorStop(0, `rgba(${40 + load * 90},${58 + load * 110},${100 + load * 90},0.95)`);
      gg.addColorStop(1, "rgba(20,32,58,0.95)");
      g.fillStyle = gg; g.fill();
      if (load > 0.02) { g.shadowBlur = 26 * load; g.shadowColor = "rgba(251,191,36,0.55)"; }
      g.lineWidth = 2; g.strokeStyle = `rgba(251,191,36,${0.25 + load * 0.6})`; g.stroke();
      g.shadowBlur = 0;
      g.restore();
      this.label("GENERATOR", 905, 192, "rgba(230,245,255,0.65)", 10, "center");
      this.label(r.mwe.toFixed(0) + " MWe", 905, 212,
        r.gridSynced ? "rgba(251,191,36,0.95)" : "rgba(244,72,95,0.85)", 13, "center");
      this.label(r.gridSynced ? "SYNCHRONISED" : "OFF LINE", 905, 230,
        r.gridSynced ? "rgba(52,211,153,0.8)" : "rgba(244,72,95,0.8)", 8, "center");

      // transmission
      const gcol = `rgba(251,191,36,${0.22 + load * 0.55})`;
      this.pipe([[964, 208], [1012, 208], [1012, 116]], 2, gcol);
      g.save();
      g.strokeStyle = gcol; g.lineWidth = 1.5;
      // transmission pylon
      g.beginPath();
      g.moveTo(1012, 116); g.lineTo(1012, 62);
      g.moveTo(988, 74); g.lineTo(1036, 74);
      g.moveTo(994, 90); g.lineTo(1030, 90);
      g.moveTo(1000, 116); g.lineTo(1012, 74); g.lineTo(1024, 116);
      g.stroke();
      // conductors leaving the site
      g.lineWidth = 1.2;
      [74, 90].forEach((y) => {
        g.beginPath();
        g.moveTo(988, y); g.quadraticCurveTo(960, y + 12, 940, y + 6);
        g.moveTo(1036, y); g.quadraticCurveTo(1062, y + 12, 1078, y + 6);
        g.stroke();
      });
      g.restore();
      this.label("GRID", 1012, 52, `rgba(251,191,36,${0.42 + load * 0.5})`, 9, "center");

      // ---- condenser ----
      g.save();
      g.beginPath(); g.roundRect(640, 306, 210, 62, 8);
      g.fillStyle = "rgba(16,26,46,0.92)"; g.fill();
      g.lineWidth = 1.6; g.strokeStyle = "rgba(140,175,235,0.4)"; g.stroke();
      g.strokeStyle = "rgba(90,150,220,0.35)"; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        g.beginPath(); g.moveTo(650, 316 + i * 9); g.lineTo(840, 316 + i * 9); g.stroke();
      }
      g.restore();
      // exhaust from LP into the condenser
      this.pipe([[726, 276], [726, 306]], 22, "rgba(90,120,170,0.28)");
      this.flow([[726, 274], [726, 306]], 12, "rgba(220,238,255,0.55)", r.tcvFlow || 0, t, 0.5);
      this.label("CONDENSER", 745, 337, "rgba(200,225,255,0.45)", 10, "center");

      // ---- feedwater back to the vessel ----
      const fwPts = [[640, 348], [500, 348], [430, 348], [430, 262], [V.right - 6, 262]];
      this.pipe(fwPts, 8, "rgba(90,120,170,0.5)", "rgba(16,24,42,0.9)");
      const fwCol = r.ctl.feedTemp < 150 ? "rgba(120,190,255,0.95)" : "rgba(255,190,120,0.9)";
      this.flow(fwPts, 5, fwCol, r.feedFlow || 0, -t, 0.9);
      // feedwater heater
      g.save();
      g.beginPath(); g.roundRect(516, 334, 62, 28, 6);
      g.fillStyle = "rgba(20,32,56,0.95)"; g.fill();
      g.lineWidth = 1.4; g.strokeStyle = "rgba(140,175,235,0.4)"; g.stroke();
      g.restore();
      this.label("FW HTR " + r.ctl.feedTemp.toFixed(0) + "°C", 547, 348, "rgba(230,245,255,0.6)", 8, "center");
      // pump
      g.save(); g.translate(464, 348);
      g.beginPath(); g.arc(0, 0, 12, 0, TAU);
      g.fillStyle = "rgba(20,32,56,0.95)"; g.fill();
      g.lineWidth = 1.6; g.strokeStyle = "rgba(140,175,235,0.55)"; g.stroke();
      g.rotate(-t * clamp(r.feedFlow || 0, 0, 1.4) * 8);
      g.strokeStyle = "rgba(120,200,255,0.9)"; g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        g.beginPath(); g.moveTo(0, 0);
        g.lineTo(Math.cos(i * TAU / 3) * 9, Math.sin(i * TAU / 3) * 9); g.stroke();
      }
      g.restore();
      this.tag("FEEDWATER " + ((r.feedFlow || 0) * 100).toFixed(0) + "%", 430, 392, "rgba(200,225,255,0.6)", 9, "center");

      // HPCI / LPCI injection indication
      if (r.hpci || r.lpci) {
        g.save();
        g.globalAlpha = 0.5 + Math.sin(t * 6) * 0.3;
        this.pipe([[430, 300], [430, 262]], 10, r.lpci ? "rgba(52,211,153,0.9)" : "rgba(34,211,238,0.9)");
        g.restore();
        this.tag(r.lpci ? "LPCI / CORE SPRAY" : "HPCI / RCIC", 430, 414,
          "rgba(52,211,153,0.95)", 9, "center");
      }
    }

    /* ---- cooling tower ---- */
    drawCoolingTower(r, t) {
      const g = this.ctx;
      const bx = 1000, by = 664, topY = 452, topW = 34, botW = 52, waistY = 540, waistW = 26;
      g.save();
      g.beginPath();
      g.moveTo(bx - botW, by);
      g.quadraticCurveTo(bx - waistW, waistY, bx - topW, topY);
      g.lineTo(bx + topW, topY);
      g.quadraticCurveTo(bx + waistW, waistY, bx + botW, by);
      g.closePath();
      const ctg = g.createLinearGradient(0, topY, 0, by);
      ctg.addColorStop(0, "rgba(40,58,94,0.85)");
      ctg.addColorStop(1, "rgba(16,26,46,0.9)");
      g.fillStyle = ctg; g.fill();
      g.lineWidth = 1.6; g.strokeStyle = "rgba(140,175,235,0.35)"; g.stroke();
      g.restore();

      // plume, scaled by heat rejected
      const heat = clamp((r.tcvFlow || 0) + (r.bypassFlow || 0), 0, 1.2);
      if (heat > 0.02) {
        g.save();
        this.plume.forEach((p) => {
          p.p += 0.0034 * (0.5 + heat);
          if (p.p > 1) p.p -= 1;
          const y = topY - p.p * 190;
          const x = bx + p.o * (0.3 + p.p * 2.1) + Math.sin(p.p * 6 + t) * 8;
          const rr = 9 + p.p * 34 * p.s;
          g.beginPath(); g.arc(x, y, rr, 0, TAU);
          g.fillStyle = `rgba(226,240,255,${(1 - p.p) * 0.10 * heat})`;
          g.fill();
        });
        g.restore();
      }
      this.label("COOLING TOWER", bx, by + 14, "rgba(200,225,255,0.35)", 9, "center");

      // circ water
      const cw = [[850, 336], [900, 336], [900, 620], [bx - 40, 620]];
      this.pipe(cw, 6, "rgba(70,110,160,0.4)");
      this.flow(cw, 4, "rgba(120,200,255,0.6)", heat * 0.8, t, 0.6);
    }

    drawReadouts(r) {
      const g = this.ctx;
      const x = 486, y0 = 24, w = 172, h = 96;
      g.save();
      g.beginPath(); g.roundRect(x, y0, w, h, 8);
      g.fillStyle = "rgba(7,13,24,0.82)"; g.fill();
      g.lineWidth = 1; g.strokeStyle = "rgba(140,175,235,0.22)"; g.stroke();
      g.font = "10px 'JetBrains Mono', monospace";
      const keff = 1 / (1 - clamp(r.reactivity.total, -0.9, 0.09));
      const rows = [
        ["RPV", r.pressure.toFixed(2) + " MPa", r.pressure > SETPOINTS.pressHigh],
        ["THERMAL", (r.thermalPower * PLANT.thermalRated).toFixed(0) + " MWth", false],
        ["FLUX", (r.n * 100).toFixed(1) + " %", r.n > 1.05],
        ["VOID", (r.void * 100).toFixed(0) + " %", r.void > 0.8],
        ["k-eff", keff.toFixed(4), keff > 1.002],
      ];
      let y = y0 + 16;
      rows.forEach(([k, v, hot]) => {
        g.fillStyle = "rgba(200,225,255,0.38)"; g.fillText(k, x + 10, y);
        g.fillStyle = hot ? "rgba(255,170,120,0.98)" : "rgba(230,245,255,0.9)";
        g.fillText(v, x + 76, y);
        y += 17;
      });
      g.restore();
    }
  }

  /* ====================================================================== */
  /*  Strip charts                                                          */
  /* ====================================================================== */

  class Strip {
    constructor(canvas, series, opts) {
      this.c = canvas; this.g = canvas.getContext("2d");
      this.series = series; this.opts = opts || {};
      this.data = series.map(() => []);
      this.max = this.opts.points || 340;
      this.fit(); window.addEventListener("resize", () => this.fit());
    }
    fit() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.c.clientWidth || 900;
      const h = this.opts.height || 230;
      this.c.width = Math.round(w * dpr);
      this.c.height = Math.round(w * (h / 900) * dpr);
      this.scale = (w * dpr) / 900;
      this.h = h;
    }
    push(vals) {
      vals.forEach((v, i) => {
        const d = this.data[i];
        d.push(v);
        if (d.length > this.max) d.shift();
      });
    }
    draw() {
      const g = this.g, w = 900, h = this.h;
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      g.clearRect(0, 0, w, h);
      // grid
      g.strokeStyle = "rgba(140,175,235,0.08)"; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
      this.series.forEach((s, i) => {
        const d = this.data[i];
        if (d.length < 2) return;
        const step = w / (this.max - 1);
        g.beginPath();
        for (let k = 0; k < d.length; k++) {
          const x = w - (d.length - 1 - k) * step;
          const y = h - clamp((d[k] - s.min) / (s.max - s.min), 0, 1) * (h - 12) - 6;
          k === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
        }
        g.lineWidth = s.w || 1.8; g.strokeStyle = s.colour;
        g.shadowBlur = 8; g.shadowColor = s.colour;
        g.stroke();
        g.shadowBlur = 0;
        if (s.fill) {
          g.lineTo(w, h); g.lineTo(w - (d.length - 1) * step, h); g.closePath();
          g.fillStyle = s.fill; g.fill();
        }
      });
    }
  }

  /* ====================================================================== */
  /*  Instrument definitions                                                */
  /* ====================================================================== */

  const METERS = [
    {
      id: "power", label: "Reactor power", min: 0, max: 130,
      get: (r) => r.n * 100, fmt: (v) => v.toFixed(1) + " %",
      marks: [[100, "warn"], [118, "danger"]],
      warn: (v) => v > 105 ? (v > 115 ? 2 : 1) : 0,
    },
    {
      id: "mwe", label: "Generator", min: 0, max: 1350,
      get: (r) => r.mwe, fmt: (v) => v.toFixed(0) + " MWe",
      colour: "linear-gradient(90deg,#fbbf24,#fb923c)",
    },
    {
      id: "press", label: "Dome pressure", min: 5.5, max: 9.0,
      get: (r) => r.pressure, fmt: (v) => v.toFixed(2) + " MPa",
      marks: [[7.62, "warn"], [7.72, "danger"]],
      warn: (r) => 0,
      warnV: (v) => v > 7.62 ? 2 : v > 7.45 ? 1 : 0,
    },
    {
      id: "level", label: "Water level", min: -180, max: 70,
      get: (r) => r.levelInd, fmt: (v) => v.toFixed(0) + " in",
      marks: [[55, "warn"], [-45, "warn"], [-110, "danger"], [-160, "danger"]],
      warnV: (v) => v < -110 || v > 55 ? 2 : (v < -30 || v > 38 ? 1 : 0),
      colour: "linear-gradient(90deg,#34d399,#22d3ee)",
    },
    {
      id: "fuel", label: "Peak fuel temp", min: 200, max: 3000,
      get: (r) => r.tFuel, fmt: (v) => v.toFixed(0) + " °C",
      marks: [[1200, "warn"], [2865, "danger"]],
      warnV: (v) => v > 1200 ? 2 : v > 1050 ? 1 : 0,
      colour: "linear-gradient(90deg,#22d3ee,#fbbf24,#f4485f)",
    },
    {
      id: "void", label: "Core void fraction", min: 0, max: 100,
      get: (r) => r.void * 100, fmt: (v) => v.toFixed(0) + " %",
      marks: [[80, "danger"]],
      warnV: (v) => v > 80 ? 2 : v > 68 ? 1 : 0,
    },
    {
      id: "flow", label: "Core flow", min: 0, max: 115,
      get: (r) => r.ctl.flow, fmt: (v) => v.toFixed(0) + " %",
      marks: [[22, "warn"]],
    },
    {
      id: "pool", label: "Suppression pool", min: 20, max: 200,
      get: (r) => r.poolT, fmt: (v) => v.toFixed(0) + " °C",
      marks: [[95, "warn"]],
      warnV: (v) => v > 130 ? 2 : v > 95 ? 1 : 0,
      colour: "linear-gradient(90deg,#4d8cff,#f4485f)",
    },
    {
      id: "dw", label: "Drywell pressure", min: 0, max: 8,
      get: (r) => r.drywellP * 10, fmt: (v) => v.toFixed(2) + " bar",
      marks: [[4.2, "warn"], [7.8, "danger"]],
      warnV: (v) => v > 4.2 ? 2 : v > 1.1 ? 1 : 0,
      colour: "linear-gradient(90deg,#a78bfa,#f4485f)",
    },
    {
      id: "rad", label: "Radiation", min: 0, max: 100,
      get: (r) => clamp(Math.log10(Math.max(r.radiation, 0.01)) * 20 + 40, 0, 100),
      fmt: (v, r) => r.radiation < 1000 ? r.radiation.toFixed(2) + " mSv/h" : (r.radiation / 1000).toFixed(1) + " Sv/h",
      warnV: null, raw: true,
      colour: "linear-gradient(90deg,#34d399,#fbbf24,#f4485f)",
    },
  ];

  /* ---------------------------------------------------------- controls */

  const CONTROLS = [
    {
      id: "rods", name: "Control rods", unit: "% withdrawn", min: 0, max: 100, step: 0.5,
      get: (r) => r.ctl.rodDemand, set: (r, v) => { r.ctl.rodDemand = v; },
      show: (r) => r.ctl.rods.toFixed(1) + "%",
      hint: "Neutron poison on a stick. Withdrawing rods adds reactivity and raises power; the rods move slowly on purpose. A scram drives all of them fully in within three seconds.",
      disabled: (r) => r.scrammed,
    },
    {
      id: "flow", name: "Recirculation flow", unit: "% core flow", min: 25, max: 108, step: 1,
      get: (r) => r.ctl.flowDemand, set: (r, v) => { r.ctl.flowDemand = v; },
      show: (r) => r.ctl.flow.toFixed(0) + "%",
      hint: "The fast way to move power in a BWR. More flow sweeps steam bubbles out of the core, which puts moderator back, which raises power. Roughly 65% to 100% power without touching a rod.",
    },
    {
      id: "loadLimit", name: "Turbine load limit", unit: "% of rated steam", min: 0, max: 100, step: 1,
      get: (r) => r.ctl.loadLimit, set: (r, v) => { r.ctl.loadLimit = v; },
      show: (r) => r.ctl.loadLimit.toFixed(0) + "%",
      hint: "How much steam the turbine is allowed to take while the pressure regulator is in automatic. Anything above this goes to the bypass valves and is thrown away into the condenser.",
      disabled: (r) => !r.ctl.pressAuto,
    },
    {
      id: "tcv", name: "Turbine control valves", unit: "% open", min: 0, max: 100, step: 1,
      get: (r) => r.ctl.tcv, set: (r, v) => { r.ctl.tcv = v; },
      show: (r) => r.ctl.tcv.toFixed(0) + "%",
      hint: "Manual valve position. Closing these with the reactor at power traps steam in the vessel: pressure rises, voids collapse, and reactivity goes up. This is the classic pressurisation transient.",
      auto: (r) => r.ctl.pressAuto, disabled: (r) => r.ctl.pressAuto,
    },
    {
      id: "bypass", name: "Turbine bypass valves", unit: "% open", min: 0, max: 100, step: 1,
      get: (r) => r.ctl.bypass, set: (r, v) => { r.ctl.bypass = v; },
      show: (r) => r.ctl.bypass.toFixed(0) + "%",
      hint: "Dumps steam straight to the condenser, bypassing the turbine. Capacity is 25% of rated flow. This is what makes a turbine trip a non-event instead of an emergency.",
      auto: (r) => r.ctl.pressAuto, disabled: (r) => r.ctl.pressAuto,
    },
    {
      id: "pressSet", name: "Pressure setpoint", unit: "MPa", min: 5.6, max: 7.6, step: 0.01,
      get: (r) => r.ctl.pressSet, set: (r, v) => { r.ctl.pressSet = v; },
      show: (r) => r.ctl.pressSet.toFixed(2),
      hint: "What the regulator holds the dome at. Higher pressure squeezes voids out of the core and adds reactivity; lower pressure does the opposite and costs you cycle efficiency.",
      disabled: (r) => !r.ctl.pressAuto,
    },
    {
      id: "feedwater", name: "Feedwater flow", unit: "% of rated", min: 0, max: 130, step: 1,
      get: (r) => r.ctl.feedwater, set: (r, v) => { r.ctl.feedwater = v; },
      show: (r) => r.ctl.feedwater.toFixed(0) + "%",
      hint: "Replaces the water you are boiling away. Too little and the core uncovers; too much and you flood the steam lines and trip the turbine on high level.",
      auto: (r) => r.ctl.feedAuto, disabled: (r) => r.ctl.feedAuto,
    },
    {
      id: "feedTemp", name: "Feedwater temperature", unit: "°C", min: 40, max: 230, step: 1,
      get: (r) => r.ctl.feedTemp, set: (r, v) => { r.ctl.feedTemp = v; },
      show: (r) => r.ctl.feedTemp.toFixed(0) + "°C",
      hint: "Colder feedwater subcools the core, collapses voids and adds reactivity, which is free extra power and also how you can walk into a flux scram without touching a rod.",
    },
    {
      id: "slc", name: "Standby liquid control", unit: "% boron injected", min: 0, max: 100, step: 1,
      get: (r) => r.ctl.slc, set: (r, v) => { r.ctl.slc = v; },
      show: (r) => r.ctl.slc.toFixed(0) + "%",
      hint: "Sodium pentaborate: a chemical shutdown that works even if every control rod is stuck. Injecting it ruins the coolant chemistry and ends the fuel cycle, so it is the last resort, not the first.",
    },
    {
      id: "vent", name: "Hardened vent", unit: "% open", min: 0, max: 100, step: 1,
      get: (r) => r.ctl.vent, set: (r, v) => { r.ctl.vent = v; },
      show: (r) => r.ctl.vent.toFixed(0) + "%",
      hint: "Deliberately releases filtered containment gas to stop the building bursting. A small controlled release now instead of an uncontrolled one later. This is the decision Fukushima had to make.",
    },
  ];

  const TOGGLES = [
    { id: "pressAuto", on: "PRESSURE REG · AUTO", off: "PRESSURE REG · MANUAL", get: (r) => r.ctl.pressAuto, set: (r, v) => { r.ctl.pressAuto = v; } },
    { id: "feedAuto", on: "FEEDWATER · AUTO", off: "FEEDWATER · MANUAL", get: (r) => r.ctl.feedAuto, set: (r, v) => { r.ctl.feedAuto = v; } },
    { id: "msiv", on: "MSIV · OPEN", off: "MSIV · CLOSED", get: (r) => r.ctl.msiv, set: (r, v) => { r.ctl.msiv = v; } },
    {
      id: "turbine", on: "TURBINE · ON LINE", off: "TURBINE · TRIPPED",
      get: (r) => !r.tripped,
      set: (r, v) => {
        if (!v) { r.tripTurbine("Manual turbine trip"); }
        else if (r.pressure > 5.4) { r.tripped = false; r.pushLog("Turbine reset and resynchronised.", "info"); }
      },
    },
  ];

  const SAFETY = [
    {
      id: "rps", name: "REACTOR PROTECTION SYSTEM",
      desc: "Trips the reactor on high flux, high pressure, low water level or high drywell pressure. Fails safe: it inserts the rods when it loses power.",
    },
    {
      id: "srv", name: "SAFETY RELIEF VALVES",
      desc: "Eleven spring-loaded valves that lift on pressure alone and dump steam to the suppression pool. No electricity, no signal, no decision.",
    },
    {
      id: "eccs", name: "EMERGENCY CORE COOLING",
      desc: "HPCI, RCIC, automatic depressurisation, LPCI and core spray. Independent, redundant, and steam-driven at high pressure so it works in a blackout.",
    },
    {
      id: "rpt", name: "RECIRC TRIP / ARI",
      desc: "Trips the recirculation pumps and inserts rods by an alternate path if flux runs high. A second, diverse way of doing what the RPS does.",
    },
    {
      id: "containment", name: "CONTAINMENT ISOLATION",
      desc: "Closes the main steam isolation valves and seals every penetration on low level or high drywell pressure. The last physical barrier.",
    },
  ];

  /* ====================================================================== */
  /*  Application                                                           */
  /* ====================================================================== */

  const reactor = new Reactor({ seed: (Math.random() * 1e9) | 0 });
  const plant = new PlantView($("rg-plant-canvas"));
  const trend = new Strip($("rg-trend-canvas"), [
    { colour: "#4d8cff", min: 0, max: 140, w: 2 },
    { colour: "#fbbf24", min: 200, max: 3000 },
    { colour: "#22d3ee", min: 5.5, max: 9.5 },
    { colour: "#34d399", min: -200, max: 80 },
  ], { height: 230 });
  const market = new Strip($("rg-market-canvas"), [
    { colour: "#22d3ee", min: -40, max: 200, w: 2, fill: "rgba(34,211,238,0.10)" },
    { colour: "#fbbf24", min: 0, max: 1350, w: 1.4 },
  ], { height: 180 });

  let speed = 1, lastSpeed = 1, running = false, lastT = performance.now();
  let sampleAcc = 0;

  /* ---------------------------------------------------------- build DOM */

  const meterEls = {};
  (function buildMeters() {
    const host = $("rg-meters");
    METERS.forEach((m) => {
      const el = document.createElement("div");
      el.className = "rg-meter";
      const marks = (m.marks || []).map(([v, k]) =>
        `<i class="rg-meter-mark ${k}" style="left:${clamp((v - m.min) / (m.max - m.min), 0, 1) * 100}%"></i>`).join("");
      el.innerHTML =
        `<span class="rg-meter-label">${m.label}</span>` +
        `<span class="rg-meter-val" data-v></span>` +
        `<span class="rg-meter-track"><span class="rg-meter-fill" data-f${m.colour ? ` style="background:${m.colour}"` : ""}></span>${marks}</span>`;
      host.appendChild(el);
      meterEls[m.id] = { val: el.querySelector("[data-v]"), fill: el.querySelector("[data-f]") };
    });
  })();

  const ctlEls = {};
  (function buildControls() {
    const host = $("rg-ctl-grid");
    CONTROLS.forEach((c) => {
      const el = document.createElement("div");
      el.className = "rg-ctl";
      el.innerHTML =
        `<div class="rg-ctl-top"><span class="rg-ctl-name">${c.name}</span><span class="rg-ctl-val" data-v></span></div>` +
        `<input type="range" class="rg-slider" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.get(reactor)}">` +
        `<div class="rg-ctl-hint">${c.hint}</div>`;
      host.appendChild(el);
      const input = el.querySelector("input");
      input.addEventListener("input", () => {
        c.set(reactor, parseFloat(input.value));
        input.style.setProperty("--pct", ((input.value - c.min) / (c.max - c.min) * 100) + "%");
      });
      input.style.setProperty("--pct", ((c.get(reactor) - c.min) / (c.max - c.min) * 100) + "%");
      ctlEls[c.id] = { el, input, val: el.querySelector("[data-v]") };
    });
  })();

  const toggleEls = {};
  (function buildToggles() {
    const host = $("rg-toggles");
    TOGGLES.forEach((tg) => {
      const b = document.createElement("button");
      b.className = "rg-toggle";
      b.innerHTML = `<span class="led"></span><span data-t></span>`;
      b.addEventListener("click", () => tg.set(reactor, !tg.get(reactor)));
      host.appendChild(b);
      toggleEls[tg.id] = { b, t: b.querySelector("[data-t]") };
    });
  })();

  const safetyEls = {};
  (function buildSafety() {
    const host = $("rg-safety-grid");
    SAFETY.forEach((s) => {
      const el = document.createElement("button");
      el.className = "rg-sys";
      el.innerHTML =
        `<span class="led"></span>` +
        `<span class="rg-sys-body"><span class="rg-sys-name">${s.name}</span>` +
        `<span class="rg-sys-desc">${s.desc}</span></span>`;
      el.addEventListener("click", () => {
        const on = reactor.safety[s.id];
        if (on) {
          const ok = window.confirm(
            "DEFEAT " + s.name + "?\n\n" + s.desc +
            "\n\nIn a real plant this requires a written procedure, a key and a second signature. " +
            "Disabling it is the only way to damage this reactor.\n\nProceed?");
          if (!ok) return;
          reactor.safety[s.id] = false;
          reactor.pushLog("OPERATOR DEFEATED " + s.name + ".", "crit");
        } else {
          reactor.safety[s.id] = true;
          reactor.pushLog(s.name + " restored to service.", "info");
        }
      });
      host.appendChild(el);
      safetyEls[s.id] = el;
    });
  })();

  (function buildDeaths() {
    const host = $("rg-deaths");
    if (!host) return;
    const data = [
      ["Coal", 24.6, true], ["Oil", 18.4, true], ["Biomass", 4.6, true],
      ["Natural gas", 2.8, true], ["Hydropower", 1.3, false],
      ["Wind", 0.04, false], ["Nuclear", 0.03, false], ["Solar", 0.02, false],
    ];
    const max = 24.6;
    host.innerHTML = data.map(([name, v, dirty]) =>
      `<div class="rg-death-row${dirty ? " dirty" : ""}"><span>${name}</span>` +
      `<span class="rg-death-bar"><i style="width:0%" data-w="${Math.max(v / max * 100, 0.4)}"></i></span>` +
      `<b>${v}</b></div>`).join("");
    const animate = () => host.querySelectorAll("[data-w]").forEach((i) => { i.style.width = i.dataset.w + "%"; });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((e) => {
        if (e[0].isIntersecting) { animate(); io.disconnect(); }
      }, { threshold: 0.25 });
      io.observe(host);
    } else animate();
  })();

  /* --------------------------------------------------------- top buttons */

  document.querySelectorAll(".rg-speed button").forEach((b) => {
    b.addEventListener("click", () => {
      speed = parseFloat(b.dataset.speed);
      if (speed > 0) lastSpeed = speed;
      document.querySelectorAll(".rg-speed button").forEach((x) => x.classList.toggle("on", x === b));
    });
  });

  $("rg-scram").addEventListener("click", () => {
    if (!reactor.scrammed) reactor.scram("Operator action", true);
  });

  $("rg-help-toggle").addEventListener("click", () => {
    root.classList.toggle("show-help");
    $("rg-help-toggle").textContent = root.classList.contains("show-help") ? "Hide explanations" : "What does this do?";
  });

  $("rg-restart").addEventListener("click", () => endShift(true));
  $("rg-again").addEventListener("click", () => restart());
  $("rg-start").addEventListener("click", () => {
    $("rg-briefing").hidden = true;
    running = true;
  });

  function restart() {
    reactor.opts.seed = (Math.random() * 1e9) | 0;
    reactor.reset(true);
    trend.data = trend.series.map(() => []);
    market.data = market.series.map(() => []);
    CONTROLS.forEach((c) => {
      const e = ctlEls[c.id];
      e.input.value = c.get(reactor);
      e.input.style.setProperty("--pct", ((c.get(reactor) - c.min) / (c.max - c.min) * 100) + "%");
    });
    $("rg-overlay").hidden = true;
    running = true;
  }

  function endShift(manual) {
    if (!reactor.gameOver) reactor.endGame(manual ? "manual" : "auto");
    const o = reactor.outcome;
    const best = (() => {
      try {
        const prev = parseFloat(localStorage.getItem("atom-criticality-best") || "-Infinity");
        if (reactor.money.net > prev) { localStorage.setItem("atom-criticality-best", String(reactor.money.net)); return reactor.money.net; }
        return prev;
      } catch { return reactor.money.net; }
    })();

    $("rg-ines").textContent = o.ines;
    $("rg-ines").dataset.l = o.ines;
    $("rg-outcome-title").textContent = "INES " + o.ines + " - " + o.title;
    $("rg-outcome-detail").textContent = o.detail;
    $("rg-outcome-stats").innerHTML = [
      ["Shift P&L", fmtMoney(reactor.money.net)],
      ["Energy sold", (reactor.money.mwh / 1000).toFixed(1) + " GWh"],
      ["Core damage", reactor.damage.core.toFixed(1) + "%"],
      ["Best ever", isFinite(best) ? fmtMoney(best) : "-"],
    ].map(([k, v]) => `<div><label>${k}</label><b>${v}</b></div>`).join("");
    $("rg-overlay").hidden = false;
    running = false;
  }

  /* ------------------------------------------------------------- render */

  let lastAlarmSig = "";
  let lastLogLen = -1;

  function renderUI(r) {
    // topbar
    $("rg-clock").textContent = fmtClock(r.market.hour);
    $("rg-mwe").textContent = r.mwe.toFixed(0);
    $("rg-price").textContent = (r.money.lastPrice < 0 ? "-$" : "$") + Math.abs(r.money.lastPrice).toFixed(0);
    const rate = r.mwe * r.money.lastPrice - 20000 - r.mwe * 9.6;
    $("rg-rate").textContent = fmtMoney(rate);
    const netEl = $("rg-net");
    netEl.textContent = fmtMoney(r.money.net);
    netEl.classList.toggle("bad", r.money.net < 0);

    const worst = [...r.alarms.values()].reduce((a, x) => Math.max(a, x.level), 0);
    const dot = $("rg-live-dot");
    dot.className = "rg-dot" + (worst >= 3 ? " crit" : worst === 2 ? " warn" : "");
    const mode = $("rg-mode");
    mode.textContent = r.gameOver ? "ENDED" : r.scrammed ? "SCRAM" : r.tripped ? "TRIP" : "RUN";
    mode.classList.toggle("trip", r.scrammed || r.tripped || r.gameOver);
    $("rg-scram").disabled = r.scrammed;

    // meters
    METERS.forEach((m) => {
      const e = meterEls[m.id];
      const v = m.get(r);
      e.val.textContent = m.fmt(v, r);
      const pct = clamp((v - m.min) / (m.max - m.min), 0, 1) * 100;
      e.fill.style.width = pct + "%";
      const lvl = m.warnV ? m.warnV(v) : 0;
      e.val.className = "rg-meter-val" + (lvl === 2 ? " crit" : lvl === 1 ? " warn" : "");
    });

    // reactivity
    const rho = r.reactivity;
    const dollars = rho.total / BETA;
    $("rg-rho-total").textContent = (dollars >= 0 ? "+" : "") + dollars.toFixed(2) + " $";
    const fill = $("rg-rho-fill");
    const span = clamp(Math.abs(dollars) / 3, 0, 1) * 50;
    if (dollars >= 0) { fill.style.left = "50%"; fill.style.right = "auto"; fill.style.width = span + "%"; fill.style.background = "linear-gradient(90deg,#fb923c,#f4485f)"; }
    else { fill.style.right = "50%"; fill.style.left = "auto"; fill.style.width = span + "%"; fill.style.background = "linear-gradient(90deg,#22d3ee,#4d8cff)"; }
    $("rg-rho-items").innerHTML = [
      ["Rods", rho.rods], ["Doppler", rho.doppler], ["Void", rho.void],
      ["Moderator", rho.mod], ["Xenon", rho.xenon], ["Boron", rho.boron],
    ].map(([k, v]) => {
      const pcm = v * 1e5;
      return `<div class="rg-rho-item">${k}<b class="${pcm < 0 ? "neg" : "pos"}">${pcm >= 0 ? "+" : ""}${pcm.toFixed(0)}</b></div>`;
    }).join("");

    // alarms
    const list = [...r.alarms.values()].sort((a, b) => b.level - a.level);
    const sig = list.map((a) => a.id).join("|");
    if (sig !== lastAlarmSig) {
      lastAlarmSig = sig;
      const host = $("rg-alarm-list");
      host.innerHTML = list.length
        ? list.map((a) => `<div class="rg-alarm${a.level === 3 ? " crit" : ""}">${a.text}</div>`).join("")
        : `<div class="rg-alarm rg-alarm-ok">All parameters within limits</div>`;
      const c = $("rg-alarm-count");
      c.textContent = list.length;
      c.className = "rg-count" + (worst >= 3 ? " bad" : worst === 2 ? " warn" : "");
    }

    // controls
    CONTROLS.forEach((c) => {
      const e = ctlEls[c.id];
      e.val.textContent = c.show(r);
      const isAuto = c.auto ? c.auto(r) : false;
      e.el.classList.toggle("auto", isAuto);
      const dis = c.disabled ? c.disabled(r) : false;
      e.input.disabled = dis;
      if (isAuto || (c.id === "rods" && r.scrammed) || (c.id === "flow" && r.rptFired)) {
        const v = c.id === "rods" ? r.ctl.rods : c.id === "flow" ? r.ctl.flow : c.get(r);
        e.input.value = v;
        e.input.style.setProperty("--pct", ((v - c.min) / (c.max - c.min) * 100) + "%");
      }
    });

    TOGGLES.forEach((tg) => {
      const e = toggleEls[tg.id];
      const on = tg.get(r);
      e.b.className = "rg-toggle " + (on ? "on" : "off");
      e.t.textContent = on ? tg.on : tg.off;
    });

    let armed = 0;
    SAFETY.forEach((s) => {
      const on = r.safety[s.id];
      if (on) armed++;
      safetyEls[s.id].classList.toggle("off", !on);
    });
    const ae = $("rg-armed");
    ae.textContent = armed + " / 5 ARMED";
    ae.classList.toggle("bad", armed < 5);

    // market footer
    $("rg-demand").textContent = "demand " + (r.market.demand * 100).toFixed(0) + "%";
    $("rg-mwh").textContent = (r.money.mwh / 1000).toFixed(1) + " GWh";
    $("rg-rev").textContent = fmtMoney(r.money.revenue);
    $("rg-cost").textContent = fmtMoney(r.money.fuelOM);
    $("rg-pen").textContent = fmtMoney(r.money.penalties);

    // log
    if (r.log.length !== lastLogLen) {
      lastLogLen = r.log.length;
      const host = $("rg-log-list");
      host.innerHTML = r.log.slice(-60).reverse().map((l) =>
        `<div class="rg-log-line ${l.kind}"><time>${fmtClock(6 + l.t / 3600).slice(-5)}</time><span>${l.msg}</span></div>`).join("");
    }

    $("rg-plant-flash").classList.toggle("on", r.damage.melt > 2 || r.damage.containmentBreach);
  }

  /* --------------------------------------------------------------- loop */

  function frame(now) {
    const wall = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;

    if (running && !reactor.gameOver && speed > 0) {
      let remaining = Math.min(wall * speed, 2.0);
      while (remaining > 1e-4) {
        const h = Math.min(0.08, remaining);
        reactor.step(h);
        remaining -= h;
      }
      sampleAcc += wall * speed;
      if (sampleAcc > 1.2) {
        sampleAcc = 0;
        trend.push([reactor.n * 100, reactor.tFuel, reactor.pressure, reactor.levelInd]);
        market.push([reactor.money.lastPrice, reactor.mwe]);
      }
      if (reactor.gameOver) endShift(false);
    }

    plant.draw(reactor, wall * (speed > 0 ? 1 : 0.2));
    trend.draw();
    market.draw();
    renderUI(reactor);

    requestAnimationFrame(frame);
  }

  // roundRect polyfill for older Safari
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      this.moveTo(x + rr, y);
      this.arcTo(x + w, y, x + w, y + h, rr);
      this.arcTo(x + w, y + h, x, y + h, rr);
      this.arcTo(x, y + h, x, y, rr);
      this.arcTo(x, y, x + w, y, rr);
      this.closePath();
      return this;
    };
  }

  requestAnimationFrame(frame);
})();
