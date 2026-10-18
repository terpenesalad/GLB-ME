// Seamless procedural textures – a port of the Android TextureGen (same patterns & maths).

export const PATTERNS = [
  ['CHECKER', 'Checker', 0xEDEDED, 0x2B2B30, 8, true],
  ['UV_GRID', 'UV Grid', 0xFFFFFF, 0x1C1C1F, 8, false],
  ['BRICKS', 'Bricks', 0xA8553A, 0xD9D2C5, 4, true],
  ['TILES', 'Tiles', 0xF2F2F2, 0x8E8E93, 4, true],
  ['WOOD', 'Wood', 0xB07A45, 0x6B4226, 3, true],
  ['MARBLE', 'Marble', 0xF4F1EC, 0x7A7A82, 2, true],
  ['STONE', 'Stone', 0x8D8A84, 0x4B4843, 5, true],
  ['CLOUDS', 'Noise', 0xFFFFFF, 0x000000, 4, true],
  ['STRIPES', 'Stripes', 0xFFD60A, 0x1C1C1F, 6, true],
  ['DOTS', 'Dots', 0xFF375F, 0xFFF4F6, 6, true],
  ['HEX', 'Hexagons', 0x64D2FF, 0x0A3D57, 5, true],
  ['CAMO', 'Camo', 0x6B7F4A, 0x3B4A2B, 3, true],
  ['FABRIC', 'Fabric', 0x3A5BA0, 0x223a6e, 24, true],
  ['CARBON', 'Carbon', 0x3A3A3E, 0x111113, 16, true],
  ['METAL', 'Brushed', 0xC9CDD2, 0x8E9399, 1, true],
  ['GRADIENT', 'Gradient', 0x5E5CE6, 0xFF375F, 1, true],
  ['PIXELS', 'Pixel Grass', 0x5DBB63, 0x3E8E41, 16, true],
  ['LAVA', 'Lava', 0xFF6A00, 0x1A0A05, 3, true],
].map(([id, label, a, b, scale, usesB]) => ({ id, label, a, b, scale, usesB }));

export const patternById = (id) => PATTERNS.find((p) => p.id === id);

export function defaultSpec(id) {
  const p = patternById(id);
  return { pattern: id, colorA: p.a, colorB: p.b, scale: p.scale, seed: 7, detail: 0.5 };
}

const mod = (a, n) => ((a % n) + n) % n;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const HEX_H = Math.sqrt(3) / 2;

export function mix(a, b, t) {
  const tt = clamp01(t);
  const r = (((a >> 16) & 255) * (1 - tt) + ((b >> 16) & 255) * tt) | 0;
  const g = (((a >> 8) & 255) * (1 - tt) + ((b >> 8) & 255) * tt) | 0;
  const bl = ((a & 255) * (1 - tt) + (b & 255) * tt) | 0;
  return (r << 16) | (g << 8) | bl;
}
function shade(c, f) {
  const r = Math.min(255, Math.max(0, (((c >> 16) & 255) * f) | 0));
  const g = Math.min(255, Math.max(0, (((c >> 8) & 255) * f) | 0));
  const b = Math.min(255, Math.max(0, ((c & 255) * f) | 0));
  return (r << 16) | (g << 8) | b;
}
function hsv(h, s, v) {
  const hh = (h - Math.floor(h)) * 6; const i = hh | 0; const f = hh - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return ((r * 255) << 16) | ((g * 255) << 8) | (b * 255 | 0);
}
function hash1(i, seed) {
  let x = (Math.imul(i, 374761393) + Math.imul(seed, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) & 0xFFFFFF) / 16777215;
}
const hash2 = (x, y, seed) => hash1(Math.imul(x, 7919) + Math.imul(y, 104729), seed);

