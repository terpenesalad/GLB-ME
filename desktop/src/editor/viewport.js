// WebGL viewport: renderer, environments, orbit camera, picking, gizmo, sculpt/paint/face strokes,
// overlays (selection brackets, mask, face selection, wireframe) and thumbnails.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { isMesh, isLight, frameBounds } from './model.js';
import { matcapTexture } from './textures.js';
import { SculptEngine } from '../core/sculpt.js';
import { FaceSelection } from '../core/faces.js';

export const ENVS = [['STUDIO', 'Studio'], ['SUNSET', 'Sunset'], ['OVERCAST', 'Overcast'], ['NIGHT', 'Night'], ['NEON', 'Neon'], ['DARK', 'Lights only']];
export const SHADING = [['PBR', 'Realistic', 'sun'], ['MATCAP', 'Matcap', 'circle'], ['FLAT_CLAY', 'Clay', 'cloud'], ['NORMALS', 'Normals', 'compass'], ['UNLIT', 'Unlit', 'lightbulb-off']];
export const BACKGROUNDS = [[0x2B2E3A, 0x101116], [0x3a3f4f, 0x1b1d24], [0xf2f2f5, 0xc9cad2], [0x1d2b4a, 0x070a12], [0x4a2f5c, 0x120a1a], [0x000000, 0x000000]];

export function defaultRender() {
  return { shading: 'PBR', matcap: 0, env: 'STUDIO', exposure: 1, lightAngle: -40, lightHeight: 45, shadows: true, grid: true, wireframe: false, bgTop: 0x2B2E3A, bgBottom: 0x101116, ortho: false, fov: 45, axes: true, envRotation: 0, envIntensity: 1 };
}

