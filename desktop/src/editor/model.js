// Scene document: object tree (meshes, lights, cameras, groups/empties), multi-selection,
// animation keys + named clips, and undo history.
// Every scene object is a THREE.Object3D with editor state in `obj.ed` (never exported as-is).
// Objects live in one ordered list (doc.objects); `ed.parent` is the parent object (or null) and
// the THREE hierarchy is kept in sync with it, so transforms are always local to the parent.
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { computeNormals, tcount } from '../core/mesh.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let nextId = 1;

// ------------------------------------------------------------------------------- materials
/** Every material is physically based (glTF metallic-roughness + clearcoat, transmission, sheen …). */
export function newMaterial(opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: opts.color ?? 0xd9d9de, roughness: opts.roughness ?? 0.45, metalness: opts.metalness ?? 0 });
  m.name = opts.name || 'Material';
  if (opts.emissive != null) m.emissive.set(opts.emissive);
  m.userData = { tiling: [1, 1], offset: [0, 0], rotation: 0, pixel: false, maps: {} };
  return m;
}
/** Converts any standard material into a MeshPhysicalMaterial (keeps every standard property). */
export function toPhysical(m) {
  if (!m || m.isMeshPhysicalMaterial) return m;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.name = m.name; p.userData = m.userData;
  return p;
}
export const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
/** Applies the material's tiling/offset/rotation/pixel settings to all of its textures. */
export function syncTextures(m) {
  const u = m.userData;
  for (const k of TEX_SLOTS) {
    const t = m[k]; if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(u.tiling[0], u.tiling[1]); t.offset.set(u.offset[0], u.offset[1]); t.rotation = u.rotation; t.center.set(0.5, 0.5);
    const nf = u.pixel ? THREE.NearestFilter : THREE.LinearFilter;
    if (t.magFilter !== nf) { t.magFilter = nf; t.minFilter = u.pixel ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter; t.needsUpdate = true; }
  }
}
const MAT_KEYS = ['roughness', 'metalness', 'emissiveIntensity', 'opacity', 'transparent', 'alphaTest', 'side', ...TEX_SLOTS, 'vertexColors', 'name', 'depthWrite',
  'clearcoat', 'clearcoatRoughness', 'transmission', 'ior', 'thickness', 'sheen', 'sheenRoughness', 'specularIntensity', 'iridescence', 'aoMapIntensity'];
export function snapMaterial(m) {
  const s = { color: m.color.getHex(), emissive: m.emissive.getHex(), normalScale: m.normalScale.x, sheenColor: m.sheenColor?.getHex() ?? 0, specularColor: m.specularColor?.getHex() ?? 0xffffff, attenuationColor: m.attenuationColor?.getHex() ?? 0xffffff, ud: JSON.parse(JSON.stringify({ ...m.userData, maps: undefined })), maps: { ...m.userData.maps } };
  for (const k of MAT_KEYS) s[k] = m[k];
  return s;
}
export function restoreMaterial(m, s) {
  m.color.setHex(s.color); m.emissive.setHex(s.emissive); m.normalScale.set(s.normalScale, s.normalScale);
  if (m.sheenColor) m.sheenColor.setHex(s.sheenColor); if (m.specularColor) m.specularColor.setHex(s.specularColor); if (m.attenuationColor) m.attenuationColor.setHex(s.attenuationColor);
  const changedProgram = TEX_SLOTS.some((k) => m[k] !== s[k]) || m.vertexColors !== s.vertexColors || m.transparent !== s.transparent || m.alphaTest !== s.alphaTest;
  for (const k of MAT_KEYS) if (s[k] !== undefined && k in m) m[k] = s[k];
  m.userData = { ...s.ud, maps: { ...s.maps } };
  syncTextures(m);
  if (changedProgram) m.needsUpdate = true;
}

