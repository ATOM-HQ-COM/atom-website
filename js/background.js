/* ========================================================================
   Atom, animated WebGL background (electric blue + cyan)
   Adapted from Velaris shader with atom-themed palette + theme sync.
   ======================================================================== */

(function () {
  // Stub so callers can always call setPalette safely, even before the
  // canvas initialises or when WebGL is unavailable. Replaced with the real
  // implementation once the shader is running.
  window.AtomBackground = window.AtomBackground || {
    ready: false,
    setPalette: function () { return false; },
  };

  const vertexShaderSrc = `
    attribute vec2 position;
    varying vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSrc = `
    precision highp float;
    varying vec2 vUv;

    uniform vec2  u_resolution;
    uniform float u_time;
    uniform float u_grain;
    uniform vec3  u_colors[4];
    uniform vec3  u_bg;

    vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

    float snoise(vec2 v){
      const vec4 C = vec4(0.211324865405187, 0.366025403784439,
               -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy));
      vec2 x0 = v -   i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod(i, 289.0);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
        + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
        dot(x12.zw,x12.zw)), 0.0);
      m = m*m;
      m = m*m;
      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    void main() {
      vec2 uv = vUv;
      float ratio = u_resolution.x / u_resolution.y;
      vec2 p = uv - 0.5;
      p.x *= ratio;

      float t = u_time * 0.1;

      float n1 = snoise(p * 0.4 + vec2(t * 0.2, -t * 0.3));
      float n2 = snoise(p * 0.55 + vec2(-t * 0.15, t * 0.25) + n1 * 0.25);
      float n3 = snoise(p * 0.75 + vec2(t * 0.1, -t * 0.2) + n2 * 0.2);

      vec3 col = u_bg;

      float dist = length(p) * 1.5;
      float vignette = 1.0 - smoothstep(0.3, 1.2, dist);

      col = mix(col, u_colors[0], smoothstep(-0.2, 0.5, n1) * 0.45);
      col = mix(col, u_colors[1], smoothstep(-0.1, 0.6, n2) * 0.30);
      col = mix(col, u_colors[2], smoothstep(-0.3, 0.4, n3) * 0.35);
      col = mix(col, u_colors[3], smoothstep(0.0, 0.7, n1 * n2) * 0.30);

      float glow = smoothstep(0.85, 0.0, dist) * 0.14;
      col += u_colors[1] * glow;

      col = mix(col * 0.55, col, vignette);

      float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453 + u_time);
      col += (grain - 0.5) * u_grain * 0.08;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // Palettes tuned to Atom brand, electric blue + cyan only (no purple)
  const PALETTES = {
    dark: {
      bg: "#070b16",
      colors: ["#1e3a8a", "#22d3ee", "#0b1120", "#070b16"],
      grain: 0.30,
      speed: 1.2,
    },
    light: {
      bg: "#eef2f8",
      colors: ["#d6e4ff", "#cdf3fb", "#eef2f8", "#eef2f8"],
      grain: 0.14,
      speed: 1.0,
    },
  };

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }

  function initBackground() {
    // The animated shader now lives only on the chat page. Every other page
    // uses the solid --bg colour, so the site reads as sleek rather than
    // "AI gradient". The chat page is the one with the .chat-app shell.
    if (!document.querySelector(".chat-app")) return;

    let canvas = document.getElementById("bg-canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "bg-canvas";
      document.body.prepend(canvas);
    }

    const gl = canvas.getContext("webgl", { antialias: true, premultipliedAlpha: false });
    if (!gl) {
      // Fallback: subtle CSS radial gradient, still class-switchable.
      const paintFallback = (p) => {
        canvas.style.background =
          `radial-gradient(ellipse at top, ${p.colors[0]} 0%, ${p.bg} 62%)`;
        canvas.style.transition = "background 1s ease";
      };
      paintFallback(PALETTES.dark);
      window.AtomBackground.setPalette = function (next) {
        paintFallback(next && next.colors ? next : PALETTES.dark);
        return true;
      };
      window.AtomBackground.ready = true;
      return;
    }

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
      }
      return s;
    };

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShaderSrc));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShaderSrc));
    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uGrain = gl.getUniformLocation(program, "u_grain");
    const uColors = gl.getUniformLocation(program, "u_colors");
    const uBg = gl.getUniformLocation(program, "u_bg");

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    // An override palette (set by the chat page when a class is picked)
    // wins over the theme palette. Null means "use the theme".
    let override = null;

    let palette = getCurrentPalette();
    // Palette lerp state for smooth theme transitions
    let cur = deepClone(palette);
    let target = deepClone(palette);

    function deepClone(p) {
      return {
        bg: hexToRgb(p.bg),
        colors: p.colors.map(hexToRgb),
        grain: p.grain,
        speed: p.speed,
      };
    }

    function themePalette() {
      const theme = document.documentElement.getAttribute("data-theme") || "dark";
      return PALETTES[theme] || PALETTES.dark;
    }

    function getCurrentPalette() {
      return override || themePalette();
    }

    /* Public hook. The chat page calls this with a class palette; the
       render loop already lerps `cur` toward `target` every frame, so the
       background eases from one subject's colours to the next over about
       a second instead of snapping. Pass null to fall back to the theme.

       Duration is controlled by `fade` (seconds); it just scales the lerp
       factor, so callers can ask for a slower, more deliberate change. */
    window.AtomBackground = window.AtomBackground || {};
    window.AtomBackground.setPalette = function (next, fade) {
      const base = themePalette();
      override = next
        ? {
            bg: next.bg || base.bg,
            colors: (next.colors && next.colors.length === 4) ? next.colors : base.colors,
            grain: typeof next.grain === "number" ? next.grain : base.grain,
            speed: typeof next.speed === "number" ? next.speed : base.speed,
          }
        : null;
      target = deepClone(getCurrentPalette());
      if (typeof fade === "number" && fade > 0) lerpRate = Math.min(0.5, 3 / (fade * 60));
      return true;
    };
    window.AtomBackground.ready = true;

    // Listen to theme changes
    const observer = new MutationObserver(() => {
      target = deepClone(getCurrentPalette());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const lerp = (a, b, t) => a + (b - a) * t;
    const lerpArr = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

    let start = performance.now();
    let running = true;
    let paused = false;
    // How fast `cur` chases `target` each frame. 0.05 crosses most of the
    // distance in roughly a second at 60fps, which reads as a smooth fade
    // rather than a cut.
    let lerpRate = 0.05;

    // Pause on tab hidden to save battery
    document.addEventListener("visibilitychange", () => {
      paused = document.hidden;
    });

    function render(now) {
      if (!running) return;
      if (paused) {
        requestAnimationFrame(render);
        return;
      }

      const dt = lerpRate;
      cur.bg = lerpArr(cur.bg, target.bg, dt);
      cur.colors = cur.colors.map((c, i) => lerpArr(c, target.colors[i], dt));
      cur.grain = lerp(cur.grain, target.grain, dt);
      cur.speed = lerp(cur.speed, target.speed, dt);

      const t = ((now - start) / 1000) * cur.speed;

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uGrain, cur.grain);
      gl.uniform3f(uBg, cur.bg[0], cur.bg[1], cur.bg[2]);

      const flat = new Float32Array(cur.colors.flat());
      gl.uniform3fv(uColors, flat);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBackground);
  } else {
    initBackground();
  }
})();
