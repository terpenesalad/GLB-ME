// Template construction kit: geometry helpers (bevelled boxes, walls with openings, lathes,
// extrusions, swept mouldings, rods), world-scale UVs so textures sit at real-world size, and a
// builder that assembles named, editable parts (meshes in groups) with shared PBR materials.
// Units are metres; +Y is up; a model's front faces +Z.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION, ADDITION } from 'three-bvh-csg';
import { makeMesh, makeGroup, makeLight } from '../editor/model.js';
import { createMaterial, materialsReady, LIB } from './matlib.js';

const D2R = Math.PI / 180;
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** Applies { at, rot (degrees, YXZ), scale } to a geometry (in place) and returns it. */
export function xf(g, o = {}) {
  if (!o.at && !o.rot && !o.scale) return g;
  const r = o.rot || [0, 0, 0], s = o.scale == null ? [1, 1, 1] : typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : o.scale;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ'));
  g.applyMatrix4(new THREE.Matrix4().compose(V(o.at || [0, 0, 0]), q, V(s)));
  return g;
}
const axisRot = (g, axis) => { if (axis === 'x') g.rotateZ(-Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2); return g; };

// ------------------------------------------------------------------------------- geometry
export const G = {
  /** Box centred on `at`; `bevel` rounds the edges (radius in metres). */
  box(w, h, d, o = {}) {
    const b = o.bevel ? Math.min(o.bevel, Math.min(w, h, d) * 0.49) : 0;
    const g = b > 0.0005 ? new RoundedBoxGeometry(w, h, d, o.seg ?? 1, b) : new THREE.BoxGeometry(w, h, d);
    return xf(g, o);
  },
  /** Box spanning two corners [x0,y0,z0]–[x1,y1,z1] (before rotation). */
  span(a, b, o = {}) {
    const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]), d = Math.abs(b[2] - a[2]);
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const g = G.box(w, h, d, { bevel: o.bevel, seg: o.seg });
    g.translate(c[0], c[1], c[2]);
    return xf(g, { rot: o.rot, at: o.at, scale: o.scale });
  },
  /** Cylinder with its base at y = 0 (axis 'y' | 'x' | 'z'). */
  cyl(r, h, o = {}) {
    const g = new THREE.CylinderGeometry(o.r2 ?? r, r, h, o.seg ?? 24, o.hseg ?? 1, !!o.open, o.theta0 ?? 0, o.theta ?? Math.PI * 2);
    g.translate(0, o.center ? 0 : h / 2, 0);
    return xf(axisRot(g, o.axis), o);
  },
  sphere(r, o = {}) { return xf(new THREE.SphereGeometry(r, o.seg ?? 24, o.rings ?? Math.max(8, (o.seg ?? 24) >> 1), 0, Math.PI * 2, 0, o.theta ?? Math.PI), o); },
  /** Lathe from [[radius, y], …] (bottom → top). */
  lathe(pts, o = {}) {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), o.seg ?? 24);
    if (o.uvScale) uvScale(g, o.uvScale[0], o.uvScale[1]);
    return xf(axisRot(g, o.axis), o);
  },
  torus(r, t, o = {}) { return xf(new THREE.TorusGeometry(r, t, o.rseg ?? 10, o.seg ?? 32, o.arc ?? Math.PI * 2), o); },
  /** Flat quad facing +Z, centred. */
  quad(w, h, o = {}) { return xf(new THREE.PlaneGeometry(w, h), o); },
  /** Extrudes a 2D outline ([[x,y],…] or THREE.Shape) along +Z by `depth` (centred when o.center). */
  extrude(shape, depth, o = {}) {
    const s = shape instanceof THREE.Shape ? shape : new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y)));
    if (o.holes) for (const hpts of o.holes) s.holes.push(hpts instanceof THREE.Path ? hpts : new THREE.Path(hpts.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(s, { depth, curveSegments: o.curve ?? 12, bevelEnabled: !!o.bevel, bevelSize: o.bevel || 0, bevelThickness: o.bevel || 0, bevelSegments: o.bevelSeg ?? 2, bevelOffset: o.bevel ? -o.bevel : 0 });
    if (o.center) g.translate(0, 0, -depth / 2);
    return xf(g, o);
  },
  /**
   * Wall panel along +X from 0 to len, height h, thickness t centred on z = 0, with openings
   * { x, y, w, h, arch: 'round' | 'segment' } (x, y = bottom-left corner).
   */
  wall(len, h, t, holes = [], o = {}) {
    const s = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, h), new THREE.Vector2(0, h)]);
    for (const ho of holes) s.holes.push(openingPath(ho));
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 16 });
    g.translate(0, 0, -t / 2);
    return xf(g, o);
  },
  /** Thin rod (cylinder) between two points. */
  rod(a, b, r, o = {}) {
    const A = V(a), B = V(b), len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, o.r2 ?? r, len, o.seg ?? 8, 1, !!o.open);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.applyQuaternion(q); g.translate(A.x, A.y, A.z);
    return g;
  },
  /** Smooth tube through points (Catmull-Rom) or along a curve. */
  tube(pts, r, o = {}) {
    const curve = pts.isCurve ? pts : new THREE.CatmullRomCurve3(pts.map(V), !!o.closed, 'centripetal', o.tension ?? 0.5);
    return xf(new THREE.TubeGeometry(curve, o.seg ?? 32, r, o.rseg ?? 8, !!o.closed), o);
  },
  /**
   * Sweeps a closed 2D profile [[x,y],…] (x = to the right of travel / outwards, y = up) along a
   * polyline path [[x,y,z],…] with mitred corners. Hard edges where the profile turns sharply.
   */
  sweep(profile, path, o = {}) { return xf(sweepGeometry(profile, path, o), o); },
  /** Gable / hip roof helpers live in the families; this makes a prism from a 2D side outline. */
  prism(pts, depth, o = {}) { return G.extrude(pts, depth, { ...o, center: o.center ?? true }); },
};

