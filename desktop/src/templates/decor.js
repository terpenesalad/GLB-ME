// Canvas-drawn textures for templates: Victorian cast-iron lace (alpha cut-out with a rounded
// normal map), leadlight glass, painted signs and destination displays, and leaf cards for trees.
import * as THREE from 'three';
import { Noise } from './pbr.js';

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const tex = (c, srgb = true, name = 'Texture', wrap = true) => {
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.name = name; t.anisotropy = 8;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};
const cache = new Map();
const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

/** Normal map from the alpha channel of a canvas (cut-out shapes read as rounded castings). */
function normalFromAlpha(c, strength = 3, rad = 3) {
  const w = c.width, h = c.height, src = c.getContext('2d').getImageData(0, 0, w, h).data;
  let H = new Float32Array(w * h); for (let i = 0; i < w * h; i++) H[i] = src[i * 4 + 3] / 255;
  const blur = (A) => { const B = new Float32Array(w * h), C = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += A[y * w + ((x + k + w) % w)]; B[y * w + x] = s / (2 * rad + 1); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += B[Math.min(h - 1, Math.max(0, y + k)) * w + x]; C[y * w + x] = s / (2 * rad + 1); }
    return C; };
  H = blur(blur(H));
  const n = canvas(w, h), ctx = n.getContext('2d'), img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = H[y * w + ((x - 1 + w) % w)], r = H[y * w + ((x + 1) % w)], u = H[Math.max(0, y - 1) * w + x], d = H[Math.min(h - 1, y + 1) * w + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1; const len = Math.hypot(nx, ny, nz);
    const p = (y * w + x) * 4; img.data[p] = (nx / len * 0.5 + 0.5) * 255; img.data[p + 1] = (ny / len * 0.5 + 0.5) * 255; img.data[p + 2] = (nz / len * 0.5 + 0.5) * 255; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return n;
}
/** Bakes a soft shading into a white cut-out so castings look moulded even under flat light. */
function shadeCutout(c) {
  const w = c.width, h = c.height, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, w, h), nz = new Noise(5);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4; if (!img.data[p + 3]) continue;
    const v = 0.78 + nz.fbm(x / w, y / h, 32, 3) * 0.3; img.data[p] = img.data[p + 1] = img.data[p + 2] = Math.min(255, v * 255);
  }
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------------------- iron lace
/**
 * Cast-iron lace frieze (one repeat = 0.6 m × 0.3 m) or corner bracket. White with alpha; tint the
 * material colour (black, Brunswick green, cream…). style: 'frieze' | 'bracket' | 'balustrade'.
 */
