// Scene document: ordered objects, selection, animation keys and undo history.
// Every scene object is a THREE.Object3D with editor state in `obj.ed` (never exported as-is).
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { computeNormals, tcount } from '../core/mesh.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let nextId = 1;

// ------------------------------------------------------------------------------- materials
export function newMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xd9d9de, roughness: opts.roughness ?? 0.45, metalness: opts.metalness ?? 0 });
  m.name = opts.name || 'Material';
  if (opts.emissive != null) m.emissive.set(opts.emissive);
  m.userData = { tiling: [1, 1], offset: [0, 0], rotation: 0, pixel: false, maps: {} };
  return m;
}
/** Applies the material's tiling/offset/rotation/pixel settings to all of its textures. */
export function syncTextures(m) {
  const u = m.userData;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'metalnessMap', 'aoMap']) {
    const t = m[k]; if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(u.tiling[0], u.tiling[1]); t.offset.set(u.offset[0], u.offset[1]); t.rotation = u.rotation; t.center.set(0.5, 0.5);
    const nf = u.pixel ? THREE.NearestFilter : THREE.LinearFilter;
    if (t.magFilter !== nf) { t.magFilter = nf; t.minFilter = u.pixel ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter; t.needsUpdate = true; }
  }
}
const MAT_KEYS = ['roughness', 'metalness', 'emissiveIntensity', 'opacity', 'transparent', 'alphaTest', 'side', 'map', 'normalMap', 'roughnessMap', 'emissiveMap', 'metalnessMap', 'aoMap', 'vertexColors', 'name', 'depthWrite'];
export function snapMaterial(m) {
  const s = { color: m.color.getHex(), emissive: m.emissive.getHex(), normalScale: m.normalScale.x, ud: JSON.parse(JSON.stringify({ ...m.userData, maps: undefined })), maps: { ...m.userData.maps } };
  for (const k of MAT_KEYS) s[k] = m[k];
  return s;
}
export function restoreMaterial(m, s) {
  m.color.setHex(s.color); m.emissive.setHex(s.emissive); m.normalScale.set(s.normalScale, s.normalScale);
  const changedProgram = m.map !== s.map || m.normalMap !== s.normalMap || m.roughnessMap !== s.roughnessMap || m.vertexColors !== s.vertexColors || m.transparent !== s.transparent || m.alphaTest !== s.alphaTest || m.emissiveMap !== s.emissiveMap;
  for (const k of MAT_KEYS) m[k] = s[k];
  m.userData = { ...s.ud, maps: { ...s.maps } };
  syncTextures(m);
  if (changedProgram) m.needsUpdate = true;
}

// ------------------------------------------------------------------------------- objects
export function makeMesh(geo, name, material = null) {
  const mesh = new THREE.Mesh(geo, material || newMaterial());
  mesh.name = name;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.ed = { id: nextId++, kind: 'mesh', prim: null, text: null, locked: false, keys: new Map() };
  prepareGeometry(geo);
  if (geo.attributes.color) mesh.material.vertexColors = true;
  return mesh;
}
export function prepareGeometry(geo) {
  if (!geo.attributes.normal) computeNormals(geo);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  if (!geo.boundsTree) geo.computeBoundsTree({ maxLeafTris: 10 });
  return geo;
}
export const LIGHT_TYPES = { point: 'Point light', spot: 'Spot light', directional: 'Sun light' };
export function makeLight(type, name) {
  const g = new THREE.Group();
  g.name = name || LIGHT_TYPES[type];
  let l;
  if (type === 'spot') { l = new THREE.SpotLight(0xffffff, 8, 0, Math.PI / 6, 0.3, 2); }
  else if (type === 'directional') { l = new THREE.DirectionalLight(0xffffff, 2.5); }
  else { l = new THREE.PointLight(0xffffff, 6, 0, 2); }
  l.castShadow = type !== 'point';
  if (l.shadow) { l.shadow.mapSize.set(1024, 1024); l.shadow.bias = -0.0005; l.shadow.normalBias = 0.02; }
  if (l.target) { l.target.position.set(0, 0, -1); g.add(l.target); }
  g.add(l);
  g.ed = { id: nextId++, kind: 'light', lightType: type, light: l, locked: false, keys: new Map() };
  return g;
}
export const isMesh = (o) => o?.ed?.kind === 'mesh';
export const isLight = (o) => o?.ed?.kind === 'light';

