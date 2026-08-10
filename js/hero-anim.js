/* ========================================================================
   Atom, physics animations.
   Two decorative, physically correct free-body-diagram animations, each on
   its own stage:
     - Pendulum       (#fbd-pendulum, hero): tension, weight, mg components,
                       velocity.
     - Rocket mission (#rocket-anim, Why Atom): launch, orbit, and reentry
                       with a live FBD (thrust T, gravity F, drag D, velocity
                       v, radial r), a camera that zooms from a surface view
                       out to an orbital view, phase-specific equations, and
                       blackboard telemetry graphs of altitude and velocity.
   ======================================================================== */

(function () {
  const NS = "http://www.w3.org/2000/svg";
  const C_MG = "#fbbf24", C_COMP = "rgba(251,191,36,0.55)", C_V = "#4ade80";
  const C_T = "#22d3ee";

  function makeHelpers(svg, eqEl) {
    function mk(tag, attrs, parent) {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, attrs[k]);
      (parent || svg).appendChild(el);
      return el;
    }
    function setVec(el, x1, y1, x2, y2) {
      el.setAttribute("x1", x1); el.setAttribute("y1", y1);
      el.setAttribute("x2", x2); el.setAttribute("y2", y2);
    }
    function arrowMarker(defs, id, color) {
      const m = mk("marker", { id, viewBox: "0 0 10 10", refX: "8.5", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, defs);
      mk("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }, m);
    }
    function labelEl(color) {
      return mk("text", {
        fill: color, "font-size": "15", "font-family": "'JetBrains Mono', monospace",
        "font-style": "italic", "font-weight": "600",
        "paint-order": "stroke", stroke: "rgba(6,10,20,0.85)", "stroke-width": "4",
      });
    }
    function typesetEq() {
      if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([eqEl]).catch(() => {});
      else setTimeout(typesetEq, 200);
    }
    function setEq(latex) { if (eqEl) { eqEl.innerHTML = latex; typesetEq(); } }
    return { mk, setVec, arrowMarker, labelEl, setEq };
  }

  // ===================== PENDULUM =====================
  function Pendulum(svg, eqEl, liveEl) {
    const { mk, setVec, arrowMarker, labelEl, setEq } = makeHelpers(svg, eqEl);
    svg.setAttribute("viewBox", "0 0 500 480");
    const PX = 250, PY = 60, L = 300, BOB_R = 26;
    const g = 9.81, Lm = 1.0;
    let theta = (55 * Math.PI) / 180, omega = 0;
    const C_STRING = "rgba(238,242,250,0.55)", C_ARC = "rgba(238,242,250,0.22)";

    const defs = mk("defs", {});
    arrowMarker(defs, "ah-t", C_T); arrowMarker(defs, "ah-mg", C_MG);
    arrowMarker(defs, "ah-comp", C_COMP); arrowMarker(defs, "ah-v", C_V);
    const grad = mk("radialGradient", { id: "fbdBob", cx: "36%", cy: "32%", r: "72%" }, defs);
    mk("stop", { offset: "0%", "stop-color": "#6f9dff" }, grad);
    mk("stop", { offset: "45%", "stop-color": "#2f6bff" }, grad);
    mk("stop", { offset: "100%", "stop-color": "#12275e" }, grad);
    const blur = mk("filter", { id: "fbdGlow", x: "-60%", y: "-60%", width: "220%", height: "220%" }, defs);
    mk("feGaussianBlur", { stdDeviation: "8" }, blur);

    const ceil = mk("g", {});
    mk("line", { x1: PX - 90, y1: PY, x2: PX + 90, y2: PY, stroke: "rgba(238,242,250,0.4)", "stroke-width": 3, "stroke-linecap": "round" }, ceil);
    for (let i = -80; i <= 80; i += 16) mk("line", { x1: PX + i, y1: PY, x2: PX + i - 9, y2: PY - 12, stroke: "rgba(238,242,250,0.22)", "stroke-width": 2, "stroke-linecap": "round" }, ceil);
    mk("circle", { cx: PX, cy: PY, r: 5, fill: "#22d3ee" }, ceil);
    mk("line", { x1: PX, y1: PY, x2: PX, y2: PY + L + 45, stroke: "rgba(238,242,250,0.18)", "stroke-width": 1.5, "stroke-dasharray": "5 7" });
    (function () {
      const a = (62 * Math.PI) / 180;
      const x1 = PX + L * Math.sin(-a), y1 = PY + L * Math.cos(-a);
      const x2 = PX + L * Math.sin(a), y2 = PY + L * Math.cos(a);
      mk("path", { d: `M ${x1} ${y1} A ${L} ${L} 0 0 0 ${x2} ${y2}`, fill: "none", stroke: C_ARC, "stroke-width": 1.6, "stroke-dasharray": "3 8", "stroke-linecap": "round" });
    })();
    const angArc = mk("path", { fill: "none", stroke: "#38bdf8", "stroke-width": 1.8 });
    const angLabel = mk("text", { fill: "#38bdf8", "font-size": "17", "font-style": "italic", "font-family": "'JetBrains Mono', monospace" });
    angLabel.textContent = "θ";
    const stringEl = mk("line", { stroke: C_STRING, "stroke-width": 2.6, "stroke-linecap": "round" });
    const guide1 = mk("line", { stroke: "rgba(238,242,250,0.18)", "stroke-width": 1.2, "stroke-dasharray": "4 5" });
    const guide2 = mk("line", { stroke: "rgba(238,242,250,0.18)", "stroke-width": 1.2, "stroke-dasharray": "4 5" });
    const vecComp1 = mk("line", { stroke: C_COMP, "stroke-width": 2.4, "marker-end": "url(#ah-comp)", "stroke-dasharray": "6 4" });
    const vecComp2 = mk("line", { stroke: C_COMP, "stroke-width": 2.4, "marker-end": "url(#ah-comp)", "stroke-dasharray": "6 4" });
    const vecMg = mk("line", { stroke: C_MG, "stroke-width": 3, "marker-end": "url(#ah-mg)" });
    const vecT = mk("line", { stroke: C_T, "stroke-width": 3, "marker-end": "url(#ah-t)" });
    const vecV = mk("line", { stroke: C_V, "stroke-width": 3, "marker-end": "url(#ah-v)" });
    const bobGlow = mk("circle", { r: BOB_R, fill: "none", opacity: 0 });
    const bob = mk("circle", { r: BOB_R, fill: "url(#fbdBob)", stroke: "rgba(120,150,220,0.45)", "stroke-width": 1.5 });
    const lblT = labelEl(C_T); lblT.textContent = "T";
    const lblMg = labelEl(C_MG); lblMg.textContent = "mg";
    const lblC1 = labelEl(C_COMP); lblC1.textContent = "mg sinθ";
    const lblC2 = labelEl(C_COMP); lblC2.textContent = "mg cosθ";
    const lblV = labelEl(C_V); lblV.textContent = "v";
    const lblL = labelEl("rgba(238,242,250,0.6)"); lblL.textContent = "L";
    const MG_LEN = 74;

    function render() {
      const s = Math.sin(theta), c = Math.cos(theta);
      const bx = PX + L * s, by = PY + L * c;
      stringEl.setAttribute("x1", PX); stringEl.setAttribute("y1", PY);
      stringEl.setAttribute("x2", bx); stringEl.setAttribute("y2", by);
      bob.setAttribute("cx", bx); bob.setAttribute("cy", by);
      bobGlow.setAttribute("cx", bx); bobGlow.setAttribute("cy", by);
      lblL.setAttribute("x", PX + (L * 0.52) * s + 14 * c);
      lblL.setAttribute("y", PY + (L * 0.52) * c - 14 * s);
      const tLen = MG_LEN * (1 + 0.35 * Math.abs(c));
      setVec(vecT, bx, by, bx - s * tLen, by - c * tLen);
      lblT.setAttribute("x", bx - s * (tLen + 20) - 6);
      lblT.setAttribute("y", by - c * (tLen + 20) + 5);
      setVec(vecMg, bx, by, bx, by + MG_LEN);
      lblMg.setAttribute("x", bx + 10);
      lblMg.setAttribute("y", by + MG_LEN + 18);
      const tDirX = c * (theta > 0 ? -1 : 1);
      const tDirY = -s * (theta > 0 ? -1 : 1);
      const tMag = MG_LEN * Math.abs(s);
      setVec(vecComp1, bx, by, bx + tDirX * tMag, by + tDirY * tMag);
      lblC1.setAttribute("x", bx + tDirX * (tMag + 14) - 34);
      lblC1.setAttribute("y", by + tDirY * (tMag + 14) + 22);
      const rMag = MG_LEN * Math.abs(c);
      setVec(vecComp2, bx, by, bx + s * rMag, by + c * rMag);
      lblC2.setAttribute("x", bx + s * (rMag + 14) + 8);
      lblC2.setAttribute("y", by + c * (rMag + 14) + 4);
      guide1.setAttribute("x1", bx + tDirX * tMag); guide1.setAttribute("y1", by + tDirY * tMag);
      guide1.setAttribute("x2", bx); guide1.setAttribute("y2", by + MG_LEN);
      guide2.setAttribute("x1", bx + s * rMag); guide2.setAttribute("y1", by + c * rMag);
      guide2.setAttribute("x2", bx); guide2.setAttribute("y2", by + MG_LEN);
      const vLen = Math.min(Math.abs(omega) * 26, 95);
      if (vLen > 6) {
        vecV.setAttribute("opacity", 1); lblV.setAttribute("opacity", 1);
        const vdx = c * Math.sign(omega), vdy = -s * Math.sign(omega);
        setVec(vecV, bx + vdx * (BOB_R + 4), by + vdy * (BOB_R + 4), bx + vdx * (BOB_R + 4 + vLen), by + vdy * (BOB_R + 4 + vLen));
        lblV.setAttribute("x", bx + vdx * (BOB_R + vLen + 22) - 4);
        lblV.setAttribute("y", by + vdy * (BOB_R + vLen + 22) + 5);
      } else {
        vecV.setAttribute("opacity", 0); lblV.setAttribute("opacity", 0);
      }
      const ar = 52;
      const ax1 = PX, ay1 = PY + ar, ax2 = PX + ar * s, ay2 = PY + ar * c;
      const sweep = theta > 0 ? 0 : 1;
      angArc.setAttribute("d", `M ${ax1} ${ay1} A ${ar} ${ar} 0 0 ${sweep} ${ax2} ${ay2}`);
      angArc.setAttribute("opacity", Math.abs(theta) > 0.06 ? 1 : 0);
      const mid = theta / 2;
      angLabel.setAttribute("x", PX + (ar + 16) * Math.sin(mid) - 5);
      angLabel.setAttribute("y", PY + (ar + 16) * Math.cos(mid) + 6);
      angLabel.setAttribute("opacity", Math.abs(theta) > 0.12 ? 1 : 0);
      if (liveEl) liveEl.textContent = "θ = " + (theta * 180 / Math.PI).toFixed(0) + "°";
    }

    setEq("$$\\ddot{\\theta} = -\\frac{g}{L}\\sin\\theta \\qquad T = 2\\pi\\sqrt{\\frac{L}{g}} \\approx 2.01\\,\\mathrm{s}$$");

    let last = performance.now();
    function step(now) {
      const dt = Math.min((now - last) / 1000, 0.032); last = now;
      if (!document.hidden) {
        const sub = 4, h = dt / sub;
        for (let i = 0; i < sub; i++) { const a = -(g / Lm) * Math.sin(theta); omega += a * h; theta += omega * h; }
        render();
      }
      requestAnimationFrame(step);
    }
    render();
    requestAnimationFrame(step);
  }

  // ===================== ROCKET MISSION =====================
  // A genuinely integrated flight: Newtonian gravity (1/r^2), exponential
  // atmosphere drag, thrust with mass depletion, gravity-turn guidance,
  // orbital-element cutoff, deorbit / entry / landing burns. Every number on
  // screen (altitude, speed, acceleration, g, drag, apoapsis, periapsis) is
  // read straight out of the integrator. Playback uses per-phase time warp
  // that is smoothed in log space so the motion never jumps.
  function Rocket(svg, eqEl, liveEl) {
    const { mk, setVec, arrowMarker, labelEl, setEq } = makeHelpers(svg, eqEl);
    svg.setAttribute("viewBox", "0 0 500 580");

    // ---- physical constants (SI) ----
    const GM = 3.986004418e14, RE = 6.371e6, rho0 = 1.225, HS = 8500;
    // ---- vehicle (tuned so the mission closes: orbit then land on the pad) ----
    const VEH = {
      m0: 520e3, mDry: 21e3, ve: 3650, T: 6.9e6, aCap: 39, CdA: 3.2,
      CdA_re: 11.0, T_land: 1.05e6, m_land: 21e3,
    };
    const TARGET_ALT = 400e3, DEORBIT_LEAD = 1.55, DEORBIT_DV = 210, ENTRY_TGT = 2200;

    // display scales
    const H_REF = 400e3;            // altitude that maps to the orbit ring
    const ALT_SCALE_LOW = 196, ALT_SCALE_HIGH = 52;  // exaggerated (labelled)
    const STAGE_B = 272;
    const GX0 = 74, GX1 = 448;
    const P1Y0 = 356, P1Y1 = 424, P2Y0 = 450, P2Y1 = 518;
    const H_AXIS = 450, V_AXIS = 8, A_AXIS = 80;
    const ANIM_TOTAL = 28;

    // per-phase time warp (sim seconds per wall second)
    const WARP = { ASCENT: 51, COAST: 213, CIRC: 28, ORBIT: 519, DEORBIT: 6, REENTRY: 216, ENTRYBURN: 58, LAND: 25, DONE: 30 };
    // Real seconds the landed rocket sits on the pad before the next launch.
    const HOLD_AFTER_LAND = 3.5;

    const C_THRUST = "#22d3ee", C_GRAV = "#fbbf24", C_DRAG = "#fb7185",
      C_VEL = "#4ade80", C_ACC = "#c084fc", C_RUL = "#94a3b8",
      C_FAINT = "rgba(238,242,250,0.20)";

    const sm = (p) => p * p * (3 - 2 * p);
    const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const rhoAt = (h) => (h > 140e3 ? 0 : rho0 * Math.exp(-h / HS));

    // ---------- state ----------
    let S, animT, samples, phaseMarks, warpNow, sinceSample;
    // Timestamp (in animT seconds) of touchdown, so the DONE phase can be held
    // for a fixed beat before the next launch. -1 means "not landed yet".
    let doneAt = -1;
    function reset() {
      S = { x: 0, y: RE, vx: 0, vy: 0, m: VEH.m0, CdA: VEH.CdA, t: 0, phase: "ASCENT", theta: 0, prevAng: 0, dv: 0, landLatch: false };
      animT = 0; samples = []; phaseMarks = []; warpNow = WARP.ASCENT; sinceSample = 0; trailPts = [];
      doneAt = -1;
      shownPhase = "";
      // Prime S.acc immediately. Every frame reads S.acc, so it must never be
      // undefined, not even on the first frame after a relaunch.
      stepPhysics(0.001);
    }

    function elements(x, y, vx, vy) {
      const r = Math.hypot(x, y), v = Math.hypot(vx, vy);
      const E = v * v / 2 - GM / r;
      const a = -GM / (2 * E);
      const hA = x * vy - y * vx;
      const e = Math.sqrt(Math.max(0, 1 + 2 * E * hA * hA / (GM * GM)));
      return { r, v, a, e, apo: a * (1 + e), peri: a * (1 - e) };
    }

    // one integration step of dt seconds (semi-implicit Euler, small dt)
    function stepPhysics(dt) {
      const r = Math.hypot(S.x, S.y), h = r - RE, v = Math.hypot(S.vx, S.vy);
      const upx = S.x / r, upy = S.y / r;
      const prox = upy, proy = -upx;              // prograde (theta increasing)
      const el = elements(S.x, S.y, S.vx, S.vy);

      // unwrap swept angle
      const ang = Math.atan2(S.x, S.y);
      let dA = ang - S.prevAng;
      if (dA > Math.PI) dA -= 2 * Math.PI;
      if (dA < -Math.PI) dA += 2 * Math.PI;
      S.theta += dA; S.prevAng = ang;

      let thrust = null;
      const P = S.phase;
      if (P === "ASCENT") {
        const p = c01((h - 1500) / (150e3 - 1500));
        const pitch = (Math.PI / 2) * sm(p);
        const dx = upx * Math.cos(pitch) + prox * Math.sin(pitch);
        const dy = upy * Math.cos(pitch) + proy * Math.sin(pitch);
        if (S.m > VEH.mDry) {
          const thr = Math.min(1, (VEH.aCap * S.m) / VEH.T);
          const aT = (VEH.T * thr) / S.m;
          thrust = [dx * aT, dy * aT];
          S.m -= (VEH.T * thr / VEH.ve) * dt;
        }
        if (el.apo - RE >= TARGET_ALT) S.phase = "COAST";
      } else if (P === "COAST") {
        if ((S.x * S.vx + S.y * S.vy) / r <= 0) S.phase = "CIRC";
      } else if (P === "CIRC") {
        const vc = Math.sqrt(GM / r);
        let thr = Math.min(Math.max((vc - v) / 40, 0), 1);
        thr = Math.min(thr, (VEH.aCap * S.m) / VEH.T);
        if (thr > 0.005 && S.m > VEH.mDry) {
          const aT = (VEH.T * thr) / S.m;
          thrust = [prox * aT, proy * aT];
          S.m -= (VEH.T * thr / VEH.ve) * dt;
        } else S.phase = "ORBIT";
      } else if (P === "ORBIT") {
        if (S.theta >= 2 * Math.PI - DEORBIT_LEAD) { S.phase = "DEORBIT"; S.m = VEH.m_land; S.CdA = VEH.CdA_re; S.dv = 0; }
      } else if (P === "DEORBIT") {
        const aT = VEH.T_land / S.m;
        thrust = [-prox * aT, -proy * aT];
        S.dv += aT * dt;
        if (S.dv >= DEORBIT_DV) S.phase = "REENTRY";
      } else if (P === "ENTRYBURN") {
        const aT = VEH.T_land / S.m, n = v || 1;
        thrust = [-S.vx / n * aT, -S.vy / n * aT];
        if (v <= ENTRY_TGT) S.phase = "REENTRY";
      } else if (P === "REENTRY" || P === "LAND") {
        if (P === "REENTRY" && h < 72e3 && v > ENTRY_TGT + 50) S.phase = "ENTRYBURN";
        else {
          const rdot = (S.x * S.vx + S.y * S.vy) / r, vDown = -rdot;
          const aTmax = VEH.T_land / S.m, gLoc = GM / (r * r);
          const need = (vDown * vDown) / (2 * Math.max(h, 1));
          if (S.phase === "REENTRY" && vDown > 0 && need + gLoc >= 0.30 * aTmax) S.phase = "LAND";
          if (S.phase === "LAND") {
            const vT = Math.max(1.8, Math.min(75, Math.sqrt(2 * 0.32 * aTmax * Math.max(h - 3, 0))));
            // a rocket can only push away from its engine: never command
            // downward thrust (that used to flip the vehicle over)
            const aUp = Math.max(0, gLoc + 4.0 * (vDown - vT));
            const vHor = S.vx * prox + S.vy * proy;
            const dHor = r * (S.theta - 2 * Math.PI);
            const nearF = Math.min(h / 1800, 1);
            let aHor = -(2.6 + 7 * (1 - nearF)) * vHor - 0.03 * dHor * nearF;
            const aHorMax = 0.6 * aTmax;
            aHor = Math.max(-aHorMax, Math.min(aHorMax, aHor));
            let tx = upx * aUp + prox * aHor, ty = upy * aUp + proy * aHor;
            const mg = Math.hypot(tx, ty);
            if (mg > aTmax) { tx = tx / mg * aTmax; ty = ty / mg * aTmax; }
            thrust = [tx, ty];
            if (h <= 0.5) { S.phase = "DONE"; S.vx = 0; S.vy = 0; }
          }
        }
      }

      // accelerations
      const gA = -GM / (r * r * r);
      let ax = gA * S.x, ay = gA * S.y;
      const gMag = GM / (r * r);
      let dMag = 0;
      if (v > 1) {
        const q = 0.5 * rhoAt(h) * v * v;
        dMag = q * S.CdA / S.m;
        ax -= dMag * S.vx / v; ay -= dMag * S.vy / v;
      }
      let tMag = 0;
      if (thrust) { ax += thrust[0]; ay += thrust[1]; tMag = Math.hypot(thrust[0], thrust[1]); }

      if (S.phase !== "DONE") {
        S.vx += ax * dt; S.vy += ay * dt;
        S.x += S.vx * dt; S.y += S.vy * dt;
        S.t += dt;
      }
      S.acc = { ax, ay, aNet: Math.hypot(ax, ay), g: gMag, drag: dMag, thrust: tMag, thrustVec: thrust, el, h, v, r, upx, upy, prox, proy };
      return S.acc;
    }

    // ================= defs =================
    const defs = mk("defs", {});
    arrowMarker(defs, "r-ah-t", C_THRUST); arrowMarker(defs, "r-ah-g", C_GRAV);
    arrowMarker(defs, "r-ah-d", C_DRAG); arrowMarker(defs, "r-ah-v", C_VEL);
    arrowMarker(defs, "r-ah-a", C_ACC);
    const ocean = mk("radialGradient", { id: "oceanG", cx: "35%", cy: "28%", r: "85%" }, defs);
    mk("stop", { offset: "0%", "stop-color": "#4a9fe8" }, ocean);
    mk("stop", { offset: "55%", "stop-color": "#1e5fc2" }, ocean);
    mk("stop", { offset: "100%", "stop-color": "#0a1f52" }, ocean);
    const termG = mk("linearGradient", { id: "termG", x1: "0%", y1: "0%", x2: "95%", y2: "70%" }, defs);
    mk("stop", { offset: "55%", "stop-color": "rgba(2,6,18,0)" }, termG);
    mk("stop", { offset: "100%", "stop-color": "rgba(2,6,18,0.62)" }, termG);
    const atmG = mk("radialGradient", { id: "atmG", cx: "50%", cy: "50%", r: "50%" }, defs);
    mk("stop", { offset: "74%", "stop-color": "rgba(96,190,255,0)" }, atmG);
    mk("stop", { offset: "90%", "stop-color": "rgba(96,190,255,0.30)" }, atmG);
    mk("stop", { offset: "100%", "stop-color": "rgba(96,190,255,0)" }, atmG);
    const fl = mk("filter", { id: "rGlow", x: "-70%", y: "-70%", width: "240%", height: "240%" }, defs);
    mk("feGaussianBlur", { stdDeviation: "4.5" }, fl);
    mk("clipPath", { id: "planetClip" }, defs).appendChild((function () { const c = document.createElementNS(NS, "circle"); c.setAttribute("r", 100); return c; })());
    const fadeV = mk("linearGradient", { id: "fadeV", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    mk("stop", { offset: "0", "stop-color": "#000" }, fadeV);
    mk("stop", { offset: "0.08", "stop-color": "#fff" }, fadeV);
    mk("stop", { offset: "0.86", "stop-color": "#fff" }, fadeV);
    mk("stop", { offset: "1", "stop-color": "#000" }, fadeV);
    const fadeH = mk("linearGradient", { id: "fadeH", x1: "0", y1: "0", x2: "1", y2: "0" }, defs);
    mk("stop", { offset: "0", "stop-color": "#000" }, fadeH);
    mk("stop", { offset: "0.07", "stop-color": "#fff" }, fadeH);
    mk("stop", { offset: "0.93", "stop-color": "#fff" }, fadeH);
    mk("stop", { offset: "1", "stop-color": "#000" }, fadeH);
    mk("rect", { x: 0, y: 0, width: 500, height: STAGE_B, fill: "url(#fadeV)" }, mk("mask", { id: "rMaskV" }, defs));
    mk("rect", { x: 0, y: 0, width: 500, height: STAGE_B, fill: "url(#fadeH)" }, mk("mask", { id: "rMaskH" }, defs));

    // ================= stage =================
    const stageOuter = mk("g", { mask: "url(#rMaskV)" });
    const stage = mk("g", { mask: "url(#rMaskH)" }, stageOuter);
    let seed = 9;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 64; i++) mk("circle", { cx: (rnd() * 500).toFixed(1), cy: (rnd() * STAGE_B).toFixed(1), r: (0.5 + rnd() * 1.2).toFixed(2), fill: "rgba(238,242,250,0.6)", opacity: (0.2 + rnd() * 0.6).toFixed(2) }, stage);

    const atmosphere = mk("circle", { fill: "url(#atmG)" }, stage);
    const planetG = mk("g", {}, stage);
    mk("circle", { cx: 0, cy: 0, r: 100, fill: "url(#oceanG)" }, planetG);
    const landG = mk("g", { "clip-path": "url(#planetClip)" }, planetG);
    const blob = (cx, cy, rx, ry, rot, fill) => mk("ellipse", { cx, cy, rx, ry, transform: "rotate(" + rot + " " + cx + " " + cy + ")", fill }, landG);
    blob(0, -82, 58, 26, 0, "#2f9e44"); blob(14, -76, 30, 14, 8, "#46b45e");
    blob(-58, -6, 26, 44, 18, "#2f9e44"); blob(-52, -18, 14, 22, 18, "#46b45e");
    blob(62, 28, 30, 20, -12, "#2f9e44"); blob(-6, 74, 36, 17, 4, "#2f9e44");
    mk("circle", { cx: 30, cy: 52, r: 6, fill: "#2f9e44" }, landG);
    mk("circle", { cx: -22, cy: 40, r: 5, fill: "#46b45e" }, landG);
    [[20, -46, 30, 8, -15], [-42, 16, 24, 7, 10], [36, 4, 20, 6, -5], [-8, 56, 18, 5, 8]].forEach((c) =>
      mk("ellipse", { cx: c[0], cy: c[1], rx: c[2], ry: c[3], transform: "rotate(" + c[4] + " " + c[0] + " " + c[1] + ")", fill: "rgba(255,255,255,0.3)" }, landG));
    mk("circle", { cx: 0, cy: 0, r: 100, fill: "url(#termG)" }, planetG);
    const planetRim = mk("circle", { fill: "none", stroke: "rgba(140,190,255,0.35)", "stroke-width": 1 }, stage);

    const skyClouds = mk("g", {}, stage);
    [[96, 84], [382, 62], [166, 150], [330, 172]].forEach((c) => {
      const g = mk("g", { transform: "translate(" + c[0] + " " + c[1] + ")" }, skyClouds);
      mk("ellipse", { cx: 0, cy: 0, rx: 30, ry: 9, fill: "rgba(255,255,255,0.13)" }, g);
      mk("ellipse", { cx: -14, cy: -5, rx: 16, ry: 7, fill: "rgba(255,255,255,0.1)" }, g);
      mk("ellipse", { cx: 14, cy: -3, rx: 18, ry: 7, fill: "rgba(255,255,255,0.1)" }, g);
    });

    const orbitPath = mk("circle", { fill: "none", stroke: C_FAINT, "stroke-width": 1.1, "stroke-dasharray": "2 7" }, stage);
    const apsisA = mk("circle", { r: 2.6, fill: "none", stroke: C_THRUST, "stroke-width": 1.2 }, stage);
    const apsisP = mk("circle", { r: 2.6, fill: "none", stroke: C_DRAG, "stroke-width": 1.2 }, stage);
    const centerDot = mk("circle", { r: 3, fill: "rgba(238,242,250,0.55)" }, stage);
    const thArc = mk("path", { fill: "none", stroke: "#38bdf8", "stroke-width": 1.1 }, stage);
    const thLbl = mk("text", { fill: "#38bdf8", "font-size": "11", "font-style": "italic", "font-family": "'JetBrains Mono', monospace" }, stage);
    thLbl.textContent = "θ";

    // altitude ruler (two labels only, so they never collide)
    const rulerLine = mk("line", { stroke: C_RUL, "stroke-width": 1, "stroke-dasharray": "3 5", opacity: 0 }, stage);
    const rulerTicks = [100, 200, 300, 400].map((hh) => ({
      h: hh,
      tick: mk("line", { stroke: C_RUL, "stroke-width": 1, opacity: 0 }, stage),
      lab: (() => {
        const l = mk("text", {
          fill: "#cbd5e1", "font-size": "9", "text-anchor": "middle",
          "font-family": "'JetBrains Mono', monospace", "font-weight": "600",
          "paint-order": "stroke", stroke: "rgba(6,10,20,0.9)", "stroke-width": "3",
          opacity: 0,
        }, stage);
        l.textContent = String(hh);
        return l;
      })(),
      major: hh === 200 || hh === 400,
    }));
    const rulerCap = mk("text", { fill: C_RUL, "font-size": "7.5", "text-anchor": "end", "font-family": "'JetBrains Mono', monospace", opacity: 0 }, stage);
    rulerCap.textContent = "km (exaggerated)";

    const trail = mk("path", { fill: "none", stroke: "rgba(34,211,238,0.4)", "stroke-width": 1.1, "stroke-dasharray": "1 5" }, stage);
    const radial = mk("line", { stroke: C_FAINT, "stroke-width": 1, "stroke-dasharray": "4 5" }, stage);

    const padG = mk("g", {}, stage);
    mk("rect", { x: -26, y: 0, width: 52, height: 6, rx: 1.5, fill: "#55627a", stroke: "#728098", "stroke-width": 0.8 }, padG);
    mk("rect", { x: -30, y: 6, width: 60, height: 3, fill: "#3d4759" }, padG);
    mk("rect", { x: -27, y: -70, width: 7, height: 70, fill: "#4a5568", stroke: "#5f6c82", "stroke-width": 0.8 }, padG);
    for (let y = -62; y < 0; y += 12) mk("line", { x1: -27, y1: y, x2: -20, y2: y + 12, stroke: "#5f6c82", "stroke-width": 1 }, padG);
    const holdArm = mk("line", { x1: -20, y1: -30, x2: -6, y2: -30, stroke: "#728098", "stroke-width": 2 }, padG);
    const beacon = mk("circle", { cx: -23.5, cy: -73, r: 2.2, fill: "#ef4444" }, padG);

    const vecG = mk("line", { stroke: C_GRAV, "stroke-width": 1.8, "marker-end": "url(#r-ah-g)" }, stage);
    const vecD = mk("line", { stroke: C_DRAG, "stroke-width": 1.8, "marker-end": "url(#r-ah-d)" }, stage);
    const vecT = mk("line", { stroke: C_THRUST, "stroke-width": 1.8, "marker-end": "url(#r-ah-t)" }, stage);
    const vecV = mk("line", { stroke: C_VEL, "stroke-width": 1.8, "marker-end": "url(#r-ah-v)" }, stage);
    const vecA = mk("line", { stroke: C_ACC, "stroke-width": 1.8, "stroke-dasharray": "5 3", "marker-end": "url(#r-ah-a)" }, stage);

    const sparksG = mk("g", {}, stage);
    const sparkEls = []; for (let i = 0; i < 30; i++) sparkEls.push(mk("circle", { r: 1.2, fill: i % 2 ? "#fbbf24" : "#fb923c", opacity: 0 }, sparksG));
    let sparks = [], trailPts = [];

    const rocketG = mk("g", {}, stage);
    const flame = mk("polygon", { fill: "#fb923c", opacity: 0, filter: "url(#rGlow)" }, rocketG);
    const flameCore = mk("polygon", { fill: "#fde68a", opacity: 0 }, rocketG);
    const legL = mk("line", { x1: -4, y1: 12, x2: -10, y2: 19, stroke: "#94a3b8", "stroke-width": 1.8, "stroke-linecap": "round", opacity: 0 }, rocketG);
    const legR = mk("line", { x1: 4, y1: 12, x2: 10, y2: 19, stroke: "#94a3b8", "stroke-width": 1.8, "stroke-linecap": "round", opacity: 0 }, rocketG);
    mk("polygon", { points: "-5,4 -11,16 -5,12", fill: "#ef4444" }, rocketG);
    mk("polygon", { points: "5,4 11,16 5,12", fill: "#ef4444" }, rocketG);
    mk("path", { d: "M -5,-7 L -5,11 L 5,11 L 5,-7 Z", fill: "#e8eefc", stroke: "rgba(148,163,184,0.8)", "stroke-width": 0.8 }, rocketG);
    mk("polygon", { points: "-5,-7 0,-17 5,-7", fill: "#ef4444" }, rocketG);
    mk("polygon", { points: "-3.4,11 3.4,11 4.4,15 -4.4,15", fill: "#94a3b8" }, rocketG);
    mk("circle", { cx: 0, cy: -1.5, r: 2, fill: "#22d3ee" }, rocketG);
    const heat = mk("ellipse", { rx: 15, ry: 8, cy: 14, fill: "rgba(251,113,133,0.5)", filter: "url(#rGlow)", opacity: 0 }, rocketG);

    function vlab(color, txt) { const l = labelEl(color); l.textContent = txt; l.setAttribute("font-size", "11.5"); l.setAttribute("stroke-width", "3.5"); stage.appendChild(l); return l; }
    const lblT = vlab(C_THRUST, "T"), lblG = vlab(C_GRAV, "Fg"), lblD = vlab(C_DRAG, "D"),
      lblV = vlab(C_VEL, "v"), lblA = vlab(C_ACC, "a"), lblR = vlab("rgba(238,242,250,0.45)", "r");

    // HUD text (SVG so it scales crisply and never covers the art)
    const hud = mk("g", {});
    const hudT = mk("text", { x: 12, y: 20, fill: "rgba(238,242,250,0.85)", "font-size": "11", "font-family": "'JetBrains Mono', monospace" }, hud);
    const hudH = mk("text", { x: 12, y: 34, fill: "rgba(34,211,238,0.9)", "font-size": "10", "font-family": "'JetBrains Mono', monospace" }, hud);
    const hudV = mk("text", { x: 12, y: 47, fill: "rgba(74,222,128,0.9)", "font-size": "10", "font-family": "'JetBrains Mono', monospace" }, hud);
    const hudA = mk("text", { x: 12, y: 60, fill: "rgba(192,132,252,0.9)", "font-size": "10", "font-family": "'JetBrains Mono', monospace" }, hud);
    const hudO = mk("text", { x: 12, y: 73, fill: "rgba(238,242,250,0.5)", "font-size": "9", "font-family": "'JetBrains Mono', monospace" }, hud);
    const phaseTag = mk("text", { x: 488, y: 20, "font-size": "11", "text-anchor": "end", "font-family": "'JetBrains Mono', monospace", "font-weight": "700", "letter-spacing": "1.2" }, hud);
    const warpTag = mk("text", { x: 488, y: 34, fill: "rgba(238,242,250,0.45)", "font-size": "9", "text-anchor": "end", "font-family": "'JetBrains Mono', monospace" }, hud);

    // ================= graphs =================
    const gxOf = (u) => GX0 + c01(u / ANIM_TOTAL) * (GX1 - GX0);
    const gy1 = (fr) => P1Y1 - c01(fr) * (P1Y1 - P1Y0);
    const gy2 = (fr) => P2Y1 - c01(fr) * (P2Y1 - P2Y0);
    function axis(y0, y1) {
      mk("line", { x1: GX0, y1: y0 - 4, x2: GX0, y2: y1, stroke: "rgba(238,242,250,0.4)", "stroke-width": 1.1 });
      mk("line", { x1: GX0, y1: y1, x2: GX1 + 6, y2: y1, stroke: "rgba(238,242,250,0.4)", "stroke-width": 1.1 });
    }
    axis(P1Y0, P1Y1); axis(P2Y0, P2Y1);
    [0, 0.5, 1].forEach((fr) => {
      [gy1, gy2].forEach((fn) => { if (fr > 0) mk("line", { x1: GX0, y1: fn(fr), x2: GX1, y2: fn(fr), stroke: "rgba(238,242,250,0.08)", "stroke-width": 1, "stroke-dasharray": "2 7" }); });
      const t1 = mk("text", { x: GX0 - 6, y: gy1(fr) + 3, fill: "rgba(34,211,238,0.7)", "font-size": "8.5", "text-anchor": "end", "font-family": "'JetBrains Mono', monospace" }); t1.textContent = String(Math.round(fr * H_AXIS));
      const t2 = mk("text", { x: GX1 + 10, y: gy1(fr) + 3, fill: "rgba(74,222,128,0.7)", "font-size": "8.5", "font-family": "'JetBrains Mono', monospace" }); t2.textContent = (fr * V_AXIS).toFixed(0);
      const t3 = mk("text", { x: GX0 - 6, y: gy2(fr) + 3, fill: "rgba(192,132,252,0.75)", "font-size": "8.5", "text-anchor": "end", "font-family": "'JetBrains Mono', monospace" }); t3.textContent = String(Math.round(fr * A_AXIS));
      const t4 = mk("text", { x: GX1 + 10, y: gy2(fr) + 3, fill: "rgba(251,191,36,0.6)", "font-size": "8.5", "font-family": "'JetBrains Mono', monospace" }); t4.textContent = (fr * A_AXIS / 9.81).toFixed(0) + "g";
    });
    function legend(x, y, color, txt, anchor) { const l = mk("text", { x, y, fill: color, "font-size": "9", "font-family": "'JetBrains Mono', monospace", "text-anchor": anchor || "start" }); l.textContent = txt; return l; }
    legend(GX0, P1Y0 - 9, "rgba(34,211,238,0.9)", "ALTITUDE km");
    legend(GX1 + 10, P1Y0 - 9, "rgba(74,222,128,0.9)", "SPEED km/s", "end");
    legend(GX0, P2Y0 - 9, "rgba(192,132,252,0.95)", "NET ACCEL m/s²");
    legend(GX1 + 10, P2Y0 - 9, "rgba(251,191,36,0.75)", "gravity", "end");
    legend(GX1 + 10, P2Y0 + 1, "rgba(251,113,133,0.85)", "drag", "end");
    legend(GX1 + 10, P2Y0 + 11, "rgba(34,211,238,0.75)", "thrust", "end");

    const curveH = mk("path", { fill: "none", stroke: "#22d3ee", "stroke-width": 1.5, "stroke-linejoin": "round" });
    const curveV = mk("path", { fill: "none", stroke: "#4ade80", "stroke-width": 1.5, "stroke-linejoin": "round" });
    const curveA = mk("path", { fill: "none", stroke: "#c084fc", "stroke-width": 1.5, "stroke-linejoin": "round" });
    const curveG = mk("path", { fill: "none", stroke: "rgba(251,191,36,0.7)", "stroke-width": 1, "stroke-dasharray": "2 3" });
    const curveD = mk("path", { fill: "none", stroke: "rgba(251,113,133,0.85)", "stroke-width": 1, "stroke-dasharray": "2 3" });
    const curveTh = mk("path", { fill: "none", stroke: "rgba(34,211,238,0.6)", "stroke-width": 1, "stroke-dasharray": "4 3" });
    const dotH = mk("circle", { r: 2.6, fill: "#22d3ee" });
    const dotV = mk("circle", { r: 2.6, fill: "#4ade80" });
    const dotA = mk("circle", { r: 2.6, fill: "#c084fc" });
    const sweepL = mk("line", { y1: P1Y0 - 4, y2: P2Y1, stroke: "rgba(238,242,250,0.22)", "stroke-width": 1 });
    const markG = mk("g", {});
    const labelG = mk("g", {});

    function drawGraphs() {
      let dH = "", dV = "", dA = "", dG = "", dD = "", dT = "";
      samples.forEach((s, i) => {
        const x = gxOf(s.u).toFixed(1), pre = i ? " L " : "M ";
        dH += pre + x + " " + gy1(s.h / H_AXIS).toFixed(1);
        dV += pre + x + " " + gy1(s.v / V_AXIS).toFixed(1);
        dA += pre + x + " " + gy2(s.a / A_AXIS).toFixed(1);
        dG += pre + x + " " + gy2(s.g / A_AXIS).toFixed(1);
        dD += pre + x + " " + gy2(s.d / A_AXIS).toFixed(1);
        dT += pre + x + " " + gy2(s.th / A_AXIS).toFixed(1);
      });
      curveH.setAttribute("d", dH); curveV.setAttribute("d", dV); curveA.setAttribute("d", dA);
      curveG.setAttribute("d", dG); curveD.setAttribute("d", dD); curveTh.setAttribute("d", dT);
      const last = samples[samples.length - 1];
      if (last) {
        const x = gxOf(last.u);
        dotH.setAttribute("cx", x); dotH.setAttribute("cy", gy1(last.h / H_AXIS));
        dotV.setAttribute("cx", x); dotV.setAttribute("cy", gy1(last.v / V_AXIS));
        dotA.setAttribute("cx", x); dotA.setAttribute("cy", gy2(last.a / A_AXIS));
        sweepL.setAttribute("x1", x); sweepL.setAttribute("x2", x);
      }
    }
    function drawMarks() {
      while (markG.firstChild) markG.removeChild(markG.firstChild);
      while (labelG.firstChild) labelG.removeChild(labelG.firstChild);
      phaseMarks.forEach((pm, i) => {
        const x = gxOf(pm.u);
        mk("line", { x1: x, y1: P1Y0 - 4, x2: x, y2: P2Y1 + 4, stroke: "rgba(238,242,250,0.16)", "stroke-width": 1, "stroke-dasharray": "3 5" }, markG);
        const nx = i + 1 < phaseMarks.length ? gxOf(phaseMarks[i + 1].u) : gxOf(ANIM_TOTAL);
        if (nx - x > 26) {
          const l = mk("text", { x: (x + nx) / 2, y: P2Y1 + 17, fill: "rgba(238,242,250,0.45)", "font-size": "8.5", "text-anchor": "middle", "letter-spacing": "0.8", "font-family": "'JetBrains Mono', monospace" }, labelG);
          l.textContent = pm.name;
        }
      });
    }

    // ================= equations =================
    const EQ = {
      ASCENT: "$m\\dot v = T - mg - \\tfrac12\\rho v^2 C_dA$",
      COAST: "$\\varepsilon = \\dfrac{v^2}{2} - \\dfrac{GM}{r} \\qquad r_a = a(1+e)$",
      CIRC: "$v_{circ} = \\sqrt{GM/r}$",
      ORBIT: "$v = \\sqrt{\\dfrac{GM}{r}} \\qquad T = 2\\pi\\sqrt{\\dfrac{r^3}{GM}}$",
      DEORBIT: "$\\Delta v = v_e \\ln(m_0/m_f)$",
      ENTRYBURN: "$D = \\tfrac12 \\rho v^2 C_d A$",
      REENTRY: "$\\rho(h) = \\rho_0 e^{-h/H} \\qquad D = \\tfrac12\\rho v^2C_dA$",
      LAND: "$v^2 = 2(a_T - g)\\,h \\qquad T \\ge mg$",
      DONE: "$v \\approx 0 \\quad \\text{touchdown}$",
    };
    const PHASE_COLOR = { ASCENT: C_THRUST, COAST: "#93c5fd", CIRC: C_THRUST, ORBIT: C_VEL, DEORBIT: C_DRAG, ENTRYBURN: C_DRAG, REENTRY: C_DRAG, LAND: C_THRUST, DONE: C_VEL };
    let shownPhase = "";

    // ================= render =================
    let attAng = -Math.PI / 2;   // smoothed sprite heading (starts nose-up)
    function render(dtR) {
      const A = S.acc; if (!A) return;
      dtR = dtR || 0.016;
      const h = A.h, v = A.v, th = S.theta;

      const k = sm(c01(h / 220e3));
      const R = 900 + (70 - 900) * k;
      const ECX = 250, ECY = 1110 + (140 - 1110) * k;
      const altScale = ALT_SCALE_LOW + (ALT_SCALE_HIGH - ALT_SCALE_LOW) * k;
      const altPx = (h / H_REF) * altScale;
      const lift = 23 * (1 - k);
      const rr = R + altPx + lift;
      const sc = R / 100;

      planetG.setAttribute("transform", "translate(" + ECX + " " + ECY + ") scale(" + sc.toFixed(4) + ")");
      planetRim.setAttribute("cx", ECX); planetRim.setAttribute("cy", ECY); planetRim.setAttribute("r", R);
      atmosphere.setAttribute("cx", ECX); atmosphere.setAttribute("cy", ECY); atmosphere.setAttribute("r", R * 1.13);
      skyClouds.setAttribute("opacity", (1 - k) * 0.9);
      const orbR = R + altScale;
      orbitPath.setAttribute("cx", ECX); orbitPath.setAttribute("cy", ECY); orbitPath.setAttribute("r", orbR);
      orbitPath.setAttribute("opacity", k > 0.5 ? (k - 0.5) * 2 * 0.9 : 0);
      centerDot.setAttribute("cx", ECX); centerDot.setAttribute("cy", ECY);
      centerDot.setAttribute("opacity", k > 0.6 ? 1 : 0);

      padG.setAttribute("transform", "translate(" + ECX + " " + (ECY - R - 6) + ") scale(" + (1 - 0.55 * k).toFixed(3) + ")");
      padG.setAttribute("opacity", Math.pow(1 - k, 1.4));
      holdArm.setAttribute("opacity", Math.max(0, 1 - S.t * 0.25));
      beacon.setAttribute("opacity", 0.35 + 0.65 * (Math.sin(animT * 7) > 0 ? 1 : 0));

      // screen frame
      const sp = Math.sin(th), cp = Math.cos(th);
      const px = ECX + rr * sp, py = ECY - rr * cp;
      const sRad = [sp, -cp], sTan = [cp, sp];
      const toScreen = (wx, wy) => {
        const vr = wx * sp + wy * cp, vt = wx * cp - wy * sp;
        const X = vr * sRad[0] + vt * sTan[0], Y = vr * sRad[1] + vt * sTan[1];
        const n = Math.hypot(X, Y) || 1;
        return [X / n, Y / n];
      };

      // Attitude by flight phase (this is how the real vehicle is oriented),
      // then smoothed along the shortest arc so it can never snap or spin.
      let want;
      const P = S.phase;
      if (P === "ASCENT") want = A.thrustVec ? toScreen(A.thrustVec[0], A.thrustVec[1]) : sRad;
      else if (P === "DEORBIT") want = v > 20 ? toScreen(-S.vx, -S.vy) : sRad;
      else if (P === "ENTRYBURN" || P === "REENTRY" || P === "LAND" || P === "DONE") want = sRad; // engines down, nose up
      else want = v > 20 ? toScreen(S.vx, S.vy) : sRad;                                          // prograde on orbit
      const wantAng = Math.atan2(want[1], want[0]);
      let dAng = wantAng - attAng;
      while (dAng > Math.PI) dAng -= 2 * Math.PI;
      while (dAng < -Math.PI) dAng += 2 * Math.PI;
      attAng += dAng * Math.min(1, dtR * 5.5);
      const att = [Math.cos(attAng), Math.sin(attAng)];
      rocketG.setAttribute("transform", "translate(" + px.toFixed(1) + " " + py.toFixed(1) + ") rotate(" + ((attAng * 180) / Math.PI + 90).toFixed(1) + ")");

      const vDir = v > 1 ? toScreen(S.vx, S.vy) : [0, 0];

      if (k > 0.5) { trailPts.push([px, py]); if (trailPts.length > 200) trailPts.shift(); }
      trail.setAttribute("d", trailPts.map((q, i) => (i ? "L " : "M ") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" "));
      trail.setAttribute("opacity", k * 0.85);

      setVec(radial, ECX, ECY, px, py);
      radial.setAttribute("opacity", k > 0.55 ? 0.85 : 0);
      lblR.setAttribute("x", (ECX + px) / 2 + 7); lblR.setAttribute("y", (ECY + py) / 2 - 3);
      lblR.setAttribute("opacity", k > 0.55 ? 1 : 0);

      const thShow = k > 0.6 && th > 0.25;
      if (thShow) {
        const ar = 20, large = (th % (2 * Math.PI)) > Math.PI ? 1 : 0;
        thArc.setAttribute("d", "M " + ECX + " " + (ECY - ar) + " A " + ar + " " + ar + " 0 " + large + " 1 " + (ECX + ar * sp).toFixed(1) + " " + (ECY - ar * cp).toFixed(1));
        thLbl.setAttribute("x", ECX + 30 * Math.sin(th / 2) - 3);
        thLbl.setAttribute("y", ECY - 30 * Math.cos(th / 2) + 4);
      }
      thArc.setAttribute("opacity", thShow ? 0.85 : 0); thLbl.setAttribute("opacity", thShow ? 0.85 : 0);

      // apsides from live orbital elements
      const showAps = k > 0.75 && A.el.e < 0.9 && isFinite(A.el.apo);
      if (showAps) {
        const ra = R + ((A.el.apo - RE) / H_REF) * altScale, rp = R + ((A.el.peri - RE) / H_REF) * altScale;
        const angA = th, angP = th + Math.PI;
        apsisA.setAttribute("cx", ECX + ra * Math.sin(angA)); apsisA.setAttribute("cy", ECY - ra * Math.cos(angA));
        apsisP.setAttribute("cx", ECX + Math.max(rp, R * 0.98) * Math.sin(angP)); apsisP.setAttribute("cy", ECY - Math.max(rp, R * 0.98) * Math.cos(angP));
      }
      apsisA.setAttribute("opacity", showAps ? 0.6 : 0); apsisP.setAttribute("opacity", showAps ? 0.6 : 0);

      // altitude ruler
      const aR = -2.15, rsx = Math.sin(aR), rcy = -Math.cos(aR);
      const rulOp = k > 0.7 ? (k - 0.7) / 0.3 : 0;
      rulerLine.setAttribute("x1", ECX + R * rsx); rulerLine.setAttribute("y1", ECY + R * rcy);
      rulerLine.setAttribute("x2", ECX + (R + altScale * 1.14) * rsx); rulerLine.setAttribute("y2", ECY + (R + altScale * 1.14) * rcy);
      rulerLine.setAttribute("opacity", rulOp * 0.9);
      rulerTicks.forEach((rt) => {
        const rk = R + (rt.h / 400) * altScale;
        const bx = ECX + rk * rsx, by = ECY + rk * rcy;
        const tl = rt.major ? 6 : 3.5;
        rt.tick.setAttribute("x1", bx - rcy * tl); rt.tick.setAttribute("y1", by + rsx * tl);
        rt.tick.setAttribute("x2", bx + rcy * tl); rt.tick.setAttribute("y2", by - rsx * tl);
        rt.tick.setAttribute("opacity", rulOp * (rt.major ? 0.95 : 0.5));
        // push the number clear of the ruler, perpendicular to it
        rt.lab.setAttribute("x", bx - rcy * 13); rt.lab.setAttribute("y", by + rsx * 13 + 3);
        rt.lab.setAttribute("opacity", rt.major ? rulOp * 0.95 : 0);
      });
      rulerCap.setAttribute("x", ECX + (R + altScale * 1.14) * rsx - 4);
      rulerCap.setAttribute("y", ECY + (R + altScale * 1.14) * rcy - 6);
      rulerCap.setAttribute("opacity", rulOp * 0.55);

      // ---- FBD vectors, scaled from the real accelerations ----
      const OFF = 12, SCA = 1.05;   // px per m/s^2
      const gPx = Math.max(14, Math.min(58, A.g * 2.4));
      const gd = toScreen(-A.upx, -A.upy);
      setVec(vecG, px + gd[0] * OFF, py + gd[1] * OFF, px + gd[0] * (OFF + gPx), py + gd[1] * (OFF + gPx));
      lblG.setAttribute("x", px + gd[0] * (OFF + gPx + 11) - 6); lblG.setAttribute("y", py + gd[1] * (OFF + gPx + 11) + 4);

      const tOn = A.thrust > 0.5;
      const tPx = Math.min(66, A.thrust * SCA);
      vecT.setAttribute("opacity", tOn ? 1 : 0); lblT.setAttribute("opacity", tOn ? 1 : 0);
      if (tOn) {
        const td = toScreen(A.thrustVec[0], A.thrustVec[1]);
        setVec(vecT, px + td[0] * OFF, py + td[1] * OFF, px + td[0] * (OFF + tPx), py + td[1] * (OFF + tPx));
        lblT.setAttribute("x", px + td[0] * (OFF + tPx + 11) - 4); lblT.setAttribute("y", py + td[1] * (OFF + tPx + 11) + 4);
      }

      const dPx = Math.min(62, A.drag * SCA);
      const dOn = dPx > 5 && v > 1;
      vecD.setAttribute("opacity", dOn ? 1 : 0); lblD.setAttribute("opacity", dOn ? 1 : 0);
      if (dOn) {
        setVec(vecD, px - vDir[0] * OFF, py - vDir[1] * OFF, px - vDir[0] * (OFF + dPx), py - vDir[1] * (OFF + dPx));
        lblD.setAttribute("x", px - vDir[0] * (OFF + dPx + 11) - 4); lblD.setAttribute("y", py - vDir[1] * (OFF + dPx + 11) + 4);
      }
      heat.setAttribute("opacity", A.drag > 6 ? Math.min(0.8, A.drag / 45) : 0);

      const vPx = 14 + Math.min(52, (v / 7800) * 52);
      const vOn = v > 30;
      vecV.setAttribute("opacity", vOn ? 1 : 0); lblV.setAttribute("opacity", vOn ? 1 : 0);
      if (vOn) {
        setVec(vecV, px + vDir[0] * OFF, py + vDir[1] * OFF, px + vDir[0] * (OFF + vPx), py + vDir[1] * (OFF + vPx));
        lblV.setAttribute("x", px + vDir[0] * (OFF + vPx + 11) - 4); lblV.setAttribute("y", py + vDir[1] * (OFF + vPx + 11) + 4);
      }

      const aPx = Math.min(58, A.aNet * SCA);
      const aOn = aPx > 6;
      vecA.setAttribute("opacity", aOn ? 0.95 : 0); lblA.setAttribute("opacity", aOn ? 0.95 : 0);
      if (aOn) {
        const ad = toScreen(A.ax, A.ay);
        setVec(vecA, px + ad[0] * OFF, py + ad[1] * OFF, px + ad[0] * (OFF + aPx), py + ad[1] * (OFF + aPx));
        lblA.setAttribute("x", px + ad[0] * (OFF + aPx + 11) - 4); lblA.setAttribute("y", py + ad[1] * (OFF + aPx + 11) + 4);
      }

      if (tOn) {
        const fLen = (S.phase === "ASCENT" ? 15 : 9) + Math.random() * 8;
        flame.setAttribute("points", "-4,15 4,15 0," + (15 + fLen).toFixed(1));
        flame.setAttribute("opacity", 0.9);
        flameCore.setAttribute("points", "-2,15 2,15 0," + (15 + fLen * 0.55).toFixed(1));
        flameCore.setAttribute("opacity", 0.95);
        if (sparks.length < 30) {
          const ang = Math.atan2(att[1], att[0]) + Math.PI + (Math.random() - 0.5) * 0.85;
          const spd = 26 + Math.random() * 48;
          sparks.push({ x: px - att[0] * 17, y: py - att[1] * 17, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.5 });
        }
      } else { flame.setAttribute("opacity", 0); flameCore.setAttribute("opacity", 0); }
      const legsOut = (S.phase === "LAND" && h < 3000) || S.phase === "DONE";
      legL.setAttribute("opacity", legsOut ? 1 : 0); legR.setAttribute("opacity", legsOut ? 1 : 0);

      // HUD
      const mm = Math.floor(S.t / 60), ss = Math.floor(S.t % 60);
      hudT.textContent = "T+" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
      hudH.textContent = "h   " + (h / 1000).toFixed(1) + " km";
      hudV.textContent = "v   " + (v / 1000).toFixed(2) + " km/s";
      hudA.textContent = "a   " + A.aNet.toFixed(1) + " m/s² (" + (A.aNet / 9.81).toFixed(1) + "g)";
      hudO.textContent = isFinite(A.el.apo) && A.el.e < 1
        ? "apo " + ((A.el.apo - RE) / 1000).toFixed(0) + " / peri " + ((A.el.peri - RE) / 1000).toFixed(0) + " km   e=" + A.el.e.toFixed(3)
        : "suborbital";
      phaseTag.textContent = S.phase; phaseTag.setAttribute("fill", PHASE_COLOR[S.phase] || C_VEL);
      warpTag.textContent = "time ×" + Math.round(warpNow);
      if (liveEl) liveEl.textContent = "";

      if (S.phase !== shownPhase) {
        shownPhase = S.phase;
        setEq(EQ[S.phase] || "");
        phaseMarks.push({ u: animT, name: S.phase });
        drawMarks();
      }
      drawGraphs();
    }

    function stepSparks(dt) {
      sparks = sparks.filter((s) => (s.life -= dt) > 0);
      sparkEls.forEach((el, i) => {
        const s = sparks[i];
        if (!s) { el.setAttribute("opacity", 0); return; }
        s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 60 * dt;
        el.setAttribute("cx", s.x.toFixed(1)); el.setAttribute("cy", s.y.toFixed(1));
        el.setAttribute("opacity", (s.life / 0.5) * 0.85);
      });
    }

    reset(); // primes S.acc internally
    let last = performance.now();
    function frame(now) {
      let dtReal = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!document.hidden) {
        // log-space warp smoothing: no sudden speed jumps between phases
        const target = WARP[S.phase] || 30;
        const lam = Math.min(1, dtReal * 3.2);
        warpNow = Math.exp(Math.log(warpNow) + (Math.log(target) - Math.log(warpNow)) * lam);

        animT += dtReal;
        if (S.phase === "DONE") {
          // Hold on the landed vehicle for HOLD_AFTER_LAND real seconds, then
          // relaunch. reset() clears doneAt, so this loops forever.
          if (doneAt < 0) doneAt = animT;
          if (animT - doneAt >= HOLD_AFTER_LAND) reset();
        } else {
          let simLeft = dtReal * warpNow;
          const base = (S.phase === "LAND" || S.acc.h < 20e3) ? 0.02 : 0.25;
          let guard = 0;
          while (simLeft > 0 && guard++ < 240 && S.phase !== "DONE") {
            const dt = Math.min(base, simLeft);
            stepPhysics(dt);
            simLeft -= dt;
          }
        }
        sinceSample += dtReal;
        if (sinceSample > 0.045 && S.acc) {
          sinceSample = 0;
          samples.push({ u: animT, h: S.acc.h / 1000, v: S.acc.v / 1000, a: S.acc.aNet, g: S.acc.g, d: S.acc.drag, th: S.acc.thrust });
          if (samples.length > 900) samples.shift();
        }
        stepSparks(dtReal);
        render(dtReal);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ===================== INIT =====================
  const pend = document.getElementById("fbd-pendulum");
  if (pend) Pendulum(pend, document.getElementById("hero-eq"), document.getElementById("hero-live"));
  const rocket = document.getElementById("rocket-anim");
  if (rocket) Rocket(rocket, document.getElementById("rocket-eq"), document.getElementById("rocket-live"));
})();