export function laceTexture(style = 'frieze') {
  return memo('lace:' + style, () => {
    const W = style === 'bracket' ? 512 : 1024, H = style === 'balustrade' ? 1024 : 512;
    const c = canvas(W, H), x = c.getContext('2d');
    x.strokeStyle = x.fillStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
    const line = (w, pts) => { x.lineWidth = w; x.beginPath(); x.moveTo(...pts[0]); for (const p of pts.slice(1)) x.lineTo(...p); x.stroke(); };
    const circ = (cx, cy, r, w) => { x.lineWidth = w; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke(); };
    const scroll = (cx, cy, r, dir, w, turns = 1.6) => { x.lineWidth = w; x.beginPath(); for (let t = 0; t <= turns * Math.PI * 2; t += 0.08) { const rr = r * (1 - t / (turns * Math.PI * 2) * 0.82); const px = cx + Math.cos(t * dir) * rr, py = cy + Math.sin(t * dir) * rr; t ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); };
    const dot = (cx, cy, r) => { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    if (style === 'frieze') {
      // rails
      x.fillRect(0, 0, W, 34); x.fillRect(0, H - 30, W, 30); x.fillRect(0, 50, W, 12);
      for (let i = 0; i < 2; i++) {
        const ox = i * W / 2, cx = ox + W / 4, cy = 262;
        circ(cx, cy, 128, 22); circ(cx, cy, 78, 16);
        for (let kk = 0; kk < 4; kk++) { const a = kk * Math.PI / 2 + Math.PI / 4; circ(cx + Math.cos(a) * 36, cy + Math.sin(a) * 36, 26, 12); }
        dot(cx, cy, 16);
        for (let kk = 0; kk < 16; kk++) { const a = kk / 16 * Math.PI * 2; dot(cx + Math.cos(a) * 103, cy + Math.sin(a) * 103, 10); }
        // C-scrolls filling the spandrels
        scroll(ox + 46, 140, 74, 1, 17); scroll(ox + 46, 384, 74, -1, 17);
        scroll(ox + W / 2 - 46, 140, 74, -1, 17); scroll(ox + W / 2 - 46, 384, 74, 1, 17);
        line(16, [[ox + 6, 62], [ox + 6, H - 30]]);
        // pendant drops and spear points along the bottom rail
        for (let kk = -2; kk <= 2; kk++) { const px = cx + kk * 26; line(9, [[px, 392], [px, H - 30]]); dot(px, 396, 11); }
        for (const px of [ox + 30, ox + W / 2 - 30]) { x.beginPath(); x.moveTo(px - 24, H - 30); x.quadraticCurveTo(px, 420, px + 24, H - 30); x.fill(); }
      }
    } else if (style === 'bracket') {
      // quarter-circle corner bracket: post on the left edge, beam along the top
      x.fillRect(0, 0, W, 24); x.fillRect(0, 0, 24, H);
      x.lineWidth = 12; x.beginPath(); x.moveTo(24, H - 20); x.quadraticCurveTo(70, 70, W - 20, 24); x.stroke();
      x.save(); x.beginPath(); x.moveTo(24, H - 20); x.quadraticCurveTo(70, 70, W - 20, 24); x.lineTo(24, 24); x.closePath(); x.clip();
      circ(170, 170, 95, 10); circ(170, 170, 50, 8); dot(170, 170, 14);
      scroll(330, 80, 55, 1, 9); scroll(80, 330, 55, -1, 9); scroll(300, 200, 34, 1, 7, 1.3); scroll(200, 300, 34, -1, 7, 1.3);
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; dot(170 + Math.cos(a) * 72, 170 + Math.sin(a) * 72, 5); }
      line(7, [[24, 24], [120, 120]]); line(7, [[260, 60], [420, 40]]); line(7, [[60, 260], [40, 420]]);
      x.restore();
    } else { // balustrade panel (balcony): rails top/bottom, symmetric rosette pattern
      x.fillRect(0, 0, W, 34); x.fillRect(0, H - 34, W, 34);
      for (let i = 0; i < 2; i++) {
        const cx = W / 4 + i * W / 2;
        circ(cx, H / 2, 200, 14); circ(cx, H / 2, 120, 10);
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; circ(cx + Math.cos(a) * 160, H / 2 + Math.sin(a) * 160, 36, 8); }
        dot(cx, H / 2, 30);
        for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * Math.PI * 2; line(8, [[cx + Math.cos(a) * 40, H / 2 + Math.sin(a) * 40], [cx + Math.cos(a) * 118, H / 2 + Math.sin(a) * 118]]); }
        scroll(cx - 205, 140, 90, 1, 12); scroll(cx + 205, 140, 90, -1, 12); scroll(cx - 205, H - 140, 90, -1, 12); scroll(cx + 205, H - 140, 90, 1, 12);
        line(12, [[cx - W / 4 + 6, 34], [cx - W / 4 + 6, H - 34]]);
      }
    }
    const n = normalFromAlpha(c, 5, 5);
    shadeCutout(c);
    const map = tex(c, true, 'Iron lace ' + style), normalMap = tex(n, false, 'Iron lace ' + style + ' normal');
    if (style === 'bracket') for (const t of [map, normalMap]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return { map, normalMap };
  });
}

