// WebGL viewport: renderer, environments, orbit camera, picking & box selection, the transform
// gizmo (single object, multi-selection pivot, or the push/pull handle in Faces mode),
// sculpt/paint/face strokes, overlays (selection outlines, mask, face selection, wireframe,
// light/camera/empty helpers, measure), the navigation gizmo, thumbnails and image renders.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { isMesh, isLight, isCamera, isGroup, frameBounds } from './model.js';
import { matcapTexture } from './textures.js';
import { SculptEngine } from '../core/sculpt.js';
import { texelDensity, sampleColor } from './texpaint.js';
import { FaceSelection } from '../core/faces.js';

export const ENVS = [['STUDIO', 'Studio'], ['PHOTO', 'Photo studio'], ['DAYLIGHT', 'Daylight'], ['CITY', 'City street'], ['FOREST', 'Forest'], ['INTERIOR', 'Apartment'], ['GOLDEN', 'Golden hour'], ['DAWN', 'Dawn'], ['SUNSET', 'Sunset'], ['OVERCAST', 'Overcast'], ['NIGHT', 'Night'], ['NEON', 'Neon'], ['DARK', 'Lights only']];
/** Real-world HDR panoramas (CC0, Poly Haven) shipped in hdri/. */
export const HDRIS = { PHOTO: 'studio_small_03_1k', DAYLIGHT: 'rooitou_park_1k', PARK: 'rooitou_park_1k', CITY: 'potsdamer_platz_1k', FOREST: 'forest_slope_1k', INTERIOR: 'lebombo_1k', GOLDEN: 'venice_sunset_1k', DAWN: 'kiara_1_dawn_1k' };
const hdrCache = new Map();
function loadHdr(name) { if (!hdrCache.has(name)) hdrCache.set(name, new RGBELoader().loadAsync(`hdri/${name}.hdr`).then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; return t; })); return hdrCache.get(name); }
export const SHADING = [['PBR', 'Realistic', 'sun'], ['MATCAP', 'Matcap', 'circle'], ['FLAT_CLAY', 'Clay', 'cloud'], ['NORMALS', 'Normals', 'compass'], ['UNLIT', 'Unlit', 'lightbulb-off']];
export const BACKGROUNDS = [[0x2B2E3A, 0x101116], [0x3a3f4f, 0x1b1d24], [0xf2f2f5, 0xc9cad2], [0x1d2b4a, 0x070a12], [0x4a2f5c, 0x120a1a], [0x000000, 0x000000]];
/** Axis colours: standard (red/green/blue) and colour-blind safe (Okabe–Ito vermillion/yellow/blue). */
export const AXIS_COLORS = { standard: [0xff5a67, 0x7cdb72, 0x5b95ff], cvd: [0xe86a10, 0xf0e442, 0x2f8fdb] };

