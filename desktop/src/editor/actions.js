// Editing operations on the document (all undoable through doc.transact).
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { buildShape, SHAPES, defaultParams } from '../core/shapes.js';
import { buildText, defaultTextSpec, parseFont, cachedFont } from '../core/text.js';
import { cloneGeometry, computeNormals, subdivide, smoothInPlace, flatShaded, smoothShaded, flipWinding, projectUvs, applyMatrix, normalize, bumpTopo, merge as mergeGeos, fromArrays, weldInfo, removeUnused } from '../core/mesh.js';
import { makeMesh, makeLight, makeCamera, makeGroup, newMaterial, isMesh, isLight, isCamera, isGroup, prepareGeometry, syncTextures, frameBounds, copyKeys } from './model.js';
import { decimate } from './io.js';
import { stickerTexture } from './textures.js';
import { loadFont } from './fonts.js';

/** Replaces geometry during a live drag, freeing the previous temporary one (never one held by undo). */
function swapLive(o, geo) {
  const old = o.geometry;
  if (o.ed.liveTemp && o.ed.liveTemp === old) { old.disposeBoundsTree?.(); old.dispose(); }
  o.geometry = geo; o.ed.liveTemp = geo;
}

export const PALETTE = [0xd9d9de, 0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x38d9a9, 0x4dabf7, 0x748ffc, 0xda77f2, 0xf783ac, 0x8d6e63, 0x343a40];
const _m = new THREE.Matrix4();

/** Re-expresses a world matrix in `parent`'s space (null = scene root) and writes it to o's TRS. */
function setWorldMatrix(o, world, parent) {
  const pw = parent ? (parent.updateWorldMatrix(true, false), parent.matrixWorld) : new THREE.Matrix4();
  _m.copy(pw).invert().multiply(world).decompose(o.position, o.quaternion, o.scale);
}

export class Actions {
  constructor(ed) { this.ed = ed; this.doc = ed.doc; this.vp = ed.vp; }