// ------------------------------------------------------------------------------- leadlight
/** Victorian leadlight panel (fanlight / sidelight / door glass). */
export function leadlightTexture(kind = 'fan') {
  return memo('lead:' + kind, () => {
    const W = 512, H = kind === 'side' ? 1024 : 256, c = canvas(W, H), x = c.getContext('2d'), nz = new Noise(kind.length + 3);
    const pal = ['#a2203a', '#d8a933', '#2f6b4a', '#2b4f8a', '#e9e3cf', '#e9e3cf', '#c9d9d4'];
    const pane = (pts, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(...pts[0]); for (const p of pts.slice(1)) x.lineTo(...p); x.closePath(); x.fill(); };
    x.fillStyle = '#d9e3df'; x.fillRect(0, 0, W, H);
    if (kind === 'fan') {
      for (let i = 0; i < 9; i++) { const a0 = Math.PI + i * Math.PI / 9, a1 = a0 + Math.PI / 9; pane([[W / 2, H], [W / 2 + Math.cos(a0) * 600, H + Math.sin(a0) * 600], [W / 2 + Math.cos(a1) * 600, H + Math.sin(a1) * 600]], i % 2 ? '#e7e1cc' : '#cfdcd6'); }
      x.fillStyle = pal[0]; x.beginPath(); x.arc(W / 2, H, 70, Math.PI, 0); x.fill();
      x.fillStyle = pal[1]; x.beginPath(); x.arc(W / 2, H, 40, Math.PI, 0); x.fill();
      x.fillStyle = pal[3]; x.fillRect(0, 0, W, 26); x.fillStyle = pal[2]; for (let i = 0; i < 8; i++) x.fillRect(i * 64 + 26, 6, 14, 14);
    } else {
      const bw = kind === 'side' ? 60 : 50; x.fillStyle = pal[3]; x.fillRect(0, 0, W, bw); x.fillRect(0, H - bw, W, bw); x.fillRect(0, 0, bw, H); x.fillRect(W - bw, 0, bw, H);
      x.fillStyle = pal[1]; for (const [px, py] of [[0, 0], [W - bw, 0], [0, H - bw], [W - bw, H - bw]]) x.fillRect(px, py, bw, bw);
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.3;
      x.fillStyle = pal[2]; x.beginPath(); x.moveTo(cx, cy - r); x.lineTo(cx + r * 0.7, cy); x.lineTo(cx, cy + r); x.lineTo(cx - r * 0.7, cy); x.closePath(); x.fill();
      x.fillStyle = pal[0]; x.beginPath(); x.arc(cx, cy, r * 0.32, 0, Math.PI * 2); x.fill();
      x.fillStyle = pal[1]; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; x.beginPath(); x.arc(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.12, 0, Math.PI * 2); x.fill(); }
    }
    // came (lead lines): edge-detect colour changes, plus grain
    const img = x.getImageData(0, 0, W, H), d = img.data, out = new Uint8ClampedArray(d);
    for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) {
      const p = (y * W + xx) * 4; let edge = false;
      for (const q of [p + 4, p - 4, p + W * 4, p - W * 4]) if (Math.abs(d[p] - d[q]) + Math.abs(d[p + 1] - d[q + 1]) + Math.abs(d[p + 2] - d[q + 2]) > 30) edge = true;
      const g = 0.9 + nz.v(xx / W, y / H, 64) * 0.2;
      if (edge) { out[p] = out[p + 1] = out[p + 2] = 40; } else { out[p] *= g; out[p + 1] *= g; out[p + 2] *= g; }
    }
    // thicken lead lines
    const o2 = new Uint8ClampedArray(out);
    for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) { const p = (y * W + xx) * 4; if (out[p] === 40 && out[p + 1] === 40) for (const q of [p + 4, p - 4, p + W * 4, p - W * 4]) { o2[q] = o2[q + 1] = o2[q + 2] = 40; } }
    img.data.set(o2); x.putImageData(img, 0, 0);
    return tex(c, true, 'Leadlight', false);
  });
}

// ------------------------------------------------------------------------------- signs
/**
 * Painted / printed sign. lines: string or [string…]; style: { bg, fg, font, weight, border, glow, pad }
 * Returns { map, aspect } (aspect = width / height of the board for sizing geometry).
 */
export function signTexture(lines, st = {}) {
  const key = 'sign:' + JSON.stringify([lines, st]);
  return memo(key, () => {
    lines = Array.isArray(lines) ? lines : [lines];
    const H = st.h || 256, W = st.w || 1024, c = canvas(W, H), x = c.getContext('2d');
    x.fillStyle = st.bg || '#1f3b2c'; x.fillRect(0, 0, W, H);
    if (st.border) { x.strokeStyle = st.borderColor || st.fg || '#e9d9a6'; x.lineWidth = st.border; x.strokeRect(st.border, st.border, W - st.border * 2, H - st.border * 2); }
    const font = st.font || 'Georgia, "Times New Roman", serif';
    const lh = (H - (st.pad ?? 30) * 2) / lines.length;
    x.textAlign = st.align || 'center'; x.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      let size = lh * (st.scale || 0.78);
      x.font = `${st.weight || 700} ${size}px ${font}`;
      const maxW = W - (st.pad ?? 30) * 2 - (st.border || 0) * 2;
      while (x.measureText(ln).width > maxW && size > 8) { size *= 0.94; x.font = `${st.weight || 700} ${size}px ${font}`; }
      if (st.glow) { x.shadowColor = st.fg; x.shadowBlur = size * 0.25; }
      x.fillStyle = st.fg || '#e9d9a6';
      if (st.spacing) x.letterSpacing = st.spacing + 'px';
      const tx = st.align === 'left' ? (st.pad ?? 30) + (st.border || 0) : W / 2;
      x.fillText(ln, tx, (st.pad ?? 30) + lh * (i + 0.5));
    });
    if (st.dots) { // LED matrix look
      const img = x.getImageData(0, 0, W, H), d = img.data, s = st.dots;
      for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { const fx = (xx % s) / s - 0.5, fy = (y % s) / s - 0.5; if (fx * fx + fy * fy > 0.16) { const p = (y * W + xx) * 4; d[p] *= 0.15; d[p + 1] *= 0.15; d[p + 2] *= 0.15; } }
      x.putImageData(img, 0, 0);
    }
    const t = tex(c, true, 'Sign ' + lines.join(' '), false);
    return { map: t, aspect: W / H };
  });
}

