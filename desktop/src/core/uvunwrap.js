// Automatic UV unwrapping ("smart UV project") for texture painting: splits the mesh into
// charts of similar facing (angle limit), projects each chart flat, and packs the charts
// without overlap into the 0–1 square with a small margin. Also detects overlapping UVs.
import * as THREE from 'three';
import { weldInfo, fromArrays } from './mesh.js';

/** Fraction of UV-covered cells that are covered more than once (0 = no overlap), or 1 if there are no UVs. */
export function uvOverlap(g, res = 256) {
  const uv = g.attributes.uv; if (!uv) return 1;
  const key = (g.userData.topo || 0) + ':' + uv.version;
  if (g.userData._ovKey === key) return g.userData._ov;
  const idx = g.index.array, grid = new Uint16Array(res * res), tc = idx.length / 3;
  const step = Math.max(1, Math.floor(tc / 60000));
  let covered = 0, multi = 0;
  const stamp = new Uint32Array(res * res);
  for (let t = 0; t < tc; t += step) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    const P = [[uv.getX(a), uv.getY(a)], [uv.getX(b), uv.getY(b)], [uv.getX(c), uv.getY(c)]].map(([x, y]) => [(x - Math.floor(x)) * res, (y - Math.floor(y)) * res]);
    // skip triangles that straddle a tile wrap (they belong to tiling layouts anyway)
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    if (Math.max(...xs) - Math.min(...xs) > res / 2 || Math.max(...ys) - Math.min(...ys) > res / 2) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(res - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(res - 1, Math.ceil(Math.max(...ys)));
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area, w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area, w2 = 1 - w0 - w1;
      if (w0 < 0.02 || w1 < 0.02 || w2 < 0.02) continue; // interior only, so shared edges don't count
      const i = y * res + x;
      if (stamp[i] === t + 1) continue; stamp[i] = t + 1;
      if (grid[i] === 0) covered++; else if (grid[i] === 1) multi++;
      grid[i]++;
    }
  }
  const ov = covered ? multi / covered : 1;
  g.userData._ovKey = key; g.userData._ov = ov;
  return ov;
}

/**
 * Returns a new geometry with non-overlapping UVs. Vertices are split along chart borders;
 * position/normal/colour/mask are kept. angleLimit in degrees (Blender's default is 66°).
 */