  // ------------------------------------------------------------------ adding
  /** Where a new object goes: on the floor at the view centre, nudged sideways so it doesn't overlap. */
  dropPoint(geo, scale = 1) {
    const t = this.vp.cam.target;
    const bb = (geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox)).clone();
    bb.min.multiplyScalar(scale); bb.max.multiplyScalar(scale);
    const meshes = this.doc.meshes.filter((m) => this.doc.isShown(m));
    const p = new THREE.Vector3(meshes.length ? t.x : 0, -bb.min.y, meshes.length ? t.z : 0);
    if (!meshes.length) return p;
    const boxes = meshes.map((m) => new THREE.Box3().setFromObject(m));
    const w = bb.max.x - bb.min.x;
    for (let i = 0; i < 40; i++) {
      const cand = bb.clone().translate(p);
      const hit = boxes.find((b) => b.intersectsBox(cand.clone().expandByScalar(-0.001)));
      if (!hit) break;
      p.x = hit.max.x - bb.min.x + Math.max(0.05, w * 0.1);
    }
    return p;
  }
  addObject(o, label = 'Add ' + o.name, at = null) {
    this.doc.transact(label, () => {
      if (at) o.position.copy(at);
      this.doc.attach(o); this.doc.select(o);
    }, []);
    this.ed.toast(`${o.name} added`);
    return o;
  }
  addShape(type, params = null) {
    const prm = { ...defaultParams(type), ...(params || {}) };
    const geo = buildShape(type, prm);
    prepareGeometry(geo);
    const o = makeMesh(geo, this.doc.uniqueName(SHAPES[type].label), newMaterial({ color: type === 'TERRAIN' ? 0xffffff : 0xd9d9de }));
    o.ed.prim = { type, params: prm };
    if (geo.attributes.color) o.material.vertexColors = true;
    if (type === 'PLANE' || type === 'TERRAIN') o.material.side = THREE.DoubleSide;
    return this.addObject(o, 'Add ' + SHAPES[type].label, this.dropPoint(geo));
  }
  rebuildPrimitive(o, params, live = false) {
    const geo = buildShape(o.ed.prim.type, params);
    if (live) { // live slider drag: no undo record
      swapLive(o, prepareGeometry(geo)); o.ed.prim = { type: o.ed.prim.type, params: { ...params } }; this.doc.touch(); return;
    }
    this.doc.transact('Edit shape', () => { o.geometry = prepareGeometry(geo); o.ed.prim = { type: o.ed.prim.type, params: { ...params } }; }, [o]);
  }
  sceneCentre() {
    const box = frameBounds(this.doc.meshes, this.doc);
    return { c: box.isEmpty() ? new THREE.Vector3(0, 0.5, 0) : box.getCenter(new THREE.Vector3()), size: box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length() };
  }
  addLight(type) {
    const o = makeLight(type, this.doc.uniqueName({ point: 'Point light', spot: 'Spot light', directional: 'Sun light' }[type]));
    const { c, size } = this.sceneCentre();
    o.position.set(c.x + size * 0.6, c.y + size * 0.8, c.z + size * 0.6);
    if (type !== 'point') o.lookAt(c);
    if (this.vp.render.env !== 'DARK' && !this.ed.settings.seenLightTip) { this.ed.settings.seenLightTip = true; this.ed.saveSettings(); setTimeout(() => this.ed.hint('Lights are easiest to see with the “Lights only” environment (Scene tab).'), 600); }
    return this.addObject(o, 'Add light');
  }
  /** A camera placed where the viewport camera is, looking the same way. */
  addCamera() {
    const o = makeCamera(this.doc.uniqueName('Camera'), { fov: this.vp.render.fov });
    this.vp.camera.updateMatrixWorld(true);
    this.vp.camera.matrixWorld.decompose(o.position, o.quaternion, new THREE.Vector3());
    return this.addObject(o, 'Add camera');
  }
  alignCameraToView(o = this.sel()) {
    if (!isCamera(o)) return;
    this.vp.camera.updateMatrixWorld(true);
    const w = new THREE.Matrix4().compose(this.vp.camera.position, this.vp.camera.quaternion, o.getWorldScale(new THREE.Vector3()));
    this.doc.transact('Align camera to view', () => { setWorldMatrix(o, w, this.doc.parentOf(o)); o.ed.camera.fov = this.vp.render.fov; o.ed.camera.updateProjectionMatrix(); }, [o]);
  }
  addEmpty() {
    const o = makeGroup(this.doc.uniqueName('Empty'));
    o.position.copy(this.vp.cam.target);
    return this.addObject(o, 'Add empty');
  }
  async addText(spec = defaultTextSpec(), at = null) {
    const font = await loadFont(spec.font);
    const geo = buildText(font, spec);
    if (!geo) { this.ed.toast('Type some text first'); return null; }
    prepareGeometry(geo);
    const o = makeMesh(geo, this.doc.uniqueName(spec.text.split('\n')[0].slice(0, 24) || 'Text'), newMaterial({ color: 0xf2f2f5, roughness: 0.35 }));
    o.ed.text = { ...spec };
    const width = geo.boundingBox.max.x - geo.boundingBox.min.x;
    if (width > 2.4) o.scale.setScalar(2.4 / width); // start at a comfortable size
    return this.addObject(o, 'Add text', at || this.dropPoint(geo, o.scale.x));
  }
  async rebuildText(o, spec, live = false) {
    const font = await loadFont(spec.font);
    const geo = buildText(font, spec);
    if (!geo) return false;
    prepareGeometry(geo);
    const name = spec.text.split('\n')[0].slice(0, 24) || 'Text';
    if (live) { swapLive(o, geo); o.ed.text = { ...spec }; this.doc.touch(); return true; }
    this.doc.transact('Edit text', () => { o.geometry = geo; o.ed.text = { ...spec }; if (!o.ed.renamed) o.name = this.doc.uniqueName(name, o); }, [o]);
    return true;
  }
  addGeometry(geo, name, opts = {}) {
    prepareGeometry(geo);
    const o = makeMesh(geo, this.doc.uniqueName(name), newMaterial(opts));
    return this.addObject(o, 'Add ' + name, opts.at || this.dropPoint(geo));
  }
  /** Adds imported objects (already parented among themselves through ed.parent). */
  addObjects(objs, label) {
    this.doc.transact(label, () => { for (const o of objs) { o.name = this.doc.uniqueName(o.name || 'Mesh'); this.doc.attach(o); } this.doc.setSelection(objs.filter((o) => !objs.includes(o.ed.parent))); }, []);
  }

  // ------------------------------------------------------------------ selection
  sel() { return this.doc.selected; }
  /** Top-level selected objects (or the given one). */
  targets(o = null) { return o ? [o] : this.doc.topSelected(); }
  selectAll() { this.doc.setSelection(this.doc.roots().filter((o) => this.doc.isShown(o))); }
  selectNone() { this.doc.setSelection([]); }
  selectInvert() { const top = this.doc.roots(); this.doc.setSelection(top.filter((o) => !this.doc.isSelected(o) && this.doc.isShown(o))); }
  selectChildren() { const c = this.doc.selection.flatMap((o) => this.doc.children(o)); if (c.length) this.doc.setSelection(c); }
  selectParent() { const p = [...new Set(this.doc.selection.map((o) => this.doc.parentOf(o)).filter(Boolean))]; if (p.length) this.doc.setSelection(p); }
  selectHierarchy() { const all = this.doc.selection.flatMap((o) => [o, ...this.doc.descendants(o)]); this.doc.setSelection(all, this.doc.selected); }
  selectSimilar() {
    const o = this.sel(); if (!o) return;
    const list = this.doc.objects.filter((x) => x.ed.kind === o.ed.kind && this.doc.isShown(x) && (!isMesh(o) || x.material === o.material || (x.material.color.equals(o.material.color))));
    this.doc.setSelection(list, o);
  }
  /** Steps the selection to the previous/next object in tree order. */
  cycle(dir) {
    const order = this.doc.treeOrder(); if (!order.length) return;
    const i = order.indexOf(this.sel());
    this.doc.select(order[(i + dir + order.length) % order.length]);
  }

  // ------------------------------------------------------------------ object ops
  cloneObject(o) {
    let c;
    if (isMesh(o)) {
      c = makeMesh(cloneGeometry(o.geometry), o.name, o.material.clone());
      c.material.userData = JSON.parse(JSON.stringify({ ...o.material.userData }));
      c.ed.prim = o.ed.prim ? JSON.parse(JSON.stringify(o.ed.prim)) : null; c.ed.text = o.ed.text ? { ...o.ed.text } : null;
      c.castShadow = o.castShadow;
    } else if (isLight(o)) {
      c = makeLight(o.ed.lightType, o.name);
      const a = o.ed.light, b = c.ed.light; b.color.copy(a.color); b.intensity = a.intensity; b.distance = a.distance; if (a.isSpotLight) { b.angle = a.angle; b.penumbra = a.penumbra; } b.castShadow = a.castShadow;
    } else if (isCamera(o)) {
      const k = o.ed.camera; c = makeCamera(o.name, { fov: k.fov, aspect: k.aspect, near: k.near, far: k.far });
    } else c = makeGroup(o.name);
    c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale); c.visible = o.visible;
    c.ed.keys = copyKeys(o.ed.keys); c.ed.props = o.ed.props.map((x) => [...x]); c.ed.noExport = o.ed.noExport; c.ed.collision = o.ed.collision; c.ed.locked = o.ed.locked;
    return c;
  }
  /** Copies the selected objects (with their children) beside the originals. */
  duplicate(o = null, { offset = true, select = true, label = 'Duplicate' } = {}) {
    const tops = this.targets(o); if (!tops.length) return [];
    let out = [];
    this.doc.transact(label, () => { out = this._duplicate(tops, offset); if (select) this.doc.setSelection(out); }, []);
    return out;
  }
  /** Clones subtrees into the document (call inside a transaction). Returns the new top objects. */
  _duplicate(tops, offset = true) {
    const out = [];
    const box = frameBounds(tops, this.doc), dx = offset && !box.isEmpty() ? Math.max(0.1, box.getSize(new THREE.Vector3()).x * 1.15) : 0;
    for (const top of tops) {
      const tree = [top, ...this.doc.descendants(top)], map = new Map();
      for (const x of tree) { const c = this.cloneObject(x); c.name = this.doc.uniqueName(x.name); map.set(x, c); }
      for (const x of tree) map.get(x).ed.parent = x === top ? this.doc.parentOf(top) : map.get(this.doc.parentOf(x)) || null;
      const c = map.get(top);
      if (dx) { c.position.x += dx; for (const k of c.ed.keys.values()) k.p[0] += dx; }
      const last = tree.reduce((m, x) => Math.max(m, this.doc.objects.indexOf(x)), 0);
      tree.forEach((x, i) => this.doc.attach(map.get(x), last + 1 + i));
      out.push(c);
    }
    return out;
  }
  remove(o = null) {
    const tops = this.targets(o); if (!tops.length) return;
    const all = [...new Set(tops.flatMap((t) => [t, ...this.doc.descendants(t)]))];
    const label = tops.length === 1 ? 'Delete ' + tops[0].name : `Delete ${tops.length} objects`;
    this.doc.transact(label, () => { for (const x of all) this.doc.detach(x); }, []);
    this.ed.toast(`${label.replace('Delete', 'Deleted')} — Ctrl+Z to undo`);
  }
  rename(o, name) { if (!name || name === o.name) return; this.doc.transact('Rename', () => { o.name = name; o.ed.renamed = true; }, [o]); }
  setVisible(o, v) { const list = o ? [o] : this.doc.selection; if (!list.length) return; this.doc.transact(v ? 'Show' : 'Hide', () => list.forEach((x) => { x.visible = v; }), list); }
  toggleVisible() { const list = this.doc.selection; if (!list.length) return; const v = !list.every((x) => x.visible); this.setVisible(null, v); }
  hideUnselected() { const keep = new Set(this.doc.selection.flatMap((o) => [o, ...this.doc.ancestors(o), ...this.doc.descendants(o)])); const list = this.doc.objects.filter((o) => !keep.has(o) && o.visible); if (list.length) this.doc.transact('Hide others', () => list.forEach((x) => { x.visible = false; }), list); }
  setLocked(o, v) { const list = o ? [o] : this.doc.selection; this.doc.transact(v ? 'Lock' : 'Unlock', () => list.forEach((x) => { x.ed.locked = v; }), list); }
  showAll() { const hidden = this.doc.objects.filter((o) => !o.visible); if (hidden.length) this.doc.transact('Show all', () => hidden.forEach((o) => { o.visible = true; }), hidden); }
  /** Moves an object up/down among its siblings. */
  move(o, dir) {
    const l = this.doc.objects, sib = l.filter((x) => this.doc.parentOf(x) === this.doc.parentOf(o));
    const i = sib.indexOf(o), j = i + dir; if (j < 0 || j >= sib.length) return;
    const other = sib[j], ia = l.indexOf(o), ib = l.indexOf(other);
    this.doc.transact('Reorder', () => { l[ia] = other; l[ib] = o; }, []);
  }
  /**
   * Drag & drop in the layers tree: put `objs` before/after `target`, or inside it.
   * World transforms are kept when the parent changes.
   */
  dropOn(objs, target, where) {
    const d = this.doc;
    objs = objs.filter((o) => !objs.some((p) => p !== o && d.isAncestor(p, o))); // move subtrees once
    const newParent = target ? (where === 'inside' ? target : d.parentOf(target)) : null;
    if (newParent && objs.some((o) => o === newParent || d.isAncestor(o, newParent))) { this.ed.toast('Can’t put an object inside itself'); return; }
    if (target && objs.includes(target)) return;
    d.transact(where === 'inside' ? 'Parent to ' + target.name : 'Reorder', () => {
      for (const o of objs) this.reparent(o, newParent);
      const l = d.objects;
      for (const o of objs) l.splice(l.indexOf(o), 1);
      let at = target ? l.indexOf(target) + (where === 'before' ? 0 : 1) : l.length;
      if (where === 'inside') at = l.indexOf(target) + 1;
      l.splice(at, 0, ...objs);
      d.syncTree();
    }, objs);
  }
  /** Changes the parent keeping the world transform (and converting animation keys). */
  reparent(o, parent) {
    const d = this.doc;
    const old = d.parentOf(o); if (old === parent) return;
    o.updateWorldMatrix(true, false);
    const oldPW = old ? old.matrixWorld.clone() : new THREE.Matrix4();
    const newPW = parent ? (parent.updateWorldMatrix(true, false), parent.matrixWorld.clone()) : new THREE.Matrix4();
    const conv = newPW.clone().invert().multiply(oldPW);
    const apply = (p, q, s) => { const m = new THREE.Matrix4().compose(p, q, s).premultiply(conv); m.decompose(p, q, s); };
    apply(o.position, o.quaternion, o.scale);
    for (const k of o.ed.keys.values()) { const p = new THREE.Vector3().fromArray(k.p), q = new THREE.Quaternion().fromArray(k.q), s = new THREE.Vector3().fromArray(k.s); apply(p, q, s); k.p = p.toArray(); k.q = q.toArray(); k.s = s.toArray(); }
    o.ed.parent = parent || null;
    d.syncTree();
  }
  setParent(objs = this.doc.selection.filter((o) => o !== this.sel()), parent = this.sel()) {
    if (!parent || !objs.length) { this.ed.toast('Select the children, then the parent last'); return; }
    this.dropOn(objs, parent, 'inside');
  }
  clearParent(objs = this.doc.selection) {
    const list = objs.filter((o) => this.doc.parentOf(o)); if (!list.length) return;
    this.doc.transact('Clear parent', () => list.forEach((o) => this.reparent(o, null)), list);
  }
  /** Ctrl+G: wraps the selection in a new group placed at its base centre. */
  group(objs = this.doc.topSelected()) {
    if (!objs.length) { this.ed.toast('Select objects to group'); return null; }
    let g = null;
    this.doc.transact('Group', () => { g = this._group(objs); this.doc.select(g); }, objs);
    return g;
  }
  _group(objs, name = 'Group') {
    const d = this.doc, parents = new Set(objs.map((o) => d.parentOf(o))), parent = parents.size === 1 ? [...parents][0] : null;
    const g = makeGroup(d.uniqueName(name));
    const box = frameBounds(objs, d), c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    if (!box.isEmpty()) c.y = box.min.y; // pivot at the base, like a game-ready prefab
    g.ed.parent = parent;
    d.attach(g, Math.min(...objs.map((o) => d.objects.indexOf(o))));
    setWorldMatrix(g, new THREE.Matrix4().makeTranslation(c.x, c.y, c.z), parent);
    g.updateWorldMatrix(true, false);
    for (const o of objs) this.reparent(o, g);
    // keep the group's children right after it in the list
    const l = d.objects; for (const o of objs) l.splice(l.indexOf(o), 1);
    l.splice(l.indexOf(g) + 1, 0, ...objs);
    d.syncTree();
    return g;
  }
  ungroup(groups = this.doc.selection.filter(isGroup)) {
    if (!groups.length) { this.ed.toast('Select a group'); return; }
    const d = this.doc, kids = groups.flatMap((g) => d.children(g));
    d.transact('Ungroup', () => {
      for (const g of groups) { const p = d.parentOf(g); for (const c of d.children(g)) this.reparent(c, p); d.detach(g); }
      d.setSelection(kids);
    }, kids);
  }
  resetTransform(o = null, what = 'all') {
    const list = this.targets(o); if (!list.length) return;
    this.doc.transact('Reset transform', () => list.forEach((x) => {
      if (what === 'all' || what === 'r') x.quaternion.identity();
      if (what === 'all' || what === 's') x.scale.set(1, 1, 1);
      if (what === 'p') x.position.set(0, 0, 0);
    }), list);
  }
  dropToFloor(o = null) {
    const list = this.targets(o).filter((x) => isMesh(x) || this.doc.descendants(x).some(isMesh)); if (!list.length) return;
    this.doc.transact('Drop to floor', () => list.forEach((x) => {
      x.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(x, true);
      if (b.isEmpty()) return;
      const w = x.matrixWorld.clone().premultiply(new THREE.Matrix4().makeTranslation(0, -b.min.y, 0));
      setWorldMatrix(x, w, this.doc.parentOf(x));
    }), list);
  }
  mirror(o = null, axis = 'x') { const list = this.targets(o); if (!list.length) return; this.doc.transact('Mirror', () => list.forEach((x) => { x.scale[axis] *= -1; }), list); }
  /** Bakes position/rotation/scale (or only some of them) into the vertices. */
  applyTransform(o = null, what = 'all') {
    const list = this.targets(o).filter(isMesh); if (!list.length) return;
    const hadKeys = list.some((x) => x.ed.keys.size);
    const geos = list.map((x) => {
      x.updateMatrix();
      const m = what === 'scale' ? new THREE.Matrix4().makeScale(x.scale.x, x.scale.y, x.scale.z) : what === 'rs' ? new THREE.Matrix4().compose(new THREE.Vector3(), x.quaternion, x.scale) : x.matrix.clone();
      const g = cloneGeometry(x.geometry); applyMatrix(g, m); bumpTopo(g); return [g, m];
    });
    this.doc.transact(what === 'scale' ? 'Apply scale' : what === 'rs' ? 'Apply rotation & scale' : 'Apply transform', () => list.forEach((x, i) => {
      x.geometry = prepareGeometry(geos[i][0]); x.ed.prim = null; x.ed.text = null;
      if (what === 'all') x.position.set(0, 0, 0);
      if (what !== 'scale') x.quaternion.identity();
      x.scale.set(1, 1, 1);
      // children keep their place
      for (const c of this.doc.children(x)) c.applyMatrix4(geos[i][1]);
      x.ed.keys = new Map();
    }), [...list, ...list.flatMap((x) => this.doc.children(x))]);
    if (list.some((x) => x.ed.keys?.size === 0) && hadKeys) this.ed.toast('Animation keys on these objects were cleared – Ctrl+Z to undo');
  }
  /** Moves the pivot to the geometry's centre or bottom without moving the mesh. */
  setOrigin(o = null, where = 'center') {
    const list = this.targets(o).filter(isMesh); if (!list.length) return;
    const data = list.map((x) => {
      const g = cloneGeometry(x.geometry); g.computeBoundingBox();
      const c = where === 'cursor' ? x.worldToLocal(this.vp.cam.target.clone()) : g.boundingBox.getCenter(new THREE.Vector3()); if (where === 'bottom') c.y = g.boundingBox.min.y;
      g.translate(-c.x, -c.y, -c.z);
      return { x, g, c };
    });
    this.doc.transact('Set origin', () => data.forEach(({ x, g, c }) => {
      const shift = c.clone().multiply(x.scale).applyQuaternion(x.quaternion);
      x.geometry = prepareGeometry(g); x.position.add(shift); x.ed.prim = null; x.ed.text = null;
      for (const ch of this.doc.children(x)) ch.position.sub(c);
      for (const k of x.ed.keys.values()) { const ks = c.clone().multiply(new THREE.Vector3().fromArray(k.s)).applyQuaternion(new THREE.Quaternion().fromArray(k.q)); k.p = [k.p[0] + ks.x, k.p[1] + ks.y, k.p[2] + ks.z]; }
    }), [...list, ...list.flatMap((x) => this.doc.children(x))]);
  }
  /** Turns a parametric shape or text into a plain editable mesh. */
  makeEditable(o = this.sel(), silent = false) {
    if (!isMesh(o) || (!o.ed.prim && !o.ed.text)) return;
    this.doc.transact('Make editable', () => { o.ed.prim = null; o.ed.text = null; }, [o]);
    if (!silent) this.ed.toast('Now a free-form mesh');
  }
  geoOp(label, fn, o = this.sel()) {
    if (!isMesh(o)) return;
    const busy = o.geometry.index.count > 3e6 ? this.ed.busy(label + '…') : null;
    try {
      const g = fn(o.geometry);
      if (!g) return;
      bumpTopo(g);
      this.doc.transact(label, () => { o.geometry = prepareGeometry(g); o.ed.prim = null; o.ed.text = null; }, [o]);
    } finally { busy?.close(); }
  }
  subdivide(o, smooth = true) {
    if (o.geometry.index.count / 3 > 1.5e6) { this.ed.toast('Mesh is already very dense'); return; }
    this.geoOp('Subdivide', (g) => subdivide(g, smooth), o);
  }
  smooth(o, it = 3) { this.geoOp('Smooth', (g) => { const c = cloneGeometry(g); smoothInPlace(c, it); computeNormals(c); return c; }, o); }
  decimate(o, ratio) { this.geoOp('Decimate', (g) => decimate(g, ratio), o); }
  setFlat(o, flat) {
    this.geoOp(flat ? 'Flat shading' : 'Smooth shading', (g) => { const c = flat ? flatShaded(cloneGeometry(g)) : smoothShaded(cloneGeometry(g)); c.userData.flat = flat; computeNormals(c); return c; }, o);
  }
  flipNormals(o) { this.geoOp('Flip normals', (g) => { const c = cloneGeometry(g); flipWinding(c); computeNormals(c); return c; }, o); }
  projectUvs(o, mode) { this.geoOp('UV projection', (g) => { const c = cloneGeometry(g); projectUvs(c, mode); return c; }, o); }
  /** Joins the selected meshes into the active one (or all visible meshes when only one is selected). */
  join(o = this.sel(), all = false) {
    const d = this.doc;
    let others = (all || d.selection.length < 2 ? d.meshes.filter((m) => d.isShown(m)) : d.selection.filter(isMesh)).filter((m) => m !== o && !d.isAncestor(m, o));
    if (!isMesh(o) || !others.length) { this.ed.toast('Select two or more meshes to join'); return; }
    o.updateMatrixWorld(true);
    const inv = o.matrixWorld.clone().invert();
    const diffMat = others.some((m) => m.material !== o.material && (m.material.map || m.material.color.getHex() !== o.material.color.getHex()));
    const parts = [cloneGeometry(o.geometry), ...others.map((m) => { m.updateMatrixWorld(true); const g = cloneGeometry(m.geometry); applyMatrix(g, inv.clone().multiply(m.matrixWorld)); return g; })];
    const g = mergeGeos(parts); bumpTopo(g);
    const kids = others.flatMap((m) => d.children(m).filter((c) => !others.includes(c)));
    d.transact('Join', () => {
      for (const c of kids) this.reparent(c, o);
      o.geometry = prepareGeometry(g); o.ed.prim = null; o.ed.text = null; for (const m of others) d.detach(m); d.select(o);
    }, [o, ...others, ...kids]);
    if (diffMat) this.ed.toast(`Joined — the result uses ${o.name}’s material`);
  }
  joinAll(o = this.sel()) { this.join(o, true); }

  // ------------------------------------------------------------------ booleans (Tinkercad / Shapr3D style)
  /**
   * Union / subtract / intersect: the active object is the base, the other selected meshes are
   * the tools (they're removed afterwards, Ctrl+Z brings them back).
   */
  boolean(op) {
    const d = this.doc, base = this.sel();
    const tools = d.selection.filter((x) => isMesh(x) && x !== base);
    if (!isMesh(base) || !tools.length) { this.ed.toast('Select the tool object(s), then the base object last'); return false; }
    const b = this.ed.busy({ union: 'Combining…', subtract: 'Cutting…', intersect: 'Intersecting…' }[op]);
    try {
      const withUv = [base, ...tools].every((x) => x.geometry.attributes.uv), withColor = [base, ...tools].some((x) => x.geometry.attributes.color && x.material.vertexColors);
      const brush = (o) => {
        o.updateMatrixWorld(true);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', o.geometry.attributes.position.clone());
        g.setAttribute('normal', o.geometry.attributes.normal.clone());
        if (withUv) g.setAttribute('uv', o.geometry.attributes.uv.clone());
        if (withColor) { const c = o.geometry.attributes.color && o.material.vertexColors ? o.geometry.attributes.color.clone() : new THREE.BufferAttribute(new Float32Array(o.geometry.attributes.position.count * 4).fill(1), 4); g.setAttribute('color', c); }
        g.setIndex(o.geometry.index.clone());
        const br = new Brush(g); br.matrix.copy(o.matrixWorld); br.matrixAutoUpdate = false; br.matrixWorld.copy(o.matrixWorld);
        return br;
      };
      const ev = new Evaluator(); ev.useGroups = false; ev.attributes = ['position', 'normal', ...(withUv ? ['uv'] : []), ...(withColor ? ['color'] : [])];
      let acc = brush(base);
      const kind = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION }[op];
      for (const t of tools) { const r = ev.evaluate(acc, brush(t), kind); r.matrix.identity(); r.matrixWorld.identity(); r.matrixAutoUpdate = false; acc = new Brush(r.geometry); acc.matrixAutoUpdate = false; acc.matrix.identity(); acc.matrixWorld.identity(); }
      let g = acc.geometry;
      if (!g.attributes.position.count) { this.ed.toast(op === 'intersect' ? 'The objects don’t overlap' : 'Nothing left after the operation'); return false; }
      g.applyMatrix4(base.matrixWorld.clone().invert());
      g = weldBoolean(g);
      if (base.matrixWorld.determinant() < 0) flipWinding(g);
      g.userData.flat = !!base.geometry.userData.flat;
      bumpTopo(g);
      const kids = tools.flatMap((t) => d.children(t).filter((c) => !tools.includes(c)));
      d.transact({ union: 'Union', subtract: 'Subtract', intersect: 'Intersect' }[op], () => {
        for (const c of kids) this.reparent(c, base);
        base.geometry = prepareGeometry(g); base.ed.prim = null; base.ed.text = null;
        for (const t of tools) d.detach(t);
        d.select(base);
      }, [base, ...tools, ...kids]);
      this.ed.toast(`${{ union: 'Combined', subtract: 'Cut', intersect: 'Intersected' }[op]} · ${(g.index.count / 3).toLocaleString()} triangles`);
      return true;
    } catch (e) { console.error(e); this.ed.toast('Boolean failed: ' + e.message, 4000); return false; }
    finally { b.close(); }
  }

  // ------------------------------------------------------------------ arrays / align / distribute
  /** Linear or radial copies, collected in a group with the original. */
  array(o, { count = 5, mode = 'linear', axis = 'x', gap = 0.2, angle = 360, radius = 0, rotate = true } = {}) {
    const d = this.doc; o = o || this.sel(); if (!o || count < 2) return;
    const box = frameBounds([o], d), size = box.isEmpty() ? new THREE.Vector3(0.3, 0.3, 0.3) : box.getSize(new THREE.Vector3());
    d.transact('Array', () => {
      const g = this._group([o], o.name + ' array');
      const step = new THREE.Vector3().setComponent('xyz'.indexOf(axis), size.getComponent('xyz'.indexOf(axis)) + gap);
      const copies = [];
      for (let i = 1; i < count; i++) {
        const [c] = this._duplicate([o], false);
        if (mode === 'linear') c.position.addScaledVector(step, i);
        else {
          const a = THREE.MathUtils.degToRad(angle) * i / (angle >= 360 ? count : count - 1), r = radius || Math.max(size.x, size.z) * count / (2 * Math.PI) * 1.3;
          const p0 = o.position.clone(); c.position.set(p0.x + Math.sin(a) * r, p0.y, p0.z + Math.cos(a) * r - r);
          if (rotate) c.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
        }
        copies.push(c);
      }
      // list the copies in creation order right after the original
      const l = d.objects, trees = copies.map((c) => [c, ...d.descendants(c)]).flat();
      for (const x of trees) l.splice(l.indexOf(x), 1);
      const after = [o, ...d.descendants(o)].reduce((m, x) => Math.max(m, l.indexOf(x)), 0);
      l.splice(after + 1, 0, ...trees);
      d.select(g);
    }, [o]);
  }
  /** Aligns the selected objects' bounds (min / centre / max) on a world axis. */
  align(axis, where) {
    const d = this.doc, list = d.topSelected(); if (list.length < 2) { this.ed.toast('Select two or more objects'); return; }
    const i = 'xyz'.indexOf(axis), all = frameBounds(list, d), target = where === 'min' ? all.min.getComponent(i) : where === 'max' ? all.max.getComponent(i) : all.getCenter(new THREE.Vector3()).getComponent(i);
    d.transact('Align', () => list.forEach((o) => {
      const b = frameBounds([o], d); if (b.isEmpty()) return;
      const cur = where === 'min' ? b.min.getComponent(i) : where === 'max' ? b.max.getComponent(i) : b.getCenter(new THREE.Vector3()).getComponent(i);
      this.translateWorld(o, new THREE.Vector3().setComponent(i, target - cur));
    }), list);
  }
  /** Spreads the selected objects evenly (by centre) between the outermost two. */
  distribute(axis) {
    const d = this.doc, list = d.topSelected(); if (list.length < 3) { this.ed.toast('Select three or more objects'); return; }
    const i = 'xyz'.indexOf(axis), cs = list.map((o) => [o, frameBounds([o], d).getCenter(new THREE.Vector3()).getComponent(i)]).sort((a, b) => a[1] - b[1]);
    const a = cs[0][1], b = cs[cs.length - 1][1];
    d.transact('Distribute', () => cs.forEach(([o, c], k) => this.translateWorld(o, new THREE.Vector3().setComponent(i, a + (b - a) * k / (cs.length - 1) - c))), list);
  }
  translateWorld(o, delta) {
    o.updateWorldMatrix(true, false);
    const w = o.matrixWorld.clone().premultiply(new THREE.Matrix4().makeTranslation(delta.x, delta.y, delta.z));
    setWorldMatrix(o, w, this.doc.parentOf(o));
  }
  /** Arrow-key nudge in world space (one undo step per press). */
  nudge(delta) {
    const list = this.doc.topSelected().filter((o) => !o.ed.locked); if (!list.length) return;
    this.doc.transact('Nudge', () => list.forEach((o) => { this.translateWorld(o, delta); if (this.ed.mode === 'animate' && this.ed.autoKey) this.doc.setKey(o); }), list);
  }

  // ------------------------------------------------------------------ mesh cleanup
  /** Welds vertices closer than `dist` (keeps UV seams and hard edges). */
  mergeByDistance(o, dist = 0.0001) {
    let removed = 0;
    this.geoOp('Merge by distance', (g) => {
      const c = cloneGeometry(g); const before = c.attributes.position.count;
      c.deleteAttribute('normal');
      const m = mergeVertices(c, Math.max(1e-7, dist));
      m.userData = { flat: !!g.userData.flat, topo: 0 };
      const out = normalize(m); computeNormals(out);
      removed = before - out.attributes.position.count;
      return removed > 0 ? out : null;
    }, o);
    this.ed.toast(removed > 0 ? `Merged ${removed.toLocaleString()} vertices` : 'Nothing to merge');
  }
  /** Removes zero-area triangles and unused vertices. */
  removeDegenerate(o) {
    let n = 0;
    this.geoOp('Remove degenerate faces', (g) => {
      const p = g.attributes.position.array, idx = g.index.array, keep = [];
      const box = g.boundingBox || (g.computeBoundingBox(), g.boundingBox), eps = Math.pow(box.min.distanceTo(box.max) * 1e-7, 2);
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        const x = e1[1] * e2[2] - e1[2] * e2[1], y = e1[2] * e2[0] - e1[0] * e2[2], z = e1[0] * e2[1] - e1[1] * e2[0];
        if (x * x + y * y + z * z > eps) keep.push(idx[t], idx[t + 1], idx[t + 2]); else n++;
      }
      if (!n) return null;
      const c = cloneGeometry(g); c.setIndex(new THREE.BufferAttribute(Uint32Array.from(keep), 1));
      return removeUnused(c);
    }, o);
    this.ed.toast(n ? `Removed ${n.toLocaleString()} degenerate triangles` : 'No degenerate triangles');
  }
  /** Makes every triangle face the same way, pointing outwards. */
  recalcNormals(o) {
    let flipped = 0;
    this.geoOp('Recalculate normals', (g) => { const c = cloneGeometry(g); flipped = orientOutward(c); computeNormals(c); return c; }, o);
    this.ed.toast(flipped ? `Fixed ${flipped.toLocaleString()} inverted triangles` : 'Normals are consistent');
  }
  /** Splits disconnected pieces into separate objects. */
  separateLoose(o = this.sel()) {
    if (!isMesh(o)) return;
    const comps = components(o.geometry);
    if (comps.length < 2) { this.ed.toast('This mesh is one connected piece'); return; }
    if (comps.length > 500) { this.ed.toast(`${comps.length} pieces – too many to separate`); return; }
    const g = o.geometry, idx = g.index.array, d = this.doc;
    const parts = comps.map((tris) => { const I = []; for (const t of tris) I.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]); const c = cloneGeometry(g); c.setIndex(new THREE.BufferAttribute(Uint32Array.from(I), 1)); return removeUnused(c); });
    d.transact('Separate by loose parts', () => {
      o.geometry = prepareGeometry(parts[0]); o.ed.prim = null; o.ed.text = null;
      let at = d.objects.indexOf(o) + 1; const made = [o];
      for (let i = 1; i < parts.length; i++) {
        const n = makeMesh(prepareGeometry(parts[i]), d.uniqueName(o.name + ' part'), o.material);
        n.position.copy(o.position); n.quaternion.copy(o.quaternion); n.scale.copy(o.scale); n.ed.parent = d.parentOf(o);
        d.attach(n, at++); made.push(n);
      }
      d.setSelection(made, o);
    }, [o]);
    this.ed.toast(`Separated into ${parts.length} objects`);
  }

  // ------------------------------------------------------------------ face ops (edit mode)
  faceOp(label, fn) {
    const o = this.sel(), f = this.vp.faces;
    if (!isMesh(o) || !f.geo || f.isEmpty()) { this.ed.toast('Select faces first – click a face, or switch to the brush'); return; }
    const r = fn(f);
    if (!r) return;
    const geo = r.geo || r, sel = r.sel;
    bumpTopo(geo);
    this.doc.transact(label, () => { o.geometry = prepareGeometry(geo); o.ed.prim = null; o.ed.text = null; }, [o]);
    f.rebind(geo, sel || null);
    this.vp.syncFaceOverlay(); this.vp.syncGizmo(); this.ed.refresh();
  }
  deleteFaces() { this.faceOp('Delete faces', (f) => f.deleteFaces()); }
  extrude(d) { this.faceOp('Extrude', (f) => f.extrude(d)); }
  inset(a) { this.faceOp('Inset', (f) => f.inset(a)); }
  flipFaces() { this.faceOp('Flip faces', (f) => f.flipFaces()); }
  /** Interactive push/pull from the handle: live preview on drag, one undo step on release. */
  pushPull(phase, dist) {
    const o = this.sel(), f = this.vp.faces;
    if (phase === 'start') {
      if (!isMesh(o) || f.isEmpty()) return;
      this.pp = { o, base: o.geometry, sel: Uint8Array.from(f.sel), last: null };
      return;
    }
    const pp = this.pp; if (!pp) return;
    const build = () => { const saved = f.geo, savedSel = f.sel; f.geo = pp.base; f.sel = pp.sel; const r = Math.abs(dist) < 1e-6 ? null : f.extrude(dist); f.geo = saved; f.sel = savedSel; return r; };
    if (phase === 'move') {
      const r = build(); const prev = pp.last;
      pp.last = r;
      pp.o.geometry = r ? r.geo : pp.base;
      if (r) { r.geo.computeBoundingSphere(); r.geo.computeBoundingBox(); }
      if (prev && prev.geo !== pp.base) prev.geo.dispose();
      this.ed.showPushPull?.(dist);
      this.doc.touch(); return;
    }
    // end
    this.pp = null; this.ed.showPushPull?.(null);
    pp.o.geometry = pp.base;
    if (pp.last) pp.last.geo.dispose();
    const r = build();
    if (!r) { this.vp.syncGizmo(); this.doc.touch(); return; }
    bumpTopo(r.geo);
    this.doc.transact(dist > 0 ? 'Pull' : 'Push', () => { pp.o.geometry = prepareGeometry(r.geo); pp.o.ed.prim = null; pp.o.ed.text = null; }, [pp.o]);
    f.rebind(r.geo, r.sel);
    this.vp.syncFaceOverlay(); this.vp.syncGizmo(); this.ed.refresh();
  }
  /** Moves the selected faces into a new object (to give a part its own material). */
  separate(newMaterial = true) {
    const o = this.sel(), f = this.vp.faces;
    if (!isMesh(o) || !f.geo || f.isEmpty()) { this.ed.toast('Select faces first'); return null; }
    const part = f.extract(), rest = f.deleteFaces();
    if (!part) return null;
    bumpTopo(part); if (rest) bumpTopo(rest);
    const n = makeMesh(prepareGeometry(part), this.doc.uniqueName(o.name + ' part'), newMaterial ? o.material.clone() : o.material);
    if (newMaterial) { n.material.userData = JSON.parse(JSON.stringify(o.material.userData)); syncTextures(n.material); }
    n.position.copy(o.position); n.quaternion.copy(o.quaternion); n.scale.copy(o.scale); n.ed.parent = this.doc.parentOf(o);
    n.ed.keys = copyKeys(o.ed.keys);
    this.doc.transact('Separate part', () => {
      if (rest && rest.index.count) { o.geometry = prepareGeometry(rest); o.ed.prim = null; o.ed.text = null; } else this.doc.detach(o);
      this.doc.attach(n, Math.max(0, this.doc.objects.indexOf(o) + 1)); this.doc.select(n);
    }, [o]);
    f.bind(n.geometry); this.vp.syncFaceOverlay();
    return n;
  }

  // ------------------------------------------------------------------ material helpers
  material(label, fn, o = this.sel(), live = false) {
    if (!isMesh(o)) return;
    if (live) { fn(o.material); this.doc.touch(); return; }
    this.doc.transact(label, () => fn(o.material), [o]);
  }
  /** Copies the material to every other mesh (independent copies). */
  materialToAll(o = this.sel()) {
    const targets = this.doc.meshes.filter((m) => m !== o);
    if (!isMesh(o) || !targets.length) return;
    this.doc.transact('Material to all', () => { for (const t of targets) { t.material = o.material.clone(); t.material.userData = JSON.parse(JSON.stringify(o.material.userData)); syncTextures(t.material); } }, targets);
    this.ed.toast(`Material copied to ${targets.length} object${targets.length > 1 ? 's' : ''}`);
  }
  /** Shares one material between objects (one glTF material in the export – fewer draw calls). */
  linkMaterial(mat, objs = this.doc.selection.filter(isMesh)) {
    if (!mat || !objs.length) return;
    this.doc.transact('Link material', () => objs.forEach((x) => { x.material = mat; }), objs);
    this.ed.toast(objs.length > 1 ? `${objs.length} objects now share “${mat.name}”` : `Using “${mat.name}”`);
  }
  makeUnique(o = this.sel()) {
    if (!isMesh(o)) return;
    const users = this.doc.meshes.filter((x) => x.material === o.material).length;
    if (users < 2) { this.ed.toast('This material is only used here'); return; }
    this.doc.transact('Make material unique', () => { const m = o.material.clone(); m.userData = JSON.parse(JSON.stringify(o.material.userData)); m.name = o.material.name + ' copy'; syncTextures(m); o.material = m; }, [o]);
  }

  // ------------------------------------------------------------------ properties
  setProps(o, props) { this.doc.transact('Custom properties', () => { o.ed.props = props.map((x) => [...x]); }, [o]); }
  setExport(o, v) { const list = o ? [o] : this.doc.selection; this.doc.transact(v ? 'Include in export' : 'Exclude from export', () => list.forEach((x) => { x.ed.noExport = !v; }), list); }
  setCollision(o, v) { const list = (o ? [o] : this.doc.selection).filter(isMesh); this.doc.transact('Collision', () => list.forEach((x) => { x.ed.collision = v; }), list); }

  // ------------------------------------------------------------------ stickers (decals)
  placeSticker(spec) {
    this.ed.startPlacement('Click a surface to place the sticker', (hit) => {
      if (!hit || !isMesh(hit.obj)) { this.ed.toast('Click on a model'); return false; }
      const target = hit.obj;
      const n = hit.face.normal.clone().transformDirection(target.matrixWorld);
      const helper = new THREE.Object3D(); helper.position.copy(hit.point); helper.lookAt(hit.point.clone().add(n));
      const box = new THREE.Box3().setFromObject(target), size = box.getSize(new THREE.Vector3()).length() * (spec.size || 0.25);
      helper.rotateZ(THREE.MathUtils.degToRad(spec.rotation || 0));
      let geo = new DecalGeometry(target, hit.point, helper.rotation, new THREE.Vector3(size, size, size));
      if (!geo.attributes.position.count) { this.ed.toast('Could not project the sticker here'); return false; }
      // into the target's local space; the sticker becomes a child of the surface it's stuck to
      target.updateMatrixWorld(true);
      geo.applyMatrix4(target.matrixWorld.clone().invert());
      geo = normalize(geo);
      const map = spec.texture || stickerTexture(spec.kind, spec.value, spec.color);
      const m = newMaterial({ color: 0xffffff, roughness: 0.6 });
      m.map = map; m.transparent = true; m.alphaTest = 0.02; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4;
      m.userData.maps = { kind: 'sticker', name: spec.label || 'Sticker' };
      m.name = 'Sticker';
      const o = makeMesh(geo, this.doc.uniqueName((spec.label || 'Sticker')), m);
      o.castShadow = false;
      o.ed.parent = target;
      this.doc.transact('Add sticker', () => { this.doc.attach(o, this.doc.objects.indexOf(target) + 1); this.doc.select(o); }, []);
      return true;
    });
  }
}

