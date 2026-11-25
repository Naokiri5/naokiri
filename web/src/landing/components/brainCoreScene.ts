import * as THREE from 'three';

/**
 * BrainOS intelligence core — the only WebGL scene on the landing page (T05/T13 camera, T14 contour, T20 nodes).
 * Loaded on demand near Chapter 03. A visual metaphor only: nothing here reflects live telemetry or real cognition.
 *
 * Contract: progress comes from the shared scene controller (never from its own scroll listener); rendering stops
 * when the canvas is offscreen or the tab is hidden; reduced motion renders single frames on progress change;
 * every GPU resource is disposed on unmount; any WebGL failure reports `onFail` so the SVG fallback stays.
 */
export interface CoreOptions {
  canvas: HTMLCanvasElement;
  getProgress: () => number;
  subscribe: (listener: () => void) => () => void;
  reduced: boolean;
  compact: boolean;
  onReady: () => void;
  onFail: (reason: string) => void;
}
export interface CoreHandle { dispose(): void }

const PINK = '#F48BB8';
const BLUE = '#8FD3F4';
const CREAM = '#FFF5F7';
const GRAPHITE = '#2B2430';
const LAVENDER = '#8E8196';

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Deterministic pseudo-random sequence so every visitor sees the same topology. */
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function fibonacciSphere(n: number, radius: number): Float32Array {
  const out = new Float32Array(n * 3); const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2; const r = Math.sqrt(1 - y * y); const th = golden * i;
    out.set([Math.cos(th) * r * radius, y * radius, Math.sin(th) * r * radius], i * 3);
  }
  return out;
}

function nearestPairs(points: Float32Array, n: number, k: number): Array<[number, number]> {
  const pairs = new Set<string>(); const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const d: Array<[number, number]> = [];
    for (let j = 0; j < n; j++) if (j !== i) {
      const dx = points[i * 3] - points[j * 3], dy = points[i * 3 + 1] - points[j * 3 + 1], dz = points[i * 3 + 2] - points[j * 3 + 2];
      d.push([dx * dx + dy * dy + dz * dz, j]);
    }
    d.sort((a, b) => a[0] - b[0]);
    for (const [, j] of d.slice(0, k)) { const key = i < j ? `${i}-${j}` : `${j}-${i}`; if (!pairs.has(key)) { pairs.add(key); out.push(i < j ? [i, j] : [j, i]); } }
  }
  return out;
}

const shellVertex = /* glsl */`
  uniform float uTime; uniform float uAmp;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
  void main() {
    vec3 p = position;
    float n = sin(p.x * 3.1 + uTime * 0.7) * sin(p.y * 2.7 + uTime * 0.9) * sin(p.z * 3.3 + uTime * 0.6);
    p += normal * n * uAmp;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    vPos = position;
    gl_Position = projectionMatrix * mv;
  }`;
const shellFragment = /* glsl */`
  uniform vec3 uPink; uniform vec3 uBlue; uniform vec3 uCream; uniform float uBase; uniform float uRim;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vPos;
  void main() {
    float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.0);
    float g = smoothstep(-1.0, 1.0, vPos.y * 0.8 + vPos.x * 0.4);
    vec3 col = mix(uPink, uBlue, g);
    col = mix(uCream, col, 0.5 + 0.5 * fres);
    gl_FragColor = vec4(col, uBase + uRim * fres);
    #include <colorspace_fragment>
  }`;
const glowFragment = /* glsl */`
  uniform vec3 uPink; uniform vec3 uBlue; varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5; float d = length(c) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    vec3 col = mix(uBlue, uPink, smoothstep(-0.5, 0.5, c.x - c.y));
    gl_FragColor = vec4(col, a * a * 0.55);
    #include <colorspace_fragment>
  }`;
