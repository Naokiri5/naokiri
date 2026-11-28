/**
 * Trader Joe's miniature 3D workstation (MIA Atelier, section 6), drawn with three.js.
 *
 * Procedural low-poly geometry: no external model files, textures or network requests, so the studio adds no asset
 * pipeline and cannot fail to load a GLB. A rigged Blender GLB can replace `buildJoe` later behind the same
 * `JoeStudio` interface (setState / render / pick / dispose).
 *
 * Presentation only: this module imports nothing from the API client and holds no credentials, orders or policy.
 * Rendering is driven by the React wrapper, which pauses it off-screen, in background tabs and for reduced motion.
 */
import * as THREE from 'three';
import type { JoeState } from './JoeStateMapper';

export type MonitorId = 'decisions' | 'market' | 'portfolio';

const CORAL = 0xf06b5d;
const AMBER = 0xf0b45a;
const SLATE = 0x6d7682;

interface Rig {
  root: THREE.Group; chair: THREE.Group; body: THREE.Group; head: THREE.Group; eyes: THREE.Mesh[];
  armL: THREE.Group; armR: THREE.Group; mug: THREE.Group; steam: THREE.Mesh[];
}

/** Shared materials: created once per studio and disposed with it. */
function materials() {
  const m = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .05, ...extra });
  return {
    floor: m(0x15171c, { roughness: .9 }), desk: m(0xd9dde3, { roughness: .45 }), deskDark: m(0x24272e),
    skin: m(0xf2c6a8), hair: m(0x3a2a22), shirt: m(0x1d2026), accent: m(CORAL, { emissive: CORAL, emissiveIntensity: .25 }),
    chair: m(0x2b2f36), chrome: m(0xb8bec7, { metalness: .6, roughness: .3 }), key: m(0x30343c), eye: m(0x15171c),
    mug: m(0x1d2026), steam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .35, depthWrite: false }),
    lampShade: m(0x2b2f36), lampBulb: new THREE.MeshBasicMaterial({ color: 0xffe2b8 }),
  };
}
type Mats = ReturnType<typeof materials>;

const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

/** A monitor whose screen is a small canvas drawing: a stylised chart line, never real or invented prices. */
function buildMonitor(id: MonitorId, width: number, mats: Mats) {
  const group = new THREE.Group(); group.name = `monitor:${id}`;
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 144;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, width * .5625),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.position.z = .031; screen.userData.monitor = id;
  const bezel = box(width + .06, width * .5625 + .06, .05, mats.deskDark); bezel.userData.monitor = id;
  const stand = box(.05, .28, .05, mats.deskDark); stand.position.y = -(width * .5625) / 2 - .14;
  group.add(bezel, screen, stand);
  return { group, canvas, texture };
}

function drawScreen(canvas: HTMLCanvasElement, kind: MonitorId, tone: 'normal' | 'alert' | 'dim') {
  const g = canvas.getContext('2d'); if (!g) return;
  const color = tone === 'alert' ? '#f0b45a' : tone === 'dim' ? '#59606b' : '#f06b5d';
  g.fillStyle = tone === 'dim' ? '#101216' : '#16090a'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
  for (let y = 24; y < canvas.height; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(canvas.width, y); g.stroke(); }
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 3;
  if (kind === 'market') {
    // Decorative candle silhouettes; the label below makes clear these are not market prices.
    for (let i = 0; i < 14; i++) {
      const h = 18 + ((i * 37) % 40); const x = 14 + i * 17; const y = 110 - i * 4 - h / 2;
      g.fillRect(x, y, 8, h);
    }
  } else if (kind === 'decisions') {
    for (let i = 0; i < 6; i++) { g.fillRect(16, 18 + i * 20, 22, 10); g.globalAlpha = .55; g.fillRect(48, 18 + i * 20, 160 - (i * 23) % 70, 10); g.globalAlpha = 1; }
  } else {
    g.beginPath(); g.arc(70, 72, 40, 0, Math.PI * 2 * .7); g.stroke();
    for (let i = 0; i < 5; i++) g.fillRect(140 + i * 20, 110 - (i + 1) * 14, 12, (i + 1) * 14);
  }
  g.font = 'bold 13px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.7)';
  g.fillText(tone === 'dim' ? 'NO VERIFIED DATA' : 'ILLUSTRATIVE', 10, 138);
}

