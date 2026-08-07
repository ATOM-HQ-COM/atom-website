/* Interactive three-body spacetime scene for the homepage. */
(() => {
  const stage = document.getElementById("spacetime-stage");
  const canvas = document.getElementById("spacetime-canvas");
  if (!stage || !canvas || !window.THREE) return;

  const THREE = window.THREE;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050914, 0.024);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 180);
  camera.position.set(0, 18, 29);
  camera.lookAt(0, -2.5, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const rand = (x, y, seed = 1) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 39.425) * 43758.5453;
    return n - Math.floor(n);
  };

  function makeTexture(width, height, paint) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = width;
    textureCanvas.height = height;
    const ctx = textureCanvas.getContext("2d");
    paint(ctx, width, height);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  function makeSunTexture() {
    return makeTexture(640, 320, (ctx, width, height) => {
      const image = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        const lat = Math.abs(y / height - 0.5);
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const bands = Math.sin(x * 0.045 + y * 0.024) * 0.5 + Math.sin(x * 0.014 - y * 0.04) * 0.35;
          const grain = rand(x, y, 7) * 0.7 + rand(x * 0.35, y * 0.35, 13) * 0.3;
          const heat = THREE.MathUtils.clamp(0.72 + bands * 0.08 + grain * 0.18 - lat * 0.16, 0, 1);
          image.data[i] = 235 + heat * 20;
          image.data[i + 1] = 120 + heat * 84;
          image.data[i + 2] = 24 + heat * 35;
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);

      const spots = [
        [0.1, 0.42, 24, 11, 0.18],
        [0.21, 0.38, 38, 16, -0.32],
        [0.38, 0.58, 25, 11, 0.24],
        [0.5, 0.36, 16, 7, -0.22],
        [0.59, 0.43, 34, 14, -0.12],
        [0.73, 0.61, 21, 9, 0.18],
        [0.86, 0.34, 18, 8, -0.08],
        [0.94, 0.55, 28, 12, 0.28],
      ];
      spots.forEach(([nx, ny, rx, ry, rotate], index) => {
        const cx = nx * width;
        const cy = ny * height;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotate);
        const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, rx * 1.75);
        glow.addColorStop(0, "rgba(54, 29, 9, 0.82)");
        glow.addColorStop(0.38, "rgba(86, 44, 11, 0.58)");
        glow.addColorStop(1, "rgba(255, 199, 73, 0)");
        ctx.fillStyle = glow;
        ctx.scale(1, ry / rx);
        ctx.beginPath();
        ctx.arc(0, 0, rx * (index === 0 ? 1.25 : 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = "#ffe39b";
      ctx.lineWidth = 1.2;
      for (let y = 35; y < height; y += 28) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 14) {
          const wave = Math.sin(x * 0.018 + y * 0.07) * 4;
          if (x === 0) ctx.moveTo(x, y + wave);
          else ctx.lineTo(x, y + wave);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  }

  function makeEarthTexture() {
    const blobs = [
      [0.18, 0.42, 0.2, 1.25],
      [0.31, 0.58, 0.16, 1.0],
      [0.53, 0.38, 0.18, 1.15],
      [0.66, 0.54, 0.12, 0.9],
      [0.82, 0.47, 0.22, 1.2],
    ];
    return makeTexture(560, 280, (ctx, width, height) => {
      const image = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        const ny = y / height;
        const lat = Math.abs(ny - 0.5) * 2;
        for (let x = 0; x < width; x++) {
          const nx = x / width;
          let land = 0;
          blobs.forEach(([cx, cy, radius, weight]) => {
            const dxRaw = Math.abs(nx - cx);
            const dx = Math.min(dxRaw, 1 - dxRaw);
            const dy = ny - cy;
            land += Math.exp(-(dx * dx + dy * dy) / (radius * radius)) * weight;
          });
          land += Math.sin(nx * 38 + ny * 16) * 0.08 + (rand(x, y, 23) - 0.5) * 0.16;

          const i = (y * width + x) * 4;
          if (lat > 0.88) {
            image.data[i] = 226;
            image.data[i + 1] = 238;
            image.data[i + 2] = 242;
          } else if (land > 0.74) {
            const dry = THREE.MathUtils.clamp((lat - 0.25) * 1.2 + rand(x, y, 30) * 0.25, 0, 1);
            image.data[i] = 42 + dry * 112;
            image.data[i + 1] = 116 + dry * 58;
            image.data[i + 2] = 69 + dry * 34;
          } else {
            const depth = THREE.MathUtils.clamp(0.25 + rand(x, y, 29) * 0.32 + lat * 0.18, 0, 1);
            image.data[i] = 8 + depth * 18;
            image.data[i + 1] = 58 + depth * 76;
            image.data[i + 2] = 128 + depth * 100;
          }
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    });
  }

  function makeCloudTexture() {
    return makeTexture(560, 280, (ctx, width, height) => {
      const image = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        const ny = y / height;
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const streak = Math.sin(x * 0.045 + y * 0.08) + Math.sin(x * 0.018 - y * 0.11);
          const cloud = streak * 0.26 + rand(x * 0.8, y * 0.9, 41) * 0.62 - Math.abs(ny - 0.5) * 0.34;
          image.data[i] = 255;
          image.data[i + 1] = 255;
          image.data[i + 2] = 255;
          image.data[i + 3] = cloud > 0.44 ? THREE.MathUtils.clamp((cloud - 0.42) * 370, 0, 120) : 0;
        }
      }
      ctx.putImageData(image, 0, 0);
    });
  }

  function makeMarsTexture() {
    return makeTexture(560, 280, (ctx, width, height) => {
      const image = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        const ny = y / height;
        const lat = Math.abs(ny - 0.5) * 2;
        for (let x = 0; x < width; x++) {
          const nx = x / width;
          const canyon = Math.sin(nx * 18 + ny * 5) * 0.5 + Math.sin(nx * 43 - ny * 12) * 0.23;
          const dust = rand(x, y, 61) * 0.75 + rand(x * 0.28, y * 0.28, 64) * 0.45;
          const highland = THREE.MathUtils.clamp(0.48 + canyon * 0.17 + dust * 0.2, 0, 1);
          const i = (y * width + x) * 4;
          if (lat > 0.9) {
            image.data[i] = 236;
            image.data[i + 1] = 220;
            image.data[i + 2] = 185;
          } else {
            image.data[i] = 126 + highland * 102;
            image.data[i + 1] = 55 + highland * 62;
            image.data[i + 2] = 35 + highland * 34;
          }
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = "#4f241f";
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.ellipse(Math.random() * width, Math.random() * height, 22 + Math.random() * 42, 6 + Math.random() * 14, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
  }

  scene.add(new THREE.HemisphereLight(0x94dcff, 0x06101e, 0.68));
  const starLight = new THREE.PointLight(0xffdf8a, 115, 60, 1.7);
  starLight.position.set(0, 0.9, 0);
  scene.add(starLight);
  const rimLight = new THREE.DirectionalLight(0x7dd3fc, 1.2);
  rimLight.position.set(-8, 9, 12);
  scene.add(rimLight);

  const sunTexture = makeSunTexture();
  const star = new THREE.Mesh(
    new THREE.SphereGeometry(2.65, 96, 96),
    new THREE.MeshStandardMaterial({
      map: sunTexture,
      emissiveMap: sunTexture,
      emissive: 0xff7c1f,
      emissiveIntensity: 1.95,
      roughness: 0.82,
    })
  );
  star.position.y = 0.8;
  star.rotation.y = -0.65;
  scene.add(star);

  const corona = new THREE.Group();
  [
    [3.05, 0xffc247, 0.16],
    [3.65, 0xff8f2f, 0.07],
    [4.35, 0x38bdf8, 0.035],
  ].forEach(([radius, color, opacity]) => {
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 48),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    corona.add(shell);
  });
  corona.position.copy(star.position);
  scene.add(corona);

  const planetA = new THREE.Mesh(
    new THREE.SphereGeometry(0.96, 64, 64),
    new THREE.MeshStandardMaterial({
      map: makeEarthTexture(),
      roughness: 0.68,
      metalness: 0.02,
      emissive: 0x072f66,
      emissiveIntensity: 0.12,
    })
  );
  const planetAClouds = new THREE.Mesh(
    new THREE.SphereGeometry(0.99, 48, 48),
    new THREE.MeshStandardMaterial({
      map: makeCloudTexture(),
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      roughness: 1,
    })
  );
  const planetAAtmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.04, 48, 48),
    new THREE.MeshBasicMaterial({
      color: 0x61c7ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  planetA.add(planetAClouds, planetAAtmosphere);

  const planetB = new THREE.Mesh(
    new THREE.SphereGeometry(0.74, 64, 64),
    new THREE.MeshStandardMaterial({
      map: makeMarsTexture(),
      roughness: 0.82,
      metalness: 0.04,
      emissive: 0x4d1f16,
      emissiveIntensity: 0.12,
    })
  );
  const planetBAtmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 40, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffb268,
      transparent: true,
      opacity: 0.09,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  planetB.add(planetBAtmosphere);
  scene.add(planetA, planetB);

  function curvature(x, z, px1, pz1, px2, pz2) {
    const well = (cx, cz, strength, softening) => {
      const dx = x - cx;
      const dz = z - cz;
      return -strength / Math.sqrt(dx * dx + dz * dz + softening);
    };
    return -0.08 + well(0, 0, 15.8, 3.25) + well(px1, pz1, 1.6, 1.7) + well(px2, pz2, 0.9, 1.2);
  }

  const gridSize = 35;
  const gridSteps = 30;
  const fabricPositions = [];
  const fabricColors = [];
  const addVertex = (x, z, px1, pz1, px2, pz2) => {
    const y = curvature(x, z, px1, pz1, px2, pz2);
    fabricPositions.push(x, y, z);
    const depth = THREE.MathUtils.clamp((-y - 0.1) / 8.8, 0, 1);
    const color = new THREE.Color().setRGB(0.06 + depth * 0.04, 0.28 + depth * 0.38, 0.5 + depth * 0.42);
    fabricColors.push(color.r, color.g, color.b);
  };
  const buildFabric = (px1, pz1, px2, pz2) => {
    fabricPositions.length = 0;
    fabricColors.length = 0;
    const half = gridSize / 2;
    const step = gridSize / gridSteps;
    for (let i = 0; i <= gridSteps; i++) {
      const p = -half + i * step;
      for (let j = 0; j < gridSteps; j++) {
        const q = -half + j * step;
        addVertex(p, q, px1, pz1, px2, pz2);
        addVertex(p, q + step, px1, pz1, px2, pz2);
        addVertex(q, p, px1, pz1, px2, pz2);
        addVertex(q + step, p, px1, pz1, px2, pz2);
      }
    }
  };
  buildFabric(9, 0, -12, 0);
  const fabricGeometry = new THREE.BufferGeometry();
  fabricGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fabricPositions, 3));
  fabricGeometry.setAttribute("color", new THREE.Float32BufferAttribute(fabricColors, 3));
  const fabric = new THREE.LineSegments(
    fabricGeometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.54, blending: THREE.AdditiveBlending })
  );
  scene.add(fabric);

  function orbitRing(radius, color, opacity) {
    const points = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      points.push(new THREE.Vector3(x, curvature(x, z, 99, 99, 99, 99) + 0.18, z));
    }
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    );
  }
  scene.add(orbitRing(8.5, 0x38bdf8, 0.26), orbitRing(12.2, 0xf59e0b, 0.2));

  function makeArrow(color, opacity = 0.88) {
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color, 0.42, 0.24);
    arrow.children.forEach((child) => {
      child.material.transparent = true;
      child.material.opacity = opacity;
      child.material.depthTest = false;
      child.material.blending = THREE.AdditiveBlending;
      child.renderOrder = 6;
    });
    return arrow;
  }

  const arrows = {
    gravityA: makeArrow(0x67e8f9),
    velocityA: makeArrow(0x34d399),
    centripetalA: makeArrow(0xfacc15, 0.82),
    tidalA: makeArrow(0xfb7185, 0.8),
    gravityB: makeArrow(0x93c5fd),
    velocityB: makeArrow(0x4ade80),
    centripetalB: makeArrow(0xfbbf24, 0.8),
    tidalB: makeArrow(0xf472b6, 0.78),
  };
  scene.add(...Object.values(arrows));

  const starFieldGeometry = new THREE.BufferGeometry();
  const starPoints = [];
  for (let i = 0; i < 380; i++) {
    const r = 24 + Math.random() * 36;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPoints.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  starFieldGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPoints, 3));
  scene.add(new THREE.Points(starFieldGeometry, new THREE.PointsMaterial({ color: 0xa9d9ff, size: 0.075, transparent: true, opacity: 0.68 })));

  const sunMassLabel = stage.querySelector("[data-sun-mass]");
  const vectorLabels = Array.from(stage.querySelectorAll("[data-vector]")).reduce((map, element) => {
    map[element.dataset.vector] = element;
    return map;
  }, {});
  const projected = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  function projectPoint(point) {
    projected.copy(point).project(camera);
    return {
      x: (projected.x * 0.5 + 0.5) * stage.clientWidth,
      y: (-projected.y * 0.5 + 0.5) * stage.clientHeight,
    };
  }

  function setArrow(arrow, origin, direction, length, headLength, headWidth) {
    arrow.position.copy(origin);
    arrow.setDirection(direction);
    arrow.setLength(length, headLength, headWidth);
    return origin.clone().add(direction.clone().multiplyScalar(length));
  }

  function vectorSet(body, radius, angle, speedSign, scale, suffix) {
    const radialIn = star.position.clone().sub(body.position).normalize();
    const radialOut = radialIn.clone().multiplyScalar(-1);
    const tangent = new THREE.Vector3(-Math.sin(angle) * speedSign, 0.04, Math.cos(angle) * speedSign).normalize();
    const inwardCurve = radialIn.clone().add(new THREE.Vector3(0, -0.22, 0)).normalize();
    const lifted = up.clone().multiplyScalar(radius * 0.58);
    const side = tangent.clone().multiplyScalar(radius * 0.55);

    const gravityTip = setArrow(
      arrows[`gravity${suffix}`],
      body.position.clone().add(up.clone().multiplyScalar(radius * 0.08)),
      radialIn,
      1.9 * scale,
      0.36 * scale,
      0.22 * scale
    );
    const velocityTip = setArrow(
      arrows[`velocity${suffix}`],
      body.position.clone().add(lifted),
      tangent,
      1.75 * scale,
      0.32 * scale,
      0.2 * scale
    );
    const centripetalTip = setArrow(
      arrows[`centripetal${suffix}`],
      body.position.clone().sub(side).add(up.clone().multiplyScalar(radius * 0.12)),
      inwardCurve,
      1.25 * scale,
      0.28 * scale,
      0.17 * scale
    );
    const tidalTip = setArrow(
      arrows[`tidal${suffix}`],
      body.position.clone().add(radialOut.clone().multiplyScalar(radius * 0.55)),
      radialOut,
      0.95 * scale,
      0.24 * scale,
      0.16 * scale
    );

    return [
      { key: `gravity-${suffix.toLowerCase()}`, point: gravityTip, dx: 8, dy: -14 },
      { key: `velocity-${suffix.toLowerCase()}`, point: velocityTip, dx: 0, dy: -22 },
      { key: `centripetal-${suffix.toLowerCase()}`, point: centripetalTip, dx: -12, dy: 14 },
      { key: `tidal-${suffix.toLowerCase()}`, point: tidalTip, dx: 8, dy: 12 },
    ];
  }

  function layoutVectorLabels(entries) {
    const hud = stage.querySelector(".spacetime-hud");
    const hudRect = hud?.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const bottomReserve = hudRect ? Math.max(112, stageRect.bottom - hudRect.top + 14) : 120;
    const boxes = entries.map((entry) => {
      const element = vectorLabels[entry.key];
      if (!element) return null;
      const screen = projectPoint(entry.point);
      const width = element.offsetWidth || 46;
      const height = element.offsetHeight || 24;
      return {
        element,
        width,
        height,
        x: THREE.MathUtils.clamp(screen.x - width / 2 + entry.dx, 10, stage.clientWidth - width - 10),
        y: THREE.MathUtils.clamp(screen.y - height / 2 + entry.dy, 12, stage.clientHeight - height - bottomReserve),
      };
    }).filter(Boolean);

    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (overlapX <= -8 || overlapY <= -8) continue;

          const pushX = overlapX < overlapY ? (a.x < b.x ? -1 : 1) * (overlapX / 2 + 7) : 0;
          const pushY = overlapY <= overlapX ? (a.y < b.y ? -1 : 1) * (overlapY / 2 + 7) : 0;
          a.x = THREE.MathUtils.clamp(a.x + pushX, 10, stage.clientWidth - a.width - 10);
          b.x = THREE.MathUtils.clamp(b.x - pushX, 10, stage.clientWidth - b.width - 10);
          a.y = THREE.MathUtils.clamp(a.y + pushY, 12, stage.clientHeight - a.height - bottomReserve);
          b.y = THREE.MathUtils.clamp(b.y - pushY, 12, stage.clientHeight - b.height - bottomReserve);
        }
      }
    }

    boxes.forEach(({ element, x, y }) => {
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      element.classList.add("ready");
    });
  }

  function placeSunMass() {
    if (!sunMassLabel) return;
    const screen = projectPoint(star.position.clone().add(new THREE.Vector3(0, 0.1, 0)));
    sunMassLabel.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0) translate(-50%, -50%)`;
    sunMassLabel.classList.add("ready");
  }

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = width < 720 ? 34 : 29;
    camera.position.y = width < 720 ? 20 : 18;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(stage);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  let lastFabric = 0;

  function render() {
    const t = reduceMotion ? 0.8 : clock.getElapsedTime();
    const a1 = t * 0.34 + 2.55;
    const a2 = -t * 0.2 + 0.15;
    const x1 = Math.cos(a1) * 8.5;
    const z1 = Math.sin(a1) * 8.5;
    const x2 = Math.cos(a2) * 12.2;
    const z2 = Math.sin(a2) * 12.2;

    planetA.position.set(x1, curvature(x1, z1, x1, z1, x2, z2) + 1.1, z1);
    planetB.position.set(x2, curvature(x2, z2, x1, z1, x2, z2) + 0.84, z2);
    planetA.rotation.y += reduceMotion ? 0 : 0.008;
    planetAClouds.rotation.y += reduceMotion ? 0 : 0.004;
    planetB.rotation.y += reduceMotion ? 0 : 0.011;
    star.rotation.y += reduceMotion ? 0 : 0.0028;
    corona.scale.setScalar(1 + Math.sin(t * 2.1) * 0.026);

    const labelEntries = [
      ...vectorSet(planetA, 0.96, a1, 1, 1.05, "A"),
      ...vectorSet(planetB, 0.74, a2, -1, 0.9, "B"),
    ];

    if (!reduceMotion && t - lastFabric > 0.11) {
      buildFabric(x1, z1, x2, z2);
      fabricGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fabricPositions, 3));
      fabricGeometry.setAttribute("color", new THREE.Float32BufferAttribute(fabricColors, 3));
      lastFabric = t;
    }

    placeSunMass();
    layoutVectorLabels(labelEntries);
    renderer.render(scene, camera);
    if (!reduceMotion) requestAnimationFrame(render);
  }
  render();
})();
