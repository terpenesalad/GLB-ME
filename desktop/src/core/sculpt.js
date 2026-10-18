// Nomad-style sculpting on a BufferGeometry in its local space (port of the Android SculptEngine).
// Works on seam-welded vertex groups so UV seams never tear, records sparse undo data and
// updates normals incrementally.
import { weldInfo, weldedNeighbours, vertexTriangles, ensureColors, ensureMask, computeNormals as computeNormalsFull } from './mesh.js';

export const BRUSHES = [
  ['CLAY', 'Clay', 'brush'], ['DRAW', 'Draw', 'pencil'], ['INFLATE', 'Inflate', 'circle-plus'], ['SMOOTH', 'Smooth', 'waves'],
  ['FLATTEN', 'Flatten', 'minus'], ['PINCH', 'Pinch', 'shrink'], ['CREASE', 'Crease', 'chevron-down'], ['MOVE', 'Move', 'hand'],
  ['DRAG', 'Drag', 'move-up-right'], ['LAYER', 'Layer', 'layers-2'], ['MASK', 'Mask', 'contrast'], ['PAINT', 'Paint', 'paintbrush'],
].map(([id, label, icon]) => ({ id, label, icon }));
export const FALLOFFS = ['Smooth', 'Sphere', 'Sharp', 'Linear', 'Flat'];

export function defaultBrush(id) {
  const b = { radiusPx: 70, intensity: 0.5, negative: false, falloff: 0, usePressure: true, spacing: 0.12, color: [0.8, 0.2, 0.2, 1] };
  if (id === 'SMOOTH') b.intensity = 0.6; if (id === 'MOVE') { b.radiusPx = 110; b.intensity = 0.8; }
  if (id === 'DRAG') b.intensity = 0.7; if (id === 'MASK') b.intensity = 0.8; if (id === 'PAINT') b.intensity = 0.7;
  if (id === 'INFLATE') b.intensity = 0.35; if (id === 'LAYER') b.intensity = 0.6;
  return b;
}

export class SculptEngine {
  constructor() { this.geo = null; this.cacheGeo = null; this.cacheTopo = -1; this.symmetry = [true, false, false]; }

  begin(geo, type, settings, localRadius) {
    this.geo = geo; this.type = type; this.s = settings;
    const n = geo.attributes.position.count;
    const topo = geo.userData.topo || 0;
    if (this.cacheGeo !== geo || this.cacheTopo !== topo) {
      this.w = weldInfo(geo);
      this.nb = weldedNeighbours(geo, this.w);
      this.vt = vertexTriangles(geo);
      this.faceN = new Float32Array(geo.index.count);
      this.computeAllFaceNormals();
      this.stamp = new Int32Array(n); this.stampId = 1;
      this.tmp = new Float32Array(n * 3);
      this.cacheGeo = geo; this.cacheTopo = topo; this.grid = null;
    }
    if (type === 'PAINT') ensureColors(geo);
    if (type === 'MASK') ensureMask(geo);
    this.slot = new Int32Array(n).fill(-1);
    this.undo = { idx: [], pos: [], nrm: [], col: [], mask: [] };
    this.layerH = type === 'LAYER' ? new Float32Array(n) : null;
    this.grab = [];
    if (!this.grid || localRadius * 0.8 > this.cell * 3 || localRadius * 0.8 < this.cell / 3 || this.gridGeoVersion !== geo.userData.geomVersion) this.buildGrid(Math.max(localRadius * 0.8, 1e-5));
  }

  get active() { return !!this.geo; }

