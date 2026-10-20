// Procedural PBR materials for the template library: every material is generated from a
// seamless height field into colour (with baked cavity AO), normal (glTF / OpenGL convention)
// and roughness maps, and knows its real-world tile size so textures sit at the right scale.
// Neutral "paint" materials are near-white and take their colour from material.color, so they
// can be recoloured in the editor.
import * as THREE from 'three';

// ------------------------------------------------------------------------------- noise
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
/** Tileable value noise: period P lattice cells over the unit square. */
class Noise {
  constructor(seed = 1) { const r = rng(seed * 9973 + 17); this.t = new Float32Array(65536); for (let i = 0; i < 65536; i++) this.t[i] = r(); }
  v(x, y, P) { // x, y in [0,1) tile space
    const fx = x * P, fy = y * P, ix = Math.floor(fx), iy = Math.floor(fy), tx = fade(fx - ix), ty = fade(fy - iy);
    const m = (a) => ((a % P) + P) % P, x0 = m(ix), x1 = m(ix + 1), y0 = m(iy), y1 = m(iy + 1), t = this.t, o = (P * 131) & 255;
    const a = t[((y0 * 257 + x0 + o * 977) & 65535)], b = t[((y0 * 257 + x1 + o * 977) & 65535)], c = t[((y1 * 257 + x0 + o * 977) & 65535)], d = t[((y1 * 257 + x1 + o * 977) & 65535)];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
  fbm(x, y, P, oct = 4, gain = 0.5) { let s = 0, a = 1, n = 0; for (let i = 0; i < oct; i++) { s += a * this.v(x, y, P << i); n += a; a *= gain; } return s / n; }
  /** Worley F1/F2 (distance to nearest / second nearest feature point), tileable. */
  cell(x, y, P) {
    const fx = x * P, fy = y * P, ix = Math.floor(fx), iy = Math.floor(fy); let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j, mx = ((cx % P) + P) % P, my = ((cy % P) + P) % P, h = (my * 263 + mx * 71 + P * 13) & 65535;
      const px = cx + this.t[h], py = cy + this.t[(h + 7919) & 65535], d = Math.hypot(px - fx, py - fy);
      if (d < f1) { f2 = f1; f1 = d; id = this.t[(h + 104729) & 65535]; } else if (d < f2) f2 = d;
    }
    return { f1, f2, id };
  }
}
const hash2 = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = (h ^ (h >>> 13)) * 1274126177 >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const hexRgb = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ------------------------------------------------------------------------------- generators
// Each returns a per-pixel function f(u, v) -> [r, g, b, height, roughness] (u, v in [0,1)).
const GEN = {
  brick({ base = 0x9b4a33, alt = 0x7c3527, mortar = 0xcfc6b4, cols = 4, rows = 12, joint = 0.058, jointX = 0.021, tuck = false, seed = 3, vary = 0.18 }) {
    const n = new Noise(seed), B = hexRgb(base), A = hexRgb(alt), M = hexRgb(mortar);
    return (u, v) => {
      const row = Math.floor(v * rows), off = (row % 2) * 0.5, x = u * cols + off, col = Math.floor(x), lx = x - col, ly = v * rows - row;
      const bc = ((col % cols) + cols) % cols, r1 = hash2(bc * 7 + 1, row * 13 + 5), r2 = hash2(bc + 91, row + 33);
      const dx = Math.min(lx, 1 - lx) / jointX, dy = Math.min(ly, 1 - ly) / joint;
      const edge = Math.min(dx, dy), chip = n.fbm(u, v, 64, 2) > 0.62 ? 0.45 : 0;
      const inBrick = smooth(0.85, 1.25 + chip, edge);
      const speck = n.fbm(u, v, 128, 3), blot = n.fbm(u + r1, v, 16, 3);
      let col3 = lerp3(B, A, clamp(r1 * 1.2 + (blot - 0.5) * 0.8));
      const k = 1 + (r2 - 0.5) * vary * 2 + (speck - 0.5) * 0.25; col3 = col3.map((c) => clamp(c * k));
      const burn = smooth(0.6, 0, edge) * 0.25; col3 = col3.map((c) => c * (1 - burn * (r2 > 0.7 ? 1 : 0.3)));
      const ms = n.fbm(u, v, 256, 2), mc = M.map((c) => clamp(c * (0.85 + ms * 0.25)));
      let out = lerp3(mc, col3, inBrick);
      if (tuck && inBrick < 0.5 && dy < 0.35 && dx > 1) out = [0.93, 0.92, 0.88];
      const h = inBrick * (0.75 + speck * 0.25) + ms * 0.05;
      return [out[0], out[1], out[2], h, mix(0.96, 0.82 + speck * 0.1, inBrick)];
    };
  },
  ashlar({ base = 0x4c4f55, mortar = 0x8d8b86, rows = 4, seed = 5, pits = 0.5, tool = 0.6, warm = 0 }) {
    const n = new Noise(seed), B = hexRgb(base), M = hexRgb(mortar);
    return (u, v) => {
      const row = Math.floor(v * rows), ly = v * rows - row;
      // random block lengths per row (2–4 per tile row), tile-safe
      const k = 2 + Math.floor(hash2(row, 7) * 3), x = (u + hash2(row, 3)) % 1, col = Math.floor(x * k), lx = x * k - col;
      const jx = 0.025 * k / rows, dx = Math.min(lx, 1 - lx) / jx, dy = Math.min(ly, 1 - ly) / 0.06;
      const edge = Math.min(dx, dy), inB = smooth(0.7, 1.6, edge);
      const id = hash2(col + row * 17, 11), c = n.cell(u, v, 48), pit = c.f1 < 0.14 * pits ? 1 : 0;
      const tooling = Math.sin((u * 220 + n.fbm(u, v, 8, 2) * 30)) * 0.5 + 0.5, fine = n.fbm(u, v, 96, 4);
      let col3 = B.map((ch, i) => clamp(ch * (0.82 + id * 0.3 + (fine - 0.5) * 0.35) + (i === 0 ? warm : 0)));
      col3 = col3.map((ch) => ch * (1 - pit * 0.45));
      const out = lerp3(M.map((ch) => ch * (0.9 + fine * 0.2)), col3, inB);
      const h = inB * (0.8 + fine * 0.15 + tooling * 0.04 * tool) - pit * 0.25 * inB;
      return [out[0], out[1], out[2], h, mix(0.95, 0.8 - (1 - fine) * 0.08, inB)];
    };
  },
  setts({ base = 0x52555a, rows = 9, cols = 5, seed = 9 }) { // bluestone pitchers / cobbles
    const n = new Noise(seed), B = hexRgb(base);
    return (u, v) => {
      const row = Math.floor(v * rows), off = (row % 2) * 0.5 + hash2(row, 2) * 0.2, x = u * cols + off, col = Math.floor(x), lx = x - col, ly = v * rows - row;
      const bc = ((col % cols) + cols) % cols, r = hash2(bc * 3 + 7, row * 5 + 1);
      const ex = Math.min(lx, 1 - lx) * 2, ey = Math.min(ly, 1 - ly) * 2, dome = Math.sqrt(clamp(ex * 1.4)) * Math.sqrt(clamp(ey * 1.4));
      const fine = n.fbm(u, v, 128, 3), inS = smooth(0.05, 0.25, Math.min(ex, ey * (rows / cols) * 0.45 + 0.02));
      const polish = smooth(0.5, 0.95, dome);
      const col3 = B.map((c) => clamp(c * (0.75 + r * 0.45 + (fine - 0.5) * 0.3) * (0.65 + 0.35 * inS) + polish * 0.04));
      return [col3[0], col3[1], col3[2], dome * inS * (0.85 + fine * 0.15), mix(0.95, 0.55 - polish * 0.15, inS)];
    };
  },
  render({ seed = 4, cracks = 0, grime = 0.2 }) { // painted stucco, neutral (tinted by material colour)
    const n = new Noise(seed);
    return (u, v) => {
      const sand = n.fbm(u, v, 256, 3), blot = n.fbm(u, v, 6, 4), c = n.cell(u, v, 7);
      const crack = cracks && (c.f2 - c.f1) < 0.012 && n.v(u, v, 9) > 0.6 ? 1 : 0;
      const streak = grime * smooth(0.55, 0.2, v) * n.fbm(u * 0.2, v, 32, 2);
      const l = clamp(0.93 + (sand - 0.5) * 0.08 + (blot - 0.5) * 0.06 - streak * 0.2 - crack * 0.12);
      return [l, l * 0.995, l * 0.985, sand * 0.15 - crack * 0.3, 0.88 + sand * 0.08];
    };
  },
  weatherboard({ boards = 8, seed = 6 }) {
    const n = new Noise(seed);
    return (u, v) => {
      const b = v * boards, i = Math.floor(b), f = b - i; // f: 0 top of board → 1 bottom lip
      const grain = n.fbm(u * 0.15 + i * 0.37, f * 0.1, 64, 3), brush = n.v(u, v * 0.05, 128);
      const slope = f * 0.9 + 0.1, lip = smooth(0.92, 1, f), shadow = smooth(0.12, 0, f) * 0.45;
      const l = clamp(0.92 - shadow + (brush - 0.5) * 0.06 + (grain - 0.5) * 0.05);
      return [l, l, l * 0.99, slope * (1 - lip) + lip * 0.0 + grain * 0.04, 0.6 + brush * 0.15];
    };
  },
  corrugated({ pitch = 13, seed = 2, rust = 0, spangle = 1 }) {
    const n = new Noise(seed);
    return (u, v) => {
      const s = Math.sin(u * pitch * Math.PI * 2) * 0.5 + 0.5, c = n.cell(u, v, 40), sp = spangle * (c.id - 0.5) * 0.08;
      const streak = n.fbm(u * 3, v * 0.2, 32, 3), rr = rust * smooth(0.55, 0.8, n.fbm(u, v, 12, 4) * 0.6 + (1 - v) * 0.4);
      const l = clamp(0.8 + sp + (streak - 0.5) * 0.12 - (1 - v) * 0.05);
      const col = lerp3([l, l * 1.01, l * 1.03], [0.45, 0.22, 0.1], rr);
      return [col[0], col[1], col[2], s, clamp(0.38 + (streak - 0.5) * 0.2 + rr * 0.5)];
    };
  },
  slate({ base = 0x3f4650, rows = 4, cols = 4, seed = 8 }) {
    const n = new Noise(seed), B = hexRgb(base);
    return (u, v) => {
      const row = Math.floor(v * rows), off = (row % 2) * 0.5, x = u * cols + off, col = Math.floor(x), lx = x - col, ly = v * rows - row;
      const r = hash2(((col % cols) + cols) % cols, row), cleft = n.fbm(u + r, v, 48, 4);
      const gap = smooth(0, 0.03, Math.min(lx, 1 - lx)), lipT = smooth(0.0, 0.08, 1 - ly);
      const h = (ly * 0.6 + cleft * 0.25) * gap * lipT;
      const col3 = B.map((c) => clamp(c * (0.8 + r * 0.35 + (cleft - 0.5) * 0.3)));
      return [col3[0] * (0.5 + 0.5 * gap), col3[1] * (0.5 + 0.5 * gap), col3[2] * (0.5 + 0.5 * gap), h, 0.55 + cleft * 0.25];
    };
  },
  terracotta({ base = 0xb5532f, rows = 3, cols = 3, seed = 12 }) { // interlocking Marseille roof tiles
    const n = new Noise(seed), B = hexRgb(base);
    return (u, v) => {
      const row = Math.floor(v * rows), x = u * cols + (row % 2) * 0.5, col = Math.floor(x), lx = x - col, ly = v * rows - row;
      const r = hash2(((col % cols) + cols) % cols, row), fine = n.fbm(u, v, 96, 3), blot = n.fbm(u, v, 8, 3);
      // two shallow channels per tile, a raised interlock rib at the side, lap shadow at the bottom
      const ch = 0.5 - 0.5 * Math.cos(lx * Math.PI * 4);
      const rib = smooth(0.9, 0.96, lx) * smooth(1.0, 0.97, lx);
      const lap = smooth(0.0, 0.12, ly);
      const h = clamp((ch * 0.55 + rib * 0.45) * lap + (1 - ly) * 0.25 + fine * 0.05);
      const shadow = 0.55 + 0.45 * lap;
      const col3 = B.map((c) => clamp(c * (0.82 + r * 0.25 + (blot - 0.5) * 0.3 + (fine - 0.5) * 0.1) * shadow));
      return [col3[0], col3[1], col3[2], h, 0.68 + fine * 0.12];
    };
  },
  boards({ base = 0xc89058, alt = 0x9c6a3c, count = 6, seed = 14, gap = 0.012, gloss = 0.35 }) { // floorboards / decking / timber
    const n = new Noise(seed), B = hexRgb(base), A = hexRgb(alt);
    return (u, v) => {
      const i = Math.floor(u * count), lx = u * count - i, len = 0.33 + hash2(i, 3) * 0.4, sh = hash2(i, 9), yv = (v + sh) / len, j = Math.floor(yv), ly = yv - j;
      const r = hash2(i * 31 + j, 5), r2 = hash2(i * 7 + j, 11);
      // growth rings seen on a flat-sawn board: warped stripes along the board, plus fine fibres
      const warp = n.fbm(u * 0.5 + r, v * 0.08 + r2, 16, 3) * 3.5;
      const ring = Math.abs(Math.sin((lx * (3 + r * 3) + warp + r * 7) * Math.PI));
      const late = Math.pow(1 - ring, 6);
      const fibre = n.fbm(u * 4, v * 0.12, 64, 2);
      const knot = n.cell(u, v, 10).f1 < 0.035 && r > 0.75 ? 1 : 0;
      const seam = smooth(0, gap, Math.min(lx, 1 - lx)) * smooth(0, gap * 1.5, Math.min(ly, 1 - ly) * len);
      let col3 = lerp3(B, A, clamp(r * 0.45 + late * 0.55 + (fibre - 0.5) * 0.4 + knot * 0.7));
      col3 = col3.map((c) => c * (0.88 + r2 * 0.16) * (0.55 + 0.45 * seam));
      return [col3[0], col3[1], col3[2], seam * (0.92 + late * 0.05 + fibre * 0.03), mix(0.8, gloss + late * 0.1 + fibre * 0.06, seam)];
    };
  },
  woodgrain({ base = 0xffffff, ring = 0.08, seed = 21 }) { // neutral grain for painted or stained joinery
    const n = new Noise(seed), B = hexRgb(base);
    return (u, v) => {
      const g = Math.sin((u * 18 + n.fbm(u, v * 0.2, 8, 4) * 5) * Math.PI) * 0.5 + 0.5, f = n.fbm(u, v, 128, 2);
      const l = 1 - ring * g - (f - 0.5) * 0.05;
      return [B[0] * l, B[1] * l, B[2] * l, g * 0.15, 0.5 + f * 0.1];
    };
  },
  asphalt({ seed = 15, wear = 0.3 }) {
    const n = new Noise(seed);
    return (u, v) => {
      const c = n.cell(u, v, 220), agg = c.f1 < 0.22 ? 1 - c.f1 / 0.22 : 0, fine = n.fbm(u, v, 256, 2), blot = n.fbm(u, v, 5, 4), oil = smooth(0.62, 0.75, n.fbm(u + 0.3, v, 4, 4));
      let l = 0.2 + agg * (0.08 + c.id * 0.16) + (fine - 0.5) * 0.06 + (blot - 0.5) * 0.08 * wear - oil * 0.05;
      l = clamp(l);
      return [l, l, l * 1.03, agg * 0.6 + fine * 0.3, clamp(0.85 - agg * 0.15 + oil * -0.25)];
    };
  },
  concrete({ seed = 18, joints = 2, stain = 0.4 }) {
    const n = new Noise(seed);
    return (u, v) => {
      const fine = n.fbm(u, v, 200, 3), blot = n.fbm(u, v, 6, 4), jd = joints ? Math.min(Math.abs(((u * joints) % 1) - 0), Math.abs(((v * joints) % 1) - 0), 1 - ((u * joints) % 1), 1 - ((v * joints) % 1)) : 1;
      const joint = joints ? smooth(0.004, 0.0015, jd / joints) : 0;
      const l = clamp(0.62 + (fine - 0.5) * 0.08 + (blot - 0.5) * 0.12 * stain - joint * 0.3);
      return [l, l * 0.99, l * 0.97, fine * 0.2 - joint * 0.5, 0.88 + fine * 0.06];
    };
  },
  tessellated({ seed = 22 }) { // Victorian geometric verandah tiles: octagons + small squares, border-free field
    const n = new Noise(seed), cols = [hexRgb(0xe9e1d0), hexRgb(0x1d1b1b), hexRgb(0xa1432a), hexRgb(0xc9a15a)];
    const k = 4; // 4×4 octagons per tile
    return (u, v) => {
      const x = u * k, y = v * k, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix - 0.5, fy = y - iy - 0.5;
      const d = Math.max(Math.abs(fx), Math.abs(fy)), diag = (Math.abs(fx) + Math.abs(fy)) / Math.SQRT2;
      const inOct = Math.max(d, diag * 1.0) < 0.47, grout = Math.abs(Math.max(d, diag * 1.0) - 0.47) < 0.014;
      let c;
      if (inOct) c = (ix + iy) % 2 ? cols[2] : cols[0];
      else c = cols[1];
      const f = n.fbm(u, v, 128, 2), craze = n.cell(u, v, 60); const cr = (craze.f2 - craze.f1) < 0.01 ? 0.08 : 0;
      const l = grout ? 0.75 : 1;
      return [c[0] * l * (0.94 + f * 0.1) - cr * 0.3, c[1] * l * (0.94 + f * 0.1) - cr * 0.3, c[2] * l * (0.94 + f * 0.1) - cr * 0.3, grout ? 0 : 1, grout ? 0.9 : 0.22 + f * 0.1];
    };
  },
  ceramic({ base = 0xf3f1ec, grout = 0xb9b5ad, n: count = 4, seed = 23, gloss = 0.12 }) {
    const n = new Noise(seed), B = hexRgb(base), G = hexRgb(grout);
    return (u, v) => {
      const x = u * count, y = v * count, lx = x - Math.floor(x), ly = y - Math.floor(y), e = Math.min(lx, 1 - lx, ly, 1 - ly);
      const t = smooth(0.012, 0.03, e), r = hash2(Math.floor(x), Math.floor(y)), f = n.fbm(u, v, 128, 2);
      const c = lerp3(G, B.map((ch) => ch * (0.96 + r * 0.06)), t);
      return [c[0], c[1], c[2], t * (0.95 + f * 0.05), mix(0.85, gloss, t)];
    };
  },
  grass({ seed = 24, base = 0x4f7a2e, dry = 0x8a8a3c }) {
    const n = new Noise(seed), B = hexRgb(base), Dr = hexRgb(dry);
    return (u, v) => {
      const blades = n.fbm(u, v, 256, 2), patch = n.fbm(u, v, 6, 4), c = n.cell(u, v, 180);
      const col = lerp3(B, Dr, smooth(0.45, 0.75, patch)).map((ch) => clamp(ch * (0.7 + blades * 0.6) * (0.8 + c.id * 0.3)));
      return [col[0], col[1], col[2], blades, 0.92];
    };
  },
  gravel({ seed = 25, base = 0x8a7b68 }) {
    const n = new Noise(seed), B = hexRgb(base);
    return (u, v) => {
      const c = n.cell(u, v, 90), stone = smooth(0.42, 0.3, c.f1), f = n.fbm(u, v, 128, 3);
      const col = B.map((ch) => clamp(ch * (0.6 + c.id * 0.6) * (0.55 + stone * 0.45) + (f - 0.5) * 0.05));
      return [col[0], col[1], col[2], stone * (0.8 + f * 0.2), 0.9];
    };
  },
  sandstone({ seed = 26 }) { return GEN.ashlar({ base: 0xc9a77c, mortar: 0xd8ccb8, rows: 4, seed, pits: 0.2, tool: 0.3 }); },
  patina({ seed = 27 }) {
    const n = new Noise(seed);
    return (u, v) => {
      const a = n.fbm(u, v, 8, 5), s = n.fbm(u * 0.3, v, 64, 3), dark = smooth(0.55, 0.75, s);
      const col = lerp3([0.38, 0.62, 0.53], [0.22, 0.33, 0.27], clamp(a * 0.8 + dark * 0.5));
      return [col[0], col[1], col[2], a * 0.4, 0.62 + a * 0.2];
    };
  },
  fabric({ seed = 28, count = 120 }) {
    const n = new Noise(seed);
    return (u, v) => {
      const wx = Math.sin(u * count * Math.PI * 2), wy = Math.sin(v * count * Math.PI * 2), w = (Math.floor(u * count) + Math.floor(v * count)) % 2 ? wx : wy;
      const f = n.fbm(u, v, 32, 3), l = clamp(0.9 + w * 0.05 + (f - 0.5) * 0.08);
      return [l, l, l, w * 0.5 + 0.5, 0.95];
    };
  },
  leather({ seed = 29 }) {
    const n = new Noise(seed);
    return (u, v) => { const c = n.cell(u, v, 70), f = n.fbm(u, v, 32, 4), cr = smooth(0.0, 0.08, c.f2 - c.f1); const l = clamp(0.85 + (f - 0.5) * 0.15) * (0.85 + cr * 0.15); return [l, l, l, cr, 0.45 + (1 - cr) * 0.2]; };
  },
  marble({ seed = 30 }) {
    const n = new Noise(seed);
    return (u, v) => { const t = n.fbm(u, v, 3, 6), t2 = n.fbm(u + 5, v, 6, 5); const s1 = Math.abs(Math.sin((u * 2 + v * 1 + t * 4) * Math.PI)), s2 = Math.abs(Math.sin((u * 1 - v * 2 + t2 * 5) * Math.PI)); const vein = Math.pow(1 - s1, 10) * 0.7 + Math.pow(1 - s2, 24) * 0.35; const cloud = (t - 0.5) * 0.1; const l = clamp(0.94 - vein * 0.38 + cloud); return [l, l * 0.995, l * 0.985, 0.5, 0.1 + vein * 0.08]; };
  },
  tactile({ seed = 31 }) {
    const n = new Noise(seed);
    return (u, v) => { const x = (u * 8) % 1 - 0.5, y = (v * 8) % 1 - 0.5, d = Math.hypot(x, y), dot = smooth(0.26, 0.2, d), f = n.fbm(u, v, 64, 2); const c = [0.95 * (0.9 + f * 0.1), 0.78 * (0.9 + f * 0.1), 0.1]; return [c[0], c[1], c[2], dot, 0.6]; };
  },
  carpet({ seed = 32 }) { const n = new Noise(seed); return (u, v) => { const f = n.fbm(u, v, 256, 2), g = n.fbm(u, v, 16, 3); const l = clamp(0.85 + (f - 0.5) * 0.25 + (g - 0.5) * 0.05); return [l, l, l, f, 0.98]; }; },
  rustmetal({ seed = 33 }) {
    const n = new Noise(seed);
    return (u, v) => { const r = smooth(0.45, 0.7, n.fbm(u, v, 8, 5)), f = n.fbm(u, v, 128, 3); const c = lerp3([0.42, 0.43, 0.45], [0.42, 0.2, 0.09], r).map((x) => x * (0.85 + f * 0.3)); return [c[0], c[1], c[2], r * 0.3 + f * 0.1, 0.45 + r * 0.45]; };
  },
};