const glowVertex = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const nodeVertex = /* glsl */`
  attribute vec3 aColor; uniform float uSize; uniform float uPixelRatio; varying vec3 vColor;
  void main() { vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uSize * uPixelRatio * (4.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const nodeFragment = /* glsl */`
  uniform float uOpacity; varying vec3 vColor;
  void main() { vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; float edge = smoothstep(0.5, 0.36, d); float ring = smoothstep(0.30, 0.38, d) * 0.55;
    gl_FragColor = vec4(mix(vColor, vec3(0.169, 0.141, 0.188), ring), edge * uOpacity);
    #include <colorspace_fragment>
  }`;

export function mountBrainCore(o: CoreOptions): CoreHandle {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, alpha: true, powerPreference: 'default' });
  } catch {
    o.onFail('webgl-unavailable');
    return { dispose() { /* nothing was created */ } };
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, o.compact ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  const group = new THREE.Group();
  group.rotation.x = 0.18;
  scene.add(group);
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const color = (hex: string) => new THREE.Color(hex);

  // Translucent shell and nucleus share one shader with different opacity profiles.
  const shellUniforms = { uTime: { value: 0 }, uAmp: { value: 0.045 }, uPink: { value: color(PINK) }, uBlue: { value: color(BLUE) }, uCream: { value: color(CREAM) }, uBase: { value: 0.16 }, uRim: { value: 0.74 } };
  const shell = new THREE.Mesh(
    track(new THREE.IcosahedronGeometry(1, o.compact ? 20 : 40)),
    track(new THREE.ShaderMaterial({ uniforms: shellUniforms, vertexShader: shellVertex, fragmentShader: shellFragment, transparent: true, depthWrite: false })),
  );
  group.add(shell);
  const nucleusUniforms = { ...shellUniforms, uAmp: { value: 0.02 }, uBase: { value: 0.5 }, uRim: { value: 0.45 } };
  const nucleus = new THREE.Mesh(
    track(new THREE.IcosahedronGeometry(0.42, 12)),
    track(new THREE.ShaderMaterial({ uniforms: nucleusUniforms, vertexShader: shellVertex, fragmentShader: shellFragment, transparent: true, depthWrite: false })),
  );
  group.add(nucleus);

  const glow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(3.6, 3.6)),
    track(new THREE.ShaderMaterial({ uniforms: { uPink: { value: color(PINK) }, uBlue: { value: color(BLUE) } }, vertexShader: glowVertex, fragmentShader: glowFragment, transparent: true, depthWrite: false })),
  );
  glow.position.z = -0.6;
  scene.add(glow);

  // Horizon arcs: a spatial echo of the logo's arc, never the logo itself.
  const ring = (radius: number, tube: number, arc: number, hex: string, opacity: number) => {
    const m = new THREE.Mesh(track(new THREE.TorusGeometry(radius, tube, 10, 220, arc)), track(new THREE.MeshBasicMaterial({ color: color(hex), transparent: true, opacity })));
    group.add(m); return m;
  };
  const arcGraphite = ring(1.42, 0.011, Math.PI * 1.32, GRAPHITE, 0.85);
  arcGraphite.rotation.set(0.1, 0.25, -0.9);
  const ringBlue = ring(1.72, 0.006, Math.PI * 2, BLUE, 0.9);
  ringBlue.rotation.set(1.2, 0.2, 0.3);
  const arcPink = ring(1.58, 0.008, Math.PI * 0.85, PINK, 0.95);
  arcPink.rotation.set(-0.6, 0.9, 1.4);

  // Particle assembly (T20): deterministic start → target topology.
  const count = o.compact ? 24 : 40;
  const target = fibonacciSphere(count, 1.2);
  const start = new Float32Array(count * 3);
  const rand = lcg(20261125);
  for (let i = 0; i < count; i++) {
    const th = rand() * Math.PI * 2; const ph = Math.acos(2 * rand() - 1); const r = 2.4 + rand() * 1.3;
    start.set([Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r], i * 3);
  }
  const nodeColors = new Float32Array(count * 3);
  const pink = color(PINK); const blue = color(BLUE);
  for (let i = 0; i < count; i++) { const c = i % 2 ? blue : pink; nodeColors.set([c.r, c.g, c.b], i * 3); }
  const nodeGeo = track(new THREE.BufferGeometry());
  const nodePos = new THREE.BufferAttribute(new Float32Array(start), 3);
  nodeGeo.setAttribute('position', nodePos);
  nodeGeo.setAttribute('aColor', new THREE.BufferAttribute(nodeColors, 3));
  const nodeUniforms = { uSize: { value: o.compact ? 7 : 9 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 1 } };
  const nodes = new THREE.Points(nodeGeo, track(new THREE.ShaderMaterial({ uniforms: nodeUniforms, vertexShader: nodeVertex, fragmentShader: nodeFragment, transparent: true, depthWrite: false })));
  group.add(nodes);

  const pairs = nearestPairs(target, count, 2);
  const edgeGeo = track(new THREE.BufferGeometry());
  const edgePos = new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3);
  edgeGeo.setAttribute('position', edgePos);
  const edgeMat = track(new THREE.LineBasicMaterial({ color: color(LAVENDER), transparent: true, opacity: 0 }));
  group.add(new THREE.LineSegments(edgeGeo, edgeMat));

  let lastAssembly = -1;
  const applyAssembly = (a: number) => {
    if (Math.abs(a - lastAssembly) < 1e-4) return;
    lastAssembly = a;
    const arr = nodePos.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = start[i] + (target[i] - start[i]) * a;
    nodePos.needsUpdate = true;
    const e = edgePos.array as Float32Array;
    pairs.forEach(([i, j], k) => { e.set(arr.subarray(i * 3, i * 3 + 3), k * 6); e.set(arr.subarray(j * 3, j * 3 + 3), k * 6 + 3); });
    edgePos.needsUpdate = true;
    edgeMat.opacity = 0.55 * a;
  };

  let elapsed = 0; let last = 0; let raf = 0; let visible = false; let failed = false; let readySent = false;
  const draw = () => {
    if (failed) return;
    const p = o.getProgress();
    const dolly = easeInOut(Math.min(1, p / 0.42));
    camera.position.set(0, 0.08 * (1 - dolly), 8.4 - 3.7 * dolly);
    camera.lookAt(0, 0, 0);
    const assembly = easeInOut(smoothstep(0.4, 0.58, p));
    applyAssembly(assembly);
    const assembling = assembly > 0.05 && assembly < 0.95;
    shellUniforms.uAmp.value = o.reduced ? 0 : assembling ? 0.015 : 0.045;
    shellUniforms.uTime.value = elapsed;
    group.rotation.y = elapsed * 0.06 + p * 1.6;
    ringBlue.rotation.z = 0.3 + elapsed * 0.05;
    arcPink.rotation.y = 0.9 - elapsed * 0.04;
    renderer.render(scene, camera);
    if (!readySent) { readySent = true; o.onReady(); }
  };
  const loop = (now: number) => {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now; elapsed += dt;
    draw();
    if (visible && !document.hidden && !o.reduced) raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (o.reduced) { draw(); return; }
    if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(loop); }
  };

  const resize = () => {
    const parent = o.canvas.parentElement; if (!parent) return;
    const w = Math.max(1, parent.clientWidth); const h = Math.max(1, parent.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    draw();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (o.canvas.parentElement) ro?.observe(o.canvas.parentElement);
  const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); if (visible) wake(); }, { rootMargin: '120px 0px' });
  io.observe(o.canvas);
  const onVisibility = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVisibility);
  const unsubscribe = o.subscribe(() => { if (o.reduced) draw(); });
  const onLost = (e: Event) => { e.preventDefault(); failed = true; if (raf) cancelAnimationFrame(raf); raf = 0; o.onFail('context-lost'); };
  o.canvas.addEventListener('webglcontextlost', onLost);

  try { resize(); } catch (err) { failed = true; o.onFail(err instanceof Error ? err.message : 'render-failed'); }

  return {
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; failed = true;
      unsubscribe(); io.disconnect(); ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      o.canvas.removeEventListener('webglcontextlost', onLost);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