/**
 * Constructive solid geometry on closed meshes in the same space: op 'sub' | 'and' | 'add'.
 * Returns a non-indexed geometry with position, normal and uv.
 */
export function csg(base, tools, op = 'sub') {
  const prep = (g) => { const n = g.index ? g.toNonIndexed() : g.clone(); if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); if (!n.attributes.normal) n.computeVertexNormals(); for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); n.clearGroups(); const b = new Brush(n); b.updateMatrixWorld(); return b; };
  const ev = new Evaluator(); ev.useGroups = false; ev.attributes = ['position', 'normal', 'uv'];
  const OP = op === 'and' ? INTERSECTION : op === 'add' ? ADDITION : SUBTRACTION;
  let acc = prep(base);
  for (const t of [tools].flat()) { const r = ev.evaluate(acc, prep(t), OP); acc = new Brush(r.geometry); acc.updateMatrixWorld(); }
  return acc.geometry;
}
/** Keeps the part of a mesh between heights y0 and y1 (triangles are clipped, no caps) – fast band splitting. */
export function clipY(geo, y0, y1) {
  const g = geo.index ? geo.toNonIndexed() : geo, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  const out = { p: [], n: [], u: [] };
  const vert = (i) => ({ p: [P.getX(i), P.getY(i), P.getZ(i)], n: N ? [N.getX(i), N.getY(i), N.getZ(i)] : [0, 1, 0], u: U ? [U.getX(i), U.getY(i)] : [0, 0] });
  const lerp = (a, b, t) => ({ p: a.p.map((v, k) => v + (b.p[k] - v) * t), n: a.n.map((v, k) => v + (b.n[k] - v) * t), u: a.u.map((v, k) => v + (b.u[k] - v) * t) });
  const clip = (poly, keep, edge) => { const res = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], ia = keep(a), ib = keep(b); if (ia) res.push(a); if (ia !== ib) res.push(lerp(a, b, (edge - a.p[1]) / (b.p[1] - a.p[1]))); } return res; };
  for (let i = 0; i < P.count; i += 3) {
    let poly = [vert(i), vert(i + 1), vert(i + 2)];
    const ys = poly.map((v) => v.p[1]);
    if (Math.max(...ys) <= y0 || Math.min(...ys) >= y1) continue;
    poly = clip(poly, (v) => v.p[1] >= y0, y0); if (poly.length < 3) continue;
    poly = clip(poly, (v) => v.p[1] <= y1, y1); if (poly.length < 3) continue;
    for (let k = 1; k < poly.length - 1; k++) for (const v of [poly[0], poly[k], poly[k + 1]]) { out.p.push(...v.p); out.n.push(...v.n); out.u.push(...v.u); }
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out.p, 3)); r.setAttribute('normal', new THREE.Float32BufferAttribute(out.n, 3)); r.setAttribute('uv', new THREE.Float32BufferAttribute(out.u, 2));
  return r;
}
/** Rounded-rectangle plan (x along length, z across) extruded vertically from y0 to y1. */
export function planShape(L, W, r) {
  const s = new THREE.Shape(), hl = L / 2, hw = W / 2, [ra, rb] = (Array.isArray(r) ? r : [r, r]).map((v) => Math.max(0.001, Math.min(v, hw - 1e-3, hl - 1e-3)));
  s.moveTo(-hl + ra, -hw); s.lineTo(hl - rb, -hw); s.absarc(hl - rb, -hw + rb, rb, -Math.PI / 2, 0, false);
  s.lineTo(hl, hw - rb); s.absarc(hl - rb, hw - rb, rb, 0, Math.PI / 2, false);
  s.lineTo(-hl + ra, hw); s.absarc(-hl + ra, hw - ra, ra, Math.PI / 2, Math.PI, false);
  s.lineTo(-hl, -hw + ra); s.absarc(-hl + ra, -hw + ra, ra, Math.PI, Math.PI * 1.5, false);
  return s;
}
/** Plan outline as [x, z] points (closed loop, counter-clockwise seen from above). */
export function planPoints(L, W, r, n = 10) { return planShape(L, W, r).getPoints(n).map((v) => [v.x, v.y]); }
export function planSlab(L, W, r, y0, y1, o = {}) {
  const s = planShape(L, W, r);
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false, curveSegments: o.curve ?? 10 });
  g.rotateX(Math.PI / 2); // shape y → z, extrusion → -y
  g.translate(0, y1, 0);
  return xf(g, o);
}
/** A plan outline [[x, z], …] extruded vertically from y0 to y1 (floors, footpaths, platforms). */
export function slabXZ(pts, y0, y1, o = {}) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))), { depth: y1 - y0, bevelEnabled: false, curveSegments: o.curve ?? 12 });
  g.rotateX(Math.PI / 2); g.translate(0, y1, 0);
  return xf(g, o);
}
/** A side outline [[x, y], …] extruded across z (width W, centred). */
export function sideSlab(pts, W, o = {}) { return G.extrude(pts, W, { ...o, center: true, curve: o.curve ?? 16 }); }

