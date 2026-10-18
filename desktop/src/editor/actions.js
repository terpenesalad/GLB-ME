// Editing operations on the document (all undoable through doc.transact).
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { buildShape, SHAPES, defaultParams } from '../core/shapes.js';
import { buildText, defaultTextSpec, parseFont, cachedFont } from '../core/text.js';
import { cloneGeometry, computeNormals, subdivide, smoothInPlace, flatShaded, smoothShaded, flipWinding, projectUvs, applyMatrix, normalize, bumpTopo, merge as mergeGeos, fromArrays } from '../core/mesh.js';
import { makeMesh, makeLight, newMaterial, isMesh, isLight, prepareGeometry, syncTextures, frameBounds } from './model.js';
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

export class Actions {
  constructor(ed) { this.ed = ed; this.doc = ed.doc; this.vp = ed.vp; }

  // ------------------------------------------------------------------ adding
  /** Where a new object goes: on the floor at the view centre, nudged sideways so it doesn't overlap. */
  dropPoint(geo, scale = 1) {
    const t = this.vp.cam.target;
    const bb = (geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox)).clone();
    bb.min.multiplyScalar(scale); bb.max.multiplyScalar(scale);
    const meshes = this.doc.meshes.filter((m) => m.visible);
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
  addLight(type) {
    const o = makeLight(type, this.doc.uniqueName({ point: 'Point light', spot: 'Spot light', directional: 'Sun light' }[type]));
    const box = frameBounds(this.doc.meshes);
    const c = box.isEmpty() ? new THREE.Vector3(0, 0.5, 0) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
    o.position.set(c.x + size * 0.6, c.y + size * 0.8, c.z + size * 0.6);
    if (type !== 'point') o.lookAt(c);
    if (this.vp.render.env !== 'DARK' && !this.ed.settings.seenLightTip) { this.ed.settings.seenLightTip = true; this.ed.saveSettings(); setTimeout(() => this.ed.hint('Lights are easiest to see with the “Lights only” environment (Scene tab).'), 600); }
    return this.addObject(o, 'Add light');
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
    this.doc.transact('Edit text', () => { o.geometry = geo; o.ed.text = { ...spec }; if (o.name.startsWith(o.ed.textName || '\u0000') || !o.ed.renamed) o.name = name; }, [o]);
    return true;
  }
  addGeometry(geo, name, opts = {}) {
    prepareGeometry(geo);
    const o = makeMesh(geo, this.doc.uniqueName(name), newMaterial(opts));
    return this.addObject(o, 'Add ' + name, opts.at || this.dropPoint(geo));
  }
  addObjects(objs, label) {
    this.doc.transact(label, () => { for (const o of objs) { o.name = this.doc.uniqueName(o.name || 'Mesh'); this.doc.attach(o); } this.doc.select(objs[0]); }, []);
  }

