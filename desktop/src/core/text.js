// 3D text from any TrueType / OpenType / WOFF font (opentype.js), with rounded bevels.
import * as THREE from 'three';
import opentype from 'opentype.js';
import { normalize, computeNormals } from './mesh.js';

export function defaultTextSpec() {
  return { text: 'Title', font: 'builtin:michroma', bold: false, italic: false, depth: 0.2, bevel: 0.02, bevelSegments: 3, letterSpacing: 0, lineSpacing: 1, align: 1, quality: 6 };
}

const cache = new Map();
/** Parse (and cache) a font from an ArrayBuffer. */
export function parseFont(id, buffer) {
  if (cache.has(id)) return cache.get(id);
  const f = opentype.parse(buffer);
  cache.set(id, f);
  return f;
}
export const cachedFont = (id) => cache.get(id);

/** Polyline contours (y up, font units / 1000) for a string. */
export function textContours(font, spec) {
  const size = 100, lines = spec.text.split('\n');
  const scale = size / font.unitsPerEm;
  const lineH = (font.ascender - font.descender) * scale * spec.lineSpacing;
  const widths = lines.map((l) => advance(font, l, size, spec.letterSpacing));
  const maxW = Math.max(0, ...widths);
  const contours = [];
  const steps = Math.max(2, Math.round(spec.quality));
  const skew = spec.italic ? 0.21 : 0;
  lines.forEach((line, li) => {
    if (!line.trim()) return;
    let x = spec.align === 0 ? 0 : spec.align === 2 ? maxW - widths[li] : (maxW - widths[li]) / 2;
    const y = -li * lineH;
    const glyphs = font.stringToGlyphs(line);
    for (let i = 0; i < glyphs.length; i++) {
      const gl = glyphs[i];
      const path = gl.getPath(x, 0, size);
      let cur = null, px = 0, py = 0;
      const push = (gx, gy) => { const yy = -gy; cur.push([gx + skew * yy, yy + y]); };
      for (const c of path.commands) {
        if (c.type === 'M') { if (cur && cur.length > 2) contours.push(cur); cur = []; push(c.x, c.y); px = c.x; py = c.y; }
        else if (c.type === 'L') { push(c.x, c.y); px = c.x; py = c.y; }
        else if (c.type === 'Q') { for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; push(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y); } px = c.x; py = c.y; }
        else if (c.type === 'C') { for (let s = 1; s <= steps; s++) { const t = s / steps, u = 1 - t; push(u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x, u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y); } px = c.x; py = c.y; }
        else if (c.type === 'Z') { if (cur && cur.length > 2) contours.push(cur); cur = null; }
      }
      if (cur && cur.length > 2) contours.push(cur);
      x += gl.advanceWidth * scale + spec.letterSpacing * size;
      if (i < glyphs.length - 1 && font.getKerningValue) x += font.getKerningValue(gl, glyphs[i + 1]) * scale;
    }
  });
  return contours.map(clean).filter((c) => c.length >= 3 && Math.abs(area(c)) > 0.05);
}

function advance(font, line, size, spacing) {
  const scale = size / font.unitsPerEm, gs = font.stringToGlyphs(line);
  let w = 0; gs.forEach((g, i) => { w += g.advanceWidth * scale + (i < gs.length - 1 ? spacing * size : 0); });
  return w;
}

function clean(c) {
  const out = [];
  for (const p of c) { const l = out[out.length - 1]; if (!l || Math.abs(l[0] - p[0]) > 1e-3 || Math.abs(l[1] - p[1]) > 1e-3) out.push(p); }
  if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3) out.pop(); }
  return out;
}
export function area(c) { let a = 0; for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function inside(pt, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

/** Group contours into shapes with holes using nesting depth (works for TTF and CFF winding). */
export function contoursToShapes(contours) {
  const items = contours.map((c) => ({ c, a: Math.abs(area(c)) })).sort((x, y) => y.a - x.a);
  const parent = new Array(items.length).fill(-1), depth = new Array(items.length).fill(0);
  for (let i = 0; i < items.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (inside(items[i].c[0], items[j].c) && inside(items[i].c[Math.floor(items[i].c.length / 2)], items[j].c)) { parent[i] = j; depth[i] = depth[j] + 1; break; }
    }
  }
  const shapes = new Map();
  items.forEach((it, i) => {
    if (depth[i] % 2 === 0) {
      const pts = area(it.c) < 0 ? [...it.c].reverse() : it.c;
      shapes.set(i, new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
    }
  });
  items.forEach((it, i) => {
    if (depth[i] % 2 === 1 && shapes.has(parent[i])) {
      const pts = area(it.c) > 0 ? [...it.c].reverse() : it.c;
      shapes.get(parent[i]).holes.push(new THREE.Path(pts.map(([x, y]) => new THREE.Vector2(x, y))));
    }
  });
  return [...shapes.values()];
}

/** Build the text mesh (metres; cap height ≈ 0.7). */
export function buildText(font, spec) {
  const contours = textContours(font, spec);
  if (!contours.length) return null;
  const shapes = contoursToShapes(contours);
  const unit = 0.01; // 100 font units = 1 m
  const depth = Math.max(0.005, spec.depth) / unit;
  let bevel = Math.max(0, spec.bevel) / unit;
  bevel = Math.min(bevel, depth * 0.45);
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(0.5, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.85,
    bevelSegments: Math.max(1, Math.min(8, spec.bevelSegments | 0)), curveSegments: 1, steps: 1,
  });
  g.scale(unit, unit, unit);
  // ExtrudeGeometry UVs are in font units: make one texture repeat per metre
  const uv = g.attributes.uv; if (uv) { for (let i = 0; i < uv.array.length; i++) uv.array[i] *= unit; }
  g.center();
  const ng = g.index ? g : (() => { const n = g.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); return g; })();
  normalize(ng);
  ng.userData.flat = false;
  computeNormals(ng);
  return ng;
}