export class Viewport {
  constructor(canvas, doc, host) {
    this.canvas = canvas; this.doc = doc; this.host = host; // host: editor callbacks
    this.render = defaultRender();
    this.cam = { yaw: 35, pitch: 20, distance: 3.2, target: new THREE.Vector3(0, 0.5, 0) };
    this.mode = 'object'; // object | sculpt | paint | edit | animate
    this.brush = null; this.brushType = 'CLAY';
    this.engine = new SculptEngine();
    this.faces = new FaceSelection();
    this.faceTool = { value: 1, radiusPx: 30 };
    this.placement = null; // { onPick(hit) }
    this.needsRender = true;
    this.pointer = { x: 0, y: 0, inside: false };

    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pmrem = new THREE.PMREMGenerator(r);

    const s = this.scene = new THREE.Scene();
    s.add(doc.root);
    this.persp = new THREE.PerspectiveCamera(45, 1, 0.01, 2000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
    this.camera = this.persp;

    // key light + shadow catcher
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.02;
    s.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.0);
    s.add(this.hemi);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.28, depthWrite: false }));
    this.ground.receiveShadow = true; this.ground.renderOrder = -1;
    s.add(this.ground);

    // infinite-looking grid with distance fade
    this.gridMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true },
      uniforms: { uColor: { value: new THREE.Color(0x9aa0b4) }, uFade: { value: 20 }, uCenter: { value: new THREE.Vector3() }, uAlpha: { value: 1 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uColor; uniform float uFade; uniform vec3 uCenter; uniform float uAlpha; varying vec3 vW;
        float grid(vec2 p, float s){ vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          float d = length(vW.xz - uCenter.xz);
          float fade = 1.0 - smoothstep(uFade * 0.25, uFade, d);
          float a = max(grid(vW.xz, 0.1) * 0.10, grid(vW.xz, 1.0) * 0.32);
          vec2 ax = abs(vW.xz) / fwidth(vW.xz);
          vec3 col = uColor;
          if (ax.y < 1.0) { col = vec3(1.0, 0.36, 0.42); a = 0.75; }
          if (ax.x < 1.0) { col = vec3(0.36, 0.58, 1.0); a = 0.75; }
          gl_FragColor = vec4(col, a * fade * uAlpha);
          if (gl_FragColor.a < 0.004) discard;
        }`,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.gridMat);
    this.grid.renderOrder = -2; this.grid.frustumCulled = false;
    this.axes = new THREE.Group();
    s.add(this.grid, this.axes);

    // selection outline (inverted hull, constant screen width)
    this.outlineMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, transparent: true,
      uniforms: { uColor: { value: new THREE.Color(0x8b78ff) }, uWidth: { value: 2.2 }, uRes: { value: new THREE.Vector2(1, 1) } },
      vertexShader: `uniform float uWidth; uniform vec2 uRes;
        void main(){ vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal); vec4 cn = projectionMatrix * vec4(n, 0.0);
          vec2 dir = cn.xy; float l = length(dir); dir = l > 1e-6 ? dir / l : vec2(0.0);
          c.xy += dir * uWidth * 2.0 / uRes * c.w; gl_Position = c; }`,
      fragmentShader: 'uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }',
    });
    this.brackets = new THREE.Mesh(new THREE.BufferGeometry(), this.outlineMat);
    this.brackets.renderOrder = 3; this.brackets.visible = false; this.brackets.matrixAutoUpdate = false; s.add(this.brackets);

    // overlays
    this.faceOverlay = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x8b78ff, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
    this.faceOverlay.visible = false; this.faceOverlay.renderOrder = 5; s.add(this.faceOverlay);
    this.maskOverlay = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      vertexShader: 'attribute float mask; varying float vM; void main(){ vM = mask; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vM; void main(){ if (vM < 0.01) discard; gl_FragColor = vec4(0.02,0.02,0.05, vM*0.62); }',
    }));
    this.maskOverlay.visible = false; this.maskOverlay.renderOrder = 4; s.add(this.maskOverlay);
    this.wireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false });
    this.wires = new THREE.Group(); s.add(this.wires);
    this.helpers = new THREE.Group(); s.add(this.helpers);

    // gizmo
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmoHelper = this.gizmo.getHelper();
    s.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => this.onGizmoDrag(e.value));
    this.gizmo.addEventListener('objectChange', () => { this.host.onGizmoChange?.(); this.requestRender(); });
    this.gizmo.addEventListener('change', () => this.requestRender());

    this.raycaster = new THREE.Raycaster(); this.raycaster.firstHitOnly = true;
    this.shadingMats = new Map();
    this.unlitMats = new WeakMap();

    this.setupInput();
    this.applyRender();
    this.resize();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas.parentElement);
    doc.addEventListener('touch', () => this.requestRender());
    doc.addEventListener('change', () => { this.syncHelpers(); this.syncGizmo(); this.requestRender(); });
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------------- render settings
  applyRender() {
    const rs = this.render, r = this.renderer;
    r.toneMappingExposure = rs.exposure;
    this.setEnv(rs.env);
    this.updateBackground();
    this.grid.visible = rs.grid;
    this.ground.visible = rs.shadows; this.key.castShadow = rs.shadows;
    this.persp.fov = rs.fov; this.persp.updateProjectionMatrix();
    this.camera = rs.ortho ? this.ortho : this.persp;
    this.gizmo.camera = this.camera;
    this.updateKeyLight();
    this.syncWire();
    this.requestRender();
  }
  updateBackground() {
    const rs = this.render, c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + rs.bgTop.toString(16).padStart(6, '0')); g.addColorStop(1, '#' + rs.bgBottom.toString(16).padStart(6, '0'));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    this.scene.background?.dispose?.();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = t;
    const lum = ((rs.bgTop >> 16 & 255) + (rs.bgTop >> 8 & 255) + (rs.bgTop & 255)) / 765;
    this.gridMat.uniforms.uColor.value.set(lum > 0.6 ? 0x3c3f4a : 0x9aa0b4);
  }
  setEnv(id) {
    if (this.envId === id && this.scene.environment) { this.scene.environmentRotation.y = THREE.MathUtils.degToRad(this.render.envRotation || 0); this.scene.environmentIntensity = this.render.envIntensity ?? 1; return; }
    this.envId = id;
    if (this.envTex) { this.envTex.dispose(); this.envTex = null; }
    if (id === 'DARK') { this.scene.environment = null; this.hemi.intensity = 0.06; this.key.intensity = 0.25; return; }
    this.hemi.intensity = 0;
    const envScene = id === 'STUDIO' ? new RoomEnvironment() : gradientEnv(id);
    this.envTex = this.pmrem.fromScene(envScene, 0.035).texture;
    this.scene.environment = this.envTex;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(this.render.envRotation || 0);
    this.scene.environmentIntensity = this.render.envIntensity ?? 1;
    this.key.intensity = { STUDIO: 1.6, SUNSET: 2.2, OVERCAST: 0.9, NIGHT: 0.6, NEON: 0.8 }[id] ?? 1.5;
    this.key.color.set(id === 'SUNSET' ? 0xffc79a : id === 'NIGHT' ? 0x9db4ff : 0xffffff);
  }
  updateKeyLight() {
    const rs = this.render, box = frameBounds(this.doc.objects);
    const c = box.isEmpty() ? new THREE.Vector3(0, 0.5, 0) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 2 : Math.max(1, box.getSize(new THREE.Vector3()).length());
    const a = THREE.MathUtils.degToRad(rs.lightAngle), e = THREE.MathUtils.degToRad(rs.lightHeight);
    this.key.position.set(c.x + Math.sin(a) * Math.cos(e) * size * 2, c.y + Math.sin(e) * size * 2, c.z + Math.cos(a) * Math.cos(e) * size * 2);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 0.01; sc.far = size * 5; sc.updateProjectionMatrix();
    const y = box.isEmpty() ? 0 : Math.min(0, box.min.y);
    this.ground.position.set(c.x, y - 0.0005, c.z); this.ground.scale.setScalar(size * 6);
  }

  // ------------------------------------------------------------------------- camera
  resize() {
    const p = this.canvas.parentElement; const w = p.clientWidth, hh = p.clientHeight;
    if (!w || !hh) return;
    this.renderer.setSize(w, hh, false);
    this.persp.aspect = w / hh; this.persp.updateProjectionMatrix();
    this.updateCamera(); this.requestRender();
  }
  updateCamera() {
    const c = this.cam, y = THREE.MathUtils.degToRad(c.yaw), p = THREE.MathUtils.degToRad(c.pitch);
    const eye = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(c.distance).add(c.target);
    for (const cam of [this.persp, this.ortho]) { cam.position.copy(eye); cam.up.set(0, Math.cos(p) >= 0 ? 1 : -1, 0); cam.lookAt(c.target); }
    const w = this.canvas.clientWidth || 1, hh = this.canvas.clientHeight || 1;
    const halfH = c.distance * Math.tan(THREE.MathUtils.degToRad(this.render.fov) / 2), halfW = halfH * w / hh;
    Object.assign(this.ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH }); this.ortho.updateProjectionMatrix();
    this.persp.near = Math.max(0.001, c.distance * 0.005); this.persp.far = Math.max(100, c.distance * 200); this.persp.updateProjectionMatrix();
    this.host.onCamera?.();
  }
  frame(objs = null, animate = true) {
    const list = objs || (this.doc.selected ? [this.doc.selected] : this.doc.objects);
    let box = frameBounds(list);
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(0.05, sphere.radius);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.render.fov) / 2) * 1.3;
    this.animateCam({ target: sphere.center, distance: dist }, animate);
  }
  animateCam(to, animate = true) {
    const from = { yaw: this.cam.yaw, pitch: this.cam.pitch, distance: this.cam.distance, target: this.cam.target.clone() };
    const goal = { yaw: to.yaw ?? from.yaw, pitch: to.pitch ?? from.pitch, distance: to.distance ?? from.distance, target: to.target ? to.target.clone() : from.target };
    if (to.yaw != null) { let d = ((goal.yaw - from.yaw) % 360 + 540) % 360 - 180; goal.yaw = from.yaw + d; }
    if (!animate || document.documentElement.classList.contains('reduce-motion')) { Object.assign(this.cam, goal); this.updateCamera(); this.requestRender(); return; }
    const t0 = performance.now(), dur = 380;
    this.camAnim = (now) => {
      let t = Math.min(1, (now - t0) / dur); t = 1 - Math.pow(1 - t, 3);
      this.cam.yaw = from.yaw + (goal.yaw - from.yaw) * t; this.cam.pitch = from.pitch + (goal.pitch - from.pitch) * t;
      this.cam.distance = from.distance + (goal.distance - from.distance) * t; this.cam.target.lerpVectors(from.target, goal.target, t);
      this.updateCamera();
      if (t >= 1) this.camAnim = null;
    };
  }
  view(name) {
    const v = { front: [0, 0], back: [180, 0], left: [-90, 0], right: [90, 0], top: [0, 89.9], bottom: [0, -89.9], iso: [35, 20] }[name];
    if (v) this.animateCam({ yaw: v[0], pitch: v[1] });
  }

  // ------------------------------------------------------------------------- picking
  ndc(e) { const r = this.canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  pick(e, onlyObj = null) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const targets = onlyObj ? [onlyObj] : [...this.doc.meshes.filter((o) => o.visible), ...this.helpers.children];
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      const o = hit.object.userData.lightOf || hit.object;
      if (o.visible !== false) return { ...hit, obj: o };
    }
    return null;
  }
  worldPerPixel(point) {
    const hh = this.canvas.clientHeight || 1;
    if (this.camera.isOrthographicCamera) return (this.ortho.top - this.ortho.bottom) / hh;
    const d = this.camera.position.distanceTo(point);
    return 2 * d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2) / hh;
  }

  // ------------------------------------------------------------------------- input
  setupInput() {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.pointer.inside = false; this.host.onBrushCursor?.(null); });
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => { if (this.mode === 'object') { const hit = this.pick(e); if (hit) this.frame([hit.obj]); } });
  }
  onDown(e) {
    this.canvas.focus({ preventScroll: true });
    if (this.drag) return;
    if (this.gizmo.dragging || (this.gizmo.axis && this.gizmoHelper.visible && e.button === 0)) return;
    const nav = e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey);
    this.canvas.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, moved: false, t: performance.now() };
    if (nav) { this.drag = { kind: e.button === 1 || (e.button === 2 && e.shiftKey) ? 'pan' : 'orbit', ...start }; return; }
    if (e.button !== 0) return;
    if (this.placement) { const hit = this.pick(e); this.placement.onPick(hit, e); this.drag = { kind: 'none', ...start }; return; }
    const sel = this.doc.selected;
    if ((this.mode === 'sculpt' || this.mode === 'paint') && isMesh(sel) && sel.visible) {
      const hit = this.pick(e, sel);
      if (hit) { this.beginStroke(hit, e, start); return; }
    }
    if (this.mode === 'edit' && isMesh(sel) && sel.visible) {
      const hit = this.pick(e, sel);
      if (hit) { this.beginFaceStroke(hit, e, start); return; }
    }
    this.drag = { kind: 'maybe-orbit', ...start };
  }
  onMove(e) {
    this.pointer = { x: e.clientX, y: e.clientY, inside: true };
    const d = this.drag;
    if (!d) { this.hover(e); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    if (d.kind === 'maybe-orbit' && d.moved) d.kind = e.shiftKey ? 'pan' : 'orbit';
    if (d.kind === 'orbit') {
      this.cam.yaw -= (e.movementX || 0) * 0.35; this.cam.pitch = Math.max(-89.9, Math.min(89.9, this.cam.pitch + (e.movementY || 0) * 0.35));
      this.camAnim = null; this.updateCamera(); this.requestRender();
    } else if (d.kind === 'pan') {
      const wpp = this.worldPerPixel(this.cam.target);
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      this.cam.target.addScaledVector(right, -(e.movementX || 0) * wpp).addScaledVector(up, (e.movementY || 0) * wpp);
      this.camAnim = null; this.updateCamera(); this.requestRender();
    } else if (d.kind === 'stroke') this.strokeMove(e);
    else if (d.kind === 'faces') this.faceMove(e);
  }
  onUp(e) {
    const d = this.drag; this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d) return;
    if (d.kind === 'stroke') this.endStroke();
    else if (d.kind === 'faces') this.endFaceStroke();
    else if (d.kind === 'maybe-orbit' && !d.moved && d.button === 0) {
      // click: select
      const hit = this.pick(e);
      if (this.mode === 'object' || this.mode === 'animate' || !hit || hit.obj !== this.doc.selected) this.host.onPickObject?.(hit ? hit.obj : null, e);
    }
    this.hover(e);
  }
  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey && (this.mode === 'sculpt' || this.mode === 'paint') && this.brush) { // ctrl+wheel = brush size
      this.host.onBrushResize?.(e.deltaY < 0 ? 1.08 : 1 / 1.08); return;
    }
    const k = Math.pow(1.0015, e.deltaY * (e.deltaMode === 1 ? 30 : 1));
    // zoom towards cursor
    const hit = this.pick(e);
    const old = this.cam.distance;
    this.cam.distance = Math.max(0.01, Math.min(5000, old * k));
    if (hit && k < 1) { const f = 1 - this.cam.distance / old; this.cam.target.lerp(hit.point, f * 0.6); }
    this.camAnim = null; this.updateCamera(); this.requestRender();
  }
  hover(e) {
    if (!this.pointer.inside) return;
    const sel = this.doc.selected;
    if ((this.mode === 'sculpt' || this.mode === 'paint' || this.mode === 'edit') && isMesh(sel)) {
      const r = this.mode === 'edit' ? this.faceTool.radiusPx : this.brush?.radiusPx || 60;
      this.host.onBrushCursor?.({ x: e.clientX, y: e.clientY, r, neg: this.mode === 'edit' ? this.faceTool.value === 0 : (this.brush?.negative !== (e.ctrlKey || e.metaKey)) });
    } else this.host.onBrushCursor?.(null);
  }
  onGizmoDrag(on) {
    if (on) this.host.onGizmoStart?.(); else this.host.onGizmoEnd?.();
  }

  // ------------------------------------------------------------------------- sculpt / paint strokes
  toLocal(o, p) { return o.worldToLocal(p.clone()); }
  localRadius(o, worldR) { const s = o.getWorldScale(new THREE.Vector3()); return worldR / Math.max(1e-6, Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z))); }
  beginStroke(hit, e, start) {
    const o = this.doc.selected, b = this.brush;
    let type = this.mode === 'paint' ? 'PAINT' : this.brushType;
    if (e.shiftKey && this.mode === 'sculpt') type = 'SMOOTH';
    const settings = { ...b, negative: b.negative !== !!(e.ctrlKey || e.metaKey) };
    const worldR = b.radiusPx * this.worldPerPixel(hit.point);
    const r = this.localRadius(o, worldR);
    this.engine.symmetry = this.host.symmetry();
    this.engine.begin(o.geometry, type, settings, r);
    const local = this.toLocal(o, hit.point);
    this.stroke = { obj: o, type, r, last: local.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), hit.point), startWorld: hit.point.clone(), lastWorld: hit.point.clone(), dist: 0, pressure: e.pressure || 0.5 };
    if (type === 'MOVE') this.engine.grabStart(local.toArray(), r);
    else this.engine.dab(local.toArray(), r, e.pointerType === 'pen' ? e.pressure : 1, null);
    if (type === 'PAINT' && !o.material.vertexColors) { o.material.vertexColors = true; o.material.needsUpdate = true; }
    this.drag = { kind: 'stroke', ...start };
    this.afterDab();
  }
  strokeMove(e) {
    const s = this.stroke; if (!s) return;
    const o = s.obj, pressure = e.pointerType === 'pen' ? e.pressure : 1;
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    if (s.type === 'MOVE' || s.type === 'DRAG') {
      const p = this.raycaster.ray.intersectPlane(s.plane, new THREE.Vector3()); if (!p) return;
      if (s.type === 'MOVE') {
        const d = this.toLocal(o, p).sub(this.toLocal(o, s.startWorld));
        this.engine.dab(this.toLocal(o, s.startWorld).toArray(), s.r, pressure, d.toArray());
      } else {
        const d = this.toLocal(o, p).sub(this.toLocal(o, s.lastWorld));
        if (d.length() < s.r * 0.02) return;
        this.engine.dab(this.toLocal(o, s.lastWorld).toArray(), s.r, pressure, d.toArray());
        s.lastWorld.copy(p); s.plane.setFromNormalAndCoplanarPoint(s.plane.normal, p);
      }
      this.afterDab(); return;
    }
    const hit = this.pick(e, o); if (!hit) return;
    const local = this.toLocal(o, hit.point);
    const spacing = Math.max(0.02, this.brush.spacing || 0.12) * s.r;
    let dist = local.distanceTo(s.last);
    if (dist < spacing) return;
    // interpolate dabs along the path for an even stroke
    const steps = Math.min(24, Math.floor(dist / spacing));
    const from = s.last.clone();
    for (let i = 1; i <= steps; i++) {
      const p = from.clone().lerp(local, i / steps);
      this.engine.dab(p.toArray(), s.r, pressure, null);
    }
    s.last.copy(local);
    this.afterDab();
  }
  afterDab() {
    const g = this.stroke?.obj.geometry;
    this.bvhDirty = true;
    if (this.maskOverlay.visible && g?.attributes.mask) this.maskOverlay.geometry = g;
    this.requestRender();
  }
  endStroke() {
    const s = this.stroke; this.stroke = null; if (!s) return;
    const rec = this.engine.end();
    const g = s.obj.geometry;
    g.boundsTree?.refit(); g.computeBoundingSphere(); g.computeBoundingBox();
    if (rec) { const und = rec.undo, red = rec.redo; rec.undo = () => { und(); g.boundsTree?.refit(); }; rec.redo = () => { red(); g.boundsTree?.refit(); }; }
    this.doc.pushRecord(rec);
    this.syncMask();
  }

  // ------------------------------------------------------------------------- face selection strokes
  bindFaces() {
    const o = this.doc.selected;
    if (!isMesh(o)) { this.faceOverlay.visible = false; return; }
    if (this.faces.geo !== o.geometry || this.faces.topo !== (o.geometry.userData.topo || 0)) this.faces.bind(o.geometry);
    this.syncFaceOverlay();
  }
  beginFaceStroke(hit, e, start) {
    this.bindFaces();
    this.faceDrag = { obj: hit.obj, value: e.ctrlKey || e.metaKey || e.button === 2 ? 0 : (e.shiftKey ? 1 : this.faceTool.value), before: Uint8Array.from(this.faces.sel) };
    this.drag = { kind: 'faces', ...start };
    this.paintFaces(hit);
  }
  paintFaces(hit) {
    const o = this.faceDrag.obj;
    const r = this.localRadius(o, this.faceTool.radiusPx * this.worldPerPixel(hit.point));
    this.faces.paint(this.toLocal(o, hit.point).toArray(), r, this.faceDrag.value);
    if (hit.faceIndex != null) this.faces.sel[hit.faceIndex] = this.faceDrag.value;
    this.syncFaceOverlay(); this.requestRender();
  }
  faceMove(e) { const hit = this.pick(e, this.faceDrag.obj); if (hit) this.paintFaces(hit); }
  endFaceStroke() {
    const fd = this.faceDrag; this.faceDrag = null; if (!fd) return;
    const after = Uint8Array.from(this.faces.sel), before = fd.before, faces = this.faces, geo = faces.geo;
    const apply = (s) => { if (faces.geo === geo) { faces.sel.set(s); faces.version++; this.syncFaceOverlay(); } };
    this.doc.pushRecord({ label: 'Select faces', bytes: after.length * 2, undo: () => apply(before), redo: () => apply(after) });
    this.host.onFacesChanged?.();
  }
  syncFaceOverlay() {
    const o = this.doc.selected;
    if (this.mode !== 'edit' || !isMesh(o) || !this.faces.geo) { this.faceOverlay.visible = false; return; }
    const idx = this.faces.selectedIndex();
    const g = this.faceOverlay.geometry;
    if (g.attributes.position !== o.geometry.attributes.position) { g.setAttribute('position', o.geometry.attributes.position); }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.faceOverlay.visible = idx.length > 0;
    this.faceOverlay.matrixAutoUpdate = false;
    this.faceOverlay.matrix.copy(o.matrixWorld); this.faceOverlay.matrixWorldNeedsUpdate = true;
    this.requestRender();
  }
  syncMask() {
    const o = this.doc.selected;
    const show = this.mode === 'sculpt' && isMesh(o) && o.visible && !!o.geometry.attributes.mask;
    this.maskOverlay.visible = show;
    if (show) { this.maskOverlay.geometry = o.geometry; this.maskOverlay.matrixAutoUpdate = false; this.maskOverlay.matrix.copy(o.matrixWorld); this.maskOverlay.matrixWorldNeedsUpdate = true; }
    this.requestRender();
  }

  // ------------------------------------------------------------------------- gizmo & helpers
  syncGizmo() {
    const o = this.doc.selected;
    const show = !!o && o.visible && !o.ed.locked && (this.mode === 'object' || this.mode === 'animate') && this.gizmoMode !== 'none' && !this.placement;
    if (show) { if (this.gizmo.object !== o) this.gizmo.attach(o); this.gizmo.setMode(this.gizmoMode || 'translate'); }
    else if (this.gizmo.object) this.gizmo.detach();
    this.gizmoHelper.visible = show;
  }
  syncHelpers() {
    // light handles (pickable)
    const lights = this.doc.objects.filter(isLight);
    const have = new Map(this.helpers.children.map((c) => [c.userData.lightOf, c]));
    for (const [l, hm] of have) if (!lights.includes(l)) { this.helpers.remove(hm); hm.geometry.dispose(); }
    for (const l of lights) {
      let hm = have.get(l);
      if (!hm) {
        hm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.6 }));
        hm.add(ring);
        if (l.ed.lightType !== 'point') { const dir = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -0.45)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 })); hm.add(dir); }
        hm.userData.lightOf = l; this.helpers.add(hm);
      }
      hm.material.color.copy(l.ed.light.color);
      hm.visible = l.visible && this.mode !== 'sculpt' && this.mode !== 'paint';
    }
    this.syncWire(); this.syncMask(); this.syncFaceOverlay();
  }
  syncWire() {
    const want = this.render.wireframe ? this.doc.meshes.filter((o) => o.visible) : [];
    const cur = new Map(this.wires.children.map((w) => [w.userData.of, w]));
    for (const [o, w] of cur) if (!want.includes(o)) this.wires.remove(w);
    for (const o of want) { let w = cur.get(o); if (!w) { w = new THREE.Mesh(o.geometry, this.wireMat); w.userData.of = o; w.matrixAutoUpdate = false; this.wires.add(w); } }
  }
  updateOverlays() {
    for (const hm of this.helpers.children) { const l = hm.userData.lightOf; l.updateWorldMatrix(true, false); hm.matrixAutoUpdate = false; hm.matrix.copy(l.matrixWorld); const s = new THREE.Vector3(); hm.matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), s); hm.matrix.scale(new THREE.Vector3(1 / s.x, 1 / s.y, 1 / s.z).multiplyScalar(Math.max(0.3, this.cam.distance / 7))); hm.matrixWorldNeedsUpdate = true; }
    for (const w of this.wires.children) { const o = w.userData.of; w.geometry = o.geometry; w.matrix.copy(o.matrixWorld); w.matrixWorldNeedsUpdate = true; }
    const o = this.doc.selected;
    if (this.faceOverlay.visible && o) { this.faceOverlay.matrix.copy(o.matrixWorld); this.faceOverlay.matrixWorldNeedsUpdate = true; }
    if (this.maskOverlay.visible && o) { this.maskOverlay.matrix.copy(o.matrixWorld); this.maskOverlay.matrixWorldNeedsUpdate = true; }
    // outline around the selection
    const showB = !!o && o.visible && isMesh(o) && (this.mode === 'object' || this.mode === 'animate');
    this.brackets.visible = showB;
    if (showB) {
      this.brackets.geometry = o.geometry;
      this.brackets.matrix.copy(o.matrixWorld); this.brackets.matrixWorldNeedsUpdate = true;
      const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.outlineMat.uniforms.uRes.value.copy(sz);
      this.outlineMat.uniforms.uWidth.value = 2.2 * this.renderer.getPixelRatio();
    }
    // grid follows the camera target
    const fade = Math.max(4, this.cam.distance * 4);
    this.grid.scale.setScalar(fade * 2.2); this.grid.position.set(this.cam.target.x, 0, this.cam.target.z);
    this.gridMat.uniforms.uFade.value = fade; this.gridMat.uniforms.uCenter.value.copy(this.cam.target);
  }

  // ------------------------------------------------------------------------- shading modes
  modeMaterial(o) {
    const sh = this.render.shading, vc = !!o.geometry.attributes.color && o.material.vertexColors;
    if (sh === 'UNLIT') {
      let m = this.unlitMats.get(o.material);
      if (!m) { m = new THREE.MeshBasicMaterial(); this.unlitMats.set(o.material, m); }
      m.color.copy(o.material.color); m.map = o.material.map; m.vertexColors = vc; m.transparent = o.material.transparent; m.opacity = o.material.opacity; m.alphaTest = o.material.alphaTest; m.side = o.material.side;
      if (m.version === 0 || m.userData.key !== `${!!m.map}${vc}`) { m.userData.key = `${!!m.map}${vc}`; m.needsUpdate = true; }
      return m;
    }
    const key = sh + (vc ? 'c' : '') + this.render.matcap + (o.material.side === THREE.DoubleSide ? 'd' : '');
    let m = this.shadingMats.get(key);
    if (!m) {
      if (sh === 'MATCAP') m = new THREE.MeshMatcapMaterial({ matcap: matcapTexture(this.render.matcap), vertexColors: vc });
      else if (sh === 'NORMALS') m = new THREE.MeshNormalMaterial();
      else m = new THREE.MeshStandardMaterial({ color: 0xcfcac4, roughness: 0.85, metalness: 0, vertexColors: vc });
      m.side = o.material.side;
      this.shadingMats.set(key, m);
    }
    return m;
  }
  clearShadingCache() { for (const m of this.shadingMats.values()) m.dispose(); this.shadingMats.clear(); }

  // ------------------------------------------------------------------------- loop
  requestRender() { this.needsRender = true; }
  loop(now) {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    if (this.camAnim) { this.camAnim(now); this.needsRender = true; }
    this.host.onFrame?.(now);
    if (!this.needsRender) return;
    this.needsRender = false;
    if (this.bvhDirty && !this.stroke) this.bvhDirty = false;
    else if (this.bvhDirty && this.stroke && now - (this.lastRefit || 0) > 50) { this.stroke.obj.geometry.boundsTree?.refit(); this.lastRefit = now; }
    this.draw(this.camera);
  }
  draw(camera, target = null) {
    this.doc.root.updateMatrixWorld(true);
    this.updateOverlays();
    const swap = [];
    if (this.render.shading !== 'PBR') for (const o of this.doc.meshes) { swap.push([o, o.material]); o.material = this.modeMaterial(o); }
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, camera);
    this.renderer.setRenderTarget(null);
    for (const [o, m] of swap) o.material = m;
  }

  /** PNG thumbnail of the current scene (square, framed). */
  async thumbnail(size = 512) {
    const box = frameBounds(this.doc.objects);
    const cam = new THREE.PerspectiveCamera(this.render.fov, 1, 0.01, 1000);
    const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1) : box.getBoundingSphere(new THREE.Sphere());
    const d = Math.max(0.05, sphere.radius) / Math.sin(THREE.MathUtils.degToRad(this.render.fov) / 2) * 1.2;
    const y = THREE.MathUtils.degToRad(this.cam.yaw), p = THREE.MathUtils.degToRad(Math.max(-60, Math.min(60, this.cam.pitch)));
    cam.position.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(d).add(sphere.center);
    cam.lookAt(sphere.center); cam.near = d / 100; cam.far = d * 10; cam.updateProjectionMatrix();
    const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const vis = [this.grid.visible, this.axes.visible, this.gizmoHelper.visible, this.brackets.visible, this.helpers.visible, this.faceOverlay.visible, this.maskOverlay.visible, this.wires.visible];
    this.grid.visible = this.axes.visible = this.gizmoHelper.visible = this.helpers.visible = this.faceOverlay.visible = this.maskOverlay.visible = this.wires.visible = false;
    this.doc.root.updateMatrixWorld(true);
    this.brackets.visible = false;
    const swap = [];
    if (this.render.shading !== 'PBR') for (const o of this.doc.meshes) { swap.push([o, o.material]); o.material = this.modeMaterial(o); }
    this.renderer.setRenderTarget(rt); this.renderer.render(this.scene, cam); this.renderer.setRenderTarget(null);
    for (const [o, m] of swap) o.material = m;
    [this.grid.visible, this.axes.visible, this.gizmoHelper.visible, this.brackets.visible, this.helpers.visible, this.faceOverlay.visible, this.maskOverlay.visible, this.wires.visible] = vis;
    const px = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    rt.dispose();
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
    for (let row = 0; row < size; row++) img.data.set(px.subarray((size - 1 - row) * size * 4, (size - row) * size * 4), row * size * 4);
    ctx.putImageData(img, 0, 0);
    this.requestRender();
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return blob.arrayBuffer();
  }
  dispose() { this.disposed = true; this.ro?.disconnect(); this.gizmo.dispose(); this.envTex?.dispose(); this.pmrem.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss?.(); }
}

/** Equirect-ish gradient environments (sky / ground / a few soft light panels). */
function gradientEnv(id) {
  const cfg = {
    SUNSET: { top: 0x3b4a8a, mid: 0xff9a5c, bottom: 0x2a1a22, panels: [[0xffd2a1, 10, [6, 2, -4]]] },
    OVERCAST: { top: 0xdfe5ee, mid: 0xc4cad4, bottom: 0x6f737a, panels: [[0xffffff, 2.5, [0, 8, 0]]] },
    NIGHT: { top: 0x050815, mid: 0x18233f, bottom: 0x04050a, panels: [[0x9db4ff, 3, [-5, 6, 3]]] },
    NEON: { top: 0x12061f, mid: 0x2a0c3d, bottom: 0x07020c, panels: [[0xff2bd6, 14, [-6, 1.5, 0]], [0x00e5ff, 14, [6, 1.5, 0]]] },
  }[id];
  const s = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(cfg.top) }, mid: { value: new THREE.Color(cfg.mid) }, bottom: { value: new THREE.Color(cfg.bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(mid, top, pow(y, 0.6)) : mix(mid, bottom, pow(-y, 0.4)); gl_FragColor = vec4(c, 1.0); }',
  });
  s.add(new THREE.Mesh(geo, mat));
  for (const [color, intensity, p] of cfg.panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...p); m.lookAt(0, 0, 0); s.add(m);
  }
  return s;
}