/** Periodic value noise: every octave wraps at an integer lattice period. */
export class TileNoise {
  constructor(seed) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    let s = (BigInt(seed) * 2654435761n) & 0x7fffffffn;
    for (let i = 255; i >= 1; i--) {
      s = (s * 1103515245n + 12345n) & 0x7fffffffn;
      const j = Number(s % BigInt(i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Int32Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  lattice(ix, iy) { return this.perm[(this.perm[ix & 255] + iy) & 511] / 127.5 - 1; }
  noise(x, y, px, py = px) {
    const p = Math.max(1, px), q = Math.max(1, py);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = this.lattice(mod(x0, p), mod(y0, q)), b = this.lattice(mod(x0 + 1, p), mod(y0, q));
    const c = this.lattice(mod(x0, p), mod(y0 + 1, q)), d = this.lattice(mod(x0 + 1, p), mod(y0 + 1, q));
    const top = a + (b - a) * ux;
    return top + ((c + (d - c) * ux) - top) * uy;
  }
  fbm(x, y, px, octaves, py = px) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += this.noise(x * f, y * f, px * f, py * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
  }
  turbulence(x, y, period, octaves) {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < octaves; o++) { sum += Math.abs(this.noise(x * f, y * f, period * f)) * amp; amp *= 0.5; f *= 2; }
    return sum;
  }
  voronoi(x, y, period) {
    const p = Math.max(1, period);
    const cx = Math.floor(x), cy = Math.floor(y);
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, wx = mod(gx, p), wy = mod(gy, p);
      const h = this.perm[(this.perm[wx & 255] + wy) & 511];
      const ox = this.perm[(h + 17) & 511] / 255 * 0.8 + 0.1;
      const oy = this.perm[(h + 91) & 511] / 255 * 0.8 + 0.1;
      const dx = gx + ox - x, dy = gy + oy - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; id = wx + wy * p; } else if (d < d2) d2 = d;
    }
    return [d1, d2, id];
  }
}

function hexEdge(x, y, period) {
  const h = HEX_H;
  const r0 = Math.floor(y / h);
  let best = 1e9, second = 1e9;
  for (let dr = -1; dr <= 2; dr++) {
    const r = r0 + dr; const off = (r & 1) === 1 ? 0.5 : 0;
    const c0 = Math.floor(x - off);
    for (let dc = -1; dc <= 2; dc++) {
      const cx = c0 + dc + off + 0.5, cy = (r + 0.5) * h;
      const d = Math.hypot(x - cx, y - cy);
      if (d < best) { second = best; best = d; } else if (d < second) second = d;
    }
  }
  return (second - best) / 2;
}

export function repeats(spec) {
  const sc = Math.max(1, spec.scale | 0);
  if (spec.pattern === 'CHECKER' || spec.pattern === 'FABRIC') return Math.ceil(sc / 2) * 2;
  if (spec.pattern === 'CARBON') return Math.ceil(sc / 4) * 4;
  return sc;
}

