// Triangle selection for Edit mode and the topology operations that act on it.
import { weldInfo, vertexTriangles, fromArrays, removeUnused, computeNormals } from './mesh.js';

export class FaceSelection {
  constructor() { this.geo = null; this.sel = new Uint8Array(0); this.version = 0; }

  bind(g) {
    if (g === this.geo && (g?.userData.topo || 0) === this.topo && this.sel.length === (g ? g.index.count / 3 : 0)) return;
    this.geo = g; this.topo = g?.userData.topo || 0;
    this.sel = new Uint8Array(g ? g.index.count / 3 : 0); this.version++;
  }
  rebind(g, sel) { this.geo = g; this.topo = g.userData.topo || 0; this.sel = sel && sel.length === g.index.count / 3 ? sel : new Uint8Array(g.index.count / 3); this.version++; }
  count() { let c = 0; for (const s of this.sel) c += s; return c; }
  isEmpty() { return !this.sel.some((s) => s); }
  selectAll() { this.sel.fill(1); this.version++; }
  clear() { this.sel.fill(0); this.version++; }
  invert() { for (let i = 0; i < this.sel.length; i++) this.sel[i] ^= 1; this.version++; }

  paint(c, r, value) {
    const g = this.geo; if (!g) return false;
    const p = g.attributes.position.array, idx = g.index.array, r2 = r * r, val = value ? 1 : 0; let any = false;
    for (let t = 0; t < this.sel.length; t++) {
      if (this.sel[t] === val) continue;
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, cc = idx[t * 3 + 2] * 3;
      const x = (p[a] + p[b] + p[cc]) / 3 - c[0], y = (p[a + 1] + p[b + 1] + p[cc + 1]) / 3 - c[1], z = (p[a + 2] + p[b + 2] + p[cc + 2]) / 3 - c[2];
      if (x * x + y * y + z * z <= r2) { this.sel[t] = val; any = true; }
    }
    if (any) this.version++;
    return any;
  }

  grow() {
    const g = this.geo; if (!g) return;
    const w = weldInfo(g), idx = g.index.array, vsel = new Uint8Array(w.rep.length);
    for (let t = 0; t < this.sel.length; t++) if (this.sel[t]) for (let k = 0; k < 3; k++) vsel[w.rep[idx[t * 3 + k]]] = 1;
    for (let t = 0; t < this.sel.length; t++) if (!this.sel[t]) for (let k = 0; k < 3; k++) if (vsel[w.rep[idx[t * 3 + k]]]) { this.sel[t] = 1; break; }
    this.version++;
  }

  selectLinked() {
    const g = this.geo; if (!g) return;
    const w = weldInfo(g), vt = vertexTriangles(g), idx = g.index.array, q = [];
    for (let t = 0; t < this.sel.length; t++) if (this.sel[t]) q.push(t);
    while (q.length) {
      const t = q.pop();
      for (let k = 0; k < 3; k++) {
        const r = w.rep[idx[t * 3 + k]];
        for (let i = w.groupStart[r]; i < w.groupStart[r + 1]; i++) {
          const v = w.groupList[i];
          for (let j = vt.start[v]; j < vt.start[v + 1]; j++) { const n = vt.list[j]; if (!this.sel[n]) { this.sel[n] = 1; q.push(n); } }
        }
      }
    }
    this.version++;
  }

