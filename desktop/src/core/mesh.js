// Mesh utilities on THREE.BufferGeometry (indexed, Float32 attributes).
// Attributes used by the editor: position, normal, uv?, color (rgba)?, mask (1 float)?
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const pos = (g) => g.attributes.position.array;
export const vcount = (g) => g.attributes.position.count;
export const tcount = (g) => g.index.count / 3;

/** Make sure a geometry is indexed with float32 position/normal (and rgba colour if present). */
export function normalize(g) {
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name];
    if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array) || a.normalized) {
      const n = a.count, s = a.itemSize, out = new Float32Array(n * s);
      for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) out[i * s + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(out, s));
    }
  }
  if (g.attributes.color && g.attributes.color.itemSize === 3) {
    const c = g.attributes.color.array, n = g.attributes.color.count, out = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { out[i * 4] = c[i * 3]; out[i * 4 + 1] = c[i * 3 + 1]; out[i * 4 + 2] = c[i * 3 + 2]; out[i * 4 + 3] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(out, 4));
  }
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'mask'].includes(name)) g.deleteAttribute(name);
  if (!g.attributes.normal) computeNormals(g);
  g.clearGroups();
  return g;
}

/** Weld info: rep[v] = representative vertex of the co-located group; group lists. */
export function weldInfo(g) {
  if (g.userData._weld && g.userData._weldTopo === g.userData.topo) return g.userData._weld;
  const p = pos(g), n = vcount(g);
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  const diag = box.getSize(new THREE.Vector3()).length() || 1;
  const q = 1 / (diag * 1e-6);
  const map = new Map(); const rep = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const key = Math.round(p[v * 3] * q) + ',' + Math.round(p[v * 3 + 1] * q) + ',' + Math.round(p[v * 3 + 2] * q);
    const r = map.get(key);
    if (r === undefined) { map.set(key, v); rep[v] = v; } else rep[v] = r;
  }
  const count = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) count[rep[v] + 1]++;
  const start = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) start[v + 1] = start[v] + count[v + 1];
  const fill = start.slice(0, n), list = new Int32Array(n);
  for (let v = 0; v < n; v++) list[fill[rep[v]]++] = v;
  const w = { rep, groupStart: start, groupList: list, hasDuplicates: map.size !== n };
  g.userData._weld = w; g.userData._weldTopo = g.userData.topo;
  return w;
}

/** Vertex→triangle adjacency (CSR). */
export function vertexTriangles(g) {
  const idx = g.index.array, n = vcount(g), tc = idx.length / 3;
  const cnt = new Int32Array(n + 1);
  for (let i = 0; i < idx.length; i++) cnt[idx[i] + 1]++;
  for (let v = 0; v < n; v++) cnt[v + 1] += cnt[v];
  const fill = cnt.slice(0, n), list = new Int32Array(idx.length);
  for (let t = 0; t < tc; t++) for (let k = 0; k < 3; k++) list[fill[idx[t * 3 + k]]++] = t;
  return { start: cnt, list };
}

/** Welded neighbours of each representative vertex (CSR over reps). */
export function weldedNeighbours(g, w) {
  const idx = g.index.array, n = vcount(g), tc = idx.length / 3;
  const sets = new Array(n);
  for (let t = 0; t < tc; t++) {
    const a = w.rep[idx[t * 3]], b = w.rep[idx[t * 3 + 1]], c = w.rep[idx[t * 3 + 2]];
    (sets[a] ||= new Set()).add(b).add(c); (sets[b] ||= new Set()).add(a).add(c); (sets[c] ||= new Set()).add(a).add(b);
  }
  const start = new Int32Array(n + 1); let total = 0;
  for (let v = 0; v < n; v++) { start[v] = total; if (sets[v]) { sets[v].delete(v); total += sets[v].size; } }
  start[n] = total;
  const list = new Int32Array(total);
  for (let v = 0; v < n; v++) if (sets[v]) { let i = start[v]; for (const x of sets[v]) list[i++] = x; }
  return { start, list };
}