export function smartUnwrap(g, { angleLimit = 60, margin = 0.004 } = {}) {
  const p = g.attributes.position.array, idx = g.index.array, tc = idx.length / 3, w = weldInfo(g);
  const N = new Float32Array(tc * 3), A = new Float32Array(tc);
  for (let t = 0; t < tc; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x, l = Math.hypot(x, y, z);
    A[t] = l / 2; if (l > 0) { N[t * 3] = x / l; N[t * 3 + 1] = y / l; N[t * 3 + 2] = z / l; }
  }
  // triangle adjacency through welded edges
  const edges = new Map();
  for (let t = 0; t < tc; t++) for (let k = 0; k < 3; k++) {
    const ra = w.rep[idx[t * 3 + k]], rb = w.rep[idx[t * 3 + (k + 1) % 3]]; const key = ra < rb ? ra * 4294967296 + rb : rb * 4294967296 + ra;
    const l = edges.get(key); if (l) l.push(t); else edges.set(key, [t]);
  }
  const cos = Math.cos(angleLimit * Math.PI / 180);
  const chartOf = new Int32Array(tc).fill(-1), charts = [];
  const order = Array.from({ length: tc }, (_, i) => i).sort((x, y) => A[y] - A[x]);
  for (const seed of order) {
    if (chartOf[seed] >= 0) continue;
    const id = charts.length, n0 = [N[seed * 3], N[seed * 3 + 1], N[seed * 3 + 2]], tris = [seed], q = [seed];
    chartOf[seed] = id;
    // area-weighted chart normal, updated as it grows (keeps charts flat-ish)
    const cn = [n0[0] * A[seed], n0[1] * A[seed], n0[2] * A[seed]];
    while (q.length) {
      const t = q.pop();
      for (let k = 0; k < 3; k++) {
        const ra = w.rep[idx[t * 3 + k]], rb = w.rep[idx[t * 3 + (k + 1) % 3]];
        for (const u of edges.get(ra < rb ? ra * 4294967296 + rb : rb * 4294967296 + ra) || []) {
          if (chartOf[u] >= 0) continue;
          const l = Math.hypot(cn[0], cn[1], cn[2]) || 1;
          if ((N[u * 3] * cn[0] + N[u * 3 + 1] * cn[1] + N[u * 3 + 2] * cn[2]) / l < cos) continue;
          if (N[u * 3] * n0[0] + N[u * 3 + 1] * n0[1] + N[u * 3 + 2] * n0[2] < cos * 0.8) continue;
          chartOf[u] = id; tris.push(u); q.push(u);
          cn[0] += N[u * 3] * A[u]; cn[1] += N[u * 3 + 1] * A[u]; cn[2] += N[u * 3 + 2] * A[u];
        }
      }
    }
    charts.push({ tris, n: cn });
  }
  // project each chart onto its plane; find the tight rectangle by trying a few rotations
  const outP = [], outUV = [], outI = [], outN = [], outC = [], outM = [];
  const nrm = g.attributes.normal?.array, col = g.attributes.color?.array, msk = g.attributes.mask?.array;
  const placed = [];
  for (const ch of charts) {
    const l = Math.hypot(...ch.n) || 1, n = new THREE.Vector3(ch.n[0] / l, ch.n[1] / l, ch.n[2] / l);
    const u = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
    const v = n.clone().cross(u);
    const map = new Map(), loc = [];
    for (const t of ch.tris) for (let k = 0; k < 3; k++) {
      const vi = idx[t * 3 + k];
      if (!map.has(vi)) { map.set(vi, loc.length); loc.push([vi, p[vi * 3] * u.x + p[vi * 3 + 1] * u.y + p[vi * 3 + 2] * u.z, p[vi * 3] * v.x + p[vi * 3 + 1] * v.y + p[vi * 3 + 2] * v.z]); }
    }
    let best = null;
    for (let r = 0; r < 90; r += 15) {
      const c = Math.cos(r * Math.PI / 180), s = Math.sin(r * Math.PI / 180);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [, x, y] of loc) { const X = x * c - y * s, Y = x * s + y * c; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }
      const area = (x1 - x0) * (y1 - y0);
      if (!best || area < best.area) best = { area, c, s, x0, y0, w: x1 - x0, h: y1 - y0 };
    }
    placed.push({ ch, map, loc, ...best });
  }
  // shelf packing (tallest first) into a square
  const total = placed.reduce((a, c) => a + (c.w + 1e-9) * (c.h + 1e-9), 0);
  const maxW = Math.max(...placed.map((c) => c.w));
  let side = Math.max(maxW, Math.sqrt(total) * 1.12);
  const pad = () => side * margin * 2;
  const pack = () => {
    let x = 0, y = 0, rowH = 0;
    for (const c of [...placed].sort((a, b) => b.h - a.h)) {
      if (x + c.w > side && x > 0) { x = 0; y += rowH + pad(); rowH = 0; }
      c.px = x; c.py = y; x += c.w + pad(); rowH = Math.max(rowH, c.h);
    }
    return y + rowH;
  };
  let height = pack();
  for (let i = 0; i < 12 && height > side * 1.02; i++) { side *= 1.06; height = pack(); }
  const S = Math.max(side, height) * (1 + margin * 2);
  for (const c of placed) {
    const base = outP.length / 3;
    for (const [vi, x, y] of c.loc) {
      const X = x * c.c - y * c.s - c.x0, Y = x * c.s + y * c.c - c.y0;
      outP.push(p[vi * 3], p[vi * 3 + 1], p[vi * 3 + 2]);
      outUV.push((c.px + X) / S + margin, (c.py + Y) / S + margin);
      if (nrm) outN.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2]);
      if (col) outC.push(col[vi * 4], col[vi * 4 + 1], col[vi * 4 + 2], col[vi * 4 + 3]);
      if (msk) outM.push(msk[vi]);
    }
    for (const t of c.ch.tris) for (let k = 0; k < 3; k++) outI.push(base + c.map.get(idx[t * 3 + k]));
  }
  const out = fromArrays({ position: outP, index: outI, uv: outUV, color: col ? outC : null, mask: msk ? outM : null, flat: !!g.userData.flat });
  // keep the original shading (normals were averaged across the new seams by fromArrays; restore exact ones)
  if (nrm && outN.length === out.attributes.normal.array.length) { out.attributes.normal.array.set(outN); out.attributes.normal.needsUpdate = true; }
  out.userData.charts = placed.length;
  return { geo: out, charts: placed.length, oldUv: (() => { // old UVs for baking, aligned with the new vertices
    const ouv = g.attributes.uv; if (!ouv) return null;
    const arr = new Float32Array((outP.length / 3) * 2); let i = 0;
    for (const c of placed) for (const [vi] of c.loc) { arr[i++] = ouv.getX(vi); arr[i++] = ouv.getY(vi); }
    return arr;
  })() };
}