  /**
   * Flat region under a clicked triangle: all connected triangles lying in the same plane
   * (within `angleDeg`). This is the "face" a CAD tool would pick for push/pull.
   */
  selectCoplanar(t0, value = 1, angleDeg = 2) {
    const g = this.geo; if (!g || t0 == null || t0 < 0 || t0 >= this.sel.length) return 0;
    const w = weldInfo(g), idx = g.index.array, p = g.attributes.position.array, tc = this.sel.length;
    const nrm = (t, out) => {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
      const x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x, l = Math.hypot(x, y, z) || 1;
      out[0] = x / l; out[1] = y / l; out[2] = z / l; return out;
    };
    // welded edge → triangles
    if (!this._edgeTris || this._edgeGeo !== g || this._edgeTopo !== this.topo) {
      const m = new Map();
      for (let t = 0; t < tc; t++) for (let k = 0; k < 3; k++) {
        const ra = w.rep[idx[t * 3 + k]], rb = w.rep[idx[t * 3 + (k + 1) % 3]];
        const key = ra < rb ? ra * 4294967296 + rb : rb * 4294967296 + ra;
        const l = m.get(key); if (l) l.push(t); else m.set(key, [t]);
      }
      this._edgeTris = m; this._edgeGeo = g; this._edgeTopo = this.topo;
    }
    const n0 = nrm(t0, [0, 0, 0]), a0 = idx[t0 * 3] * 3, d0 = n0[0] * p[a0] + n0[1] * p[a0 + 1] + n0[2] * p[a0 + 2];
    const box = g.boundingBox || (g.computeBoundingBox(), g.boundingBox);
    const eps = Math.max(1e-6, box.min.distanceTo(box.max) * 1e-4), cos = Math.cos(angleDeg * Math.PI / 180), n = [0, 0, 0];
    const seen = new Uint8Array(tc), q = [t0]; seen[t0] = 1; let count = 0;
    while (q.length) {
      const t = q.pop();
      this.sel[t] = value; count++;
      for (let k = 0; k < 3; k++) {
        const ra = w.rep[idx[t * 3 + k]], rb = w.rep[idx[t * 3 + (k + 1) % 3]];
        for (const u of this._edgeTris.get(ra < rb ? ra * 4294967296 + rb : rb * 4294967296 + ra) || []) {
          if (seen[u]) continue; seen[u] = 1;
          nrm(u, n);
          if (n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] < cos) continue;
          const b = idx[u * 3] * 3;
          if (Math.abs(n0[0] * p[b] + n0[1] * p[b + 1] + n0[2] * p[b + 2] - d0) > eps) continue;
          q.push(u);
        }
      }
    }
    this.version++;
    return count;
  }

  selectedVertices() {
    const g = this.geo; if (!g) return [];
    const w = weldInfo(g), idx = g.index.array, mark = new Uint8Array(w.rep.length);
    for (let t = 0; t < this.sel.length; t++) if (this.sel[t]) for (let k = 0; k < 3; k++) { const r = w.rep[idx[t * 3 + k]]; for (let i = w.groupStart[r]; i < w.groupStart[r + 1]; i++) mark[w.groupList[i]] = 1; }
    const out = []; for (let v = 0; v < mark.length; v++) if (mark[v]) out.push(v); return out;
  }

  averageNormal() {
    const g = this.geo, p = g.attributes.position.array, idx = g.index.array; let x = 0, y = 0, z = 0;
    for (let t = 0; t < this.sel.length; t++) if (this.sel[t]) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      x += e1[1] * e2[2] - e1[2] * e2[1]; y += e1[2] * e2[0] - e1[0] * e2[2]; z += e1[0] * e2[1] - e1[1] * e2[0];
    }
    const l = Math.hypot(x, y, z); return l < 1e-20 ? [0, 1, 0] : [x / l, y / l, z / l];
  }

  attrs(g) { return { uv: g.attributes.uv?.array, color: g.attributes.color?.array, mask: g.attributes.mask?.array }; }

  subset(keep) {
    const g = this.geo, idx = g.index.array, out = [];
    for (let t = 0; t < this.sel.length; t++) if (!!this.sel[t] === keep) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
    if (!out.length) return null;
    const a = this.attrs(g);
    return removeUnused(fromArrays({ position: g.attributes.position.array.slice(), index: out, uv: a.uv?.slice(), color: a.color?.slice(), mask: a.mask?.slice(), flat: g.userData.flat }));
  }
  deleteFaces() { return this.isEmpty() ? null : this.subset(false); }
  extract() { return this.isEmpty() ? null : this.subset(true); }

  flipFaces() {
    if (this.isEmpty()) return null;
    const g = this.geo, idx = g.index.array.slice();
    for (let t = 0; t < this.sel.length; t++) if (this.sel[t]) { const tmp = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = tmp; }
    const a = this.attrs(g);
    return { geo: fromArrays({ position: g.attributes.position.array.slice(), index: idx, uv: a.uv?.slice(), color: a.color?.slice(), mask: a.mask?.slice(), flat: g.userData.flat }), sel: this.sel.slice() };
  }

  /** Extrude the selection along its average normal; returns {geo, sel}. */
  extrude(distance) {
    if (this.isEmpty()) return null;
    const g = this.geo, w = weldInfo(g), idx = g.index.array, tc = this.sel.length;
    const key = (a, b) => { const ra = w.rep[a], rb = w.rep[b]; return ra < rb ? ra * 4294967296 + rb : rb * 4294967296 + ra; };
    const use = new Map();
    for (let t = 0; t < tc; t++) if (this.sel[t]) for (let k = 0; k < 3; k++) { const kk = key(idx[t * 3 + k], idx[t * 3 + (k + 1) % 3]); use.set(kk, (use.get(kk) || 0) + 1); }
    const nrm = this.averageNormal(), vc = g.attributes.position.count, dup = new Int32Array(vc).fill(-1);
    const P = Array.from(g.attributes.position.array);
    const a = this.attrs(g);
    const UV = a.uv ? Array.from(a.uv) : null, C = a.color ? Array.from(a.color) : null, M = a.mask ? Array.from(a.mask) : null;
    let next = vc;
    const dupOf = (v) => {
      if (dup[v] >= 0) return dup[v];
      P.push(P[v * 3] + nrm[0] * distance, P[v * 3 + 1] + nrm[1] * distance, P[v * 3 + 2] + nrm[2] * distance);
      if (UV) UV.push(UV[v * 2], UV[v * 2 + 1]);
      if (C) C.push(C[v * 4], C[v * 4 + 1], C[v * 4 + 2], C[v * 4 + 3]);
      if (M) M.push(M[v]);
      return (dup[v] = next++);
    };
    const I = [], sel = [];
    for (let t = 0; t < tc; t++) {
      if (this.sel[t]) { I.push(dupOf(idx[t * 3]), dupOf(idx[t * 3 + 1]), dupOf(idx[t * 3 + 2])); sel.push(1); }
      else { I.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]); sel.push(0); }
    }
    for (let t = 0; t < tc; t++) if (this.sel[t]) for (let k = 0; k < 3; k++) {
      const v0 = idx[t * 3 + k], v1 = idx[t * 3 + (k + 1) % 3];
      if (use.get(key(v0, v1)) !== 1) continue;
      const a2 = dupOf(v0), b2 = dupOf(v1);
      I.push(v0, v1, b2); sel.push(0); I.push(v0, b2, a2); sel.push(0);
    }
    const geo = fromArrays({ position: P, index: I, uv: UV, color: C, mask: M, flat: g.userData.flat });
    return { geo, sel: Uint8Array.from(sel) };
  }

  inset(amount) {
    const r = this.extrude(0); if (!r) return null;
    const p = r.geo.attributes.position.array, idx = r.geo.index.array, vs = new Set();
    for (let t = 0; t < r.sel.length; t++) if (r.sel[t]) for (let k = 0; k < 3; k++) vs.add(idx[t * 3 + k]);
    let cx = 0, cy = 0, cz = 0; for (const v of vs) { cx += p[v * 3]; cy += p[v * 3 + 1]; cz += p[v * 3 + 2]; }
    const n = Math.max(1, vs.size); cx /= n; cy /= n; cz /= n;
    for (const v of vs) { p[v * 3] += (cx - p[v * 3]) * amount; p[v * 3 + 1] += (cy - p[v * 3 + 1]) * amount; p[v * 3 + 2] += (cz - p[v * 3 + 2]) * amount; }
    computeNormals(r.geo);
    return r;
  }

  /** Index buffer of selected triangles (for the highlight overlay). */
  selectedIndex() {
    const g = this.geo; if (!g) return new Uint32Array(0);
    const idx = g.index.array, out = [];
    for (let t = 0; t < this.sel.length; t++) if (this.sel[t]) out.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
    return Uint32Array.from(out);
  }
}