function snapObject(o) {
  const s = { p: o.position.clone(), q: o.quaternion.clone(), sc: o.scale.clone(), visible: o.visible, name: o.name, locked: o.ed.locked, keys: new Map([...o.ed.keys].map(([f, k]) => [f, { p: [...k.p], q: [...k.q], s: [...k.s] }])) };
  if (o.ed.kind === 'mesh') {
    s.geo = o.geometry; s.mat = snapMaterial(o.material); s.matRef = o.material;
    s.prim = o.ed.prim ? JSON.parse(JSON.stringify(o.ed.prim)) : null; s.text = o.ed.text ? { ...o.ed.text } : null;
  } else {
    const l = o.ed.light; s.light = { color: l.color.getHex(), intensity: l.intensity, distance: l.distance, angle: l.angle, penumbra: l.penumbra, cast: l.castShadow };
  }
  return s;
}
function restoreObject(o, s) {
  o.position.copy(s.p); o.quaternion.copy(s.q); o.scale.copy(s.sc); o.visible = s.visible; o.name = s.name; o.ed.locked = s.locked;
  o.ed.keys = new Map([...s.keys].map(([f, k]) => [f, { p: [...k.p], q: [...k.q], s: [...k.s] }]));
  if (o.ed.kind === 'mesh') {
    if (o.geometry !== s.geo) { o.geometry = s.geo; prepareGeometry(s.geo); }
    o.material = s.matRef;
    restoreMaterial(s.matRef, s.mat);
    o.ed.prim = s.prim ? JSON.parse(JSON.stringify(s.prim)) : null; o.ed.text = s.text ? { ...s.text } : null;
  } else {
    const l = o.ed.light, L = s.light;
    l.color.setHex(L.color); l.intensity = L.intensity; l.distance = L.distance;
    if (l.isSpotLight) { l.angle = L.angle; l.penumbra = L.penumbra; }
    l.castShadow = L.cast;
  }
}