  // ------------------------------------------------------------------ object ops
  sel() { return this.doc.selected; }
  duplicate(o = this.sel()) {
    if (!o) return;
    let c;
    if (isMesh(o)) {
      c = makeMesh(cloneGeometry(o.geometry), this.doc.uniqueName(o.name), o.material.clone());
      c.material.userData = JSON.parse(JSON.stringify({ ...o.material.userData }));
      c.ed.prim = o.ed.prim ? JSON.parse(JSON.stringify(o.ed.prim)) : null; c.ed.text = o.ed.text ? { ...o.ed.text } : null;
    } else {
      c = makeLight(o.ed.lightType, this.doc.uniqueName(o.name));
      const a = o.ed.light, b = c.ed.light; b.color.copy(a.color); b.intensity = a.intensity; b.distance = a.distance; if (a.isSpotLight) { b.angle = a.angle; b.penumbra = a.penumbra; } b.castShadow = a.castShadow;
    }
    c.position.copy(o.position); c.quaternion.copy(o.quaternion); c.scale.copy(o.scale);
    const size = isMesh(o) ? new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()) : new THREE.Vector3(0.3, 0, 0);
    c.position.x += Math.max(0.1, size.x * 1.15);
    c.ed.keys = new Map([...o.ed.keys].map(([f, k]) => [f, { p: [k.p[0] + Math.max(0.1, size.x * 1.15), k.p[1], k.p[2]], q: [...k.q], s: [...k.s] }]));
    this.doc.transact('Duplicate', () => { this.doc.attach(c, this.doc.objects.indexOf(o) + 1); this.doc.select(c); }, []);
  }
  remove(o = this.sel()) {
    if (!o) return;
    this.doc.transact('Delete ' + o.name, () => this.doc.detach(o), []);
    this.ed.toast(`Deleted ${o.name} — Ctrl+Z to undo`);
  }
  rename(o, name) { if (!name || name === o.name) return; this.doc.transact('Rename', () => { o.name = name; o.ed.renamed = true; }, [o]); }
  setVisible(o, v) { this.doc.transact(v ? 'Show' : 'Hide', () => { o.visible = v; }, [o]); }
  setLocked(o, v) { this.doc.transact(v ? 'Lock' : 'Unlock', () => { o.ed.locked = v; }, [o]); }
  showAll() { const hidden = this.doc.objects.filter((o) => !o.visible); if (hidden.length) this.doc.transact('Show all', () => hidden.forEach((o) => { o.visible = true; }), hidden); }
  move(o, dir) {
    const i = this.doc.objects.indexOf(o), j = i + dir;
    if (j < 0 || j >= this.doc.objects.length) return;
    this.doc.transact('Reorder', () => { const l = this.doc.objects; [l[i], l[j]] = [l[j], l[i]]; }, []);
  }
  reorder(o, toIndex) {
    const l = this.doc.objects, i = l.indexOf(o); if (i < 0 || i === toIndex) return;
    this.doc.transact('Reorder', () => { l.splice(i, 1); l.splice(Math.min(l.length, toIndex > i ? toIndex - 1 : toIndex), 0, o); }, []);
  }
  resetTransform(o = this.sel(), what = 'all') {
    if (!o) return;
    this.doc.transact('Reset transform', () => {
      if (what === 'all' || what === 'r') o.quaternion.identity();
      if (what === 'all' || what === 's') o.scale.set(1, 1, 1);
      if (what === 'p') o.position.set(0, 0, 0);
    }, [o]);
  }
  dropToFloor(o = this.sel()) {
    if (!isMesh(o)) return;
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o, true);
    this.doc.transact('Drop to floor', () => { o.position.y -= b.min.y; }, [o]);
  }
  mirror(o = this.sel(), axis = 'x') { if (!o) return; this.doc.transact('Mirror', () => { o.scale[axis] *= -1; }, [o]); }
  /** Bakes position/rotation/scale into the vertices. */
  applyTransform(o = this.sel()) {
    if (!isMesh(o)) return;
    o.updateMatrix();
    const g = cloneGeometry(o.geometry);
    applyMatrix(g, o.matrix); bumpTopo(g);
    this.doc.transact('Apply transform', () => { o.geometry = prepareGeometry(g); o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); o.ed.prim = null; o.ed.text = null; o.ed.keys = new Map(); }, [o]);
  }
  /** Moves the pivot to the geometry's centre or bottom without moving the mesh. */
  setOrigin(o = this.sel(), where = 'center') {
    if (!isMesh(o)) return;
    const g = cloneGeometry(o.geometry); g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3()); if (where === 'bottom') c.y = g.boundingBox.min.y;
    g.translate(-c.x, -c.y, -c.z);
    const shift = c.clone().multiply(o.scale).applyQuaternion(o.quaternion);
    this.doc.transact('Set origin', () => {
      o.geometry = prepareGeometry(g); o.position.add(shift); o.ed.prim = null; o.ed.text = null;
      for (const k of o.ed.keys.values()) { const ks = c.clone().multiply(new THREE.Vector3().fromArray(k.s)).applyQuaternion(new THREE.Quaternion().fromArray(k.q)); k.p = [k.p[0] + ks.x, k.p[1] + ks.y, k.p[2] + ks.z]; }
    }, [o]);
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
  /** Merges other visible meshes into the selected one. */
  joinAll(o = this.sel()) {
    const others = this.doc.meshes.filter((m) => m !== o && m.visible);
    if (!isMesh(o) || !others.length) return;
    o.updateMatrixWorld(true);
    const inv = o.matrixWorld.clone().invert();
    const parts = [cloneGeometry(o.geometry), ...others.map((m) => { m.updateMatrixWorld(true); const g = cloneGeometry(m.geometry); applyMatrix(g, inv.clone().multiply(m.matrixWorld)); return g; })];
    const g = mergeGeos(parts); bumpTopo(g);
    this.doc.transact('Join', () => { o.geometry = prepareGeometry(g); o.ed.prim = null; o.ed.text = null; for (const m of others) this.doc.detach(m); }, [o, ...others]);
  }

  // ------------------------------------------------------------------ face ops (edit mode)
  faceOp(label, fn) {
    const o = this.sel(), f = this.vp.faces;
    if (!isMesh(o) || !f.geo || f.isEmpty()) { this.ed.toast('Paint a selection on the mesh first'); return; }
    const r = fn(f);
    if (!r) return;
    const geo = r.geo || r, sel = r.sel;
    bumpTopo(geo);
    this.doc.transact(label, () => { o.geometry = prepareGeometry(geo); o.ed.prim = null; o.ed.text = null; }, [o]);
    f.rebind(geo, sel || null);
    this.vp.syncFaceOverlay(); this.ed.refresh();
  }
  deleteFaces() { this.faceOp('Delete faces', (f) => f.deleteFaces()); }
  extrude(d) { this.faceOp('Extrude', (f) => f.extrude(d)); }
  inset(a) { this.faceOp('Inset', (f) => f.inset(a)); }
  flipFaces() { this.faceOp('Flip faces', (f) => f.flipFaces()); }
  /** Moves the selected faces into a new object (to give a part its own material). */
  separate(newMaterial = true) {
    const o = this.sel(), f = this.vp.faces;
    if (!isMesh(o) || !f.geo || f.isEmpty()) { this.ed.toast('Paint a selection on the mesh first'); return null; }
    const part = f.extract(), rest = f.deleteFaces();
    if (!part) return null;
    bumpTopo(part); if (rest) bumpTopo(rest);
    const n = makeMesh(prepareGeometry(part), this.doc.uniqueName(o.name + ' part'), o.material.clone());
    n.material.userData = JSON.parse(JSON.stringify(o.material.userData));
    syncTextures(n.material);
    n.position.copy(o.position); n.quaternion.copy(o.quaternion); n.scale.copy(o.scale);
    n.ed.keys = new Map([...o.ed.keys].map(([k, v]) => [k, { p: [...v.p], q: [...v.q], s: [...v.s] }]));
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
  materialToAll(o = this.sel()) {
    const targets = this.doc.meshes.filter((m) => m !== o);
    if (!isMesh(o) || !targets.length) return;
    this.doc.transact('Material to all', () => { for (const t of targets) { t.material = o.material.clone(); t.material.userData = JSON.parse(JSON.stringify(o.material.userData)); syncTextures(t.material); } }, targets);
    this.ed.toast(`Material copied to ${targets.length} object${targets.length > 1 ? 's' : ''}`);
  }

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
      // into the target's local space so the sticker shares its transform
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
      o.position.copy(target.position); o.quaternion.copy(target.quaternion); o.scale.copy(target.scale);
      this.doc.transact('Add sticker', () => { this.doc.attach(o, this.doc.objects.indexOf(target) + 1); this.doc.select(o); }, []);
      return true;
    });
  }
}

export { defaultTextSpec, parseFont, cachedFont, fromArrays };