/** Smooth vertex normals, averaged across co-located (seam) vertices unless flat. */
export function computeNormals(g) {
  const p = pos(g), idx = g.index.array, n = vcount(g);
  let nrm = g.attributes.normal?.array;
  if (!nrm || nrm.length !== n * 3) { nrm = new Float32Array(n * 3); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); }
  nrm.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
  }
  if (!g.userData.flat) {
    const w = weldInfo(g);
    if (w.hasDuplicates) for (let r = 0; r < n; r++) {
      const s = w.groupStart[r], e = w.groupStart[r + 1];
      if (e - s <= 1) continue;
      let x = 0, y = 0, z = 0;
      for (let k = s; k < e; k++) { const v = w.groupList[k] * 3; x += nrm[v]; y += nrm[v + 1]; z += nrm[v + 2]; }
      // only merge across UV seams, not across hard edges (angle check against the sum)
      for (let k = s; k < e; k++) { const v = w.groupList[k] * 3; const d = (nrm[v] * x + nrm[v + 1] * y + nrm[v + 2] * z) / (Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) * Math.hypot(x, y, z) + 1e-20); if (d > 0.75) { nrm[v] = x; nrm[v + 1] = y; nrm[v + 2] = z; } }
    }
  }
  for (let v = 0; v < n; v++) { const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1; nrm[v * 3] /= l; nrm[v * 3 + 1] /= l; nrm[v * 3 + 2] /= l; }
  g.attributes.normal.needsUpdate = true;
  return g;
}

export function bumpTopo(g) { g.userData.topo = (g.userData.topo || 0) + 1; delete g.userData._weld; }

/** Build a new indexed geometry from raw arrays. */
export function fromArrays({ position, index, uv = null, color = null, mask = null, flat = false }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position instanceof Float32Array ? position : Float32Array.from(position), 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv instanceof Float32Array ? uv : Float32Array.from(uv), 2));
  if (color) g.setAttribute('color', new THREE.BufferAttribute(color instanceof Float32Array ? color : Float32Array.from(color), 4));
  if (mask) g.setAttribute('mask', new THREE.BufferAttribute(mask instanceof Float32Array ? mask : Float32Array.from(mask), 1));
  g.setIndex(new THREE.BufferAttribute(index instanceof Uint32Array ? index : Uint32Array.from(index), 1));
  g.userData.flat = flat;
  computeNormals(g);
  return g;
}

export function cloneGeometry(g) {
  const c = g.clone();
  c.userData = { flat: !!g.userData.flat, topo: 0 };
  return c;
}

/** Keep only vertices referenced by the index. */
export function removeUnused(g) {
  const idx = g.index.array, n = vcount(g);
  const map = new Int32Array(n).fill(-1); let m = 0;
  for (let i = 0; i < idx.length; i++) if (map[idx[i]] < 0) map[idx[i]] = m++;
  const out = {};
  for (const name of ['position', 'uv', 'color', 'mask']) {
    const a = g.attributes[name]; if (!a) continue;
    const s = a.itemSize, arr = new Float32Array(m * s);
    for (let v = 0; v < n; v++) if (map[v] >= 0) for (let k = 0; k < s; k++) arr[map[v] * s + k] = a.array[v * s + k];
    out[name] = arr;
  }
  const ni = new Uint32Array(idx.length); for (let i = 0; i < idx.length; i++) ni[i] = map[idx[i]];
  return fromArrays({ position: out.position, index: ni, uv: out.uv, color: out.color, mask: out.mask, flat: g.userData.flat });
}

/** Every triangle gets its own vertices (hard edges). */
export function flatShaded(g) {
  const ng = g.toNonIndexed();
  const n = ng.attributes.position.count; const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i;
  const r = fromArrays({ position: ng.attributes.position.array, index: idx, uv: ng.attributes.uv?.array, color: ng.attributes.color?.array, mask: ng.attributes.mask?.array, flat: true });
  return r;
}

export function smoothShaded(g) {
  const c = cloneGeometry(g);
  c.deleteAttribute('normal');
  const m = mergeVertices(c, 1e-5);
  m.userData = { flat: false, topo: 0 };
  return normalize(computeNormals(normalize(m)));
}