  computeAllFaceNormals() {
    const p = this.geo.attributes.position.array, idx = this.geo.index.array;
    for (let t = 0; t < idx.length; t += 3) this.faceNormal(t / 3, p, idx);
  }
  faceNormal(t, p, idx) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const f = this.faceN; f[t * 3] = e1y * e2z - e1z * e2y; f[t * 3 + 1] = e1z * e2x - e1x * e2z; f[t * 3 + 2] = e1x * e2y - e1y * e2x;
  }

  buildGrid(cs) {
    this.cell = cs; this.grid = new Map();
    const p = this.geo.attributes.position.array, rep = this.w.rep, n = rep.length;
    this.cellOf = new Array(n);
    for (let v = 0; v < n; v++) {
      if (rep[v] !== v) continue;
      const k = this.key(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      this.cellOf[v] = k;
      let l = this.grid.get(k); if (!l) { l = []; this.grid.set(k, l); } l.push(v);
    }
    this.gridGeoVersion = this.geo.userData.geomVersion;
  }
  key(x, y, z) { const c = this.cell; return (Math.floor(x / c) * 73856093) ^ (Math.floor(y / c) * 19349663) ^ (Math.floor(z / c) * 83492791); }
  regrid(v, p) {
    const k = this.key(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
    if (k === this.cellOf[v]) return;
    const old = this.grid.get(this.cellOf[v]); if (old) { const i = old.indexOf(v); if (i >= 0) { old[i] = old[old.length - 1]; old.pop(); } }
    let l = this.grid.get(k); if (!l) { l = []; this.grid.set(k, l); } l.push(v);
    this.cellOf[v] = k;
  }
  query(cx, cy, cz, r) {
    const out = [], p = this.geo.attributes.position.array, r2 = r * r, c = this.cell;
    const x0 = Math.floor((cx - r) / c), x1 = Math.floor((cx + r) / c), y0 = Math.floor((cy - r) / c), y1 = Math.floor((cy + r) / c), z0 = Math.floor((cz - r) / c), z1 = Math.floor((cz + r) / c);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096) {
      const rep = this.w.rep;
      for (let v = 0; v < rep.length; v++) { if (rep[v] !== v) continue; const dx = p[v * 3] - cx, dy = p[v * 3 + 1] - cy, dz = p[v * 3 + 2] - cz; if (dx * dx + dy * dy + dz * dz <= r2) out.push(v); }
      return out;
    }
    const seen = new Set();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
      if (seen.has(k)) continue; seen.add(k);
      const l = this.grid.get(k); if (!l) continue;
      for (const v of l) { const dx = p[v * 3] - cx, dy = p[v * 3 + 1] - cy, dz = p[v * 3 + 2] - cz; if (dx * dx + dy * dy + dz * dz <= r2) out.push(v); }
    }
    return out;
  }

  falloff(x) {
    const t = Math.min(1, Math.max(0, x));
    switch (this.s.falloff) {
      case 1: return Math.sqrt(Math.max(0, 1 - t * t));
      case 2: return (1 - t) * (1 - t);
      case 3: return 1 - t;
      case 4: return t < 0.85 ? 1 : (1 - t) / 0.15;
      default: return 1 - t * t * (3 - 2 * t);
    }
  }

  capture(v) {
    if (this.slot[v] >= 0) return;
    const g = this.geo, u = this.undo;
    this.slot[v] = u.idx.length; u.idx.push(v);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    u.pos.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]); u.nrm.push(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
    const c = g.attributes.color?.array; if (c) u.col.push(c[v * 4], c[v * 4 + 1], c[v * 4 + 2], c[v * 4 + 3]);
    const m = g.attributes.mask?.array; if (m) u.mask.push(m[v]);
  }

  passes() {
    const out = [];
    for (const a of this.symmetry[0] ? [1, -1] : [1]) for (const b of this.symmetry[1] ? [1, -1] : [1]) for (const c of this.symmetry[2] ? [1, -1] : [1]) out.push([a, b, c]);
    return out;
  }

  /** One dab at local [center] (array) with local radius r; delta for Move/Drag. */
  dab(center, r, pressure, delta) {
    if (!this.geo || r <= 0) return;
    if (r > this.cell * 4 || r < this.cell * 0.25) this.buildGrid(Math.max(r * 0.8, 1e-5));
    this.moved = []; this.stampId++;
    const press = this.s.usePressure ? Math.min(1, Math.max(0.05, pressure)) : 1;
    const strength = this.s.intensity * press, sign = this.s.negative ? -1 : 1;
    for (const s of this.passes()) {
      const c = [center[0] * s[0], center[1] * s[1], center[2] * s[2]];
      const d = delta ? [delta[0] * s[0], delta[1] * s[1], delta[2] * s[2]] : null;
      this.apply(c, r, strength, sign, d, s);
    }
    this.finish();
  }

  mark(v) { if (this.stamp[v] !== this.stampId) { this.stamp[v] = this.stampId; this.moved.push(v); } }

  weight(v, c, r, p, mask) {
    const dx = p[v * 3] - c[0], dy = p[v * 3 + 1] - c[1], dz = p[v * 3 + 2] - c[2];
    const f = this.falloff(Math.sqrt(dx * dx + dy * dy + dz * dz) / r);
    return mask ? f * (1 - mask[v]) : f;
  }

  apply(c, r, strength, sign, delta, sym) {
    const g = this.geo, p = g.attributes.position.array, nrm = g.attributes.normal.array, mask = g.attributes.mask?.array;
    if (this.type === 'MOVE') return this.applyGrab(c, r, delta, sym);
    const found = this.query(c[0], c[1], c[2], r);
    if (!found.length) return;
    let anx = 0, any = 0, anz = 0, acx = 0, acy = 0, acz = 0, aw = 0;
    for (const v of found) {
      const dx = p[v * 3] - c[0], dy = p[v * 3 + 1] - c[1], dz = p[v * 3 + 2] - c[2];
      const f = this.falloff(Math.sqrt(dx * dx + dy * dy + dz * dz) / r);
      anx += nrm[v * 3] * f; any += nrm[v * 3 + 1] * f; anz += nrm[v * 3 + 2] * f;
      acx += p[v * 3] * f; acy += p[v * 3 + 1] * f; acz += p[v * 3 + 2] * f; aw += f;
    }
    const nl = Math.hypot(anx, any, anz);
    if (nl < 1e-12 || aw < 1e-12) return;
    anx /= nl; any /= nl; anz /= nl; acx /= aw; acy /= aw; acz /= aw;
    const t = this.type;
    if (t === 'SMOOTH') {
      const tmp = this.tmp, nb = this.nb;
      for (const v of found) {
        const s = nb.start[v], e = nb.start[v + 1];
        if (e === s) { tmp[v * 3] = p[v * 3]; tmp[v * 3 + 1] = p[v * 3 + 1]; tmp[v * 3 + 2] = p[v * 3 + 2]; continue; }
        let sx = 0, sy = 0, sz = 0; for (let j = s; j < e; j++) { const w = nb.list[j] * 3; sx += p[w]; sy += p[w + 1]; sz += p[w + 2]; }
        const inv = 1 / (e - s); tmp[v * 3] = sx * inv; tmp[v * 3 + 1] = sy * inv; tmp[v * 3 + 2] = sz * inv;
      }
      for (const v of found) {
        const w = this.weight(v, c, r, p, mask) * Math.min(1, strength * 1.6);
        if (w <= 0) continue;
        this.capture(v);
        p[v * 3] += (tmp[v * 3] - p[v * 3]) * w; p[v * 3 + 1] += (tmp[v * 3 + 1] - p[v * 3 + 1]) * w; p[v * 3 + 2] += (tmp[v * 3 + 2] - p[v * 3 + 2]) * w;
        this.mark(v);
      }
      return;
    }
    if (t === 'MASK') {
      const mk = ensureMask(g);
      for (const v of found) {
        const dx = p[v * 3] - c[0], dy = p[v * 3 + 1] - c[1], dz = p[v * 3 + 2] - c[2];
        const w = this.falloff(Math.sqrt(dx * dx + dy * dy + dz * dz) / r) * strength;
        if (w <= 0) continue; this.capture(v);
        mk[v] = Math.min(1, Math.max(0, mk[v] + sign * w)); this.mark(v);
      }
      return;
    }
    if (t === 'PAINT') {
      const col = ensureColors(g), pc = this.s.color;
      for (const v of found) {
        const w = this.weight(v, c, r, p, mask) * strength;
        if (w <= 0) continue; this.capture(v);
        for (let q = 0; q < 4; q++) col[v * 4 + q] += ((sign < 0 ? 1 : pc[q]) - col[v * 4 + q]) * w;
        this.mark(v);
      }
      return;
    }
    const h = r * 0.1;
    for (const v of found) {
      const w = this.weight(v, c, r, p, mask) * strength;
      if (w <= 0) continue;
      this.capture(v);
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      if (t === 'DRAW') { const s = sign * w * h * 1.2; p[v * 3] = x + anx * s; p[v * 3 + 1] = y + any * s; p[v * 3 + 2] = z + anz * s; }
      else if (t === 'CLAY') {
        const off = r * 0.18 * sign;
        const d = (x - acx) * anx + (y - acy) * any + (z - acz) * anz - off;
        if ((sign > 0 && d < 0) || (sign < 0 && d > 0)) { const s = -d * w * 0.5; p[v * 3] = x + anx * s; p[v * 3 + 1] = y + any * s; p[v * 3 + 2] = z + anz * s; }
      } else if (t === 'INFLATE') { const s = sign * w * h * 0.9; p[v * 3] = x + nrm[v * 3] * s; p[v * 3 + 1] = y + nrm[v * 3 + 1] * s; p[v * 3 + 2] = z + nrm[v * 3 + 2] * s; }
      else if (t === 'FLATTEN') { const d = (x - acx) * anx + (y - acy) * any + (z - acz) * anz; const s = -d * w * 0.5; p[v * 3] = x + anx * s; p[v * 3 + 1] = y + any * s; p[v * 3 + 2] = z + anz * s; }
      else if (t === 'PINCH' || t === 'CREASE') {
        let tx = c[0] - x, ty = c[1] - y, tz = c[2] - z;
        const dn = tx * anx + ty * any + tz * anz; tx -= anx * dn; ty -= any * dn; tz -= anz * dn;
        const k2 = sign * w * (t === 'PINCH' ? 0.35 : 0.25);
        let nx = x + tx * k2, ny = y + ty * k2, nz = z + tz * k2;
        if (t === 'CREASE') { const s = -sign * w * h * 0.6; nx += anx * s; ny += any * s; nz += anz * s; }
        p[v * 3] = nx; p[v * 3 + 1] = ny; p[v * 3 + 2] = nz;
      } else if (t === 'DRAG') { if (delta) { p[v * 3] = x + delta[0] * w; p[v * 3 + 1] = y + delta[1] * w; p[v * 3 + 2] = z + delta[2] * w; } }
      else if (t === 'LAYER') {
        const oi = this.slot[v], u = this.undo;
        const target = sign * h * 1.5, cur = this.layerH[v];
        const next = sign > 0 ? Math.min(target, cur + w * h * 0.6) : Math.max(target, cur - w * h * 0.6);
        this.layerH[v] = next;
        p[v * 3] = u.pos[oi * 3] + u.nrm[oi * 3] * next; p[v * 3 + 1] = u.pos[oi * 3 + 1] + u.nrm[oi * 3 + 1] * next; p[v * 3 + 2] = u.pos[oi * 3 + 2] + u.nrm[oi * 3 + 2] * next;
      }
      this.mark(v);
    }
  }

  applyGrab(c, r, delta, sym) {
    const p = this.geo.attributes.position.array, symId = (sym[0] < 0 ? 1 : 0) | (sym[1] < 0 ? 2 : 0) | (sym[2] < 0 ? 4 : 0);
    if (!delta) {
      const mask = this.geo.attributes.mask?.array;
      for (const v of this.query(c[0], c[1], c[2], r)) {
        const w = this.weight(v, c, r, p, mask);
        if (w > 0) this.grab.push({ v, w, sym: symId, o: [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]] });
      }
      return;
    }
    const k = Math.max(0.15, this.s.intensity) * 1.6;
    for (const gr of this.grab) {
      if (gr.sym !== symId) continue;
      const w = Math.min(1, gr.w * k); this.capture(gr.v);
      p[gr.v * 3] = gr.o[0] + delta[0] * w; p[gr.v * 3 + 1] = gr.o[1] + delta[1] * w; p[gr.v * 3 + 2] = gr.o[2] + delta[2] * w;
      this.mark(gr.v);
    }
  }

  grabStart(center, r) {
    this.grab = [];
    for (const s of this.passes()) this.applyGrab([center[0] * s[0], center[1] * s[1], center[2] * s[2]], r, null, s);
  }

  finish() {
    const g = this.geo, moved = this.moved;
    if (!moved.length) return;
    const p = g.attributes.position.array, w = this.w, col = g.attributes.color?.array, mk = g.attributes.mask?.array;
    const n0 = moved.length;
    for (let k = 0; k < n0; k++) {
      const v = moved[k], gs = w.groupStart[v], ge = w.groupStart[v + 1];
      if (ge - gs <= 1) continue;
      for (let i = gs; i < ge; i++) {
        const d = w.groupList[i]; if (d === v) continue;
        this.capture(d);
        p[d * 3] = p[v * 3]; p[d * 3 + 1] = p[v * 3 + 1]; p[d * 3 + 2] = p[v * 3 + 2];
        if (col) for (let q = 0; q < 4; q++) col[d * 4 + q] = col[v * 4 + q];
        if (mk) mk[d] = mk[v];
        moved.push(d);
      }
    }
    let lo = Infinity, hi = -1; for (const v of moved) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (this.type === 'PAINT') { range(g.attributes.color, lo, hi); return; }
    if (this.type === 'MASK') { range(g.attributes.mask, lo, hi); return; }
    for (let k = 0; k < n0; k++) this.regrid(moved[k], p);
    this.updateNormals(moved);
    range(g.attributes.position, lo, hi);
    g.userData.geomVersion = (g.userData.geomVersion || 0) + 1;
    this.gridGeoVersion = g.userData.geomVersion;
  }

  /** Recompute normals around the moved vertices (face normals, then vertex sums). */
  updateNormals(moved) {
    const g = this.geo, p = g.attributes.position.array, idx = g.index.array, nrm = g.attributes.normal.array, vt = this.vt, w = this.w;
    this.stampId++;
    const faces = [], verts = [];
    const fstamp = this.fstamp && this.fstamp.length === idx.length / 3 ? this.fstamp : (this.fstamp = new Int32Array(idx.length / 3));
    this.fid = (this.fid || 0) + 1;
    for (const v of moved) for (let j = vt.start[v]; j < vt.start[v + 1]; j++) { const t = vt.list[j]; if (fstamp[t] !== this.fid) { fstamp[t] = this.fid; faces.push(t); this.faceNormal(t, p, idx); } }
    for (const t of faces) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; if (this.stamp[v] !== this.stampId) { this.stamp[v] = this.stampId; verts.push(v); } }
    const fn = this.faceN;
    for (const v of verts) {
      let x = 0, y = 0, z = 0;
      for (let j = vt.start[v]; j < vt.start[v + 1]; j++) { const t = vt.list[j]; x += fn[t * 3]; y += fn[t * 3 + 1]; z += fn[t * 3 + 2]; }
      nrm[v * 3] = x; nrm[v * 3 + 1] = y; nrm[v * 3 + 2] = z;
    }
    if (!g.userData.flat) {
      // average across seam duplicates (smooth), like the full computeNormals
      this.stampId++;
      for (const v of verts) {
        const r = w.rep[v]; if (this.stamp[r] === this.stampId) continue; this.stamp[r] = this.stampId;
        const s = w.groupStart[r], e = w.groupStart[r + 1]; if (e - s <= 1) continue;
        let x = 0, y = 0, z = 0;
        for (let k = s; k < e; k++) { const u = w.groupList[k]; let ux = 0, uy = 0, uz = 0; for (let j = vt.start[u]; j < vt.start[u + 1]; j++) { const t = vt.list[j]; ux += fn[t * 3]; uy += fn[t * 3 + 1]; uz += fn[t * 3 + 2]; } x += ux; y += uy; z += uz; }
        for (let k = s; k < e; k++) { const u = w.groupList[k] * 3; nrm[u] = x; nrm[u + 1] = y; nrm[u + 2] = z; }
      }
    }
    for (const v of verts) { const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1; nrm[v * 3] /= l; nrm[v * 3 + 1] /= l; nrm[v * 3 + 2] /= l; }
    let lo = Infinity, hi = -1; for (const v of verts) { if (v < lo) lo = v; if (v > hi) hi = v; }
    range(g.attributes.normal, lo, hi);
  }

  /** Ends the stroke; returns an undo record or null. */
  end() {
    const g = this.geo; if (!g) return null;
    this.geo = null;
    const u = this.undo, n = u.idx.length;
    if (!n) return null;
    const idx = Int32Array.from(u.idx), before = Float32Array.from(u.pos);
    const beforeC = g.attributes.color && u.col.length === n * 4 ? Float32Array.from(u.col) : null;
    const beforeM = g.attributes.mask && u.mask.length === n ? Float32Array.from(u.mask) : null;
    const after = new Float32Array(n * 3), afterC = beforeC ? new Float32Array(n * 4) : null, afterM = beforeM ? new Float32Array(n) : null;
    const p = g.attributes.position.array, c = g.attributes.color?.array, m = g.attributes.mask?.array;
    for (let i = 0; i < n; i++) {
      const v = idx[i]; after[i * 3] = p[v * 3]; after[i * 3 + 1] = p[v * 3 + 1]; after[i * 3 + 2] = p[v * 3 + 2];
      if (afterC) for (let q = 0; q < 4; q++) afterC[i * 4 + q] = c[v * 4 + q];
      if (afterM) afterM[i] = m[v];
    }
    const topo = g.userData.topo || 0, engine = this;
    const applyState = (P, C, M) => {
      if ((g.userData.topo || 0) !== topo) return;
      const pp = g.attributes.position.array, cc = g.attributes.color?.array, mm = g.attributes.mask?.array;
      for (let i = 0; i < n; i++) {
        const v = idx[i]; pp[v * 3] = P[i * 3]; pp[v * 3 + 1] = P[i * 3 + 1]; pp[v * 3 + 2] = P[i * 3 + 2];
        if (C && cc) for (let q = 0; q < 4; q++) cc[v * 4 + q] = C[i * 4 + q];
        if (M && mm) mm[v] = M[i];
      }
      g.attributes.position.needsUpdate = true;
      if (g.attributes.color) g.attributes.color.needsUpdate = true;
      if (g.attributes.mask) g.attributes.mask.needsUpdate = true;
      g.userData.geomVersion = (g.userData.geomVersion || 0) + 1;
      const prevGeo = engine.geo;
      if (engine.cacheGeo === g) { engine.geo = g; engine.computeAllFaceNormals(); engine.updateNormals(Array.from(idx)); engine.geo = prevGeo; engine.grid = null; }
      else { computeNormalsFull(g); }
    };
    return { label: BRUSHES.find((b) => b.id === this.type)?.label || 'Sculpt', bytes: n * 40, undo: () => applyState(before, beforeC, beforeM), redo: () => applyState(after, afterC, afterM) };
  }
}