// ------------------------------------------------------------------------------- bake to textures
function makeTex(canvas, srgb, name) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.name = name; t.flipY = true; t.userData.mimeType = 'image/jpeg';
  return t;
}
/** Renders a generator into colour (cavity AO baked in), normal and roughness textures. */
export function bakeMaps(name, f, size = 1024, { normal = 3, ao = 0.6 } = {}) {
  const N = size, H = new Float32Array(N * N), C = new Float32Array(N * N * 3), R = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const o = f((x + 0.5) / N, (y + 0.5) / N), i = y * N + x;
    C[i * 3] = o[0]; C[i * 3 + 1] = o[1]; C[i * 3 + 2] = o[2]; H[i] = o[3]; R[i] = o[4];
  }
  // cavity AO: height below a blurred neighbourhood (box blur, tileable)
  const blur = new Float32Array(N * N), tmp = new Float32Array(N * N), rad = Math.max(2, N >> 7);
  for (let y = 0; y < N; y++) { let s = 0; for (let k = -rad; k <= rad; k++) s += H[y * N + ((k + N) % N)]; for (let x = 0; x < N; x++) { tmp[y * N + x] = s / (2 * rad + 1); s += H[y * N + ((x + rad + 1) % N)] - H[y * N + ((x - rad + N) % N)]; } }
  for (let x = 0; x < N; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += tmp[((k + N) % N) * N + x]; for (let y = 0; y < N; y++) { blur[y * N + x] = s / (2 * rad + 1); s += tmp[((y + rad + 1) % N) * N + x] - tmp[((y - rad + N) % N) * N + x]; } }
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cc = mk(), nc = mk(), rc = mk();
  const cd = cc.getContext('2d').createImageData(N, N), nd = nc.getContext('2d').createImageData(N, N), rd = rc.getContext('2d').createImageData(N, N);
  const s = normal * N / 256;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, p = i * 4;
    const occ = clamp(1 - Math.max(0, blur[i] - H[i]) * ao * 2.2);
    cd.data[p] = Math.round(clamp(C[i * 3] * occ) * 255); cd.data[p + 1] = Math.round(clamp(C[i * 3 + 1] * occ) * 255); cd.data[p + 2] = Math.round(clamp(C[i * 3 + 2] * occ) * 255); cd.data[p + 3] = 255;
    const l = H[y * N + ((x - 1 + N) % N)], r = H[y * N + ((x + 1) % N)], u = H[((y - 1 + N) % N) * N + x], d = H[((y + 1) % N) * N + x];
    // canvas rows run top→bottom; texture v runs bottom→top (flipY), so +v is "up" = -y
    let nx = (l - r) * s, ny = (d - u) * s, nz = 1; const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    nd.data[p] = Math.round((nx * 0.5 + 0.5) * 255); nd.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255); nd.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255); nd.data[p + 3] = 255;
    const rv = Math.round(clamp(R[i]) * 255); rd.data[p] = rd.data[p + 1] = rd.data[p + 2] = rv; rd.data[p + 3] = 255;
  }
  cc.getContext('2d').putImageData(cd, 0, 0); nc.getContext('2d').putImageData(nd, 0, 0); rc.getContext('2d').putImageData(rd, 0, 0);
  return { map: makeTex(cc, true, name), normalMap: makeTex(nc, false, name + '_normal'), roughnessMap: makeTex(rc, false, name + '_rough') };
}

