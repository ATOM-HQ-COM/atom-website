/* ========================================================================
   Atom, animated chemistry visual: the Haber process at equilibrium.

       N2 + 3 H2  <=>  2 NH3

   Molecules move as real particles in a sealed vessel. When a nitrogen
   molecule is struck by enough hydrogen with enough combined energy, it
   reacts and two ammonia molecules are produced; ammonia spontaneously
   decomposes back at a rate that rises with temperature. Nothing is
   scripted, so the mixture genuinely settles toward a dynamic equilibrium
   and visibly shifts when the temperature slider moves, which is the whole
   point of Le Chatelier's principle.

   Canvas 2D only, no libraries. Pauses when off-screen or on a hidden tab.
   ======================================================================== */

(function () {
  const stage = document.getElementById("chem-anim");
  if (!stage) return;

  const eqEl = document.getElementById("chem-eq");
  const liveEl = document.getElementById("chem-live");
  const ctx = stage.getContext("2d");
  if (!ctx) return;

  // ---- palette (chemistry violet, matching the Chemistry class) ----
  const C = {
    n: "#c084fc",       // nitrogen
    h: "#e9d5ff",       // hydrogen
    nh3: "#a855f7",     // ammonia
    bond: "rgba(233,213,255,0.5)",
    wall: "rgba(192,132,252,0.30)",
    grid: "rgba(192,132,252,0.07)",
    flash: "#f0abfc",
  };

  // ---- simulation constants ----
  const N2 = 0, H2 = 1, NH3 = 2;
  const RADIUS = { [N2]: 11, [H2]: 7, [NH3]: 9.5 };
  const START = { n2: 7, h2: 21 };     // 1:3 stoichiometric ratio
  const SPEED = 42;                    // base px/sec at T = 0.5

  let W = 0, H = 0, dpr = 1;
  let particles = [];
  let flashes = [];
  let temp = 0.5;                      // 0..1, drives speed + back-reaction
  let tempDir = 1;
  let running = true, visible = true;
  let last = performance.now();

  const rand = (a, b) => a + Math.random() * (b - a);

  function spawn(kind, x, y) {
    const ang = Math.random() * Math.PI * 2;
    const s = SPEED * (0.55 + Math.random() * 0.9) * (kind === H2 ? 1.6 : 1);
    return {
      kind,
      x: x != null ? x : rand(40, Math.max(60, W - 40)),
      y: y != null ? y : rand(40, Math.max(60, H - 40)),
      vx: Math.cos(ang) * s,
      vy: Math.sin(ang) * s,
      spin: rand(0, Math.PI * 2),
      spinRate: rand(-2.2, 2.2),
      born: performance.now(),
    };
  }

  function reset() {
    particles = [];
    for (let i = 0; i < START.n2; i++) particles.push(spawn(N2));
    for (let i = 0; i < START.h2; i++) particles.push(spawn(H2));
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.round(rect.width), nh = Math.round(rect.height);
    if (nw === W && nh === H) return;
    const first = W === 0;
    W = nw; H = nh;
    stage.width = W * dpr;
    stage.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (first) reset();
  }

  // ---------------- chemistry ----------------

  /* Forward: N2 + 3H2 -> 2NH3, modelled the way it actually happens on a
     catalyst: hydrogen adsorbs onto the nitrogen one molecule at a time.
     Each successful collision increments a counter on the nitrogen, and the
     third one completes the reaction.

     Waiting for three hydrogens to be in contact simultaneously would be
     astronomically rare at this particle density, so a stepwise model is
     both more faithful and the only one that visibly does anything. */
  function tryForward(dt) {
    for (const n of particles) {
      if (n.kind !== N2 || n.dead) continue;
      if (n.ads === undefined) n.ads = 0;

      const contact = (RADIUS[N2] + RADIUS[H2] + 4) ** 2;
      for (const h of particles) {
        if (h.kind !== H2 || h.dead) continue;
        const dx = h.x - n.x, dy = h.y - n.y;
        if (dx * dx + dy * dy > contact) continue;

        // Activation barrier: hotter molecules clear it more often.
        if (Math.random() > (0.45 + temp * 0.5)) continue;

        h.dead = true;
        n.ads++;
        flashes.push({ x: h.x, y: h.y, t: 0, kind: "adsorb" });

        if (n.ads >= 3) {
          const cx = n.x, cy = n.y;
          n.dead = true;
          for (let k = 0; k < 2; k++) {
            particles.push(spawn(NH3, cx + rand(-12, 12), cy + rand(-12, 12)));
          }
          flashes.push({ x: cx, y: cy, t: 0, kind: "form" });
        }
        break; // one adsorption per nitrogen per frame
      }
    }
  }

  /* Partially-loaded nitrogens can lose an adsorbed hydrogen again, more
     readily when hot. Without this, hydrogen slowly gets stranded on
     nitrogens that never find a third partner and the vessel deadlocks. */
  function tryDesorb(dt) {
    for (const n of particles) {
      if (n.kind !== N2 || n.dead || !n.ads) continue;
      if (Math.random() > (0.05 + temp * 0.35) * dt) continue;
      n.ads--;
      particles.push(spawn(H2, n.x + rand(-16, 16), n.y + rand(-16, 16)));
      flashes.push({ x: n.x, y: n.y, t: 0, kind: "adsorb" });
    }
  }

  // Reverse: 2NH3 -> N2 + 3H2. Endothermic direction, so it speeds up
  // sharply with temperature. This is what makes the slider visibly shift
  // the equilibrium position rather than just the speed.
  function tryReverse(dt) {
    const ammonia = particles.filter((p) => p.kind === NH3 && !p.dead);
    if (ammonia.length < 2) return;
    const rate = 0.02 + temp * temp * 1.05;
    if (Math.random() > rate * dt * ammonia.length) return;

    const a = ammonia[(Math.random() * ammonia.length) | 0];
    let b = null, bestD = Infinity;
    for (const o of ammonia) {
      if (o === a) continue;
      const d = (o.x - a.x) ** 2 + (o.y - a.y) ** 2;
      if (d < bestD) { bestD = d; b = o; }
    }
    if (!b) return;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    a.dead = true; b.dead = true;
    particles.push(spawn(N2, cx, cy));
    for (let k = 0; k < 3; k++) particles.push(spawn(H2, cx + rand(-14, 14), cy + rand(-14, 14)));
    flashes.push({ x: cx, y: cy, t: 0, kind: "break" });
  }

  // ---------------- physics ----------------
  function step(dt) {
    // Temperature drifts slowly back and forth so the equilibrium visibly
    // breathes without anyone touching anything.
    temp += tempDir * dt * 0.055;
    if (temp > 0.92) { temp = 0.92; tempDir = -1; }
    if (temp < 0.12) { temp = 0.12; tempDir = 1; }

    const scale = 0.55 + temp * 1.1;
    for (const p of particles) {
      if (p.dead) continue;
      p.x += p.vx * dt * scale;
      p.y += p.vy * dt * scale;
      p.spin += p.spinRate * dt;
      const r = RADIUS[p.kind];
      if (p.x < r) { p.x = r; p.vx = Math.abs(p.vx); }
      if (p.x > W - r) { p.x = W - r; p.vx = -Math.abs(p.vx); }
      if (p.y < r) { p.y = r; p.vy = Math.abs(p.vy); }
      if (p.y > H - r) { p.y = H - r; p.vy = -Math.abs(p.vy); }
    }

    tryForward(dt);
    tryDesorb(dt);
    tryReverse(dt);
    particles = particles.filter((p) => !p.dead);

    // Keep the population bounded if numerics ever drift.
    if (particles.length > 90) particles.length = 90;

    for (const f of flashes) f.t += dt;
    flashes = flashes.filter((f) => f.t < 0.5);
  }

  // ---------------- drawing ----------------
  function atom(x, y, r, fill, label) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.85)");
    g.addColorStop(0.35, fill);
    g.addColorStop(1, fill);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (label && r >= 7) {
      ctx.fillStyle = "rgba(8,6,18,0.78)";
      ctx.font = `700 ${Math.round(r * 0.95)}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y + 0.5);
    }
  }

  function bond(x1, y1, x2, y2) {
    ctx.strokeStyle = C.bond;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawMolecule(p) {
    const r = RADIUS[p.kind];
    if (p.kind === N2) {
      const dx = Math.cos(p.spin) * r * 0.72, dy = Math.sin(p.spin) * r * 0.72;
      // Hydrogens already adsorbed onto this nitrogen, so you can watch a
      // molecule fill up 1, 2, 3 before it converts.
      const ads = p.ads || 0;
      for (let i = 0; i < ads; i++) {
        const a = p.spin + Math.PI / 2 + (i - 1) * 0.85;
        const hx = p.x + Math.cos(a) * (r + 5), hy = p.y + Math.sin(a) * (r + 5);
        bond(p.x, p.y, hx, hy);
        atom(hx, hy, r * 0.42, C.h, "");
      }
      bond(p.x - dx, p.y - dy, p.x + dx, p.y + dy);
      atom(p.x - dx, p.y - dy, r * 0.85, C.n, "N");
      atom(p.x + dx, p.y + dy, r * 0.85, C.n, "N");
    } else if (p.kind === H2) {
      const dx = Math.cos(p.spin) * r * 0.7, dy = Math.sin(p.spin) * r * 0.7;
      bond(p.x - dx, p.y - dy, p.x + dx, p.y + dy);
      atom(p.x - dx, p.y - dy, r * 0.78, C.h, "");
      atom(p.x + dx, p.y + dy, r * 0.78, C.h, "");
    } else {
      // Ammonia: one nitrogen with three hydrogens in a trigonal pyramid.
      for (let i = 0; i < 3; i++) {
        const a = p.spin + (i * Math.PI * 2) / 3;
        const hx = p.x + Math.cos(a) * r, hy = p.y + Math.sin(a) * r * 0.75;
        bond(p.x, p.y, hx, hy);
      }
      for (let i = 0; i < 3; i++) {
        const a = p.spin + (i * Math.PI * 2) / 3;
        atom(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.75, r * 0.5, C.h, "");
      }
      atom(p.x, p.y, r * 0.82, C.nh3, "N");
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // vessel grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    const gs = 34;
    ctx.beginPath();
    for (let x = gs; x < W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = gs; y < H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // vessel wall
    ctx.strokeStyle = C.wall;
    ctx.lineWidth = 1.5;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(1, 1, W - 2, H - 2, 14);
      ctx.stroke();
    } else {
      ctx.strokeRect(1, 1, W - 2, H - 2);
    }

    // reaction flashes
    for (const f of flashes) {
      const k = 1 - f.t / 0.5;
      const big = f.kind !== "adsorb";
      ctx.strokeStyle =
        f.kind === "form" ? C.flash
        : f.kind === "break" ? "rgba(255,255,255,0.7)"
        : "rgba(233,213,255,0.55)";
      ctx.globalAlpha = k * (big ? 0.8 : 0.5);
      ctx.lineWidth = (big ? 2.5 : 1.6) * k;
      ctx.beginPath();
      ctx.arc(f.x, f.y, (1 - k) * (big ? 46 : 18) + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // molecules, newest last so fresh product reads on top
    for (const p of particles) drawMolecule(p);

    // temperature strip along the bottom
    const barW = W - 28, barX = 14, barY = H - 12;
    ctx.strokeStyle = "rgba(192,132,252,0.18)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(barX, barY); ctx.lineTo(barX + barW, barY); ctx.stroke();
    ctx.strokeStyle = C.n;
    ctx.beginPath(); ctx.moveTo(barX, barY); ctx.lineTo(barX + barW * temp, barY); ctx.stroke();
  }

  function counts() {
    let n = 0, h = 0, a = 0;
    for (const p of particles) {
      if (p.kind === N2) n++;
      else if (p.kind === H2) h++;
      else a++;
    }
    return { n, h, a };
  }

  function updateHud() {
    if (!liveEl) return;
    const { n, h, a } = counts();
    const total = n + h + a || 1;
    const yield_ = Math.round((a / total) * 100);
    const T = Math.round(300 + temp * 450);
    liveEl.innerHTML =
      `<span><i style="background:${C.n}"></i>N<sub>2</sub> ${n}</span>` +
      `<span><i style="background:${C.h}"></i>H<sub>2</sub> ${h}</span>` +
      `<span><i style="background:${C.nh3}"></i>NH<sub>3</sub> ${a}</span>` +
      `<span class="chem-temp">T ${T} K</span>` +
      `<span class="chem-yield">yield ${yield_}%</span>`;
  }

  let hudTick = 0;
  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (visible && !document.hidden) {
      resize();
      if (W && H) {
        step(dt);
        draw();
        hudTick += dt;
        if (hudTick > 0.25) { hudTick = 0; updateHud(); }
      }
    }
    requestAnimationFrame(frame);
  }

  if (eqEl) {
    eqEl.innerHTML =
      'N<sub>2</sub> + 3 H<sub>2</sub> &#8652; 2 NH<sub>3</sub>' +
      '<span class="chem-dh">&Delta;H = &minus;92 kJ/mol</span>';
  }

  // Only animate while on screen.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((e) => { visible = e.isIntersecting; });
    }, { threshold: 0.05 }).observe(stage);
  }
  window.addEventListener("resize", resize);

  resize();
  updateHud();
  requestAnimationFrame(frame);
})();