/** Linear-blend transform of positions (and normals) by a Matrix4. */
export function applyMatrix(g, m4) {
  g.applyMatrix4(m4);
  if (m4.determinant() < 0) flipWinding(g);
  computeNormals(g);
  return g;
}

export function flipWinding(g) {
  const idx = g.index.array;
  for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  g.index.needsUpdate = true;
}

export function ensureColors(g, r = 1, gg = 1, b = 1, a = 1) {
  if (g.attributes.color) return g.attributes.color.array;
  const n = vcount(g), c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { c[i * 4] = r; c[i * 4 + 1] = gg; c[i * 4 + 2] = b; c[i * 4 + 3] = a; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 4));
  return c;
}

export function ensureMask(g) {
  if (g.attributes.mask) return g.attributes.mask.array;
  const m = new Float32Array(vcount(g));
  g.setAttribute('mask', new THREE.BufferAttribute(m, 1));
  return m;
}

export function averageEdgeLength(g, sample = 2000) {
  const p = pos(g), idx = g.index.array, tc = idx.length / 3;
  if (!tc) return 0.01;
  const step = Math.max(1, Math.floor(tc / sample)); let s = 0, c = 0;
  for (let t = 0; t < tc; t += step) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3;
    s += Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]); c++;
  }
  return s / Math.max(1, c);
}

/** Taubin smoothing (keeps volume); respects mask. */
export function smoothInPlace(g, iterations = 3) {
  const w = weldInfo(g), nb = weldedNeighbours(g, w), p = pos(g), n = vcount(g), mask = g.attributes.mask?.array;
  const tmp = new Float32Array(n * 3);
  const pass = (lambda) => {
    for (let v = 0; v < n; v++) {
      if (w.rep[v] !== v) continue;
      const s = nb.start[v], e = nb.start[v + 1];
      if (e === s) { tmp[v * 3] = p[v * 3]; tmp[v * 3 + 1] = p[v * 3 + 1]; tmp[v * 3 + 2] = p[v * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let j = s; j < e; j++) { const u = nb.list[j] * 3; x += p[u]; y += p[u + 1]; z += p[u + 2]; }
      const k = 1 / (e - s), f = lambda * (mask ? 1 - mask[v] : 1);
      tmp[v * 3] = p[v * 3] + (x * k - p[v * 3]) * f; tmp[v * 3 + 1] = p[v * 3 + 1] + (y * k - p[v * 3 + 1]) * f; tmp[v * 3 + 2] = p[v * 3 + 2] + (z * k - p[v * 3 + 2]) * f;
    }
    for (let v = 0; v < n; v++) { const r = w.rep[v]; p[v * 3] = tmp[r * 3]; p[v * 3 + 1] = tmp[r * 3 + 1]; p[v * 3 + 2] = tmp[r * 3 + 2]; }
  };
  for (let i = 0; i < iterations; i++) { pass(0.5); pass(-0.53); }
  g.attributes.position.needsUpdate = true;
  computeNormals(g);
}

/** Loop-style subdivision (smooth) or simple midpoint split. Seams stay intact. */
export function subdivide(g, smoothIt) {
  const p = pos(g), idx = g.index.array, n = vcount(g), tc = idx.length / 3;
  const w = weldInfo(g);
  const attrs = ['uv', 'color', 'mask'].filter((a) => g.attributes[a]).map((a) => [a, g.attributes[a].itemSize, g.attributes[a].array]);
  const np = Array.from(p), na = attrs.map(([, , arr]) => Array.from(arr));
  const edgeMid = new Map();
  const ni = new Uint32Array(tc * 12);
  // welded edge midpoints for smoothing (opposite vertices)
  const wedge = new Map(); // rep-key -> {opp: [], verts:[a,b]}
  const wkey = (a, b) => { const ra = w.rep[a], rb = w.rep[b]; return ra < rb ? ra * 4294967296 + rb : rb * 4294967296 + ra; };
  if (smoothIt) for (let t = 0; t < tc; t++) for (let k = 0; k < 3; k++) {
    const a = idx[t * 3 + k], b = idx[t * 3 + (k + 1) % 3], c = idx[t * 3 + (k + 2) % 3];
    const key = wkey(a, b); let e = wedge.get(key); if (!e) { e = { opp: [], a: w.rep[a], b: w.rep[b] }; wedge.set(key, e); } e.opp.push(w.rep[c]);
  }
  const mid = (a, b) => {
    const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
    let m = edgeMid.get(key); if (m !== undefined) return m;
    m = np.length / 3;
    let x = (p[a * 3] + p[b * 3]) / 2, y = (p[a * 3 + 1] + p[b * 3 + 1]) / 2, z = (p[a * 3 + 2] + p[b * 3 + 2]) / 2;
    if (smoothIt) {
      const e = wedge.get(wkey(a, b));
      if (e && e.opp.length === 2) {
        const [c, d] = e.opp;
        x = (p[a * 3] + p[b * 3]) * 0.375 + (p[c * 3] + p[d * 3]) * 0.125;
        y = (p[a * 3 + 1] + p[b * 3 + 1]) * 0.375 + (p[c * 3 + 1] + p[d * 3 + 1]) * 0.125;
        z = (p[a * 3 + 2] + p[b * 3 + 2]) * 0.375 + (p[c * 3 + 2] + p[d * 3 + 2]) * 0.125;
      }
    }
    np.push(x, y, z);
    attrs.forEach(([, s, arr], i) => { for (let k = 0; k < s; k++) na[i].push((arr[a * s + k] + arr[b * s + k]) / 2); });
    edgeMid.set(key, m); return m;
  };
  for (let t = 0; t < tc; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    ni.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], t * 12);
  }
  const outP = new Float32Array(np);
  if (smoothIt) {
    // reposition original vertices (Loop rule) using welded neighbours
    const nb = weldedNeighbours(g, w);
    for (let v = 0; v < n; v++) {
      const r = w.rep[v]; const s = nb.start[r], e = nb.start[r + 1], k = e - s;
      if (k < 3) continue;
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      let x = 0, y = 0, z = 0; for (let j = s; j < e; j++) { const u = nb.list[j] * 3; x += p[u]; y += p[u + 1]; z += p[u + 2]; }
      outP[v * 3] = p[r * 3] * (1 - k * beta) + x * beta; outP[v * 3 + 1] = p[r * 3 + 1] * (1 - k * beta) + y * beta; outP[v * 3 + 2] = p[r * 3 + 2] * (1 - k * beta) + z * beta;
    }
  }
  const o = { position: outP, index: ni, flat: g.userData.flat };
  attrs.forEach(([name], i) => { o[name] = new Float32Array(na[i]); });
  return fromArrays(o);
}