export function defaultRender() {
  return { shading: 'PBR', matcap: 0, env: 'STUDIO', exposure: 1, lightAngle: -40, lightHeight: 45, shadows: true, grid: true, wireframe: false, bgTop: 0x2B2E3A, bgBottom: 0x101116, ortho: false, fov: 45, axes: true, envRotation: 0, envIntensity: 1, xray: false, ao: true, envBg: false, envBlur: 0.04 };
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
    this.faceTool = { value: 1, radiusPx: 30, mode: 'pick' };
    this.placement = null; // { onPick(hit) }
    this.measure = null; // { a, b, live }
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
      uniforms: { uColor: { value: new THREE.Color(0x9aa0b4) }, uFade: { value: 20 }, uCenter: { value: new THREE.Vector3() }, uAlpha: { value: 1 }, uStep: { value: 0.1 }, uX: { value: new THREE.Color(1.0, 0.36, 0.42) }, uZ: { value: new THREE.Color(0.36, 0.58, 1.0) } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uColor; uniform float uFade; uniform vec3 uCenter; uniform float uAlpha; uniform float uStep; uniform vec3 uX; uniform vec3 uZ; varying vec3 vW;
        float grid(vec2 p, float s){ vec2 g = abs(fract(p / s - 0.5) - 0.5) / fwidth(p / s); return 1.0 - min(min(g.x, g.y), 1.0); }
        void main(){
          float d = length(vW.xz - uCenter.xz);
          float fade = 1.0 - smoothstep(uFade * 0.25, uFade, d);
          float a = max(grid(vW.xz, uStep) * 0.10, grid(vW.xz, uStep * 10.0) * 0.32);
          vec2 ax = abs(vW.xz) / fwidth(vW.xz);
          vec3 col = uColor;
          if (ax.y < 1.0) { col = uX; a = 0.75; }
          if (ax.x < 1.0) { col = uZ; a = 0.75; }
          gl_FragColor = vec4(col, a * fade * uAlpha);
          if (gl_FragColor.a < 0.004) discard;
        }`,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.gridMat);
    this.grid.renderOrder = -2; this.grid.frustumCulled = false;
    this.axes = new THREE.Group();
    s.add(this.grid, this.axes);

    // selection outlines (inverted hull, constant screen width): active object brighter
    const outline = (color, alpha) => new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, transparent: true,
      uniforms: { uColor: { value: new THREE.Color(color) }, uWidth: { value: 2.2 }, uRes: { value: new THREE.Vector2(1, 1) }, uAlpha: { value: alpha } },
      vertexShader: `uniform float uWidth; uniform vec2 uRes;
        void main(){ vec4 c = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal); vec4 cn = projectionMatrix * vec4(n, 0.0);
          vec2 dir = cn.xy; float l = length(dir); dir = l > 1e-6 ? dir / l : vec2(0.0);
          c.xy += dir * uWidth * 2.0 / uRes * c.w; gl_Position = c; }`,
      fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; void main(){ gl_FragColor = vec4(uColor, uAlpha); }',
    });
    this.outlineMat = outline(0xa592ff, 1); this.outlineMat2 = outline(0x7d6be0, 0.75);
    this.outlines = new THREE.Group(); s.add(this.outlines);
    this.brackets = { visible: false }; // kept for compatibility (old single outline)

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
    // measure overlay
    this.measureGroup = new THREE.Group(); this.measureGroup.visible = false; this.measureGroup.renderOrder = 20;
    const mm = new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true });
    this.measureLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), mm);
    this.measureLine.frustumCulled = false;
    const dot = () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true })); m.renderOrder = 21; return m; };
    this.measureA = dot(); this.measureB = dot();
    this.measureGroup.add(this.measureLine, this.measureA, this.measureB); s.add(this.measureGroup);
    this.measureLabel = document.createElement('div'); this.measureLabel.className = 'measure-label'; this.measureLabel.setAttribute('role', 'status'); this.measureLabel.style.display = 'none';
    canvas.parentElement?.appendChild(this.measureLabel);
    // box select rectangle
    this.boxEl = document.createElement('div'); this.boxEl.className = 'boxsel'; this.boxEl.style.display = 'none';
    canvas.parentElement?.appendChild(this.boxEl);
    // straight-line preview for the paint line tool
    this.lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); this.lineEl.setAttribute('class', 'lineprev'); this.lineEl.style.display = 'none';
    this.lineEl.innerHTML = '<line stroke-linecap="round"/><line class="core" stroke-linecap="round"/>';
    canvas.parentElement?.appendChild(this.lineEl);

    // gizmo (also drives the multi-selection pivot and the push/pull handle)
    this.pivot = new THREE.Object3D(); this.pivot.name = 'pivot'; s.add(this.pivot);
    this.ppProxy = new THREE.Object3D(); this.ppProxy.name = 'pushpull'; s.add(this.ppProxy);
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmoHelper = this.gizmo.getHelper();
    s.add(this.gizmoHelper);
    this.gizmoHelper.traverse((n) => { const m = n.material; if (!m || m.userData.axis != null) return; const hx = m.color?.getHex(); m.userData.axis = hx === 0xff0000 ? 0 : hx === 0x00ff00 ? 1 : hx === 0x0000ff ? 2 : -1; });
    this.gizmo.addEventListener('dragging-changed', (e) => this.onGizmoDrag(e.value));
    this.gizmo.addEventListener('objectChange', () => { this.onGizmoMove(); this.requestRender(); });
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
    this.nav = new NavGizmo(this);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------------- render settings
  applyRender() {
    const rs = this.render, r = this.renderer;
    r.toneMappingExposure = rs.exposure;
    this.updateBackground();
    this.setEnv(rs.env);
    this.grid.visible = rs.grid;
    this.ground.visible = rs.shadows; this.key.castShadow = rs.shadows;
    this.persp.fov = rs.fov; this.persp.updateProjectionMatrix();
    this.camera = rs.ortho ? this.ortho : this.persp;
    this.gizmo.camera = this.camera;
    this.updateKeyLight();
    this.syncWire();
    this.requestRender();
  }
  /** Axis colours for the grid, the gizmo and the navigation gizmo (colour-blind safe option). */
  setAxisColors(scheme = 'standard') {
    const c = AXIS_COLORS[scheme] || AXIS_COLORS.standard;
    this.axisColors = c;
    this.gridMat.uniforms.uX.value.setHex(c[0]); this.gridMat.uniforms.uZ.value.setHex(c[2]);
    this.gizmoHelper.traverse((n) => { const m = n.material; if (!m || !(m.userData.axis >= 0)) return; m.color.setHex(c[m.userData.axis]); if (m._color) m._color.setHex(c[m.userData.axis]); });
    this.navDirty = true; this.requestRender();
  }
  updateBackground() {
    const rs = this.render, c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const ctx = c.getContext('2d'), g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + rs.bgTop.toString(16).padStart(6, '0')); g.addColorStop(1, '#' + rs.bgBottom.toString(16).padStart(6, '0'));
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
    if (this.scene.background?.isCanvasTexture) this.scene.background.dispose();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.bgTex = t;
    if (rs.envBg && this.envEquirect) return; // panorama background stays
    this.scene.background = t; this.scene.backgroundBlurriness = 0; this.scene.backgroundIntensity = 1;
    const lum = ((rs.bgTop >> 16 & 255) + (rs.bgTop >> 8 & 255) + (rs.bgTop & 255)) / 765;
    this.gridMat.uniforms.uColor.value.set(lum > 0.6 ? 0x3c3f4a : 0x9aa0b4);
  }
  setEnv(id) {
    const rs = this.render;
    if (this.envId === id && (this.scene.environment || id === 'DARK')) { this.scene.environmentRotation.y = THREE.MathUtils.degToRad(rs.envRotation || 0); this.scene.environmentIntensity = rs.envIntensity ?? 1; this.applyEnvBackground(); return; }
    this.envId = id;
    if (this.envTex) { this.envTex.dispose(); this.envTex = null; }
    this.envEquirect = null;
    if (id === 'DARK') { this.scene.environment = null; this.hemi.intensity = 0.06; this.key.intensity = 0.25; this.applyEnvBackground(); return; }
    this.hemi.intensity = 0;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(rs.envRotation || 0);
    this.scene.environmentIntensity = rs.envIntensity ?? 1;
    this.key.intensity = { STUDIO: 1.6, SUNSET: 2.2, OVERCAST: 0.9, NIGHT: 0.6, NEON: 0.8, PHOTO: 0.8, DAYLIGHT: 1.6, CITY: 1.1, PARK: 1.6, FOREST: 1.0, INTERIOR: 0.7, GOLDEN: 1.6, DAWN: 1.0 }[id] ?? 1.5;
    this.key.color.set({ SUNSET: 0xffc79a, GOLDEN: 0xffcf9e, DAWN: 0xffd9c2, NIGHT: 0x9db4ff }[id] ?? 0xffffff);
    if (HDRIS[id]) {
      const want = id;
      this.envReady = loadHdr(HDRIS[id]).then((eq) => {
        if (this.disposed || this.envId !== want) return;
        if (this.envTex) this.envTex.dispose();
        this.envTex = this.pmrem.fromEquirectangular(eq).texture;
        this.envEquirect = eq;
        this.scene.environment = this.envTex;
        this.applyEnvBackground(); this.requestRender();
      }).catch((e) => console.warn('HDRI', e));
      return;
    }
    const envScene = id === 'STUDIO' ? new RoomEnvironment() : gradientEnv(id);
    this.envTex = this.pmrem.fromScene(envScene, 0.035).texture;
    this.scene.environment = this.envTex;
    this.envReady = Promise.resolve();
    this.applyEnvBackground();
  }
  /** Shows the HDR panorama behind the model (optional) or the gradient backdrop. */
  applyEnvBackground() {
    const rs = this.render;
    if (rs.envBg && this.envEquirect) {
      if (this.scene.background && this.scene.background !== this.envEquirect) this.scene.background.dispose?.();
      this.scene.background = this.envEquirect;
      this.scene.backgroundBlurriness = rs.envBlur ?? 0.04;
      this.scene.backgroundIntensity = rs.envIntensity ?? 1;
      this.scene.backgroundRotation.y = THREE.MathUtils.degToRad(rs.envRotation || 0);
    } else if (!this.scene.background || this.scene.background === this.envEquirect || this.scene.background.isDataTexture) this.updateBackground();
  }
  updateKeyLight() {
    const rs = this.render, box = frameBounds(this.doc.objects, this.doc);
    const c = box.isEmpty() ? new THREE.Vector3(0, 0.5, 0) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 2 : Math.max(1, box.getSize(new THREE.Vector3()).length());
    const a = THREE.MathUtils.degToRad(rs.lightAngle), e = THREE.MathUtils.degToRad(rs.lightHeight);
    this.key.position.set(c.x + Math.sin(a) * Math.cos(e) * size * 2, c.y + Math.sin(e) * size * 2, c.z + Math.cos(a) * Math.cos(e) * size * 2);
    this.key.target.position.copy(c);
    const sc = this.key.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 0.01; sc.far = size * 5; sc.updateProjectionMatrix();
    const y = box.isEmpty() ? 0 : Math.min(0, box.min.y);
    this.ground.position.set(c.x, y - 0.0005, c.z); this.ground.scale.setScalar(size * 6);
    this.setAORadius(THREE.MathUtils.clamp(size * 0.035, 0.015, 1.2));
  }

  // ------------------------------------------------------------------------- camera
  resize() {
    const p = this.canvas.parentElement; const w = p.clientWidth, hh = p.clientHeight;
    if (!w || !hh) return;
    this.renderer.setSize(w, hh, false);
    this.composer?.setSize(w, hh);
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
    this.navDirty = true;
  }
  frame(objs = null, animate = true) {
    const list = objs || (this.doc.selection.length ? this.doc.selection : this.doc.objects);
    let box = frameBounds(list, this.doc);
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
    if (!animate || document.documentElement.classList.contains('reduce-motion')) { this.camAnim = null; Object.assign(this.cam, goal); this.updateCamera(); this.requestRender(); return; }
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
  orbitBy(dYaw, dPitch) { this.camAnim = null; this.cam.yaw += dYaw; this.cam.pitch = Math.max(-89.9, Math.min(89.9, this.cam.pitch + dPitch)); this.updateCamera(); this.requestRender(); }
  zoomBy(k) { this.camAnim = null; this.cam.distance = Math.max(0.01, Math.min(5000, this.cam.distance * k)); this.updateCamera(); this.requestRender(); }
  /** Puts the orbit camera at a camera object's position, looking where it looks. */
  lookThrough(o) {
    o.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(); o.matrixWorld.decompose(pos, q, new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const dist = Math.max(0.5, this.cam.distance);
    const pitch = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, -fwd.y))));
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(-fwd.x, -fwd.z));
    if (o.ed?.camera) { this.render.fov = o.ed.camera.fov; this.render.ortho = false; this.applyRender(); }
    this.animateCam({ yaw, pitch, distance: dist, target: pos.clone().addScaledVector(fwd, dist) });
  }

  // ------------------------------------------------------------------------- picking
  ndc(e) { const r = this.canvas.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); }
  pick(e, onlyObj = null) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const targets = onlyObj ? [onlyObj] : [...this.doc.meshes.filter((o) => this.doc.isShown(o)), ...this.helpers.children.filter((h) => h.visible)];
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const hit of hits) {
      const o = hit.object.userData.helperOf || hit.object;
      if (o.visible !== false) return { ...hit, obj: o };
    }
    return null;
  }
  /** Point under the cursor on a surface, or on the ground plane. */
  pickPoint(e) {
    const hit = this.pick(e);
    if (hit && isMesh(hit.obj)) return hit.point.clone();
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }
  worldPerPixel(point) {
    const hh = this.canvas.clientHeight || 1;
    if (this.camera.isOrthographicCamera) return (this.ortho.top - this.ortho.bottom) / hh;
    const d = this.camera.position.distanceTo(point);
    return 2 * d * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2) / hh;
  }
  toScreen(p) { const v = p.clone().project(this.camera); const r = this.canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, z: v.z }; }

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
    c.addEventListener('dblclick', (e) => { if ((this.mode === 'object' || this.mode === 'animate') && !this.measure && !this.placement) { const hit = this.pick(e); if (hit) this.host.onDeepPick?.(hit.obj, e); } });
  }
  onDown(e) {
    this.canvas.focus({ preventScroll: true });
    if (this.drag) return;
    if (this.gizmo.dragging || (this.gizmo.axis && this.gizmoHelper.visible && e.button === 0)) return;
    const nav = e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey);
    this.canvas.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, moved: false, t: performance.now() };
    if (nav) { this.drag = { kind: e.button === 1 || (e.button === 2 && e.shiftKey) ? 'pan' : 'orbit', ...start }; return; }
    if (e.button !== 0) return;
    if (this.placement) { const hit = this.pick(e); this.placement.onPick(hit, e); this.drag = { kind: 'none', ...start }; return; }
    if (this.measure) { this.measureClick(e); this.drag = { kind: 'none', ...start }; return; }
    if (this.eyedrop) { const hit = this.pick(e); const cb = this.eyedrop; this.setEyedrop(null); if (hit && isMesh(hit.obj)) cb(sampleColor(hit)); this.drag = { kind: 'none', ...start }; return; }
    const sel = this.doc.selected;
    if (this.mode === 'paint' && isMesh(sel) && this.doc.isShown(sel)) {
      const b = this.brush;
      if (b.line) { this.drag = { kind: 'paintline', from: { x: e.clientX, y: e.clientY }, pressure: e.pointerType === 'pen' ? e.pressure : 1, ...start }; this.showLine(e.clientX, e.clientY, e.clientX, e.clientY); return; }
      if (e.shiftKey && this.lastPaint && this.lastPaint.obj === sel) { const from = this.toScreen(this.lastPaint.p); this.paintLine(from.x, from.y, e.clientX, e.clientY, e); this.drag = { kind: 'none', ...start }; return; }
      const hit = this.pick(e, sel);
      if (hit) { if (this.paintBegin(hit, e)) this.drag = { kind: 'paint', ...start }; else this.drag = { kind: 'none', ...start }; return; }
    }
    if (this.mode === 'sculpt' && isMesh(sel) && this.doc.isShown(sel)) {
      const hit = this.pick(e, sel);
      if (hit) { this.beginStroke(hit, e, start); return; }
    }
    if (this.mode === 'edit' && isMesh(sel) && this.doc.isShown(sel)) {
      const hit = this.pick(e, sel);
      if (hit) {
        if (this.faceTool.mode === 'pick') { this.drag = { kind: 'maybe-face', hit, ...start }; return; }
        this.beginFaceStroke(hit, e, start); return;
      }
    }
    const objectMode = this.mode === 'object' || this.mode === 'animate';
    this.drag = { kind: objectMode && (start.ctrl || this.gizmoMode === 'none') ? 'maybe-box' : 'maybe-orbit', ...start };
  }
  onMove(e) {
    this.pointer = { x: e.clientX, y: e.clientY, inside: true };
    const d = this.drag;
    if (!d) { this.hover(e); if (this.measure && this.measure.a && !this.measure.b) this.measureHover(e); return; }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 3) d.moved = true;
    if ((d.kind === 'maybe-orbit' || d.kind === 'maybe-face') && d.moved) d.kind = e.shiftKey ? 'pan' : 'orbit';
    if (d.kind === 'maybe-box' && d.moved) d.kind = 'box';
    if (d.kind === 'orbit') {
      this.cam.yaw -= (e.movementX || 0) * 0.35; this.cam.pitch = Math.max(-89.9, Math.min(89.9, this.cam.pitch + (e.movementY || 0) * 0.35));
      this.camAnim = null; this.updateCamera(); this.requestRender();
    } else if (d.kind === 'pan') {
      const wpp = this.worldPerPixel(this.cam.target);
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      this.cam.target.addScaledVector(right, -(e.movementX || 0) * wpp).addScaledVector(up, (e.movementY || 0) * wpp);
      this.camAnim = null; this.updateCamera(); this.requestRender();
    } else if (d.kind === 'box') {
      const r = this.canvas.getBoundingClientRect();
      Object.assign(this.boxEl.style, { display: 'block', left: Math.min(d.x, e.clientX) - r.left + 'px', top: Math.min(d.y, e.clientY) - r.top + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
    } else if (d.kind === 'paintline') this.showLine(d.from.x, d.from.y, e.clientX, e.clientY);
    else if (d.kind === 'paint') this.paintMove(e);
    else if (d.kind === 'stroke') this.strokeMove(e);
    else if (d.kind === 'faces') this.faceMove(e);
  }
  onUp(e) {
    const d = this.drag; this.drag = null;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d) return;
    if (d.kind === 'stroke') this.endStroke();
    else if (d.kind === 'paint') this.paintEnd();
    else if (d.kind === 'paintline') { this.lineEl.style.display = 'none'; if (d.moved) this.paintLine(d.from.x, d.from.y, e.clientX, e.clientY, e, d.pressure); else { const hit = this.pick(e, this.doc.selected); if (hit && this.paintBegin(hit, e)) this.paintEnd(); } }
    else if (d.kind === 'faces') this.endFaceStroke();
    else if (d.kind === 'box') { this.boxEl.style.display = 'none'; this.host.onBoxSelect?.(this.boxSelect(d.x, d.y, e.clientX, e.clientY), e); }
    else if (d.kind === 'maybe-face' && !d.moved) this.host.onFacePick?.(d.hit, e);
    else if (d.kind === 'orbit' && !d.moved && d.alt && d.button === 0 && (this.mode === 'object' || this.mode === 'animate')) { const hit = this.pick(e); this.host.onPickObject?.(hit ? hit.obj : null, e, hit); }
    else if ((d.kind === 'maybe-orbit' || d.kind === 'maybe-box') && !d.moved && d.button === 0) {
      // click: select
      const hit = this.pick(e);
      if (this.mode === 'object' || this.mode === 'animate' || !hit || hit.obj !== this.doc.selected) this.host.onPickObject?.(hit ? hit.obj : null, e, hit);
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
    if (!this.eyedrop && (this.mode === 'sculpt' || this.mode === 'paint' || (this.mode === 'edit' && this.faceTool.mode === 'brush')) && isMesh(sel)) {
      const r = this.mode === 'edit' ? this.faceTool.radiusPx : this.brush?.radiusPx || 60;
      this.host.onBrushCursor?.({ x: e.clientX, y: e.clientY, r, neg: this.mode === 'edit' ? this.faceTool.value === 0 : (this.brush?.negative !== (e.ctrlKey || e.metaKey)) });
    } else this.host.onBrushCursor?.(null);
  }
  /** Objects with any sampled vertex (or helper origin) inside the screen rectangle. */
  boxSelect(x0, y0, x1, y1) {
    const r = this.canvas.getBoundingClientRect();
    const toN = (x, y) => [((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1];
    const [ax, ay] = toN(x0, y0), [bx, by] = toN(x1, y1);
    const minX = Math.min(ax, bx), maxX = Math.max(ax, bx), minY = Math.min(ay, by), maxY = Math.max(ay, by);
    const inside = (v) => v.z > -1 && v.z < 1 && v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY;
    const out = [], v = new THREE.Vector3();
    this.doc.root.updateMatrixWorld(true);
    for (const o of this.doc.objects) {
      if (!this.doc.isShown(o)) continue;
      if (isMesh(o)) {
        const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 1500));
        for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).project(this.camera); if (inside(v)) { out.push(o); break; } }
      } else if (!isGroup(o) || !this.doc.children(o).length) { o.getWorldPosition(v).project(this.camera); if (inside(v)) out.push(o); }
    }
    return out;
  }

  // ------------------------------------------------------------------------- gizmo
  onGizmoDrag(on) {
    const g = this.gizmo.object;
    if (g === this.ppProxy) {
      if (on) { this.ppStart = this.ppProxy.position.clone(); this.host.onPushPull?.('start', 0); }
      else this.host.onPushPull?.('end', this.ppDistance());
      return;
    }
    if (on && g === this.pivot) {
      this.pivot.updateMatrixWorld(true);
      this.multiStart = { inv: this.pivot.matrixWorld.clone().invert(), items: this.doc.topSelected().filter((o) => !o.ed.locked).map((o) => { o.updateWorldMatrix(true, false); return { o, w: o.matrixWorld.clone() }; }) };
    }
    if (on) this.host.onGizmoStart?.(); else { this.host.onGizmoEnd?.(); this.multiStart = null; }
  }
  onGizmoMove() {
    const g = this.gizmo.object;
    if (g === this.ppProxy) { if (this.ppStart) this.host.onPushPull?.('move', this.ppDistance()); return; }
    if (g === this.pivot && this.multiStart) {
      this.pivot.updateMatrixWorld(true);
      const delta = this.pivot.matrixWorld.clone().multiply(this.multiStart.inv);
      for (const { o, w } of this.multiStart.items) {
        const nw = delta.clone().multiply(w);
        const pinv = o.parent.matrixWorld.clone().invert();
        pinv.multiply(nw).decompose(o.position, o.quaternion, o.scale);
      }
    }
    this.host.onGizmoChange?.();
  }
  /** Push/pull distance in the object's local units (along the face normal). */
  ppDistance() {
    const pp = this.pp; if (!pp || !this.ppStart) return 0;
    const dWorld = this.ppProxy.position.clone().sub(this.ppStart).dot(pp.nWorld);
    return dWorld / pp.worldPerLocal;
  }
  syncGizmo() {
    const d = this.doc, sel = d.topSelected().filter((o) => d.isShown(o) && !o.ed.locked);
    const objectMode = (this.mode === 'object' || this.mode === 'animate') && this.gizmoMode !== 'none' && !this.placement && !this.measure;
    let target = null;
    if (objectMode && sel.length === 1) target = sel[0];
    else if (objectMode && sel.length > 1) {
      if (!this.gizmo.dragging) { const box = frameBounds(sel, d); if (!box.isEmpty()) box.getCenter(this.pivot.position); this.pivot.quaternion.identity(); this.pivot.scale.set(1, 1, 1); this.pivot.updateMatrixWorld(true); }
      target = this.pivot;
    } else if (this.mode === 'edit' && this.faceTool.mode === 'pick' && this.syncPushPull()) target = this.ppProxy;
    const pp = target === this.ppProxy;
    this.gizmo.showX = !pp; this.gizmo.showZ = !pp;
    if (target) {
      if (this.gizmo.object !== target) this.gizmo.attach(target);
      if (pp) { this.gizmo.setMode('translate'); this.gizmo.setSpace('local'); }
      else { this.gizmo.setMode(this.gizmoMode || 'translate'); this.gizmo.setSpace(this.gizmoSpace || 'world'); }
    } else if (this.gizmo.object) this.gizmo.detach();
    this.gizmoHelper.visible = !!target;
  }
  /** Positions the push/pull handle on the selected faces; false if nothing is selected. */
  syncPushPull() {
    const o = this.doc.selected, f = this.faces;
    if (!isMesh(o) || !f.geo || f.geo !== o.geometry || f.isEmpty()) { this.pp = null; return false; }
    if (this.gizmo.dragging && this.gizmo.object === this.ppProxy) return true;
    const p = o.geometry.attributes.position.array, idx = o.geometry.index.array, c = new THREE.Vector3(); let n = 0;
    for (let t = 0; t < f.sel.length; t++) if (f.sel[t]) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k] * 3; c.x += p[v]; c.y += p[v + 1]; c.z += p[v + 2]; n++; }
    c.divideScalar(Math.max(1, n));
    o.updateWorldMatrix(true, false);
    const nl = new THREE.Vector3().fromArray(f.averageNormal());
    const nWorldRaw = nl.clone().transformDirection(o.matrixWorld); // normalized direction
    const m3 = new THREE.Matrix3().setFromMatrix4(o.matrixWorld);
    const worldPerLocal = nl.clone().applyMatrix3(m3).length() || 1;
    this.ppProxy.position.copy(c.applyMatrix4(o.matrixWorld));
    this.ppProxy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nWorldRaw);
    this.ppProxy.scale.set(1, 1, 1); this.ppProxy.updateMatrixWorld(true);
    this.pp = { nWorld: nWorldRaw, worldPerLocal };
    return true;
  }

  // ------------------------------------------------------------------------- measure
  setMeasure(on) {
    this.measure = on ? { a: null, b: null } : null;
    this.measureGroup.visible = false; this.measureLabel.style.display = 'none';
    this.canvas.style.cursor = on ? 'crosshair' : '';
    this.syncGizmo(); this.requestRender();
  }
  measureClick(e) {
    const p = this.pickPoint(e); if (!p) return;
    const m = this.measure;
    if (!m.a || m.b) { m.a = p; m.b = null; m.live = p.clone(); } else { m.b = p; }
    this.updateMeasure();
  }
  measureHover(e) { const p = this.pickPoint(e); if (p) { this.measure.live = p; this.updateMeasure(); } }
  updateMeasure() {
    const m = this.measure; if (!m?.a) { this.measureGroup.visible = false; this.measureLabel.style.display = 'none'; return; }
    const b = m.b || m.live || m.a;
    this.measureLine.geometry.setFromPoints([m.a, b]);
    this.measureA.position.copy(m.a); this.measureB.position.copy(b);
    this.measureGroup.visible = true;
    const d = m.a.distanceTo(b), dv = b.clone().sub(m.a);
    this.measureLabel.textContent = this.host.formatLength ? this.host.formatLength(d) + `   Δ ${this.host.formatLength(Math.abs(dv.x))} · ${this.host.formatLength(Math.abs(dv.y))} · ${this.host.formatLength(Math.abs(dv.z))}` : d.toFixed(3) + ' m';
    this.measureLabel.style.display = 'block';
    this.requestRender();
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

  // ------------------------------------------------------------------------- painting (texture or vertex colours)
  setEyedrop(cb) { this.eyedrop = cb; this.canvas.style.cursor = cb ? 'copy' : ''; this.host.onBrushCursor?.(null); }
  showLine(x0, y0, x1, y1) {
    const r = this.canvas.getBoundingClientRect(), b = this.brush, [l1, l2] = this.lineEl.children;
    for (const l of [l1, l2]) { l.setAttribute('x1', x0 - r.left); l.setAttribute('y1', y0 - r.top); l.setAttribute('x2', x1 - r.left); l.setAttribute('y2', y1 - r.top); }
    l1.setAttribute('stroke', b.hex || '#ffffff'); l1.setAttribute('stroke-width', Math.max(2, b.radiusPx * 2)); l1.setAttribute('stroke-opacity', '0.45');
    l2.setAttribute('stroke', '#ffffff'); l2.setAttribute('stroke-width', '1'); l2.setAttribute('stroke-dasharray', '4 4');
    this.lineEl.style.display = 'block';
  }
  /** Starts a paint stroke at a hit; false if the host refuses (e.g. no UVs yet). */
  paintBegin(hit, e) {
    const o = this.doc.selected, b = this.brush, tex = this.host.paintTarget?.() === 'texture';
    const s = { obj: o, tex, last: { x: e.clientX, y: e.clientY } };
    if (tex) { s.ts = this.host.onTexPaintBegin?.(o); if (!s.ts) return false; }
    else {
      const worldR = b.radiusPx * this.worldPerPixel(hit.point);
      s.r = this.localRadius(o, worldR);
      this.engine.symmetry = this.host.symmetry();
      this.engine.begin(o.geometry, 'PAINT', { ...b }, s.r);
      if (!o.material.vertexColors) { o.material.vertexColors = true; o.material.needsUpdate = true; }
    }
    this.stroke = s;
    this.paintDab(hit, this.pressureOf(e));
    return true;
  }
  pressureOf(e) { return e.pointerType === 'pen' && this.brush.usePressure ? Math.max(0.05, e.pressure || 0.5) : 1; }
  paintDab(hit, pressure = 1) {
    const s = this.stroke, b = this.brush; if (!s) return;
    this.lastPaint = { obj: s.obj, p: hit.point.clone() };
    if (s.tex) {
      if (!hit.uv) return;
      const worldR = b.radiusPx * this.worldPerPixel(hit.point) * (0.4 + 0.6 * pressure);
      const r = Math.max(0.6, Math.min(s.ts.c.width / 2, worldR * texelDensity(hit, s.obj, s.ts.t)));
      s.ts.dab(hit.uv, r, b.hex, b.intensity * pressure, b.hardness ?? 0.5, !!b.negative);
    } else this.engine.dab(this.toLocal(s.obj, hit.point).toArray(), s.r, pressure, null);
    this.requestRender();
  }
  /** Dabs along a screen-space segment, following the surface under it. */
  paintSegment(x0, y0, x1, y1, pressure = 1) {
    const b = this.brush, dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(1, b.radiusPx * Math.max(0.04, b.spacing ?? 0.12));
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) { const t = i / n; const hit = this.pick({ clientX: x0 + (x1 - x0) * t, clientY: y0 + (y1 - y0) * t }, this.stroke.obj); if (hit) this.paintDab(hit, pressure); }
  }
  paintMove(e) {
    const s = this.stroke; if (!s) return;
    this.paintSegment(s.last.x, s.last.y, e.clientX, e.clientY, this.pressureOf(e));
    s.last = { x: e.clientX, y: e.clientY };
    if (!s.tex) this.bvhDirty = true;
  }
  /** Straight line between two screen points, painted on the selected model. */
  paintLine(x0, y0, x1, y1, e, pressure = 1) {
    const o = this.doc.selected; if (!isMesh(o)) return;
    // start at the first point along the line that touches the model
    const dist = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(dist / 2));
    let start = -1, hit = null;
    for (let i = 0; i <= n; i++) { const t = i / n; hit = this.pick({ clientX: x0 + (x1 - x0) * t, clientY: y0 + (y1 - y0) * t }, o); if (hit) { start = t; break; } }
    if (start < 0) { this.host.onPaintMiss?.(); return; }
    const sx = x0 + (x1 - x0) * start, sy = y0 + (y1 - y0) * start;
    if (!this.paintBegin(hit, { clientX: sx, clientY: sy, pointerType: 'mouse' })) return;
    this.stroke.last = { x: sx, y: sy };
    this.paintSegment(sx, sy, x1, y1, pressure);
    this.paintEnd('Paint line');
  }
  paintEnd(label) {
    const s = this.stroke; this.stroke = null; if (!s) return;
    let rec;
    if (s.tex) rec = s.ts.end(label || 'Texture paint');
    else {
      rec = this.engine.end();
      const g = s.obj.geometry; g.boundsTree?.refit(); g.computeBoundingSphere(); g.computeBoundingBox();
      if (rec && label) rec.label = label;
    }
    this.doc.pushRecord(rec);
    this.requestRender();
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
    this.pushFaceRecord('Select faces', fd.before);
  }
  pushFaceRecord(label, before) {
    const after = Uint8Array.from(this.faces.sel), faces = this.faces, geo = faces.geo;
    const apply = (s) => { if (faces.geo === geo && faces.sel.length === s.length) { faces.sel.set(s); faces.version++; this.syncFaceOverlay(); this.syncGizmo(); } };
    this.doc.pushRecord({ label, bytes: after.length * 2, undo: () => apply(before), redo: () => apply(after) });
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
    const show = this.mode === 'sculpt' && isMesh(o) && this.doc.isShown(o) && !!o.geometry.attributes.mask;
    this.maskOverlay.visible = show;
    if (show) { this.maskOverlay.geometry = o.geometry; this.maskOverlay.matrixAutoUpdate = false; this.maskOverlay.matrix.copy(o.matrixWorld); this.maskOverlay.matrixWorldNeedsUpdate = true; }
    this.requestRender();
  }

  // ------------------------------------------------------------------------- helpers (lights, cameras, empties)
  syncHelpers() {
    const d = this.doc;
    const want = d.objects.filter((o) => isLight(o) || isCamera(o) || (isGroup(o) && !d.children(o).length) || (isGroup(o) && d.isSelected(o)));
    const have = new Map(this.helpers.children.map((c) => [c.userData.helperOf, c]));
    for (const [o, hm] of have) if (!want.includes(o) || hm.userData.kind !== helperKind(o)) { this.helpers.remove(hm); hm.traverse((x) => x.geometry?.dispose()); have.delete(o); }
    for (const o of want) {
      let hm = have.get(o);
      if (!hm) { hm = makeHelper(o); hm.userData.helperOf = o; hm.userData.kind = helperKind(o); this.helpers.add(hm); }
      if (isLight(o)) hm.material.color.copy(o.ed.light.color);
      const sel = d.isSelected(o);
      hm.traverse((x) => { if (x.material && x !== hm && x.userData.tint !== false) x.material.color.set(sel ? 0xb7a8ff : isLight(o) ? o.ed.light.color : 0xffffff); });
      hm.visible = d.isShown(o) && this.mode !== 'sculpt' && this.mode !== 'paint';
    }
    this.syncWire(); this.syncMask(); this.syncFaceOverlay();
  }
  syncWire() {
    const want = this.render.wireframe ? this.doc.meshes.filter((o) => this.doc.isShown(o)) : [];
    const cur = new Map(this.wires.children.map((w) => [w.userData.of, w]));
    for (const [o, w] of cur) if (!want.includes(o)) this.wires.remove(w);
    for (const o of want) { let w = cur.get(o); if (!w) { w = new THREE.Mesh(o.geometry, this.wireMat); w.userData.of = o; w.matrixAutoUpdate = false; this.wires.add(w); } }
  }
  updateOverlays() {
    const d = this.doc;
    for (const hm of this.helpers.children) {
      const o = hm.userData.helperOf; o.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(), q = new THREE.Quaternion(); o.matrixWorld.decompose(p, q, new THREE.Vector3());
      hm.matrixAutoUpdate = false; hm.matrix.compose(p, q, new THREE.Vector3().setScalar(Math.max(0.3, this.cam.distance / 7) * (isCamera(o) ? 1.6 : 1))); hm.matrixWorldNeedsUpdate = true;
    }
    for (const w of this.wires.children) { const o = w.userData.of; w.geometry = o.geometry; w.matrix.copy(o.matrixWorld); w.matrixWorldNeedsUpdate = true; }
    const o = d.selected;
    if (this.faceOverlay.visible && o) { this.faceOverlay.matrix.copy(o.matrixWorld); this.faceOverlay.matrixWorldNeedsUpdate = true; }
    if (this.maskOverlay.visible && o) { this.maskOverlay.matrix.copy(o.matrixWorld); this.maskOverlay.matrixWorldNeedsUpdate = true; }
    // outlines around every selected mesh (and the meshes inside selected groups)
    const showOutlines = this.mode === 'object' || this.mode === 'animate';
    const list = [];
    if (showOutlines) for (const s of d.selection) { if (!d.isShown(s)) continue; if (isMesh(s)) list.push([s, s === o]); for (const c of d.descendants(s)) if (isMesh(c) && d.isShown(c)) list.push([c, s === o]); }
    const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2()), wpx = 2.2 * this.renderer.getPixelRatio();
    for (const m of [this.outlineMat, this.outlineMat2]) { m.uniforms.uRes.value.copy(sz); m.uniforms.uWidth.value = wpx; }
    const pool = this.outlines.children;
    for (let i = 0; i < Math.min(list.length, 300); i++) {
      let ol = pool[i];
      if (!ol) { ol = new THREE.Mesh(new THREE.BufferGeometry(), this.outlineMat); ol.matrixAutoUpdate = false; ol.renderOrder = 3; ol.frustumCulled = false; this.outlines.add(ol); }
      const [m, active] = list[i];
      ol.geometry = m.geometry; ol.material = active ? this.outlineMat : this.outlineMat2;
      ol.matrix.copy(m.matrixWorld); ol.matrixWorldNeedsUpdate = true; ol.visible = true;
    }
    for (let i = list.length; i < pool.length; i++) pool[i].visible = false;
    // grid follows the camera target
    const fade = Math.max(4, this.cam.distance * 4);
    this.grid.scale.setScalar(fade * 2.2); this.grid.position.set(this.cam.target.x, 0, this.cam.target.z);
    this.gridMat.uniforms.uFade.value = fade; this.gridMat.uniforms.uCenter.value.copy(this.cam.target);
    this.gridMat.uniforms.uStep.value = this.cam.distance > 40 ? 1 : this.cam.distance < 0.6 ? 0.01 : 0.1;
    // measure markers keep a constant screen size
    if (this.measureGroup.visible && this.measure?.a) {
      for (const dot of [this.measureA, this.measureB]) dot.scale.setScalar(this.worldPerPixel(dot.position) * 4);
      const mid = this.measureA.position.clone().add(this.measureB.position).multiplyScalar(0.5), s = this.toScreen(mid), r = this.canvas.getBoundingClientRect();
      this.measureLabel.style.left = s.x - r.left + 'px'; this.measureLabel.style.top = s.y - r.top - 26 + 'px';
    }
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
  xrayMaterial(o) {
    if (!this.xrayMats) this.xrayMats = new WeakMap();
    let m = this.xrayMats.get(o.material);
    if (!m) { m = o.material.clone(); m.userData = {}; this.xrayMats.set(o.material, m); }
    m.color.copy(o.material.color); m.transparent = true; m.opacity = Math.min(o.material.opacity, 0.35); m.depthWrite = false; m.transmission = 0; m.side = THREE.DoubleSide;
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
    if (this.navDirty) { this.navDirty = false; this.nav.draw(); }
  }
  swapMaterials() {
    const swap = [];
    if (this.render.shading !== 'PBR') for (const o of this.doc.meshes) { swap.push([o, o.material]); o.material = this.modeMaterial(o); }
    else if (this.render.xray && (this.mode === 'object' || this.mode === 'animate' || this.mode === 'edit')) for (const o of this.doc.meshes) { swap.push([o, o.material]); o.material = this.xrayMaterial(o); }
    return swap;
  }
  draw(camera, target = null) {
    this.doc.root.updateMatrixWorld(true);
    this.updateOverlays();
    const swap = this.swapMaterials();
    let done = false;
    if (!target && this.useAO(camera)) {
      try {
        const c = this.composer || this.makeComposer();
        this.renderPass.camera = camera; this.aoPass.camera = camera;
        c.render(); done = true;
      } catch (e) { this.aoFailed = true; console.warn(e); }
    }
    if (!done) {
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.scene, camera);
      this.renderer.setRenderTarget(null);
    }
    for (const [o, m] of swap) o.material = m;
  }
  /** Ambient occlusion (GTAO) is used for realistic shading in perspective views. */
  useAO(camera) { return this.render.ao && this.render.shading === 'PBR' && !this.render.xray && camera.isPerspectiveCamera && !this.aoFailed; }
  /** Overlays (grid, gizmo, outlines, helpers) never cast ambient occlusion. */
  aoHidden() { return [this.grid, this.axes, this.gizmoHelper, this.outlines, this.helpers, this.faceOverlay, this.maskOverlay, this.wires, this.measureGroup]; }
  makeAOPasses(composer, w, h, camera, noOutput = false) {
    const rp = new RenderPass(this.scene, camera);
    const ao = new GTAOPass(this.scene, camera, w, h);
    const hidden = this.aoHidden(), base = ao.overrideVisibility.bind(ao), restore = ao.restoreVisibility.bind(ao);
    ao.overrideVisibility = () => { base(); for (const o of hidden) { ao._visibilityCache.set(o, o.visible); o.visible = false; } };
    ao.restoreVisibility = () => { restore(); };
    ao.blendIntensity = 1;
    ao.updateGtaoMaterial({ radius: this.aoRadius || 0.25, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(rp); composer.addPass(ao);
    if (!noOutput) composer.addPass(new OutputPass());
    return { rp, ao };
  }
  makeComposer() {
    try {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      const c = new EffectComposer(this.renderer, rt);
      c.setPixelRatio(this.renderer.getPixelRatio());
      const sz = this.renderer.getSize(new THREE.Vector2()); c.setSize(sz.x, sz.y);
      const { rp, ao } = this.makeAOPasses(c, size.x, size.y, this.camera);
      this.composer = c; this.renderPass = rp; this.aoPass = ao;
      return c;
    } catch (e) { console.warn('AO unavailable', e); this.aoFailed = true; throw e; }
  }
  setAORadius(r) { this.aoRadius = r; this.aoPass?.updateGtaoMaterial({ radius: r }); }

  /**
   * Renders the scene from the current view (or a square framing for thumbnails) without editor
   * overlays, tone-mapped like the viewport. Returns PNG bytes.
   */
  async renderImage({ width = 1920, height = 1080, transparent = false, framed = false, fit = 1.2, yaw = null, pitch = null, target = null } = {}) {
    const max = Math.min(this.renderer.capabilities.maxTextureSize, 8192);
    const k = Math.min(1, max / Math.max(width, height)); width = Math.max(16, Math.round(width * k)); height = Math.max(16, Math.round(height * k));
    let cam;
    if (framed) {
      const box = frameBounds(this.doc.objects, this.doc);
      cam = new THREE.PerspectiveCamera(this.render.fov, width / height, 0.01, 1000);
      const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 1) : box.getBoundingSphere(new THREE.Sphere());
      if (target) sphere.center.fromArray(target);
      const d = Math.max(0.05, sphere.radius) / Math.sin(THREE.MathUtils.degToRad(this.render.fov) / 2) * fit;
      const y = THREE.MathUtils.degToRad(yaw ?? this.cam.yaw), p = THREE.MathUtils.degToRad(Math.max(-60, Math.min(60, pitch ?? this.cam.pitch)));
      cam.position.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)).multiplyScalar(d).add(sphere.center);
      cam.lookAt(sphere.center); cam.near = d / 100; cam.far = d * 10; cam.updateProjectionMatrix();
    } else {
      cam = this.camera.clone();
      if (cam.isPerspectiveCamera) { cam.aspect = width / height; cam.updateProjectionMatrix(); }
      else { const hh = (this.ortho.top - this.ortho.bottom) / 2; cam.top = hh; cam.bottom = -hh; cam.left = -hh * width / height; cam.right = hh * width / height; cam.updateProjectionMatrix(); }
    }
    const hide = [this.grid, this.axes, this.gizmoHelper, this.outlines, this.helpers, this.faceOverlay, this.maskOverlay, this.wires, this.measureGroup];
    const vis = hide.map((x) => x.visible);
    hide.forEach((x) => { x.visible = false; });
    const bg = this.scene.background; if (transparent) this.scene.background = null;
    const rt = new THREE.WebGLRenderTarget(width, height, { samples: 4, type: THREE.HalfFloatType });
    const out = new THREE.WebGLRenderTarget(width, height);
    const clear = this.renderer.getClearAlpha();
    this.doc.root.updateMatrixWorld(true);
    const swap = this.swapMaterials(), disposers = [];
    try {
      this.renderer.setClearAlpha(transparent ? 0 : 1);
      let src = rt;
      if (!transparent && this.useAO(cam)) {
        const comp = new EffectComposer(this.renderer, rt.clone()); comp.renderToScreen = false; comp.setPixelRatio(1); comp.setSize(width, height);
        this.makeAOPasses(comp, width, height, cam, true);
        comp.passes[1].updateGtaoMaterial({ radius: this.aoRadius || 0.25 });
        comp.render(); src = comp.readBuffer; disposers.push(() => comp.dispose());
      } else { this.renderer.setRenderTarget(rt); this.renderer.clear(); this.renderer.render(this.scene, cam); }
      const pass = new OutputPass(); pass.renderToScreen = false; pass.render(this.renderer, out, src); pass.dispose();
      this.renderer.setRenderTarget(null);
      const px = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(out, 0, 0, width, height, px);
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      const ctx = c.getContext('2d'), img = ctx.createImageData(width, height);
      for (let row = 0; row < height; row++) img.data.set(px.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
      if (transparent) for (let i = 0; i < img.data.length; i += 4) { const a = img.data[i + 3]; if (a > 0 && a < 255) { const f = 255 / a; img.data[i] = Math.min(255, img.data[i] * f); img.data[i + 1] = Math.min(255, img.data[i + 1] * f); img.data[i + 2] = Math.min(255, img.data[i + 2] * f); } }
      else for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      ctx.putImageData(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return blob.arrayBuffer();
    } finally {
      for (const [o, m] of swap) o.material = m;
      this.renderer.setRenderTarget(null); this.renderer.setClearAlpha(clear);
      rt.dispose(); out.dispose(); for (const f of disposers) f();
      this.scene.background = bg;
      hide.forEach((x, i) => { x.visible = vis[i]; });
      this.requestRender();
    }
  }
  /** PNG thumbnail of the current scene (square, framed). */
  thumbnail(size = 512) { return this.renderImage({ width: size, height: size, framed: true }); }
  dispose() { this.disposed = true; this.ro?.disconnect(); this.gizmo.dispose(); this.envTex?.dispose(); this.composer?.dispose(); this.pmrem.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss?.(); this.measureLabel.remove(); this.boxEl.remove(); this.lineEl.remove(); this.nav.dispose(); }
}

// ------------------------------------------------------------------------------- helper meshes
function helperKind(o) { return isLight(o) ? 'light-' + o.ed.lightType : isCamera(o) ? 'camera' : 'empty'; }
function makeHelper(o) {
  const lineMat = () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
  const lines = (pts) => new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), lineMat());
  if (isLight(o)) {
    const hm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.6 }));
    hm.add(ring);
    if (o.ed.lightType !== 'point') hm.add(lines([[0, 0, 0], [0, 0, -0.45]]));
    return hm;
  }
  if (isCamera(o)) {
    // pick target: a small invisible box around the body; visible: a wire frustum
    const hm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.22).translate(0, 0, 0.02), new THREE.MeshBasicMaterial({ visible: false }));
    hm.add(lines([[0, 0, 0], [-0.12, 0.07, -0.2], [0, 0, 0], [0.12, 0.07, -0.2], [0, 0, 0], [0.12, -0.07, -0.2], [0, 0, 0], [-0.12, -0.07, -0.2],
      [-0.12, 0.07, -0.2], [0.12, 0.07, -0.2], [0.12, 0.07, -0.2], [0.12, -0.07, -0.2], [0.12, -0.07, -0.2], [-0.12, -0.07, -0.2], [-0.12, -0.07, -0.2], [-0.12, 0.07, -0.2],
      [-0.05, 0.09, -0.2], [0, 0.14, -0.2], [0, 0.14, -0.2], [0.05, 0.09, -0.2]]));
    return hm;
  }
  // empty / group: axis cross
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  hm.add(lines([[-0.15, 0, 0], [0.15, 0, 0], [0, -0.15, 0], [0, 0.15, 0], [0, 0, -0.15], [0, 0, 0.15]]));
  return hm;
}

// ------------------------------------------------------------------------------- navigation gizmo
/** Axis bubbles in the corner of the viewport: click an axis to look along it, drag to orbit. */
class NavGizmo {
  constructor(vp) {
    this.vp = vp;
    const host = vp.canvas.parentElement;
    this.el = document.createElement('div'); this.el.className = 'navgizmo';
    this.c = document.createElement('canvas'); this.c.setAttribute('aria-hidden', 'true');
    this.el.appendChild(this.c);
    host?.appendChild(this.el);
    this.size = 104;
    this.c.addEventListener('pointerdown', (e) => this.down(e));
    this.c.addEventListener('pointermove', (e) => this.move(e));
    this.c.addEventListener('pointerup', (e) => this.up(e));
    this.c.addEventListener('pointerleave', () => { this.hoverId = null; this.draw(); });
  }
  dispose() { this.el.remove(); }
  axes() {
    const v = this.vp, m = new THREE.Matrix4().extractRotation(v.camera.matrixWorldInverse);
    const cols = v.axisColors || AXIS_COLORS.standard;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    return [['right', [1, 0, 0], 'X', cols[0], true], ['left', [-1, 0, 0], '', cols[0], false], ['top', [0, 1, 0], 'Y', cols[1], true], ['bottom', [0, -1, 0], '', cols[1], false], ['front', [0, 0, 1], 'Z', cols[2], true], ['back', [0, 0, -1], '', cols[2], false]]
      .map(([id, d, label, col, pos]) => { const p = new THREE.Vector3(...d).applyMatrix4(m); return { id, label, col: hex(col), pos, x: p.x, y: p.y, z: p.z }; });
  }
  layout() { const s = this.size, r = s / 2 - 13; return this.axes().map((a) => ({ ...a, sx: s / 2 + a.x * r, sy: s / 2 - a.y * r })); }
  draw() {
    const s = this.size, dpr = devicePixelRatio, c = this.c;
    if (c.width !== s * dpr) { c.width = c.height = s * dpr; c.style.width = c.style.height = s + 'px'; }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, s, s);
    if (this.hoverAny) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2); ctx.fill(); }
    const items = this.layout().sort((a, b) => a.z - b.z);
    for (const a of items) if (a.pos) { ctx.strokeStyle = a.col; ctx.lineWidth = 2.2; ctx.globalAlpha = a.z < -0.2 ? 0.55 : 1; ctx.beginPath(); ctx.moveTo(s / 2, s / 2); ctx.lineTo(a.sx, a.sy); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.font = '700 11px InterUI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const a of items) {
      const rad = a.pos ? 9 : 7, hov = this.hoverId === a.id;
      ctx.globalAlpha = a.z < -0.2 ? 0.6 : 1;
      ctx.beginPath(); ctx.arc(a.sx, a.sy, rad + (hov ? 1.5 : 0), 0, Math.PI * 2);
      if (a.pos) { ctx.fillStyle = a.col; ctx.fill(); ctx.fillStyle = '#111'; ctx.fillText(a.label, a.sx, a.sy + 0.5); }
      else { ctx.fillStyle = 'rgba(20,20,26,0.75)'; ctx.fill(); ctx.strokeStyle = a.col; ctx.lineWidth = 1.6; ctx.stroke(); }
      if (hov) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }
  hit(e) { const r = this.c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; const items = this.layout().sort((a, b) => b.z - a.z); return items.find((a) => Math.hypot(a.sx - x, a.sy - y) < 11) || null; }
  down(e) { this.c.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY, moved: false }; }
  move(e) {
    if (this.drag) { if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 3) this.drag.moved = true; if (this.drag.moved) this.vp.orbitBy(-(e.movementX || 0) * 0.5, (e.movementY || 0) * 0.5); return; }
    const h = this.hit(e); const id = h?.id || null; this.hoverAny = true; if (id !== this.hoverId) { this.hoverId = id; } this.draw();
  }
  up(e) { const d = this.drag; this.drag = null; try { this.c.releasePointerCapture(e.pointerId); } catch { /* ignore */ } if (d && !d.moved) { const h = this.hit(e); if (h) this.vp.view(h.id); } }
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