/** Colour (0xRRGGBB) at (u, v); periodic with period 1. Height goes to out[0]. */
export function sample(spec, noise, u, v, out) {
  const a = spec.colorA, b = spec.colorB, k = clamp01(spec.detail), sc = repeats(spec);
  let t = 0, ht = 1, c = null;
  switch (spec.pattern) {
    case 'CHECKER': { const cx = Math.floor(u * sc), cy = Math.floor(v * sc); t = ((cx + cy) & 1) === 0 ? 0 : 1; ht = 1 - t; break; }
    case 'UV_GRID': {
      const cx = Math.floor(u * sc), cy = Math.floor(v * sc);
      const hue = ((mod(cx, sc) + mod(cy, sc) * sc) / (sc * sc)) * 0.85;
      const base = hsv(hue, 0.55, ((mod(cx, sc) + mod(cy, sc)) & 1) === 0 ? 0.95 : 0.8);
      const fu = u * sc - cx, fv = v * sc - cy;
      const line = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv));
      const sub = Math.min(Math.abs(fu - 0.5), Math.abs(fv - 0.5));
      if (line < 0.03) c = b; else if (sub < 0.01) c = mix(base, a, 0.6);
      else if (fu >= 0.18 && fu <= 0.42 && Math.abs(fv - 0.3) < 0.025) c = mix(base, b, 0.7);
      else if (fv >= 0.18 && fv <= 0.42 && Math.abs(fu - 0.3) < 0.025) c = mix(base, b, 0.4);
      else c = base;
      t = 0; ht = line < 0.03 ? 0 : 1; break;
    }
    case 'BRICKS': {
      const rows = sc * 2, ry = v * rows, row = Math.floor(ry);
      const bx = u * sc + ((row & 1) === 1 ? 0.5 : 0), col = Math.floor(bx);
      const fx = bx - col, fy = ry - row;
      const mortar = 0.02 + k * 0.08;
      const edge = Math.min(Math.min(fx, 1 - fx), Math.min(fy, 1 - fy));
      const tone = hash2(mod(col, sc), mod(row, rows), spec.seed) * 0.25;
      const grain = noise.fbm(u * 16, v * 16, 16, 3) * 0.12;
      if (edge < mortar) { t = 1; ht = 0; } else { t = 0; ht = smooth(mortar, mortar + 0.05, edge); c = shade(a, 1 - tone + grain); }
      break;
    }
    case 'TILES': {
      const fx = u * sc - Math.floor(u * sc), fy = v * sc - Math.floor(v * sc);
      const grout = 0.015 + k * 0.05;
      const edge = Math.min(Math.min(fx, 1 - fx), Math.min(fy, 1 - fy));
      if (edge < grout) { t = 1; ht = 0; } else { t = 0; ht = smooth(grout, grout + 0.06, edge); c = shade(a, 0.9 + 0.1 * ht); }
      break;
    }
    case 'WOOD': {
      const plank = Math.floor(u * sc);
      const off = hash1(mod(plank, sc), spec.seed) * 7;
      const wob = noise.fbm(u * 4, v * 2 + off, 4, 3, 2) * 0.9;
      const g = u * sc * 9 + wob * 2.2 + off;
      const f = g - Math.floor(g);
      const ring = smooth(0, 0.55, f) * (1 - smooth(0.7, 1, f));
      const streak = noise.fbm(u * 64, v * 3, 64, 3, 3) * 0.5 + 0.5;
      const fu = u * sc - plank, seam = Math.min(fu, 1 - fu);
      t = clamp01(ring * 0.65 + streak * 0.35) * (0.7 + k * 0.3);
      if (seam < 0.012) { t = 1; ht = 0; } else ht = 1 - t * 0.25;
      c = shade(mix(a, b, t), 0.92 + hash1(mod(plank, sc) + 11, spec.seed) * 0.16);
      break;
    }
    case 'MARBLE': {
      const turb = noise.turbulence(u * 2, v * 2, 2, 5);
      const vein = Math.abs(Math.sin((u * sc + v * Math.max(1, (sc / 2) | 0) + turb * (2 + k * 2.5)) * Math.PI));
      const cloud = noise.fbm(u * 3, v * 3, 3, 4) * 0.5 + 0.5;
      const q = (1 - vein) * (1 - vein); const line = q * q * q;
      t = clamp01(line * 0.9 + cloud * 0.12); ht = 1 - line * 0.3; break;
    }
    case 'STONE': {
      const [d1, d2, id] = noise.voronoi(u * sc, v * sc, sc);
      const gap = d2 - d1, crack = 0.04 + k * 0.08;
      const tone = hash1(id, spec.seed) * 0.35, grain = noise.fbm(u * 24, v * 24, 24, 3) * 0.15;
      if (gap < crack) { t = 1; ht = 0; } else { t = clamp01(tone + grain) * 0.6; ht = smooth(crack, crack + 0.15, gap) * (0.8 + 0.2 * (1 - d1)); }
      break;
    }
    case 'CLOUDS': t = clamp01(noise.fbm(u * sc, v * sc, sc, 2 + ((k * 5) | 0)) * 0.5 + 0.5); ht = 1 - t; break;
    case 'STRIPES': { const f = (u + v) * sc - Math.floor((u + v) * sc); t = f < 0.2 + k * 0.6 ? 0 : 1; ht = 1 - t; break; }
    case 'DOTS': {
      const fx = u * sc - Math.floor(u * sc) - 0.5, fy = v * sc - Math.floor(v * sc) - 0.5;
      const r = 0.15 + k * 0.3, d = Math.sqrt(fx * fx + fy * fy);
      t = smooth(r - 0.02, r + 0.02, d); ht = 1 - t; break;
    }
    case 'HEX': {
      const rows = Math.max(2, 2 * Math.round(sc / (2 * HEX_H)));
      const edge = hexEdge(u * sc, v * rows * HEX_H, sc);
      const bw = 0.04 + k * 0.12;
      t = edge < bw ? 1 : 0; ht = smooth(bw, bw + 0.08, edge); break;
    }
    case 'CAMO': {
      const n1 = noise.fbm(u * sc, v * sc, sc, 3), n2 = noise.fbm(u * sc + 5.3, v * sc + 1.7, sc, 3);
      c = n1 > 0.15 ? b : n2 > 0.1 ? mix(a, 0xD8C9A3, 0.55) : n2 < -0.25 ? 0x2A2A22 : a;
      t = 0; ht = n1 > 0.15 ? 0.6 : 1; break;
    }
    case 'FABRIC': {
      const gx = u * sc, gy = v * sc, cx = Math.floor(gx), cy = Math.floor(gy);
      const fx = gx - cx, fy = gy - cy, over = ((cx + cy) & 1) === 0;
      const thread = over ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
      t = over ? 0.25 : 0.75; ht = thread * 0.8 + 0.2;
      c = shade(mix(a, b, t), 0.7 + 0.3 * thread + noise.fbm(u * 64, v * 64, 64, 2) * 0.05); break;
    }
    case 'CARBON': {
      const gx = u * sc, gy = v * sc, cx = Math.floor(gx), cy = Math.floor(gy);
      const dir = (((cx >> 1) + (cy >> 1)) & 1) === 0;
      const sheen = Math.sin((dir ? gx - cx : gy - cy) * Math.PI);
      t = dir ? 0.2 : 0.8; ht = sheen; c = shade(mix(a, b, t), 0.6 + 0.5 * sheen); break;
    }
    case 'METAL': { const st = noise.fbm(u * 2, v * 96, 2, 3, 96) * 0.5 + 0.5; t = st; ht = 1 - st * 0.2; break; }
    case 'GRADIENT': t = v; ht = 1; break;
    case 'PIXELS': {
      const r = hash2(mod(Math.floor(u * sc), sc), mod(Math.floor(v * sc), sc), spec.seed);
      t = r > 0.75 ? 1 : r > 0.45 ? 0.5 : 0; c = shade(mix(a, b, t), 0.95 + r * 0.1); ht = 1 - t * 0.4; break;
    }
    case 'LAVA': {
      const [d1, d2] = noise.voronoi(u * sc, v * sc, sc);
      const crack = 1 - smooth(0, 0.12 + k * 0.15, d2 - d1);
      const glow = clamp01(crack + noise.fbm(u * 8, v * 8, 8, 3) * 0.2);
      t = 1 - glow; ht = t; c = mix(b, a, glow); break;
    }
  }
  out[0] = ht;
  return c ?? mix(a, b, t);
}