// ------------------------------------------------------------------------------- objects
function baseEd(kind) {
  return { id: nextId++, kind, parent: null, locked: false, keys: new Map(), props: [], noExport: false, collision: 'none', collapsed: false };
}
export function makeMesh(geo, name, material = null) {
  const mesh = new THREE.Mesh(geo, toPhysical(material) || newMaterial());
  mesh.name = name;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.ed = { ...baseEd('mesh'), prim: null, text: null };
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
  g.ed = { ...baseEd('light'), lightType: type, light: l };
  return g;
}
/** Camera object: looks down its local -Z axis (same as glTF). */
export function makeCamera(name = 'Camera', opts = {}) {
  const g = new THREE.Group(); g.name = name;
  const c = new THREE.PerspectiveCamera(opts.fov ?? 40, opts.aspect ?? 16 / 9, opts.near ?? 0.05, opts.far ?? 500);
  g.add(c);
  g.ed = { ...baseEd('camera'), camera: c };
  return g;
}
/** Group / empty: a transform with optional children (a Node3D in Godot, an Empty in Blender). */
export function makeGroup(name = 'Group') {
  const g = new THREE.Group(); g.name = name;
  g.ed = baseEd('group');
  return g;
}
export const isMesh = (o) => o?.ed?.kind === 'mesh';
export const isLight = (o) => o?.ed?.kind === 'light';
export const isCamera = (o) => o?.ed?.kind === 'camera';
export const isGroup = (o) => o?.ed?.kind === 'group';
export const KIND_LABEL = { mesh: 'Mesh', light: 'Light', camera: 'Camera', group: 'Group' };

export const copyKey = (k) => ({ p: [...k.p], q: [...k.q], s: [...k.s], ...(k.i && k.i !== 'linear' ? { i: k.i } : {}) });
export const copyKeys = (keys) => new Map([...keys].map(([f, k]) => [f, copyKey(k)]));