export function openingPath({ x, y, w, h, arch }) {
  const p = new THREE.Path();
  if (arch === 'round' || arch === 'segment') {
    const rise = arch === 'round' ? w / 2 : w * 0.18, sh = h - rise;
    const R = (rise * rise + (w / 2) ** 2) / (2 * rise), cy = y + sh + rise - R, a0 = Math.asin((w / 2) / R);
    p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + sh);
    p.absarc(x + w / 2, cy, R, Math.PI / 2 - a0, Math.PI / 2 + a0, false);
    p.lineTo(x, y);
  } else { p.moveTo(x, y); p.lineTo(x + w, y); p.lineTo(x + w, y + h); p.lineTo(x, y + h); p.lineTo(x, y); }
  return p;
}
/** Outline points of an opening (for frames and glass) – same shape as the wall hole. */
export function openingPoints(ho, n = 16) { return openingPath(ho).getPoints(n).map((v) => [v.x, v.y]); }

function sweepGeometry(profile, path, { closed = false, caps = true, up = [0, 1, 0], hard = 35 } = {}) {
  const P = path.map(V), U = V(up).normalize(), n = P.length, segs = closed ? n : n - 1;
  // profile: drop duplicated closing point, orient counter-clockwise
  let prof = profile.slice(); if (prof.length > 2 && prof[0][0] === prof.at(-1)[0] && prof[0][1] === prof.at(-1)[1]) prof.pop();
  let area = 0; for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) prof = prof.reverse();
  const m = prof.length;
  // frame (side vector) at every path point, mitred
  const dir = (i) => P[(i + 1) % n].clone().sub(P[i]).normalize();
  const side = (d) => new THREE.Vector3().crossVectors(d, U).normalize();
  const frames = P.map((_, i) => {
    let s, k = 1;
    if (!closed && i === 0) s = side(dir(0));
    else if (!closed && i === n - 1) s = side(dir(n - 2));
    else { const s1 = side(dir((i - 1 + n) % n)), s2 = side(dir(i)); s = s1.clone().add(s2).normalize(); k = 1 / Math.max(0.2, s.dot(s2)); }
    return { s, k };
  });
  const at = (i, j) => P[i].clone().addScaledVector(frames[i].s, prof[j][0] * frames[i].k).addScaledVector(U, prof[j][1]);
  // profile corners: duplicate vertices where the outline turns sharply (hard edges)
  const ring = []; // [{ j, smoothPrev }] – list of profile vertex indices with duplicates for hard corners
  const cosHard = Math.cos(hard * D2R);
  for (let j = 0; j < m; j++) {
    const a = prof[(j - 1 + m) % m], b = prof[j], c = prof[(j + 1) % m];
    const e1 = [b[0] - a[0], b[1] - a[1]], e2 = [c[0] - b[0], c[1] - b[1]], l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const sharp = (e1[0] * e2[0] + e1[1] * e2[1]) / (l1 * l2) < cosHard;
    if (sharp) { ring.push(j, j); } else ring.push(j);
  }
  // perimeter distance for v
  const vlen = [0]; for (let j = 1; j <= m; j++) vlen.push(vlen[j - 1] + Math.hypot(prof[j % m][0] - prof[j - 1][0], prof[j % m][1] - prof[j - 1][1]));
  const parts = [];
  let ulen = 0;
  for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % n, L = P[i].distanceTo(P[i2]);
    const pos = [], uv = [], idx = [];
    // build quads strip-by-strip: each profile edge j→j+1 gets its own vertices when either end is hard
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m, base = pos.length / 3;
      for (const [ii, uu] of [[i, ulen], [i2, ulen + L]]) for (const jj of [j, j2]) { const p = at(ii, jj); pos.push(p.x, p.y, p.z); uv.push(uu, jj === j2 && j2 === 0 ? vlen[m] : vlen[jj]); }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    // smooth across non-sharp profile vertices: merge by position within this segment (ignoring uv seam)
    g = smoothMerge(g, ring, m);
    parts.push(g);
    ulen += L;
  }
  if (!closed && caps) for (const [i, flip] of [[0, false], [n - 1, true]]) {
    const pts2 = prof.map(([x, y]) => new THREE.Vector2(x, y)), tris = THREE.ShapeUtils.triangulateShape(pts2, []);
    const pos = [], uv = [], idx = [];
    for (let j = 0; j < m; j++) { const p = at(i, j); pos.push(p.x, p.y, p.z); uv.push(prof[j][0], prof[j][1]); }
    for (const t of tris) flip ? idx.push(t[0], t[2], t[1]) : idx.push(t[0], t[1], t[2]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}
/** Computes normals for a sweep segment, smooth across gentle profile vertices and hard at sharp ones. */
function smoothMerge(g, ring, m) {
  const ng = g.toNonIndexed(); ng.computeVertexNormals();
  const pos = ng.attributes.position, nor = ng.attributes.normal, cnt = pos.count;
  // average normals of vertices sharing a position when the profile vertex is not sharp
  const sharpSet = new Set(); for (let k = 1; k < ring.length; k++) if (ring[k] === ring[k - 1]) sharpSet.add(ring[k]); if (ring.length > 1 && ring[0] === ring.at(-1)) sharpSet.add(ring[0]);
  const key = (i) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
  const groups = new Map();
  // vertex order per quad (j-th strip): 6 verts from idx [b, b+2, b+1, b+1, b+2, b+3] where b..b+3 = (i,j),(i,j2),(i2,j),(i2,j2)
  const profIdx = (v) => { const quad = Math.floor(v / 6), local = [0, 2, 1, 1, 2, 3][v % 6]; return local === 0 || local === 2 ? quad : (quad + 1) % m; };
  for (let v = 0; v < cnt; v++) { const pj = profIdx(v); if (sharpSet.has(pj)) continue; const k = key(v); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
  const n = new THREE.Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    n.set(0, 0, 0); for (const v of list) n.x += nor.getX(v), n.y += nor.getY(v), n.z += nor.getZ(v);
    n.normalize(); for (const v of list) nor.setXYZ(v, n.x, n.y, n.z);
  }
  return ng;
}

// ------------------------------------------------------------------------------- UVs
/** Per-face planar UVs in metres / tile (walls: u along the wall, v up; floors: x / -z; slopes: v up the slope). */
export function uvWorld(g, tu = 1, tv = 1, off = [0, 0]) {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.attributes.position, cnt = p.count, uv = new Float32Array(cnt * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), t = new THREE.Vector3(), bi = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < cnt; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    nrm.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    if (Math.abs(nrm.y) > 0.999) { t.set(1, 0, 0); bi.set(0, 0, nrm.y > 0 ? -1 : 1); }
    else { t.crossVectors(up, nrm).normalize(); bi.crossVectors(nrm, t).normalize(); }
    for (let k = 0; k < 3; k++) { const q = k === 0 ? a : k === 1 ? b : c; uv[(i + k) * 2] = q.dot(t) / tu + off[0]; uv[(i + k) * 2 + 1] = q.dot(bi) / tv + off[1]; }
  }
  ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return ng;
}
export function uvScale(g, su, sv) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); uv.needsUpdate = true; return g; }

