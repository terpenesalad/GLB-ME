// Signed-distance modelling for organic templates (animals, rocks): smooth-blended primitives are
// sampled on a grid and meshed with Surface Nets, giving a single watertight, smooth-shaded mesh
// with blended vertex colours. Units are metres.
import * as THREE from 'three';

const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hsh = (i, j, k) => { let n = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791); n = (n << 13) ^ n; return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff; };
/** 3D value noise in [0, 1]. */
export function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(hsh(i, j, k), hsh(i + 1, j, k), u), L(hsh(i, j + 1, k), hsh(i + 1, j + 1, k), u), v), L(L(hsh(i, j, k + 1), hsh(i + 1, j, k + 1), u), L(hsh(i, j + 1, k + 1), hsh(i + 1, j + 1, k + 1), u), v), w);
}
export const fbm3 = (x, y, z, o = 3) => { let s = 0, a = 1, n = 0; for (let i = 0; i < o; i++) { s += a * noise3(x, y, z); n += a; a *= 0.5; x *= 2; y *= 2; z *= 2; } return s / n; };
export const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h); };

function rotM(r) { if (!r) return null; const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180, 'YXZ')).invert(); return m.elements; }
/**
 * Primitive constructors. Each returns { d(x,y,z), c: colour [r,g,b], k: blend radius, bounds }.
 *   ell(center, radii, colour, { rot, k })        ellipsoid
 *   cone(a, b, ra, rb, colour, { k })              round cone / capsule between two points
 *   box(center, size, r, colour, { rot, k })       rounded box
 */
export const P = {
  ell(c, r, col, o = {}) {
    const m = rotM(o.rot);
    return { c: col, k: o.k ?? 0.05, sub: o.sub, b: [c, Math.max(...r)], d(x, y, z) {
      let px = x - c[0], py = y - c[1], pz = z - c[2];
      if (m) { const tx = m[0] * px + m[4] * py + m[8] * pz, ty = m[1] * px + m[5] * py + m[9] * pz, tz = m[2] * px + m[6] * py + m[10] * pz; px = tx; py = ty; pz = tz; }
      const k0 = len(px / r[0], py / r[1], pz / r[2]), k1 = len(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]));
      return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(...r);
    } };
  },
  cone(a, b, ra, rb, col, o = {}) {
    const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], l2 = bax * bax + bay * bay + baz * baz, rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
    return { c: col, k: o.k ?? 0.04, sub: o.sub, b: [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], Math.sqrt(l2) / 2 + Math.max(ra, rb)], d(x, y, z) {
      // iq's round cone
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const yy = pax * bax + pay * bay + paz * baz, z2 = yy - l2;
      const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy, x2 = cx * cx + cy * cy + cz * cz;
      const y2 = yy * yy * l2, zz = z2 * z2 * l2, kk = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(z2) * a2 * zz > kk) return Math.sqrt(x2 + zz) * il2 - rb;
      if (Math.sign(yy) * a2 * y2 < kk) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    } };
  },
  /** Faceted rock: a smoothed intersection of random half-spaces around c (size s = [x, y, z]). */
  rock(c, s, col, o = {}) {
    let r = (o.seed ?? 1) * 7919 + 13; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const planes = []; const n = o.facets ?? 14;
    for (let i = 0; i < n; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, q = Math.sqrt(1 - u * u); const nx = q * Math.cos(a), ny = u * 0.8 - 0.1, nz = q * Math.sin(a); const l = Math.hypot(nx, ny, nz); planes.push([nx / l, ny / l, nz / l, 0.75 + rnd() * 0.25]); }
    planes.push([0, -1, 0, 0.45]);
    const k = o.round ?? 0.08;
    return { c: col, k: o.k ?? 0.05, sub: o.sub, b: [c, Math.max(...s)], d(x, y, z) {
      const px = (x - c[0]) / s[0], py = (y - c[1]) / s[1], pz = (z - c[2]) / s[2];
      let d = -1e9; for (const [nx, ny, nz, off] of planes) { const v = nx * px + ny * py + nz * pz - off; d = d < -1e8 ? v : -smin(-d, -v, k); }
      return d * Math.min(s[0], s[1], s[2]);
    } };
  },
  box(c, s, r, col, o = {}) {
    const m = rotM(o.rot);
    return { c: col, k: o.k ?? 0.03, sub: o.sub, b: [c, len(s[0], s[1], s[2]) / 2], d(x, y, z) {
      let px = x - c[0], py = y - c[1], pz = z - c[2];
      if (m) { const tx = m[0] * px + m[4] * py + m[8] * pz, ty = m[1] * px + m[5] * py + m[9] * pz, tz = m[2] * px + m[6] * py + m[10] * pz; px = tx; py = ty; pz = tz; }
      const qx = Math.abs(px) - s[0] / 2 + r, qy = Math.abs(py) - s[1] / 2 + r, qz = Math.abs(pz) - s[2] / 2 + r;
      return len(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
    } };
  },
};
/** Mirrors primitives across z = 0 (left/right legs, ears, eyes …). */
export const mirrorZ = (fn) => [fn(1), fn(-1)];