function buildJoe(mats: Mats): Rig {
  const root = new THREE.Group();
  const chair = new THREE.Group(); root.add(chair);
  const seat = box(.62, .08, .6, mats.chair); seat.position.y = .52;
  const back = box(.6, .7, .08, mats.chair); back.position.set(0, .92, -.3);
  const stripe = box(.4, .04, .09, mats.accent); stripe.position.set(0, .78, -.35);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .4, 8), mats.chrome); post.position.y = .3;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .04, 5), mats.chrome); base.position.y = .1;
  chair.add(seat, back, stripe, post, base);

  const body = new THREE.Group(); body.position.y = .56; chair.add(body);
  const torso = box(.46, .52, .3, mats.shirt); torso.position.y = .32;
  const collar = box(.47, .06, .31, mats.accent); collar.position.y = .56;
  const legs = box(.44, .14, .5, mats.shirt); legs.position.set(0, .04, .16);
  body.add(torso, collar, legs);

  const head = new THREE.Group(); head.position.y = .82; body.add(head);
  const face = box(.32, .34, .3, mats.skin); face.position.y = .1;
  const hair = box(.34, .12, .32, mats.hair); hair.position.set(0, .3, .01);
  const fringe = box(.34, .07, .08, mats.hair); fringe.position.set(0, .25, .14);
  const band = new THREE.Mesh(new THREE.TorusGeometry(.2, .025, 6, 16, Math.PI), mats.deskDark); band.position.y = .12;
  const earL = box(.06, .14, .14, mats.accent); earL.position.set(-.19, .08, 0);
  const earR = earL.clone(); earR.position.x = .19;
  const eyes = [-.07, .07].map((x) => { const e = box(.04, .05, .02, mats.eye); e.position.set(x, .12, .155); return e; });
  head.add(face, hair, fringe, band, earL, earR, ...eyes);

  const arm = (side: -1 | 1) => {
    const g = new THREE.Group(); g.position.set(side * .28, .52, 0);
    const upper = box(.11, .34, .11, mats.shirt); upper.position.y = -.17;
    const hand = box(.1, .1, .1, mats.skin); hand.position.y = -.37;
    g.add(upper, hand); g.rotation.x = -1.1; body.add(g); return g;
  };
  const armL = arm(-1); const armR = arm(1);

  const mug = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(.06, .055, .13, 10), mats.mug);
  const logo = box(.03, .03, .01, mats.accent); logo.position.set(0, 0, .061);
  mug.add(cup, logo);
  const steam = [0, 1, 2].map(() => { const s = new THREE.Mesh(new THREE.SphereGeometry(.025, 6, 6), mats.steam); mug.add(s); return s; });
  return { root, chair, body, head, eyes, armL, armR, mug, steam };
}