function range(attr, lo, hi) {
  if (hi < lo) return;
  attr.clearUpdateRanges?.();
  if (attr.addUpdateRange) attr.addUpdateRange(lo * attr.itemSize, (hi - lo + 1) * attr.itemSize);
  attr.needsUpdate = true;
}

export const MaskOps = {
  clear(g) { const m = g.attributes.mask; if (m) { m.array.fill(0); m.needsUpdate = true; } },
  invert(g) { const m = ensureMask(g); for (let i = 0; i < m.length; i++) m[i] = 1 - m[i]; g.attributes.mask.needsUpdate = true; },
  blur(g, it = 2) {
    const m = g.attributes.mask?.array; if (!m) return;
    const w = weldInfo(g), nb = weldedNeighbours(g, w);
    for (let k = 0; k < it; k++) {
      const tmp = Float32Array.from(m);
      for (let v = 0; v < m.length; v++) { const r = w.rep[v]; let s = m[r], c = 1; for (let j = nb.start[r]; j < nb.start[r + 1]; j++) { s += m[nb.list[j]]; c++; } tmp[v] = s / c; }
      m.set(tmp);
    }
    g.attributes.mask.needsUpdate = true;
  },
  sharpen(g) { const m = g.attributes.mask?.array; if (!m) return; for (let i = 0; i < m.length; i++) m[i] = Math.min(1, Math.max(0, (m[i] - 0.5) * 2 + 0.5)); g.attributes.mask.needsUpdate = true; },
};