// ------------------------------------------------------------------------------- library
/**
 * Material presets: gen (+ options), tile size in metres [u, v], tint colour, metalness, normal strength.
 * Neutral generators (render, weatherboard, corrugated, woodgrain, fabric…) are coloured by `color`.
 */
export const LIB = {
  brick_red: { label: 'Red brick', gen: 'brick', o: { base: 0x9d4a32, alt: 0x7a3426 }, tile: [0.96, 1.032] },
  brick_hawthorn: { label: 'Hawthorn brick (Victorian)', gen: 'brick', o: { base: 0x5b3a33, alt: 0x40282a, mortar: 0xc9c2b5, tuck: true, vary: 0.22 }, tile: [0.96, 1.032] },
  brick_cream: { label: 'Cream brick', gen: 'brick', o: { base: 0xd8c095, alt: 0xc4a574, mortar: 0xd6cfc0, vary: 0.12 }, tile: [0.96, 1.032] },
  brick_modern: { label: 'Modern face brick', gen: 'brick', o: { base: 0xb25c3c, alt: 0x9c4a30, mortar: 0x8f8a82, vary: 0.08 }, tile: [0.96, 1.032] },
  brick_painted: { label: 'Painted brick', gen: 'brick', o: { base: 0xe8e4dc, alt: 0xdcd7cc, mortar: 0xd2cdc2, vary: 0.04 }, tile: [0.96, 1.032], color: 0xffffff },
  bluestone: { label: 'Bluestone blocks', gen: 'ashlar', o: {}, tile: [1.8, 1.2] },
  bluestone_cobbles: { label: 'Bluestone cobbles', gen: 'setts', o: {}, tile: [1.0, 1.0], normal: 4 },
  sandstone: { label: 'Sandstone', gen: 'sandstone', o: {}, tile: [1.8, 1.2] },
  render: { label: 'Painted render', gen: 'render', o: {}, tile: [2.2, 2.2], color: 0xe9dfc8, normal: 1.5 },
  weatherboard: { label: 'Weatherboards', gen: 'weatherboard', o: {}, tile: [1.2, 1.2], color: 0xf1e9d2, normal: 5 },
  corrugated: { label: 'Corrugated iron', gen: 'corrugated', o: {}, tile: [1, 1], color: 0xc8ccd0, metal: 0.65, normal: 6 },
  corrugated_painted: { label: 'Colorbond', gen: 'corrugated', o: { spangle: 0 }, tile: [1, 1], color: 0x3d5a4f, metal: 0.15, normal: 6 },
  corrugated_rusty: { label: 'Rusty iron', gen: 'corrugated', o: { rust: 0.8 }, tile: [1, 1], color: 0xbfc2c4, metal: 0.5, normal: 6 },
  slate: { label: 'Slate roof', gen: 'slate', o: {}, tile: [1.2, 1.0], normal: 5 },
  terracotta: { label: 'Terracotta tiles', gen: 'terracotta', o: {}, tile: [0.66, 1.05], normal: 6 },
  floorboards: { label: 'Baltic pine floor', gen: 'boards', o: {}, tile: [0.84, 2.4] },
  decking: { label: 'Timber decking', gen: 'boards', o: { base: 0x8f6a4a, alt: 0x6e4e36, count: 7, gap: 0.03, gloss: 0.6 }, tile: [0.98, 3] },
  oak: { label: 'Oak', gen: 'boards', o: { base: 0xb8915e, alt: 0x8d6a42, count: 3, gap: 0.001 }, tile: [0.6, 1.8] },
  walnut: { label: 'Walnut', gen: 'boards', o: { base: 0x6b4a32, alt: 0x4a3122, count: 3, gap: 0.001, gloss: 0.3 }, tile: [0.6, 1.8] },
  paint_timber: { label: 'Painted timber', gen: 'woodgrain', o: {}, tile: [1, 1], color: 0xf2efe8, normal: 1 },
  asphalt: { label: 'Asphalt', gen: 'asphalt', o: {}, tile: [3, 3], normal: 2 },
  concrete: { label: 'Concrete', gen: 'concrete', o: { joints: 0 }, tile: [3, 3], normal: 1.5 },
  footpath: { label: 'Concrete footpath', gen: 'concrete', o: { joints: 2 }, tile: [2.4, 2.4], normal: 1.5 },
  tessellated: { label: 'Tessellated tiles', gen: 'tessellated', o: {}, tile: [0.4, 0.4], normal: 2 },
  tiles_white: { label: 'White wall tiles', gen: 'ceramic', o: {}, tile: [0.6, 0.6], normal: 2 },
  tiles_floor: { label: 'Floor tiles', gen: 'ceramic', o: { base: 0xd9d4ca, grout: 0x8e8a83, n: 2, gloss: 0.25 }, tile: [1.2, 1.2], normal: 2 },
  grass: { label: 'Grass', gen: 'grass', o: {}, tile: [2, 2], normal: 2 },
  gravel: { label: 'Gravel', gen: 'gravel', o: {}, tile: [1.5, 1.5], normal: 4 },
  copper_patina: { label: 'Copper patina', gen: 'patina', o: {}, tile: [2, 2], metal: 0.3 },
  fabric: { label: 'Fabric', gen: 'fabric', o: {}, tile: [0.25, 0.25], color: 0x6f7f96, normal: 1, size: 512 },
  leather: { label: 'Leather', gen: 'leather', o: {}, tile: [0.6, 0.6], color: 0x5a3426, normal: 1.5, size: 512 },
  carpet: { label: 'Carpet', gen: 'carpet', o: {}, tile: [0.5, 0.5], color: 0x9a8e7e, normal: 1, size: 512 },
  marble: { label: 'Marble', gen: 'marble', o: {}, tile: [1.5, 1.5], normal: 0.5 },
  tactile: { label: 'Tactile paving', gen: 'tactile', o: {}, tile: [0.3, 0.3], normal: 3, size: 512 },
  rust_metal: { label: 'Weathered steel', gen: 'rustmetal', o: {}, tile: [2, 2], metal: 0.6 },
};

const cache = new Map();
/** Texture set for a library material (cached per size). */
export function libMaps(key, size = 1024) {
  const k = key + '@' + size;
  if (cache.has(k)) return cache.get(k);
  const d = LIB[key]; if (!d) throw new Error('Unknown material ' + key);
  const maps = bakeMaps(key, GEN[d.gen](d.o || {}), size, { normal: d.normal ?? 3 });
  cache.set(k, maps);
  return maps;
}
export { GEN, Noise, hash2, clamp, smooth };