export class JoeStudio {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, .1, 50);
  private readonly mats = materials();
  private readonly rig: Rig;
  private readonly monitors: { id: MonitorId; group: THREE.Group; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }[] = [];
  private readonly glow: THREE.PointLight;
  private readonly raycaster = new THREE.Raycaster();
  private state: JoeState = 'STANDBY';
  private stateSince = 0;
  private lastTone: 'normal' | 'alert' | 'dim' | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Isometric-style view from behind Joe's right shoulder, so his face, the desk and all three screens read at once.
    this.camera.position.set(2.5, 3.5, -4.1); this.camera.lookAt(-.15, .95, .6);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x20232a, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 5, -2); this.scene.add(key);
    this.glow = new THREE.PointLight(CORAL, 6, 5, 1.6); this.glow.position.set(0, 1.5, 1.1); this.scene.add(this.glow);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), this.mats.floor); floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    const grid = new THREE.GridHelper(7, 14, CORAL, 0x3a2024);
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = .35; grid.position.y = .002; this.scene.add(grid);

    const desk = new THREE.Group(); desk.position.set(0, 0, 1.0); this.scene.add(desk);
    const top = box(2.6, .08, 1.0, this.mats.desk); top.position.y = .9;
    const legL = box(.5, .86, .9, this.mats.deskDark); legL.position.set(-1.0, .43, 0);
    const legR = legL.clone(); legR.position.x = 1.0;
    const drawerGlow = box(.3, .02, .01, this.mats.accent); drawerGlow.position.set(1.0, .6, -.455);
    const keyboard = box(.62, .03, .2, this.mats.key); keyboard.position.set(0, .955, -.2);
    const mouse = box(.08, .03, .12, this.mats.key); mouse.position.set(.48, .955, -.2);
    const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .5, 6), this.mats.lampShade); lampPole.position.set(-1.05, 1.19, .2);
    const lampHead = new THREE.Mesh(new THREE.ConeGeometry(.1, .14, 10, 1, true), this.mats.lampShade); lampHead.position.set(-1.0, 1.42, .15); lampHead.rotation.z = -.6;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.03, 8, 8), this.mats.lampBulb); bulb.position.set(-.97, 1.38, .15);
    const lampLight = new THREE.PointLight(0xffe2b8, 1.2, 2.2, 2); lampLight.position.copy(bulb.position);
    const cube = box(.1, .1, .1, this.mats.accent); cube.position.set(-.7, .99, -.25); cube.rotation.y = .5;
    desk.add(top, legL, legR, drawerGlow, keyboard, mouse, lampPole, lampHead, bulb, lampLight, cube);

    const layout: [MonitorId, number, number, number][] = [['decisions', -.95, .62, .5], ['market', 0, .9, 0], ['portfolio', .95, .62, -.5]];
    for (const [id, x, width, yaw] of layout) {
      const m = buildMonitor(id, width, this.mats);
      m.group.position.set(x, 1.36, .3); m.group.rotation.y = Math.PI + yaw;
      desk.add(m.group); this.monitors.push({ id, ...m });
    }

    this.rig = buildJoe(this.mats);
    this.rig.root.position.set(0, 0, 0); this.rig.root.rotation.y = 0;
    this.scene.add(this.rig.root);
    this.rig.mug.position.set(-.55, .99, .75); this.scene.add(this.rig.mug);
    this.refreshScreens();
  }

  setState(state: JoeState, nowMs: number) {
    if (state === this.state) return;
    this.state = state; this.stateSince = nowMs;
    this.refreshScreens();
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }

  /** Which monitor (if any) is under a point in normalised device coordinates. */
  pick(ndcX: number, ndcY: number): MonitorId | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    for (const hit of this.raycaster.intersectObjects(this.monitors.map((m) => m.group), true)) {
      const id = hit.object.userData.monitor as MonitorId | undefined; if (id) return id;
    }
    return null;
  }

  private tone(): 'normal' | 'alert' | 'dim' {
    return this.state === 'RISK_ALERT' ? 'alert' : this.state === 'SYSTEM_ERROR' || this.state === 'DISCONNECTED' ? 'dim' : 'normal';
  }

  private refreshScreens() {
    const tone = this.tone();
    if (tone === this.lastTone) return;
    this.lastTone = tone;
    for (const m of this.monitors) { drawScreen(m.canvas, m.id, tone); m.texture.needsUpdate = true; }
    this.glow.color.setHex(tone === 'alert' ? AMBER : tone === 'dim' ? SLATE : CORAL);
    this.glow.intensity = tone === 'dim' ? 1.5 : 6;
  }

  /** Pose the rig for `timeSec`. `animate` false renders a calm, still pose for reduced motion. */
  render(timeSec: number, animate: boolean) {
    const { chair, body, head, eyes, armL, armR, steam } = this.rig;
    const t = animate ? timeSec : 0;
    const since = animate ? Math.max(0, t - this.stateSince / 1000) : 1;
    const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, x), 3);
    const s = this.state;
    // Defaults: seated, facing the desk, hands on the keyboard.
    let chairYaw = 0; let headYaw = 0; let headPitch = .05; let lean = 0;
    let armLX = -1.1; let armRX = -1.1; let armRZ = 0;
    const breathe = Math.sin(t * 1.6) * .012;
    if (s === 'STANDBY') {
      const sip = Math.max(0, Math.sin(t * .45)); armRX = -1.1 - sip * 1.0; headPitch = .05 - sip * .15;
      chairYaw = Math.sin(t * .2) * .12;
    } else if (s === 'LISTENING') { chairYaw = 2.3 * ease(since * 1.5); headYaw = .2; }
    else if (s === 'TYPING') { armLX = -1.15 + Math.sin(t * 14) * .08; armRX = -1.15 + Math.sin(t * 14 + 1.3) * .08; headPitch = .15; }
    else if (s === 'SCANNING') { headYaw = Math.sin(t * .9) * .55; }
    else if (s === 'RESEARCHING') { lean = .12; headPitch = -.02; }
    else if (s === 'MONITORING') { headYaw = Math.sin(t * .35) * .3; }
    else if (s === 'RISK_ALERT' || s === 'REJECTION') { headYaw = .45; armRX = -1.75; armRZ = -.5; }
    else if (s === 'RECOVERING') { headYaw = Math.sin(t * .25) * .2; headPitch = .12; }
    else if (s === 'DISCONNECTED') { headYaw = -.45; headPitch = .1; lean = .05; }
    else if (s === 'POSITION_REVIEW') { headYaw = .4; lean = .1; }
    else if (s === 'SESSION_CLOSING') { armLX = -.7; armRX = -.7; chairYaw = Math.sin(t * .5) * .15; }
    else if (s === 'SYSTEM_ERROR') { headPitch = .2; armLX = -.6; armRX = -.6; }
    chair.rotation.y += (chairYaw - chair.rotation.y) * (animate ? .08 : 1);
    head.rotation.y += (headYaw - head.rotation.y) * (animate ? .1 : 1);
    head.rotation.x += (headPitch - head.rotation.x) * (animate ? .1 : 1);
    body.rotation.x = lean; body.position.y = .56 + breathe;
    armL.rotation.x += (armLX - armL.rotation.x) * (animate ? .2 : 1);
    armR.rotation.x += (armRX - armR.rotation.x) * (animate ? .2 : 1);
    armR.rotation.z += (armRZ - armR.rotation.z) * (animate ? .2 : 1);
    const blink = animate && (t % 4.2) < .12 ? .15 : 1; for (const e of eyes) e.scale.y = blink;
    steam.forEach((p, i) => {
      const k = animate ? ((t * .5 + i / 3) % 1) : i / 3;
      p.position.set(Math.sin(k * 6 + i) * .02, .1 + k * .3, 0);
      (p.material as THREE.MeshBasicMaterial).opacity = animate ? .35 : .2;
      p.scale.setScalar(1 + k);
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    const shared = new Set<THREE.Material>(Object.values(this.mats));
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.LineSegments)) return;
      o.geometry.dispose();
      for (const m of ([] as THREE.Material[]).concat(o.material)) if (!shared.has(m)) m.dispose();
    });
    for (const m of this.monitors) m.texture.dispose();
    Object.values(this.mats).forEach((m) => m.dispose());
    this.renderer.dispose();
  }
}