/** UV projections (box / sphere / cylinder / planar). Duplicates vertices where needed. */
export const UV_MODES = [['BOX', 'Box'], ['SPHERE', 'Sphere'], ['CYLINDER', 'Cylinder'], ['PLANAR_Z', 'Front'], ['PLANAR_Y', 'Top'], ['PLANAR_X', 'Side']];
export function projectUvs(g, mode) {
  g.computeBoundingBox();
  const { min: mn, max: mx } = g.boundingBox;
  const sx = Math.max(mx.x - mn.x, 1e-6), sy = Math.max(mx.y - mn.y, 1e-6), sz = Math.max(mx.z - mn.z, 1e-6);
  const cx = (mn.x + mx.x) / 2, cy = (mn.y + mx.y) / 2, cz = (mn.z + mx.z) / 2;
  const p = pos(g), idx = g.index.array, tc = idx.length / 3;
  const keyMap = new Map(), src = [], uvs = [], ni = new Uint32Array(idx.length);
  const cu = [0, 0, 0], cv = [0, 0, 0];
  for (let t = 0; t < tc; t++) {
    let axis = 0;
    if (mode === 'BOX') {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      axis = ax >= ay && ax >= az ? (nx > 0 ? 1 : 2) : ay >= az ? (ny > 0 ? 3 : 4) : (nz > 0 ? 5 : 6);
    }
    for (let q = 0; q < 3; q++) {
      const v = idx[t * 3 + q], x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      switch (mode) {
        case 'PLANAR_Z': cu[q] = (x - mn.x) / sx; cv[q] = 1 - (y - mn.y) / sy; break;
        case 'PLANAR_Y': cu[q] = (x - mn.x) / sx; cv[q] = (z - mn.z) / sz; break;
        case 'PLANAR_X': cu[q] = (mx.z - z) / sz; cv[q] = 1 - (y - mn.y) / sy; break;
        case 'SPHERE': { const dx = x - cx, dy = y - cy, dz = z - cz, r = Math.hypot(dx, dy, dz) || 1e-9; cu[q] = Math.atan2(dx, dz) / (2 * Math.PI) + 0.5; cv[q] = Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI; break; }
        case 'CYLINDER': cu[q] = Math.atan2(x - cx, z - cz) / (2 * Math.PI) + 0.5; cv[q] = 1 - (y - mn.y) / sy; break;
        default: { const s = Math.max(sx, sy, sz);
          if (axis === 1) { cu[q] = (mx.z - z) / s; cv[q] = 1 - (y - mn.y) / s; } else if (axis === 2) { cu[q] = (z - mn.z) / s; cv[q] = 1 - (y - mn.y) / s; }
          else if (axis === 3) { cu[q] = (x - mn.x) / s; cv[q] = (z - mn.z) / s; } else if (axis === 4) { cu[q] = (x - mn.x) / s; cv[q] = 1 - (z - mn.z) / s; }
          else if (axis === 5) { cu[q] = (x - mn.x) / s; cv[q] = 1 - (y - mn.y) / s; } else { cu[q] = (mx.x - x) / s; cv[q] = 1 - (y - mn.y) / s; } }
      }
    }
    let wrap = 0;
    if (mode === 'SPHERE' || mode === 'CYLINDER') { if (Math.max(...cu) - Math.min(...cu) > 0.5) { for (let q = 0; q < 3; q++) if (cu[q] < 0.5) cu[q] += 1; wrap = 1; } }
    for (let q = 0; q < 3; q++) {
      const v = idx[t * 3 + q];
      const key = v * 16 + axis * 2 + (wrap && cu[q] >= 1 ? 1 : 0);
      let id = keyMap.get(key);
      if (id === undefined) { id = src.length; src.push(v); uvs.push(cu[q], cv[q]); keyMap.set(key, id); }
      ni[t * 3 + q] = id;
    }
  }
  const n = src.length, np = new Float32Array(n * 3);
  const col = g.attributes.color ? new Float32Array(n * 4) : null, mk = g.attributes.mask ? new Float32Array(n) : null;
  for (let i = 0; i < n; i++) {
    const v = src[i]; np[i * 3] = p[v * 3]; np[i * 3 + 1] = p[v * 3 + 1]; np[i * 3 + 2] = p[v * 3 + 2];
    if (col) col.set(g.attributes.color.array.subarray(v * 4, v * 4 + 4), i * 4);
    if (mk) mk[i] = g.attributes.mask.array[v];
  }
  return fromArrays({ position: np, index: ni, uv: new Float32Array(uvs), color: col, mask: mk, flat: g.userData.flat });
}

/** Merge geometries (with optional matrices) into one. */
export function merge(parts) {
  const P = [], I = [], C = []; let base = 0; let anyColor = parts.some(([g]) => g.attributes.color);
  for (const [g, m4] of parts) {
    const gg = m4 ? g.clone().applyMatrix4(m4) : g;
    if (m4 && m4.determinant() < 0) flipWinding(gg);
    const p = gg.attributes.position.array; for (let i = 0; i < p.length; i++) P.push(p[i]);
    const idx = gg.index.array; for (let i = 0; i < idx.length; i++) I.push(idx[i] + base);
    if (anyColor) { const c = gg.attributes.color?.array; for (let v = 0; v < gg.attributes.position.count; v++) for (let k = 0; k < 4; k++) C.push(c ? c[v * 4 + k] : 1); }
    base += gg.attributes.position.count;
  }
  return fromArrays({ position: P, index: I, color: anyColor ? C : null });
}