// ------------------------------------------------------------------------------- history
export class History {
  constructor(limitBytes = 600e6) { this.undoStack = []; this.redoStack = []; this.limit = limitBytes; this.bytes = 0; }
  push(rec) {
    this.undoStack.push(rec); this.bytes += rec.bytes || 1000;
    this.redoStack = [];
    while (this.undoStack.length > 300 || (this.bytes > this.limit && this.undoStack.length > 1)) { const r = this.undoStack.shift(); this.bytes -= r.bytes || 1000; }
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() { const r = this.undoStack.pop(); if (!r) return null; r.undo(); this.redoStack.push(r); return r; }
  redo() { const r = this.redoStack.pop(); if (!r) return null; r.redo(); this.undoStack.push(r); return r; }
  clear() { this.undoStack = []; this.redoStack = []; this.bytes = 0; }
}

// ------------------------------------------------------------------------------- document
export class Doc extends EventTarget {
  constructor() {
    super();
    this.root = new THREE.Group(); this.root.name = 'Scene';
    this.objects = [];
    this.selected = null;
    this.history = new History();
    this.fps = 30; this.frameCount = 90; this.frame = 0;
    this.dirty = false;
    this.name = 'Untitled';
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  /** Something visible changed but nothing structural (viewport redraw only). */
  changed(what = 'all') { this.dirty = true; this.changeCount = (this.changeCount || 0) + 1; this.emit('change', what); }
  touch() { this.dirty = true; this.changeCount = (this.changeCount || 0) + 1; this.emit('touch'); }

  attach(o, index = this.objects.length) { this.objects.splice(index, 0, o); this.root.add(o); }
  detach(o) { const i = this.objects.indexOf(o); if (i >= 0) this.objects.splice(i, 1); this.root.remove(o); if (this.selected === o) this.selected = null; }

  select(o) {
    if (this.selected === o) return;
    this.selected = o || null;
    this.emit('select', o); this.emit('change', 'select');
  }

  /**
   * Records an undoable change. fn() mutates; objs are snapshotted before/after.
   * The object list and selection are always recorded, so fn may add or remove objects.
   */
  transact(label, fn, objs = null) {
    const tok = this.begin(label, objs);
    let result;
    try { result = fn(); } catch (e) { console.error(e); this.cancel(tok); throw e; }
    this.commit(tok);
    return result;
  }
  /** Starts a long change (gizmo drag, slider drag); finish with commit() or cancel(). */
  begin(label, objs = null) {
    const targets = new Set(objs || (this.selected ? [this.selected] : []));
    return { label, targets, list: [...this.objects], sel: this.selected, before: new Map([...targets].map((o) => [o, snapObject(o)])) };
  }
  cancel(tok) { for (const o of tok.targets) if (o.ed) o.ed.liveTemp = null; for (const [o, s] of tok.before) restoreObject(o, s); this.setList(tok.list, tok.sel); this.changed(); }
  commit(tok, { force = false } = {}) {
    const { label, targets, before } = tok, listBefore = tok.list, selBefore = tok.sel;
    for (const o of targets) if (o.ed) o.ed.liveTemp = null;
    for (const o of this.objects) if (!listBefore.includes(o)) targets.add(o);
    const after = new Map([...targets].map((o) => [o, snapObject(o)]));
    const listAfter = [...this.objects], selAfter = this.selected;
    if (!force && listAfter.length === listBefore.length && listAfter.every((o, i) => o === listBefore[i]) && selAfter === selBefore && [...after].every(([o, s]) => sameSnap(before.get(o), s))) { this.emit('change', 'noop'); return false; }
    let bytes = 2000;
    for (const [o, s] of after) { const b = before.get(o); if (s.geo && (!b || b.geo !== s.geo)) bytes += geoBytes(s.geo); }
    this.history.push({
      label, bytes,
      undo: () => { this.setList(listBefore, selBefore); for (const [o, s] of before) restoreObject(o, s); },
      redo: () => { this.setList(listAfter, selAfter); for (const [o, s] of after) restoreObject(o, s); },
    });
    this.changed(label);
    return true;
  }
  /** Pushes a pre-built record (sculpt strokes). */
  pushRecord(rec) { if (!rec) return; this.history.push(rec); this.changed(rec.label); }
  setList(list, sel) {
    for (const o of [...this.objects]) if (!list.includes(o)) this.root.remove(o);
    this.objects = [...list];
    for (const o of list) if (o.parent !== this.root) this.root.add(o);
    this.selected = sel && list.includes(sel) ? sel : null;
  }
  undo() { const r = this.history.undo(); if (r) { this.changed('undo'); this.emit('history', 'Undo ' + r.label); } return r; }
  redo() { const r = this.history.redo(); if (r) { this.changed('redo'); this.emit('history', 'Redo ' + r.label); } return r; }

  uniqueName(base) {
    const names = new Set(this.objects.map((o) => o.name));
    if (!names.has(base)) return base;
    const stem = base.replace(/ \d+$/, '');
    for (let i = 2; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
  }
  get meshes() { return this.objects.filter(isMesh); }
  stats() {
    let tris = 0, verts = 0;
    for (const o of this.meshes) { tris += tcount(o.geometry); verts += o.geometry.attributes.position.count; }
    return { tris, verts, objects: this.objects.length };
  }
  hasAnimation() { return this.objects.some((o) => o.ed.keys.size > 0); }

  // ---------------------------------------------------------------- animation
  setKey(o, frame = this.frame) {
    o.ed.keys.set(frame, { p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() });
  }
  /** Poses all animated objects at a (fractional) frame. */
  pose(frame) {
    for (const o of this.objects) {
      const keys = o.ed.keys; if (!keys.size) continue;
      const frames = [...keys.keys()].sort((a, b) => a - b);
      let a = frames[0], b = frames[frames.length - 1];
      if (frame <= a) { applyKey(o, keys.get(a)); continue; }
      if (frame >= b) { applyKey(o, keys.get(b)); continue; }
      for (let i = 0; i < frames.length - 1; i++) if (frame >= frames[i] && frame <= frames[i + 1]) { a = frames[i]; b = frames[i + 1]; break; }
      const t = (frame - a) / Math.max(1e-6, b - a), ka = keys.get(a), kb = keys.get(b);
      o.position.fromArray(ka.p).lerp(_v.fromArray(kb.p), t);
      o.scale.fromArray(ka.s).lerp(_v.fromArray(kb.s), t);
      o.quaternion.fromArray(ka.q).slerp(_q.fromArray(kb.q), t);
    }
  }
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function applyKey(o, k) { o.position.fromArray(k.p); o.quaternion.fromArray(k.q); o.scale.fromArray(k.s); }
function sameSnap(a, b) {
  if (!a || !b) return false;
  if (!a.p.equals(b.p) || !a.q.equals(b.q) || !a.sc.equals(b.sc) || a.visible !== b.visible || a.name !== b.name || a.locked !== b.locked) return false;
  if (a.keys.size !== b.keys.size) return false;
  for (const [f, k] of a.keys) { const k2 = b.keys.get(f); if (!k2 || JSON.stringify(k) !== JSON.stringify(k2)) return false; }
  if (a.geo !== b.geo || a.matRef !== b.matRef) return false;
  if (JSON.stringify(a.light) !== JSON.stringify(b.light)) return false;
  if (a.mat && b.mat) { for (const k of Object.keys(a.mat)) { if (k === 'ud' || k === 'maps') { if (JSON.stringify(a.mat[k]) !== JSON.stringify(b.mat[k])) return false; } else if (a.mat[k] !== b.mat[k]) return false; } }
  if (JSON.stringify(a.prim) !== JSON.stringify(b.prim) || JSON.stringify(a.text) !== JSON.stringify(b.text)) return false;
  return true;
}
export function geoBytes(g) { let b = g.index ? g.index.array.byteLength : 0; for (const a of Object.values(g.attributes)) b += a.array.byteLength; return b; }

// ------------------------------------------------------------------------------- animation presets
export const ANIM_PRESETS = [
  { id: 'spin', label: 'Spin', icon: 'rotate-cw', desc: 'Full turn around Y' },
  { id: 'bounce', label: 'Bounce', icon: 'arrow-up-down', desc: 'Hop with squash' },
  { id: 'float', label: 'Float', icon: 'cloud', desc: 'Gentle hover' },
  { id: 'pulse', label: 'Pulse', icon: 'heart-pulse', desc: 'Scale beat' },
  { id: 'wobble', label: 'Wobble', icon: 'audio-waveform', desc: 'Jelly sway' },
  { id: 'swing', label: 'Swing', icon: 'bell', desc: 'Pendulum swing' },
  { id: 'shake', label: 'Shake', icon: 'vibrate', desc: 'Quick jitter' },
  { id: 'popin', label: 'Pop in', icon: 'sparkles', desc: 'Grow from zero' },
];
export function applyPreset(doc, o, id) {
  const n = doc.frameCount, base = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
  o.ed.keys = new Map();
  const steps = id === 'spin' ? 4 : id === 'shake' ? 12 : id === 'popin' ? 3 : 8;
  const e = new THREE.Euler();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, f = Math.round(t * n);
    const p = base.p.clone(), q = base.q.clone(), s = base.s.clone();
    const ang = t * Math.PI * 2;
    if (id === 'spin') q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang * (i === steps ? 0.999999 : 1)));
    if (id === 'bounce') { const hgt = Math.abs(Math.sin(ang)); p.y += hgt * 0.5; const sq = 1 - (1 - hgt) * 0.18; s.multiply(new THREE.Vector3(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq))); }
    if (id === 'float') p.y += Math.sin(ang) * 0.12;
    if (id === 'pulse') s.multiplyScalar(1 + Math.max(0, Math.sin(ang * 2)) * 0.12);
    if (id === 'wobble') { e.set(Math.sin(ang * 2) * 0.12, 0, Math.cos(ang * 2) * 0.12); q.multiply(new THREE.Quaternion().setFromEuler(e)); }
    if (id === 'swing') { e.set(0, 0, Math.sin(ang) * 0.5); q.multiply(new THREE.Quaternion().setFromEuler(e)); }
    if (id === 'shake') if (i > 0 && i < steps) p.x += (i % 2 ? 1 : -1) * 0.04;
    if (id === 'popin') s.multiplyScalar(i === 0 ? 0.001 : i === 1 ? 1.15 : 1);
    o.ed.keys.set(id === 'popin' ? [0, Math.round(n * 0.18), Math.round(n * 0.3), n][i] ?? f : f, { p: p.toArray(), q: q.toArray(), s: s.toArray() });
  }
}

export function frameBounds(objs) {
  const box = new THREE.Box3();
  for (const o of objs) { if (!o.visible) continue; if (o.ed?.kind === 'light') box.expandByPoint(o.getWorldPosition(new THREE.Vector3())); else box.expandByObject(o); }
  return box;
}