/**
 * Meshes a list of primitives. opts: { res (cells along the longest side), noise: { amp, freq }, colorFn(p, c) }
 * Returns a BufferGeometry (indexed) with position, normal and color.
 */
export function sdfMesh(prims, { res = 96, noise = null, colorFn = null, seed = 1 } = {}) {
  const adds = prims.filter((p) => !p.sub), subs = prims.filter((p) => p.sub);
  const field = (x, y, z) => {
    let d = 1e9;
    for (const p of adds) d = smin(d, p.d(x, y, z), p.k);
    for (const p of subs) d = Math.max(d, -p.d(x, y, z));
    if (noise) d -= noise.amp * (noise.mask ? noise.mask(x, y, z) : 1) * (fbm3(x * noise.freq + seed * 7.1, y * noise.freq, z * noise.freq, noise.oct ?? 3) - 0.5) * 2;
    return d;
  };
  // bounds
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const p of adds) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p.b[0][i] - p.b[1] - p.k); hi[i] = Math.max(hi[i], p.b[0][i] + p.b[1] + p.k); }
  const ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), h = ext / res;
  for (let i = 0; i < 3; i++) { lo[i] -= h * 2; hi[i] += h * 2; }
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nzc = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nzc);
  const I = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nzc; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[I(i, j, k)] = field(lo[0] + i * h, lo[1] + j * h, lo[2] + k * h);
  // surface nets: one vertex per cell with a sign change
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nzc - 1)).fill(-1), C = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nzc - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corners.map(([a, b, c]) => F[I(i + a, j + b, k + c)]);
    let mask = 0; for (let q = 0; q < 8; q++) if (v[q] < 0) mask |= 1 << q;
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]), A = corners[a], B = corners[b];
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; n++;
    }
    vid[C(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nzc - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { // x edges
    const a = F[I(i, j, k)] < 0, b = F[I(i + 1, j, k)] < 0; if (a === b) continue;
    quad(vid[C(i, j - 1, k - 1)], vid[C(i, j, k - 1)], vid[C(i, j, k)], vid[C(i, j - 1, k)], b);
  }
  for (let k = 1; k < nzc - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { // y edges
    const a = F[I(i, j, k)] < 0, b = F[I(i, j + 1, k)] < 0; if (a === b) continue;
    quad(vid[C(i - 1, j, k - 1)], vid[C(i - 1, j, k)], vid[C(i, j, k)], vid[C(i, j, k - 1)], b);
  }
  for (let k = 0; k < nzc - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { // z edges
    const a = F[I(i, j, k)] < 0, b = F[I(i, j, k + 1)] < 0; if (a === b) continue;
    quad(vid[C(i - 1, j - 1, k)], vid[C(i, j - 1, k)], vid[C(i, j, k)], vid[C(i - 1, j, k)], b);
  }
  // normals from the field gradient, colours blended by proximity to each primitive
  const cnt = pos.length / 3, nor = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3), e = h * 0.5;
  for (let v = 0; v < cnt; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let gx = field(x + e, y, z) - field(x - e, y, z), gy = field(x, y + e, z) - field(x, y - e, z), gz = field(x, y, z + e) - field(x, y, z - e);
    const l = len(gx, gy, gz) || 1; nor[v * 3] = gx / l; nor[v * 3 + 1] = gy / l; nor[v * 3 + 2] = gz / l;
    let wr = 0, wg = 0, wb = 0, ws = 0;
    for (const p of adds) { const d = Math.max(0, p.d(x, y, z)), w = Math.exp(-d / Math.max(0.004, p.k * 0.35)); wr += p.c[0] * w; wg += p.c[1] * w; wb += p.c[2] * w; ws += w; }
    let c = ws > 0 ? [wr / ws, wg / ws, wb / ws] : [0.5, 0.5, 0.5];
    if (colorFn) c = colorFn([x, y, z], c, [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]]);
    col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
  }
  // colours are authored in sRGB; vertex colours are linear in glTF/three
  for (let i = 0; i < col.length; i++) { const c = col[i]; col[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
export const hex = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