function snapObject(o) {
  const e = o.ed;
  const s = { p: o.position.clone(), q: o.quaternion.clone(), sc: o.scale.clone(), visible: o.visible, name: o.name, locked: e.locked, parent: e.parent, keys: copyKeys(e.keys), props: e.props.map((x) => [...x]), noExport: e.noExport, collision: e.collision };
  if (e.kind === 'mesh') {
    s.geo = o.geometry; s.mat = snapMaterial(o.material); s.matRef = o.material;
    s.prim = e.prim ? JSON.parse(JSON.stringify(e.prim)) : null; s.text = e.text ? { ...e.text } : null;
  } else if (e.kind === 'light') {
    const l = e.light; s.light = { color: l.color.getHex(), intensity: l.intensity, distance: l.distance, angle: l.angle, penumbra: l.penumbra, cast: l.castShadow };
  } else if (e.kind === 'camera') {
    const c = e.camera; s.cam = { fov: c.fov, aspect: c.aspect, near: c.near, far: c.far };
  }
  return s;
}
function restoreObject(o, s) {
  o.position.copy(s.p); o.quaternion.copy(s.q); o.scale.copy(s.sc); o.visible = s.visible; o.name = s.name;
  const e = o.ed;
  e.locked = s.locked; e.parent = s.parent; e.keys = copyKeys(s.keys); e.props = s.props.map((x) => [...x]); e.noExport = s.noExport; e.collision = s.collision;
  if (e.kind === 'mesh') {
    if (o.geometry !== s.geo) { o.geometry = s.geo; prepareGeometry(s.geo); }
    o.material = s.matRef;
    restoreMaterial(s.matRef, s.mat);
    e.prim = s.prim ? JSON.parse(JSON.stringify(s.prim)) : null; e.text = s.text ? { ...s.text } : null;
  } else if (e.kind === 'light') {
    const l = e.light, L = s.light;
    l.color.setHex(L.color); l.intensity = L.intensity; l.distance = L.distance;
    if (l.isSpotLight) { l.angle = L.angle; l.penumbra = L.penumbra; }
    l.castShadow = L.cast;
  } else if (e.kind === 'camera') {
    Object.assign(e.camera, s.cam); e.camera.updateProjectionMatrix();
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

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ------------------------------------------------------------------------------- document
export class Doc extends EventTarget {
  constructor() {
    super();
    this.root = new THREE.Group(); this.root.name = 'Scene';
    this.objects = [];
    this.selection = [];
    this.history = new History();
    this.fps = 30; this.frameCount = 90; this.frame = 0;
    this.clips = []; // named animation ranges: { name, start, end, loop }
    this.units = 'm';
    this.link = null; // live export target (Godot project / folder)
    this.dirty = false;
    this.name = 'Untitled';
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  /** Something visible changed but nothing structural (viewport redraw only). */
  changed(what = 'all') { this.dirty = true; this.changeCount = (this.changeCount || 0) + 1; this.emit('change', what); }
  touch() { this.dirty = true; this.changeCount = (this.changeCount || 0) + 1; this.emit('touch'); }

  // ---------------------------------------------------------------- tree
  attach(o, index = this.objects.length) { this.objects.splice(index, 0, o); this.syncTree(); }
  detach(o) {
    const i = this.objects.indexOf(o); if (i >= 0) this.objects.splice(i, 1);
    o.removeFromParent();
    if (this.selection.includes(o)) this.selection = this.selection.filter((x) => x !== o);
    this.syncTree();
  }
  /** Re-parents THREE objects to match ed.parent (objects whose parent is gone go to the root). */
  syncTree() {
    const set = new Set(this.objects);
    for (const o of this.objects) {
      const p = o.ed.parent && set.has(o.ed.parent) && !this.isAncestor(o, o.ed.parent) ? o.ed.parent : this.root;
      if (o.parent !== p) p.add(o);
    }
  }
  parentOf(o) { const p = o?.ed?.parent; return p && this.objects.includes(p) ? p : null; }
  children(o) { return this.objects.filter((x) => this.parentOf(x) === o); }
  roots() { return this.objects.filter((x) => !this.parentOf(x)); }
  descendants(o, out = []) { for (const c of this.children(o)) { out.push(c); this.descendants(c, out); } return out; }
  ancestors(o) { const out = []; let p = this.parentOf(o); const seen = new Set(); while (p && !seen.has(p)) { seen.add(p); out.push(p); p = this.parentOf(p); } return out; }
  /** true if `a` is an ancestor of `o`. */
  isAncestor(a, o) { let p = o.ed.parent; const seen = new Set(); while (p && !seen.has(p)) { if (p === a) return true; seen.add(p); p = p.ed?.parent; } return false; }
  depth(o) { return this.ancestors(o).length; }
  /** Visible itself and all of its parents. */
  isShown(o) { if (!o.visible) return false; for (const a of this.ancestors(o)) if (!a.visible) return false; return true; }
  /** Objects in tree (display) order: each parent followed by its children. */
  treeOrder() { const out = []; const walk = (list) => { for (const o of list) { out.push(o); walk(this.children(o)); } }; walk(this.roots()); return out; }

  // ---------------------------------------------------------------- selection
  get selected() { return this.selection[this.selection.length - 1] || null; }
  set selected(o) { this.selection = o ? [o] : []; }
  isSelected(o) { return this.selection.includes(o); }
  /** Selected objects without those whose ancestor is also selected (what transforms act on). */
  topSelected() { return this.selection.filter((o) => !this.ancestors(o).some((a) => this.selection.includes(a))); }
  setSelection(list, active = null) {
    let next = [...new Set(list.filter(Boolean))];
    if (active && next.includes(active)) next = [...next.filter((x) => x !== active), active];
    if (sameList(next, this.selection)) return;
    this.selection = next;
    this.emit('select', this.selected); this.emit('change', 'select');
  }
  select(o, mode = 'set') {
    if (mode === 'set') return this.setSelection(o ? [o] : []);
    if (!o) return;
    if (mode === 'add') return this.setSelection([...this.selection, o], o);
    if (mode === 'remove') return this.setSelection(this.selection.filter((x) => x !== o));
    if (mode === 'toggle') return this.isSelected(o) && this.selected === o ? this.setSelection(this.selection.filter((x) => x !== o)) : this.setSelection([...this.selection, o], o);
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
    const targets = new Set(objs || this.selection);
    return { label, targets, list: [...this.objects], sel: [...this.selection], extra: this.snapExtra(), before: new Map([...targets].map((o) => [o, snapObject(o)])) };
  }
  snapExtra() { return JSON.stringify({ clips: this.clips, fps: this.fps, frameCount: this.frameCount }); }
  restoreExtra(s) { const x = JSON.parse(s); this.clips = x.clips; this.fps = x.fps; this.frameCount = x.frameCount; }
  cancel(tok) { for (const o of tok.targets) if (o.ed) o.ed.liveTemp = null; this.setList(tok.list, tok.sel); for (const [o, s] of tok.before) restoreObject(o, s); this.restoreExtra(tok.extra); this.syncTree(); this.changed(); }
  commit(tok, { force = false } = {}) {
    const { label, targets, before } = tok, listBefore = tok.list, selBefore = tok.sel, extraBefore = tok.extra;
    for (const o of targets) if (o.ed) o.ed.liveTemp = null;
    for (const o of this.objects) if (!listBefore.includes(o)) targets.add(o);
    const after = new Map([...targets].map((o) => [o, snapObject(o)]));
    const listAfter = [...this.objects], selAfter = [...this.selection], extraAfter = this.snapExtra();
    if (!force && sameList(listAfter, listBefore) && sameList(selAfter, selBefore) && extraAfter === extraBefore && [...after].every(([o, s]) => sameSnap(before.get(o), s))) { this.emit('change', 'noop'); return false; }
    let bytes = 2000;
    for (const [o, s] of after) { const b = before.get(o); if (s.geo && (!b || b.geo !== s.geo)) bytes += geoBytes(s.geo); }
    this.history.push({
      label, bytes,
      undo: () => { this.setList(listBefore, selBefore); for (const [o, s] of before) restoreObject(o, s); this.restoreExtra(extraBefore); this.syncTree(); },
      redo: () => { this.setList(listAfter, selAfter); for (const [o, s] of after) restoreObject(o, s); this.restoreExtra(extraAfter); this.syncTree(); },
    });
    this.changed(label);
    return true;
  }
  /** Pushes a pre-built record (sculpt strokes). */
  pushRecord(rec) { if (!rec) return; this.history.push(rec); this.changed(rec.label); }
  setList(list, sel) {
    for (const o of this.objects) if (!list.includes(o)) o.removeFromParent();
    this.objects = [...list];
    this.selection = (Array.isArray(sel) ? sel : sel ? [sel] : []).filter((o) => list.includes(o));
    this.syncTree();
  }
  undo() { const r = this.history.undo(); if (r) { this.changed('undo'); this.emit('history', 'Undo ' + r.label); } return r; }
  redo() { const r = this.history.redo(); if (r) { this.changed('redo'); this.emit('history', 'Redo ' + r.label); } return r; }

  uniqueName(base, except = null) {
    const names = new Set(this.objects.filter((o) => o !== except).map((o) => o.name));
    if (!names.has(base)) return base;
    const stem = base.replace(/ \d+$/, '');
    for (let i = 2; ; i++) if (!names.has(`${stem} ${i}`)) return `${stem} ${i}`;
  }
  get meshes() { return this.objects.filter(isMesh); }
  /** Distinct materials used by meshes, with their users. */
  materials() {
    const m = new Map();
    for (const o of this.meshes) { if (!m.has(o.material)) m.set(o.material, []); m.get(o.material).push(o); }
    return m;
  }
  stats() {
    let tris = 0, verts = 0;
    for (const o of this.meshes) { tris += tcount(o.geometry); verts += o.geometry.attributes.position.count; }
    return { tris, verts, objects: this.objects.length };
  }
  hasAnimation() { return this.objects.some((o) => o.ed.keys.size > 0); }

  // ---------------------------------------------------------------- animation
  setKey(o, frame = this.frame) {
    const old = o.ed.keys.get(frame);
    o.ed.keys.set(frame, { p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(), ...(old?.i ? { i: old.i } : {}) });
  }
  /** Poses all animated objects at a (fractional) frame. */
  pose(frame) {
    for (const o of this.objects) {
      if (!o.ed.keys.size) continue;
      const k = sampleKeys(o.ed.keys, frame);
      o.position.fromArray(k.p); o.quaternion.fromArray(k.q); o.scale.fromArray(k.s);
    }
  }
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
export const EASINGS = [['linear', 'Linear'], ['ease', 'Ease in & out'], ['easein', 'Ease in'], ['easeout', 'Ease out'], ['step', 'Constant (step)']];
export function ease(mode, t) {
  if (mode === 'ease') return t * t * (3 - 2 * t);
  if (mode === 'easein') return t * t * t;
  if (mode === 'easeout') return 1 - Math.pow(1 - t, 3);
  if (mode === 'step') return 0;
  return t;
}
/** Interpolated transform of a key map at a (fractional) frame. The key at the start of a segment decides its easing. */
export function sampleKeys(keys, frame) {
  const frames = [...keys.keys()].sort((a, b) => a - b);
  const first = frames[0], last = frames[frames.length - 1];
  if (frame <= first) return keys.get(first);
  if (frame >= last) return keys.get(last);
  let a = first, b = last;
  for (let i = 0; i < frames.length - 1; i++) if (frame >= frames[i] && frame <= frames[i + 1]) { a = frames[i]; b = frames[i + 1]; break; }
  const ka = keys.get(a), kb = keys.get(b);
  const t = ease(ka.i, (frame - a) / Math.max(1e-6, b - a));
  const p = new THREE.Vector3().fromArray(ka.p).lerp(_v.fromArray(kb.p), t).toArray();
  const s = new THREE.Vector3().fromArray(ka.s).lerp(_v.fromArray(kb.s), t).toArray();
  const q = new THREE.Quaternion().fromArray(ka.q).slerp(_q.fromArray(kb.q), t).toArray();
  return { p, q, s };
}
function sameSnap(a, b) {
  if (!a || !b) return false;
  if (!a.p.equals(b.p) || !a.q.equals(b.q) || !a.sc.equals(b.sc) || a.visible !== b.visible || a.name !== b.name || a.locked !== b.locked || a.parent !== b.parent || a.noExport !== b.noExport || a.collision !== b.collision) return false;
  if (JSON.stringify(a.props) !== JSON.stringify(b.props)) return false;
  if (a.keys.size !== b.keys.size) return false;
  for (const [f, k] of a.keys) { const k2 = b.keys.get(f); if (!k2 || JSON.stringify(k) !== JSON.stringify(k2)) return false; }
  if (a.geo !== b.geo || a.matRef !== b.matRef) return false;
  if (JSON.stringify(a.light) !== JSON.stringify(b.light) || JSON.stringify(a.cam) !== JSON.stringify(b.cam)) return false;
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
    o.ed.keys.set(id === 'popin' ? [0, Math.round(n * 0.18), Math.round(n * 0.3), n][i] ?? f : f, { p: p.toArray(), q: q.toArray(), s: s.toArray(), ...(id === 'float' || id === 'swing' || id === 'popin' ? { i: 'ease' } : {}) });
  }
}

/** World bounds of objects (lights, cameras and empty groups count as points). */
export function frameBounds(objs, doc = null) {
  const box = new THREE.Box3();
  for (const o of objs) {
    if (doc ? !doc.isShown(o) : !o.visible) continue;
    if (isMesh(o) || isGroup(o)) box.expandByObject(o);
    if (!isMesh(o)) box.expandByPoint(o.getWorldPosition(new THREE.Vector3()));
  }
  return box;
}

// ------------------------------------------------------------------------------- units
export const UNITS = { m: { label: 'Metres', short: 'm', k: 1 }, cm: { label: 'Centimetres', short: 'cm', k: 100 }, mm: { label: 'Millimetres', short: 'mm', k: 1000 }, in: { label: 'Inches', short: 'in', k: 39.3700787 }, ft: { label: 'Feet', short: 'ft', k: 3.2808399 } };
export const unitK = (u) => (UNITS[u] || UNITS.m).k;