/** Boolean output (triangle soup) → indexed mesh with shared vertices where attributes match. */
function weldBoolean(g) {
  if (!g.index) { const n = g.attributes.position.count; g.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: n }, (_, i) => i), 1)); }
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  const m = mergeVertices(g, Math.max(1e-7, box.min.distanceTo(box.max) * 1e-6));
  return normalize(m);
}
/** Connected triangle components (through welded vertices). */
function components(g) {
  const w = weldInfo(g), idx = g.index.array, tc = idx.length / 3, n = w.rep.length;
  const parent = new Int32Array(n); for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < tc; t++) { const a = find(w.rep[idx[t * 3]]); for (let k = 1; k < 3; k++) { const b = find(w.rep[idx[t * 3 + k]]); if (a !== b) parent[b] = a; } }
  const map = new Map();
  for (let t = 0; t < tc; t++) { const r = find(w.rep[idx[t * 3]]); if (!map.has(r)) map.set(r, []); map.get(r).push(t); }
  return [...map.values()].sort((a, b) => b.length - a.length);
}
/** Consistent winding per connected piece (BFS over shared edges), then outward by signed volume. Returns flipped count. */
function orientOutward(g) {
  const w = weldInfo(g), idx = g.index.array, p = g.attributes.position.array, tc = idx.length / 3;
  const edges = new Map();
  for (let t = 0; t < tc; t++) for (let k = 0; k < 3; k++) { const a = w.rep[idx[t * 3 + k]], b = w.rep[idx[t * 3 + (k + 1) % 3]]; const key = a < b ? a * 4294967296 + b : b * 4294967296 + a; const l = edges.get(key); if (l) l.push(t); else edges.set(key, [t]); }
  const dirOf = (t, a, b) => { for (let k = 0; k < 3; k++) if (w.rep[idx[t * 3 + k]] === a && w.rep[idx[t * 3 + (k + 1) % 3]] === b) return 1; return -1; };
  const flip = new Uint8Array(tc), seen = new Uint8Array(tc); let flipped = 0;
  const flipTri = (t) => { const x = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = x; flip[t] ^= 1; };
  for (const comp of components(g)) {
    const q = [comp[0]]; seen[comp[0]] = 1;
    while (q.length) {
      const t = q.pop();
      for (let k = 0; k < 3; k++) {
        const a = w.rep[idx[t * 3 + k]], b = w.rep[idx[t * 3 + (k + 1) % 3]];
        const l = edges.get(a < b ? a * 4294967296 + b : b * 4294967296 + a); if (!l || l.length !== 2) continue;
        const u = l[0] === t ? l[1] : l[0]; if (seen[u]) continue; seen[u] = 1;
        if (dirOf(u, a, b) === 1) flipTri(u); // neighbour must traverse the shared edge the other way
        q.push(u);
      }
    }
    let vol = 0;
    for (const t of comp) { const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3; vol += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]); }
    if (vol < 0) for (const t of comp) flipTri(t);
  }
  for (let t = 0; t < tc; t++) flipped += flip[t];
  g.index.needsUpdate = true;
  return flipped;
}
/** Edge statistics for the mesh check: open (boundary) and non-manifold edges, pieces. */
export function analyzeMesh(g) {
  const w = weldInfo(g), idx = g.index.array, tc = idx.length / 3, p = g.attributes.position.array;
  const edges = new Map(); let degenerate = 0, inconsistent = 0;
  for (let t = 0; t < tc; t++) {
    for (let k = 0; k < 3; k++) { const a = w.rep[idx[t * 3 + k]], b = w.rep[idx[t * 3 + (k + 1) % 3]]; const key = a < b ? a * 4294967296 + b : b * 4294967296 + a; const e = edges.get(key); const dir = a < b ? 1 : -1; if (e) { e.n++; e.d += dir; } else edges.set(key, { n: 1, d: dir }); }
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-12) degenerate++;
  }
  let open = 0, nonManifold = 0;
  for (const e of edges.values()) { if (e.n === 1) open++; else if (e.n > 2) nonManifold++; else if (e.d !== 0) inconsistent++; }
  return { triangles: tc, edges: edges.size, open, nonManifold, inconsistent, degenerate, pieces: components(g).length, watertight: open === 0 && nonManifold === 0 };
}

export { defaultTextSpec, parseFont, cachedFont, fromArrays };