// ------------------------------------------------------------------------------- foliage
/** Leaf cluster card (alpha cut-out). kind: 'gum' | 'plane' | 'round' | 'palm' | 'grass' | 'hedge' */
export function leafTexture(kind = 'round', { bg = null } = {}) {
  return memo('leaf:' + kind + (bg || ''), () => {
    const S = 512, c = canvas(S, S), x = c.getContext('2d'), nz = new Noise(kind.length * 7), r = (() => { let s = kind.length * 99 + 7; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
    const cols = { gum: ['#55684c', '#6b7a58', '#46593f', '#7e8a63'], plane: ['#4f7a2e', '#6b9238', '#3f6526', '#88a84a'], round: ['#3f6f2a', '#5a8a35', '#2f5a22', '#77a046'], palm: ['#4d6f2c', '#6a8a3a', '#3d5a24'], grass: ['#5c7f2e', '#7e9a42', '#46682a', '#9aa85a'], hedge: ['#2f5a26', '#3f6f2e', '#24461e', '#4f7f36'] }[kind];
    const leaf = (px, py, len, wid, ang, col) => {
      x.save(); x.translate(px, py); x.rotate(ang);
      const g = x.createLinearGradient(0, -wid, 0, wid); g.addColorStop(0, col); g.addColorStop(0.5, shade(col, 1.15)); g.addColorStop(1, shade(col, 0.8));
      x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * 0.45, -wid, len, 0); x.quadraticCurveTo(len * 0.45, wid, 0, 0); x.fill();
      x.strokeStyle = shade(col, 0.7); x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 0); x.lineTo(len * 0.95, 0); x.stroke();
      x.restore();
    };
    const lobed = (px, py, s, ang, col) => { x.save(); x.translate(px, py); x.rotate(ang); x.fillStyle = col; x.beginPath(); for (let k = 0; k <= 5; k++) { const a = -Math.PI / 2 + (k - 2.5) * 0.55; x.moveTo(0, 0); x.quadraticCurveTo(Math.cos(a - 0.3) * s * 0.7, Math.sin(a - 0.3) * s * 0.7, Math.cos(a) * s, Math.sin(a) * s); x.quadraticCurveTo(Math.cos(a + 0.3) * s * 0.7, Math.sin(a + 0.3) * s * 0.7, 0, 0); } x.fill(); x.restore(); };
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, S, S); }
    if (kind === 'grass') {
      for (let i = 0; i < 160; i++) { const px = 20 + r() * (S - 40), hgt = S * (0.45 + r() * 0.5), bend = (r() - 0.5) * 80; x.strokeStyle = cols[i % 4]; x.lineWidth = 3 + r() * 4; x.beginPath(); x.moveTo(px, S); x.quadraticCurveTo(px + bend * 0.3, S - hgt * 0.6, px + bend, S - hgt); x.stroke(); }
    } else if (kind === 'palm') {
      x.strokeStyle = '#5a5a2e'; x.lineWidth = 6; x.beginPath(); x.moveTo(0, S / 2); x.quadraticCurveTo(S / 2, S / 2 - 40, S, S / 2 + 30); x.stroke();
      for (let i = 0; i < 60; i++) { const t = i / 60, px = t * S, py = S / 2 - 40 * Math.sin(t * Math.PI) + t * 30; for (const sgn of [-1, 1]) leaf(px, py, 120 * (1 - t * 0.6), 9, sgn * (1.1 + t * 0.3) + 0.2, cols[i % 3]); }
    } else {
      const n = kind === 'hedge' ? 420 : kind === 'gum' ? 140 : 180;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * S * 0.42, px = S / 2 + Math.cos(a) * d, py = S / 2 + Math.sin(a) * d * 0.9;
        const col = cols[Math.floor(r() * cols.length)];
        if (kind === 'gum') leaf(px, py, 70 + r() * 40, 9 + r() * 4, Math.PI / 2 + (r() - 0.5) * 1.2, col); // hanging, sickle-shaped
        else if (kind === 'plane') lobed(px, py, 34 + r() * 16, r() * Math.PI * 2, col);
        else if (kind === 'hedge') leaf(px, py, 18 + r() * 10, 7, r() * Math.PI * 2, col);
        else leaf(px, py, 34 + r() * 20, 12 + r() * 5, r() * Math.PI * 2, col);
      }
      if (kind !== 'hedge') { x.strokeStyle = kind === 'gum' ? '#8a6a52' : '#5b4630'; x.lineWidth = 4; for (let i = 0; i < 6; i++) { const a = r() * Math.PI * 2; x.beginPath(); x.moveTo(S / 2, S / 2); x.lineTo(S / 2 + Math.cos(a) * S * 0.3, S / 2 + Math.sin(a) * S * 0.3); x.stroke(); } }
    }
    // dapple
    const img = x.getImageData(0, 0, S, S); for (let i = 0; i < S * S; i++) { if (!img.data[i * 4 + 3]) continue; const v = 0.85 + nz.fbm((i % S) / S, Math.floor(i / S) / S, 8, 3) * 0.3; img.data[i * 4] *= v; img.data[i * 4 + 1] *= v; img.data[i * 4 + 2] *= v; } x.putImageData(img, 0, 0);
    const t = tex(c, true, 'Leaves ' + kind, !!bg);
    return { map: t };
  });
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return `rgb(${f(n >> 16 & 255)},${f(n >> 8 & 255)},${f(n & 255)})`; }

