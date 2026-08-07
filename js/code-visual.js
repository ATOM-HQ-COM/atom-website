/* ========================================================================
   Atom, animated coding visual: merge sort, executing.

   The algorithm is really run once on a shuffled array and every step is
   recorded as an event (enter a subarray, compare two values, write a
   value back). Playback then drives BOTH the bar chart and the highlighted
   line in the source panel from that same event stream, so the code you
   read is genuinely the code producing the motion, not a loop pretending.

   When the array is sorted it does a victory sweep, reshuffles, and runs
   again. Canvas 2D only, no libraries. Pauses off-screen and on hidden tabs.
   ======================================================================== */

(function () {
  const canvas = document.getElementById("code-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const codeEl = document.getElementById("code-lines");
  const hudEl = document.getElementById("code-hud");
  const depthEl = document.getElementById("code-depth");
  if (!ctx) return;

  // ---- the source shown in the panel. Index = line number. The `line`
  // field on each recorded event points into this array. ----
  const SOURCE = [
    "def merge_sort(a, lo, hi):",
    "    if hi - lo <= 1:",
    "        return",
    "    mid = (lo + hi) // 2",
    "    merge_sort(a, lo, mid)",
    "    merge_sort(a, mid, hi)",
    "    merge(a, lo, mid, hi)",
    "",
    "def merge(a, lo, mid, hi):",
    "    left, right = a[lo:mid], a[mid:hi]",
    "    i = j = 0",
    "    for k in range(lo, hi):",
    "        if j >= len(right) or (",
    "                i < len(left)",
    "                and left[i] <= right[j]):",
    "            a[k] = left[i]; i += 1",
    "        else:",
    "            a[k] = right[j]; j += 1",
  ];

  const N = 44;
  const STEPS_PER_SEC = 46;

  const COL = {
    idle: "rgba(148,163,184,0.26)",
    range: "#5b6b8f",
    compare: "#22d3ee",
    write: "#f1f5f9",
    done: "#3d7bff",
    axis: "rgba(148,163,184,0.14)",
  };

  let W = 0, H = 0, dpr = 1;
  let values = [];
  let events = [];
  let cursor = 0;
  let acc = 0;
  let visible = true;
  let last = performance.now();

  // transient highlight state
  let active = { lo: 0, hi: N, depth: 0 };
  let cmp = [-1, -1];
  let wrote = -1;
  let wroteAge = 0;
  let stats = { comparisons: 0, writes: 0 };
  let finished = false;
  let sweep = 0;

  function shuffled(n) {
    const a = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* Run merge sort for real, recording every step. Returns the event list;
     `values` is left holding the ORIGINAL order so playback can replay the
     writes from the start. */
  function record(input) {
    const a = input.slice();
    const ev = [];
    const push = (e) => { if (ev.length < 20000) ev.push(e); };

    function merge(lo, mid, hi, depth) {
      const left = a.slice(lo, mid), right = a.slice(mid, hi);
      push({ t: "line", line: 8, lo, hi, depth });
      push({ t: "line", line: 9, lo, hi, depth });
      let i = 0, j = 0;
      for (let k = lo; k < hi; k++) {
        push({ t: "line", line: 11, lo, hi, depth });
        const takeLeft =
          j >= right.length || (i < left.length && left[i] <= right[j]);
        if (i < left.length && j < right.length) {
          push({ t: "cmp", line: 14, i: lo + i, j: mid + j, lo, hi, depth });
        }
        if (takeLeft) {
          push({ t: "write", line: 15, k, v: left[i], lo, hi, depth });
          a[k] = left[i]; i++;
        } else {
          push({ t: "write", line: 17, k, v: right[j], lo, hi, depth });
          a[k] = right[j]; j++;
        }
      }
    }

    function sort(lo, hi, depth) {
      push({ t: "line", line: 0, lo, hi, depth });
      push({ t: "line", line: 1, lo, hi, depth });
      if (hi - lo <= 1) { push({ t: "line", line: 2, lo, hi, depth }); return; }
      push({ t: "line", line: 3, lo, hi, depth });
      const mid = (lo + hi) >> 1;
      push({ t: "line", line: 4, lo, hi, depth });
      sort(lo, mid, depth + 1);
      push({ t: "line", line: 5, lo, hi, depth });
      sort(mid, hi, depth + 1);
      push({ t: "line", line: 6, lo, hi, depth });
      merge(lo, mid, hi, depth);
    }

    sort(0, a.length, 0);
    return ev;
  }

  function restart() {
    values = shuffled(N);
    events = record(values);
    cursor = 0; acc = 0;
    stats = { comparisons: 0, writes: 0 };
    cmp = [-1, -1]; wrote = -1;
    active = { lo: 0, hi: N, depth: 0 };
    finished = false; sweep = 0;
  }

  function applyEvent(e) {
    active = { lo: e.lo, hi: e.hi, depth: e.depth || 0 };
    if (e.t === "cmp") {
      cmp = [e.i, e.j];
      stats.comparisons++;
    } else if (e.t === "write") {
      values[e.k] = e.v;
      wrote = e.k; wroteAge = 0;
      stats.writes++;
      cmp = [-1, -1];
    } else {
      cmp = [-1, -1];
    }
    highlight(e.line);
  }

  // ---------------- code panel ----------------
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  /* Minimal Python tokenizer, just enough for the snippet above. Ordered
     alternation: whatever matches first at the cursor wins, so keywords are
     tested before bare identifiers and `def name` is caught before either. */
  const KEYWORDS = new Set([
    "def", "if", "else", "elif", "return", "for", "in", "while",
    "and", "or", "not", "None", "True", "False",
  ]);
  const BUILTINS = new Set(["len", "range", "print", "int", "list"]);

  const TOKEN = new RegExp(
    [
      "(?<ws>\\s+)",
      "(?<comment>#.*$)",
      "(?<def>\\bdef\\b)",
      "(?<num>\\b\\d+\\b)",
      "(?<word>[A-Za-z_]\\w*)",
      // `//` must precede the single-char class or it splits into two `/`.
      "(?<op>//|[-+*/=<>!]=?)",
      "(?<punct>[()\\[\\]{}:,.;])",
      "(?<other>.)",
    ].join("|"),
    "y"
  );

  function tokenize(line) {
    let out = "";
    let i = 0;
    let expectDefName = false;
    TOKEN.lastIndex = 0;
    while (i < line.length) {
      TOKEN.lastIndex = i;
      const m = TOKEN.exec(line);
      if (!m) break;
      const g = m.groups;
      const raw = m[0];
      i = TOKEN.lastIndex;

      if (g.ws) { out += raw.replace(/ /g, "&nbsp;"); continue; }
      if (g.comment) { out += `<b class="t-com">${escapeHtml(raw)}</b>`; continue; }
      if (g.def) { out += `<b class="t-kw">def</b>`; expectDefName = true; continue; }
      if (g.num) { out += `<b class="t-num">${raw}</b>`; continue; }
      if (g.word) {
        let cls = "t-id";
        if (expectDefName) { cls = "t-fn"; expectDefName = false; }
        else if (KEYWORDS.has(raw)) cls = "t-kw";
        else if (BUILTINS.has(raw)) cls = "t-bi";
        out += `<b class="${cls}">${raw}</b>`;
        continue;
      }
      if (g.op) { out += `<b class="t-op">${escapeHtml(raw)}</b>`; continue; }
      if (g.punct) { out += `<b class="t-pn">${escapeHtml(raw)}</b>`; continue; }
      out += escapeHtml(raw);
    }
    return out;
  }

  function buildCode() {
    if (!codeEl) return;
    codeEl.innerHTML = SOURCE.map((ln, i) =>
      `<span class="cl" data-l="${i}"><i class="ln">${String(i + 1).padStart(2, " ")}</i>${tokenize(ln) || "&nbsp;"}</span>`
    ).join("");
  }
  let lastLine = -1;
  function highlight(line) {
    if (!codeEl || line === lastLine) return;
    const prev = codeEl.querySelector(".cl.on");
    if (prev) prev.classList.remove("on");
    const next = codeEl.querySelector(`.cl[data-l="${line}"]`);
    if (next) next.classList.add("on");
    lastLine = line;
  }

  // ---------------- drawing ----------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.round(rect.width), nh = Math.round(rect.height);
    if (nw === W && nh === H) return;
    W = nw; H = nh;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const padX = 10, padB = 16, padT = 10;
    const usableW = W - padX * 2;
    const usableH = H - padT - padB;
    const slot = usableW / N;
    const bw = Math.max(2, slot * 0.72);

    // baseline
    ctx.strokeStyle = COL.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, H - padB + 0.5);
    ctx.lineTo(W - padX, H - padB + 0.5);
    ctx.stroke();

    // active-range backdrop
    if (!finished && active.hi > active.lo) {
      ctx.fillStyle = "rgba(34,211,238,0.06)";
      ctx.fillRect(padX + active.lo * slot, padT - 4,
                   (active.hi - active.lo) * slot, usableH + 8);
    }

    for (let i = 0; i < N; i++) {
      const v = values[i];
      const h = Math.max(3, (v / N) * usableH);
      const x = padX + i * slot + (slot - bw) / 2;
      const y = H - padB - h;

      let fill = COL.idle;
      if (finished) {
        // victory sweep: colour runs left to right
        fill = i <= sweep * N ? COL.done : COL.idle;
      } else if (i === wrote && wroteAge < 0.32) {
        fill = COL.write;
      } else if (i === cmp[0] || i === cmp[1]) {
        fill = COL.compare;
      } else if (i >= active.lo && i < active.hi) {
        fill = COL.range;
      }

      ctx.fillStyle = fill;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, bw, h, Math.min(3, bw / 2));
        ctx.fill();
      } else {
        ctx.fillRect(x, y, bw, h);
      }

      // glow on the two values being compared
      if (!finished && (i === cmp[0] || i === cmp[1])) {
        ctx.save();
        ctx.shadowColor = COL.compare;
        ctx.shadowBlur = 12;
        ctx.fillRect(x, y, bw, h);
        ctx.restore();
      }
    }
  }

  function updateHud() {
    if (hudEl) {
      hudEl.innerHTML =
        `<span><b>${stats.comparisons}</b> comparisons</span>` +
        `<span><b>${stats.writes}</b> writes</span>` +
        `<span><b>n</b> = ${N}</span>` +
        `<span class="code-big-o">O(n log n)</span>`;
    }
    if (depthEl) {
      const d = Math.min(active.depth, 5);
      depthEl.innerHTML =
        `<span class="cd-label">depth</span>` +
        Array.from({ length: 6 }, (_, i) =>
          `<i class="${i <= d && !finished ? "on" : ""}"></i>`).join("");
    }
  }

  let hudTick = 0;
  let holdAfterFinish = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (visible && !document.hidden) {
      resize();
      if (W && H) {
        if (!finished) {
          acc += dt * STEPS_PER_SEC;
          let guard = 0;
          while (acc >= 1 && cursor < events.length && guard++ < 400) {
            applyEvent(events[cursor++]);
            acc -= 1;
          }
          if (cursor >= events.length) {
            finished = true;
            sweep = 0;
            holdAfterFinish = 0;
            cmp = [-1, -1];
            wrote = -1;
          }
        } else {
          sweep += dt * 0.85;
          if (sweep >= 1) {
            holdAfterFinish += dt;
            if (holdAfterFinish > 1.1) restart();
          }
        }
        wroteAge += dt;
        draw();
        hudTick += dt;
        if (hudTick > 0.12) { hudTick = 0; updateHud(); }
      }
    }
    requestAnimationFrame(frame);
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      entries.forEach((e) => { visible = e.isIntersecting; });
    }, { threshold: 0.05 }).observe(canvas);
  }
  window.addEventListener("resize", resize);

  buildCode();
  restart();
  resize();
  updateHud();
  requestAnimationFrame(frame);
})();