function clean(g) {
  let ng = g.index ? g.toNonIndexed() : g.clone();
  if (!ng.attributes.normal) ng.computeVertexNormals();
  if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) ng.deleteAttribute(k);
  ng.morphAttributes = {};
  ng.clearGroups();
  return ng;
}
/** Merges geometries into one indexed geometry (position, normal, uv[, color]). */
export function mergeAll(geos, { uv = 'keep', tile = [1, 1], off } = {}) {
  let list = geos.flat().filter(Boolean).map(clean);
  const withColor = list.some((g) => g.attributes.color);
  if (withColor) for (const g of list) if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  if (!withColor) for (const g of list) g.deleteAttribute('color');
  let g = list.length === 1 ? list[0] : mergeGeometries(list, false);
  if (uv === 'world') g = uvWorld(g, tile[0], tile[1], off);
  return mergeVertices(g, 1e-5);
}

// ------------------------------------------------------------------------------- builder
/**
 * Collects the objects of a template. Parts are meshes named for what they are, grouped in a
 * hierarchy; materials are shared between parts that use the same finish (edit once → all change).
 */
export class Kit {
  constructor(name) {
    this.objects = []; this.matCache = new Map(); this.mats = [];
    this.clips = null; this.frameCount = 0;
    this.root = name ? this.group(name, null) : null;
  }
  /** Shared material: library id ('brick_hawthorn', 'weatherboard', …) or finish ('glass', 'iron', …). */
  mat(id, opts = {}) {
    if (id && id.isMaterial) return id;
    const key = id + JSON.stringify(opts);
    if (!this.matCache.has(key)) { const m = createMaterial(id, opts); this.matCache.set(key, m); this.mats.push(m); }
    return this.matCache.get(key);
  }
  /** Material with its own (canvas) textures – lace, signs, leaves, bark … Cached by name. */
  texMat(name, maps, o = {}) {
    const key = 'tex:' + name + JSON.stringify(o);
    if (this.matCache.has(key)) return this.matCache.get(key);
    const m = createMaterial(o.finish || 'matte', { name, color: o.color ?? 0xffffff });
    if (maps.map) m.map = maps.map; if (maps.normalMap) m.normalMap = maps.normalMap; if (maps.roughnessMap) m.roughnessMap = maps.roughnessMap;
    if (maps.emissiveMap) m.emissiveMap = maps.emissiveMap;
    for (const k of ['roughness', 'metalness', 'alphaTest', 'side', 'opacity', 'transparent', 'emissiveIntensity', 'clearcoat']) if (o[k] != null) m[k] = o[k];
    if (o.emissive != null) m.emissive.set(o.emissive);
    if (o.normalScale) m.normalScale.set(o.normalScale, o.normalScale);
    m.userData.maps = { kind: 'image', name };
    this.matCache.set(key, m); this.mats.push(m);
    return m;
  }
  group(name, parent = this.root, o = {}) {
    const g = makeGroup(name);
    if (o.at) g.position.fromArray(o.at);
    if (o.rot) g.rotation.set(o.rot[0] * D2R, o.rot[1] * D2R, o.rot[2] * D2R, 'YXZ');
    if (o.scale) typeof o.scale === 'number' ? g.scale.setScalar(o.scale) : g.scale.fromArray(o.scale);
    g.ed.parent = parent || null;
    this.objects.push(g);
    return g;
  }
  /**
   * Adds a mesh part. `geos` are in the parent's space; the part's origin is placed at the bottom
   * centre of its bounds (or `pivot` = [x,y,z] / 'center' / 'none') so it moves and rotates naturally.
   * UVs default to world-scale planar mapping sized to the material's real-world tile.
   */
  part(name, geos, mat, o = {}) {
    const m = this.mat(mat, o.matOpts);
    const tile = o.tile || m.userData.libTile || [1, 1];
    const g = mergeAll(Array.isArray(geos) ? geos : [geos], { uv: o.uv || (m.userData.libTile ? 'world' : 'keep'), tile, off: o.uvOff });
    g.computeBoundingBox();
    const bb = g.boundingBox, c = new THREE.Vector3();
    if (Array.isArray(o.pivot)) c.fromArray(o.pivot);
    else if (o.pivot === 'none') c.set(0, 0, 0);
    else if (o.pivot === 'center') bb.getCenter(c);
    else c.set((bb.min.x + bb.max.x) / 2, bb.min.y, (bb.min.z + bb.max.z) / 2);
    g.translate(-c.x, -c.y, -c.z);
    const mesh = makeMesh(g, name, m);
    mesh.position.copy(c);
    if (o.shadow === false) mesh.castShadow = false;
    if (o.collision) mesh.ed.collision = o.collision;
    if (o.props) mesh.ed.props = Object.entries(o.props).map(([k, v]) => [k, String(v)]);
    mesh.ed.parent = o.parent === undefined ? this.root : o.parent;
    this.objects.push(mesh);
    return mesh;
  }
  light(type, name, o = {}) {
    const l = makeLight(type, name);
    if (o.at) l.position.fromArray(o.at);
    if (o.rot) l.rotation.set(o.rot[0] * D2R, o.rot[1] * D2R, o.rot[2] * D2R, 'YXZ');
    const L = l.ed.light;
    if (o.color != null) L.color.set(o.color);
    if (o.intensity != null) L.intensity = o.intensity;
    if (o.distance != null && 'distance' in L) L.distance = o.distance;
    if (o.angle != null && 'angle' in L) L.angle = o.angle * D2R;
    if (o.shadow != null) L.castShadow = o.shadow;
    l.ed.parent = o.parent === undefined ? this.root : o.parent;
    this.objects.push(l);
    return l;
  }
  /** Adds a key (frame → current transform of obj, after `fn` changed it). */
  key(obj, frame, fn = null, interp = null) {
    if (fn) fn(obj);
    obj.ed.keys.set(frame, { p: obj.position.toArray(), q: obj.quaternion.toArray(), s: obj.scale.toArray(), ...(interp ? { i: interp } : {}) });
  }
  /** Door/window style open–close animation: keys on each object (closed → open → closed) and two clips. */
  openClose(objs, apply, { frames = 30 } = {}) {
    for (const o of objs) {
      const p = o.position.clone(), q = o.quaternion.clone(), sc = o.scale.clone();
      this.key(o, 0, null, 'ease');
      apply(o, 1); this.key(o, frames, null, 'ease');
      o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); this.key(o, frames * 2, null, 'ease');
    }
    this.clips = [{ name: 'Open', start: 0, end: frames, loop: false }, { name: 'Close', start: frames, end: frames * 2, loop: false }];
    this.frameCount = frames * 2;
  }
  async done() {
    // sibling names are unique (Godot / Blender friendly), materials have their textures
    const seen = new Map();
    for (const o of this.objects) {
      const key = (o.ed.parent?.ed?.id ?? 'root') + '/' + o.name, n = seen.get(key) || 0;
      seen.set(key, n + 1);
      if (n) o.name = `${o.name} ${n + 1}`;
    }
    await materialsReady(this.mats);
    return this;
  }
}
export { LIB, D2R };