/** RGBA bytes + height field for a square tile. */
export function generate(spec, size) {
  const n = size, rgba = new Uint8ClampedArray(n * n * 4), height = new Float32Array(n * n);
  const noise = new TileNoise(spec.seed), h = [0];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const c = sample(spec, noise, (x + 0.5) / n, (y + 0.5) / n, h);
    const i = (y * n + x) * 4;
    rgba[i] = (c >> 16) & 255; rgba[i + 1] = (c >> 8) & 255; rgba[i + 2] = c & 255; rgba[i + 3] = 255;
    height[y * n + x] = h[0];
  }
  return { size: n, rgba, height };
}

/** Tangent-space normal map (glTF convention, green up) from a tiling height field. */
export function normalMap(height, n, strength = 2) {
  const out = new Uint8ClampedArray(n * n * 4), s = strength * n / 256;
  const hh = (x, y) => height[mod(y, n) * n + mod(x, n)];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (hh(x + 1, y - 1) + 2 * hh(x + 1, y) + hh(x + 1, y + 1) - hh(x - 1, y - 1) - 2 * hh(x - 1, y) - hh(x - 1, y + 1)) / 8;
    const dy = (hh(x - 1, y + 1) + 2 * hh(x, y + 1) + hh(x + 1, y + 1) - hh(x - 1, y - 1) - 2 * hh(x, y - 1) - hh(x + 1, y - 1)) / 8;
    let nx = -dx * s, ny = dy * s, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * n + x) * 4;
    out[i] = Math.round((nx * 0.5 + 0.5) * 255); out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255); out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255); out[i + 3] = 255;
  }
  return out;
}

export function roughnessMap(height, baseRough, metallic) {
  const out = new Uint8ClampedArray(height.length * 4);
  for (let i = 0; i < height.length; i++) {
    out[i * 4] = 255; out[i * 4 + 1] = Math.round(clamp01(baseRough + (1 - height[i]) * 0.25) * 255);
    out[i * 4 + 2] = Math.round(clamp01(metallic) * 255); out[i * 4 + 3] = 255;
  }
  return out;
}

export function luminance(rgba) {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) / 255;
  return out;
}