/** Bark texture for tree trunks (u around, v up): 'gum' (smooth, peeling patches) | 'rough' | 'palm'. */
export function barkTexture(kind = 'rough') {
  return memo('bark:' + kind, () => {
    const W = 512, H = 512, c = canvas(W, H), x = c.getContext('2d'), img = x.createImageData(W, H), nz = new Noise(kind.length + 40);
    const hgt = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const u = xx / W, v = y / H, i = y * W + xx; let r, g, b, h;
      if (kind === 'gum') {
        const patch = nz.fbm(u, v * 0.5, 6, 4), peel = patch > 0.55, f = nz.fbm(u, v, 64, 2);
        const base = peel ? [0.82, 0.8, 0.74] : [0.62, 0.6, 0.58]; const tint = nz.fbm(u + 3, v, 4, 3);
        r = base[0] * (0.85 + f * 0.25) + tint * 0.08; g = base[1] * (0.85 + f * 0.25); b = base[2] * (0.85 + f * 0.25) - tint * 0.05; h = peel ? 0.6 : 0.3 + f * 0.1;
      } else if (kind === 'palm') {
        const rings = Math.abs(Math.sin(v * Math.PI * 18 + nz.v(u, v, 8) * 2)); const f = nz.fbm(u, v, 48, 3);
        r = 0.42 * (0.7 + rings * 0.4 + f * 0.2); g = 0.36 * (0.7 + rings * 0.4 + f * 0.2); b = 0.28 * (0.7 + rings * 0.4); h = rings * 0.7 + f * 0.3;
      } else {
        const ridges = nz.fbm(u * 1, v * 0.15, 24, 4), f = nz.fbm(u, v, 96, 3), cr = Math.pow(Math.abs(ridges - 0.5) * 2, 0.6);
        r = 0.36 * (0.55 + cr * 0.6 + f * 0.2); g = 0.3 * (0.55 + cr * 0.6 + f * 0.2); b = 0.25 * (0.55 + cr * 0.6 + f * 0.2); h = cr;
      }
      hgt[i] = h; const p = i * 4; img.data[p] = Math.min(255, r * 255); img.data[p + 1] = Math.min(255, g * 255); img.data[p + 2] = Math.min(255, b * 255); img.data[p + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const n = canvas(W, H), nx = n.getContext('2d'), nd = nx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const l = hgt[y * W + ((xx - 1 + W) % W)], rr = hgt[y * W + ((xx + 1) % W)], u = hgt[((y - 1 + H) % H) * W + xx], d = hgt[((y + 1) % H) * W + xx];
      let a = (l - rr) * 6, b = (d - u) * 6, z = 1; const len = Math.hypot(a, b, z); const p = (y * W + xx) * 4;
      nd.data[p] = (a / len * 0.5 + 0.5) * 255; nd.data[p + 1] = (b / len * 0.5 + 0.5) * 255; nd.data[p + 2] = (z / len * 0.5 + 0.5) * 255; nd.data[p + 3] = 255;
    }
    nx.putImageData(nd, 0, 0);
    return { map: tex(c, true, 'Bark ' + kind), normalMap: tex(n, false, 'Bark ' + kind + ' normal') };
  });
}
