// Furniture & fittings: living, dining, bedroom, study, kitchen and bathroom pieces, lamps,
// plants and a Victorian marble fireplace. Each piece stands on y = 0, faces +Z, sizes in metres.
// The builders are also used to furnish the room templates.
import * as THREE from 'three';
import { G } from '../kit.js';
import { leafTexture } from '../decor.js';

const fab = (k, color, name = 'Upholstery') => k.mat('fabric', { color, name });
const wood = (k, id = 'oak') => k.mat(id, { name: id === 'walnut' ? 'Walnut' : 'Oak' });
const paint = (k, color, name) => k.mat('gloss', { color, name, roughness: 0.4 });
const legs = (xs, zs, h, r = 0.022, r2 = 0.016) => xs.flatMap((x) => zs.map((z) => G.cyl(r2, h, { r2: r, seg: 12, at: [x, 0, z] })));

// ------------------------------------------------------------------------------- living
export function sofa(k, parent, { at, rot, w = 2.1, d = 0.92, color = 0x5f6f7a, seats = null, name = 'Sofa' } = {}) {
  const g = k.group(name, parent, { at, rot });
  const n = seats ?? Math.max(1, Math.round((w - 0.4) / 0.62)), armW = 0.2, sh = 0.42, inner = w - armW * 2;
  const frame = [G.box(inner, 0.2, d - 0.1, { bevel: 0.03, at: [0, 0.24, 0.0] })];
  for (const s of [-1, 1]) frame.push(G.box(armW, 0.62, d, { bevel: 0.07, seg: 3, at: [s * (w / 2 - armW / 2), 0.43, 0] }));
  frame.push(G.box(inner, 0.5, 0.2, { bevel: 0.06, seg: 3, at: [0, 0.58, -d / 2 + 0.1] }));
  const cush = [];
  for (let i = 0; i < n; i++) {
    const cw = inner / n, x = -inner / 2 + cw * (i + 0.5);
    cush.push(G.box(cw - 0.015, 0.16, d - 0.28, { bevel: 0.06, seg: 3, at: [x, sh, 0.07] }));
    cush.push(G.box(cw - 0.03, 0.44, 0.17, { bevel: 0.07, seg: 3, at: [x, sh + 0.28, -d / 2 + 0.26], rot: [-10, 0, 0] }));
  }
  k.part('Frame', frame, fab(k, color), { parent: g });
  k.part('Cushions', cush, fab(k, color), { parent: g });
  k.part('Legs', legs([-w / 2 + 0.08, w / 2 - 0.08], [-d / 2 + 0.08, d / 2 - 0.08], 0.14), wood(k, 'walnut'), { parent: g });
  return g;
}
export const armchair = (k, parent, o = {}) => sofa(k, parent, { w: 0.92, seats: 1, name: 'Armchair', ...o });
export function coffeeTable(k, parent, { at, rot, w = 1.1, d = 0.6, name = 'Coffee table' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Top', [G.box(w, 0.04, d, { bevel: 0.012, at: [0, 0.42, 0] }), G.box(w - 0.12, 0.02, d - 0.12, { bevel: 0.006, at: [0, 0.14, 0] })], wood(k, 'walnut'), { parent: g });
  k.part('Legs', legs([-w / 2 + 0.06, w / 2 - 0.06], [-d / 2 + 0.06, d / 2 - 0.06], 0.4, 0.022, 0.014), wood(k, 'walnut'), { parent: g });
  return g;
}
export function rug(k, parent, { at, rot, w = 2.4, d = 1.7, color = 0x8a3b32, name = 'Rug' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Rug', [G.box(w, 0.012, d, { bevel: 0.004, at: [0, 0.006, 0] })], k.mat('carpet', { color, name: 'Rug wool' }), { parent: g, shadow: false });
  k.part('Border', [G.box(w - 0.12, 0.004, 0.05, { at: [0, 0.013, d / 2 - 0.1] }), G.box(w - 0.12, 0.004, 0.05, { at: [0, 0.013, -d / 2 + 0.1] }), G.box(0.05, 0.004, d - 0.2, { at: [w / 2 - 0.08, 0.013, 0] }), G.box(0.05, 0.004, d - 0.2, { at: [-w / 2 + 0.08, 0.013, 0] })], k.mat('carpet', { color: 0xd9c49a, name: 'Rug border' }), { parent: g, shadow: false });
  return g;
}
export function tvUnit(k, parent, { at, rot, w = 1.8, name = 'TV & cabinet' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Cabinet', [G.box(w, 0.45, 0.42, { bevel: 0.01, at: [0, 0.3, 0] })], wood(k, 'oak'), { parent: g });
  k.part('Feet', legs([-w / 2 + 0.1, w / 2 - 0.1], [-0.12, 0.12], 0.08, 0.02, 0.015), 'steel_dark', { parent: g });
  k.part('Doors', [-1, 0, 1].map((i) => G.box(w / 3 - 0.02, 0.38, 0.01, { bevel: 0.003, at: [i * w / 3, 0.3, 0.215] })), paint(k, 0x2f3437, 'Cabinet doors'), { parent: g });
  k.part('Television', [G.box(1.25, 0.72, 0.03, { bevel: 0.006, at: [0, 0.99, -0.02] }), G.box(0.3, 0.02, 0.2, { at: [0, 0.53, 0] }), G.box(0.05, 0.08, 0.04, { at: [0, 0.58, -0.02] })], k.mat('gloss', { color: 0x0b0c0d, name: 'Black gloss', roughness: 0.15 }), { parent: g });
  return g;
}
export function bookcase(k, parent, { at, rot, w = 1.0, h = 2.0, d = 0.32, name = 'Bookcase', seed = 3 } = {}) {
  const g = k.group(name, parent, { at, rot });
  const sh = [G.box(0.025, h, d, { at: [-w / 2 + 0.0125, h / 2, 0] }), G.box(0.025, h, d, { at: [w / 2 - 0.0125, h / 2, 0] }), G.box(w, 0.012, d, { at: [0, h / 2, -d / 2 + 0.006], rot: [90, 0, 0] })];
  const shelves = 5; for (let i = 0; i <= shelves; i++) sh.push(G.box(w - 0.05, 0.025, d - 0.01, { at: [0, 0.06 + i * (h - 0.09) / shelves, 0] }));
  sh[2] = G.box(w, h, 0.012, { at: [0, h / 2, -d / 2 + 0.006] });
  k.part('Shelves', sh, wood(k, 'walnut'), { parent: g });
  let r = seed * 9301 + 49297; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const cols = [0x7a2e2e, 0x2e4a7a, 0x2f5d3a, 0xc9a13b, 0x3b3b3b, 0xe2d6b8, 0x6a3f73, 0xa0522d];
  const byCol = cols.map(() => []);
  for (let i = 0; i < shelves; i++) {
    const y = 0.06 + i * (h - 0.09) / shelves + 0.0125; let x = -w / 2 + 0.04;
    while (x < w / 2 - 0.1) {
      const bw = 0.025 + rnd() * 0.035, bh = 0.2 + rnd() * 0.12, lean = rnd() > 0.92 ? 12 : 0;
      if (rnd() > 0.88) { x += 0.06; continue; }
      byCol[Math.floor(rnd() * cols.length)].push(G.box(bw, bh, 0.16 + rnd() * 0.06, { bevel: 0.003, at: [x + bw / 2, y + bh / 2, 0.02], rot: [0, 0, lean] }));
      x += bw + 0.003;
    }
  }
  byCol.forEach((geos, i) => { if (geos.length) k.part('Books', geos, k.mat('matte', { color: cols[i], name: 'Book cloth', roughness: 0.7 }), { parent: g }); });
  return g;
}
export function floorLamp(k, parent, { at, name = 'Floor lamp', light = true } = {}) {
  const g = k.group(name, parent, { at });
  k.part('Stand', [G.cyl(0.15, 0.025, { seg: 28 }), G.cyl(0.012, 1.45, { seg: 10, at: [0, 0.02, 0] })], 'brass', { parent: g });
  k.part('Shade', [G.cyl(0.2, 0.3, { r2: 0.14, seg: 32, open: true, at: [0, 1.38, 0] })], k.mat('fabric', { color: 0xefe3c8, name: 'Lampshade', side: THREE.DoubleSide, emissive: 0x5a4220, emissiveIntensity: 0.6 }), { parent: g });
  if (light) k.light('point', 'Lamp light', { parent: g, at: [0, 1.48, 0], color: 0xffd9a0, intensity: 3, distance: 6 });
  return g;
}
export function pendant(k, parent, { at, name = 'Pendant light', drop = 0.6, light = true } = {}) {
  const g = k.group(name, parent, { at });
  k.part('Cord', [G.cyl(0.004, drop, { seg: 6, at: [0, -drop, 0] }), G.cyl(0.05, 0.02, { seg: 16, at: [0, -0.02, 0] })], 'rubber', { parent: g });
  k.part('Shade', [G.lathe([[0.02, 0], [0.03, -0.02], [0.12, -0.12], [0.2, -0.24], [0.2, -0.25], [0.19, -0.25], [0.11, -0.13], [0.02, -0.03]], { seg: 32, at: [0, -drop, 0] })], k.mat('gloss', { color: 0x1f3b2c, name: 'Pendant shade', side: THREE.DoubleSide }), { parent: g });
  k.part('Bulb', [G.sphere(0.045, { seg: 16, at: [0, -drop - 0.12, 0] })], k.mat('light', { name: 'Bulb' }), { parent: g, shadow: false });
  if (light) k.light('point', 'Light', { parent: g, at: [0, -drop - 0.2, 0], color: 0xffe2b8, intensity: 6, distance: 8 });
  return g;
}
export function plant(k, parent, { at, s = 1, kind = 'round', name = 'Pot plant' } = {}) {
  const g = k.group(name, parent, { at, scale: s });
  k.part('Pot', [G.lathe([[0.0001, 0], [0.13, 0], [0.17, 0.32], [0.18, 0.33], [0.18, 0.36], [0.16, 0.36], [0.16, 0.34], [0.0001, 0.3]], { seg: 28 })], k.mat('terracotta', { name: 'Terracotta pot' }), { parent: g, uv: 'keep' });
  k.part('Soil', [G.cyl(0.155, 0.01, { seg: 24, at: [0, 0.32, 0] })], k.mat('matte', { color: 0x3b2a1e, name: 'Soil' }), { parent: g });
  const lm = k.texMat('Leaves (' + kind + ')', leafTexture(kind), { finish: 'leaf', alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6 });
  const cards = []; for (let i = 0; i < 9; i++) { const a = i * 40, t = 18 + (i % 3) * 22; cards.push(G.quad(0.55, 0.55, { at: [0, 0.62 + (i % 3) * 0.12, 0], rot: [t - 90 + 90, a, 0] })); }
  k.part('Leaves', cards, lm, { parent: g, uv: 'keep' });
  return g;
}

// ------------------------------------------------------------------------------- dining & study
export function chair(k, parent, { at, rot, name = 'Chair', color = null } = {}) {
  const g = k.group(name, parent, { at, rot });
  const m = color ? paint(k, color, 'Chair paint') : wood(k, 'oak');
  const geos = [G.box(0.44, 0.035, 0.42, { bevel: 0.01, at: [0, 0.46, 0] }), ...legs([-0.19, 0.19], [-0.17, 0.17], 0.45, 0.018, 0.015)];
  for (const s of [-1, 1]) geos.push(G.box(0.03, 0.48, 0.03, { bevel: 0.006, at: [s * 0.19, 0.7, -0.19], rot: [-6, 0, 0] }));
  for (const y of [0.62, 0.78, 0.9]) geos.push(G.box(0.38, 0.05, 0.02, { bevel: 0.006, at: [0, y, -0.2 - (y - 0.46) * 0.1], rot: [-6, 0, 0] }));
  k.part('Chair', geos, m, { parent: g });
  return g;
}
export function diningTable(k, parent, { at, rot, w = 1.8, d = 0.9, chairs = true, name = 'Dining table' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Top', [G.box(w, 0.045, d, { bevel: 0.012, at: [0, 0.75, 0] }), G.box(w - 0.16, 0.08, d - 0.16, { at: [0, 0.69, 0] })], wood(k, 'oak'), { parent: g });
  k.part('Legs', legs([-w / 2 + 0.07, w / 2 - 0.07], [-d / 2 + 0.07, d / 2 - 0.07], 0.73, 0.03, 0.025), wood(k, 'oak'), { parent: g });
  if (chairs) { const n = Math.max(1, Math.round(w / 0.62)); for (let i = 0; i < n; i++) { const x = -w / 2 + w / n * (i + 0.5); chair(k, g, { at: [x, 0, d / 2 + 0.05], rot: [0, 180, 0] }); chair(k, g, { at: [x, 0, -d / 2 - 0.05] }); } }
  return g;
}
export function desk(k, parent, { at, rot, w = 1.4, name = 'Desk & chair' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Desk', [G.box(w, 0.035, 0.7, { bevel: 0.008, at: [0, 0.74, 0] }), G.box(0.42, 0.7, 0.62, { bevel: 0.006, at: [w / 2 - 0.23, 0.37, 0] })], wood(k, 'oak'), { parent: g });
  k.part('Legs', [G.box(0.04, 0.72, 0.6, { at: [-w / 2 + 0.05, 0.36, 0] })], 'steel_dark', { parent: g });
  k.part('Drawer fronts', [0.18, 0.4, 0.62].map((y) => G.box(0.4, 0.2, 0.012, { bevel: 0.004, at: [w / 2 - 0.23, y, 0.316] })), paint(k, 0xe8e6e1, 'White drawers'), { parent: g });
  k.part('Laptop', [G.box(0.34, 0.015, 0.24, { bevel: 0.004, at: [-0.15, 0.765, 0.05] }), G.box(0.34, 0.22, 0.008, { bevel: 0.003, at: [-0.15, 0.88, -0.07], rot: [-15, 0, 0] })], 'aluminium', { parent: g });
  const c = k.group('Office chair', g, { at: [-0.15, 0, 0.62], rot: [0, 180, 0] });
  const base = []; for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; base.push(G.rod([0, 0.1, 0], [Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32], 0.02), G.sphere(0.03, { seg: 10, at: [Math.cos(a) * 0.32, 0.03, Math.sin(a) * 0.32] })); }
  base.push(G.cyl(0.025, 0.36, { at: [0, 0.1, 0] }));
  k.part('Base', base, 'steel_dark', { parent: c });
  k.part('Seat', [G.box(0.48, 0.08, 0.46, { bevel: 0.035, seg: 2, at: [0, 0.5, 0] }), G.box(0.44, 0.55, 0.06, { bevel: 0.03, seg: 2, at: [0, 0.86, -0.22], rot: [-8, 0, 0] })], k.mat('leather', { color: 0x1d1d1f, name: 'Black leather' }), { parent: c });
  return g;
}

// ------------------------------------------------------------------------------- bedroom
export function bed(k, parent, { at, rot, w = 1.53, l = 2.03, color = 0xe9e4da, accent = 0x41607a, name = 'Bed' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Base & headboard', [G.box(w + 0.06, 0.28, l + 0.04, { bevel: 0.02, at: [0, 0.22, 0] }), G.box(w + 0.1, 1.05, 0.08, { bevel: 0.03, at: [0, 0.53, -l / 2 - 0.04] })], fab(k, 0x6c6258, 'Bedhead fabric'), { parent: g });
  k.part('Legs', legs([-w / 2, w / 2], [-l / 2 + 0.05, l / 2 - 0.05], 0.08, 0.025, 0.02), wood(k, 'walnut'), { parent: g });
  k.part('Mattress', [G.box(w, 0.22, l, { bevel: 0.05, seg: 2, at: [0, 0.47, 0] })], k.mat('fabric', { color: 0xf4f2ee, name: 'Mattress' }), { parent: g });
  k.part('Duvet', [G.box(w + 0.08, 0.1, l * 0.72, { bevel: 0.05, seg: 3, at: [0, 0.6, l * 0.14] }), G.box(w + 0.08, 0.06, 0.34, { bevel: 0.03, seg: 2, at: [0, 0.67, -l * 0.2], rot: [0, 0, 0] })], k.mat('fabric', { color, name: 'Linen' }), { parent: g });
  k.part('Throw', [G.box(w + 0.12, 0.03, 0.5, { bevel: 0.015, seg: 2, at: [0, 0.665, l / 2 - 0.32] })], k.mat('fabric', { color: accent, name: 'Throw' }), { parent: g });
  k.part('Pillows', [-1, 1].map((s) => G.box(w / 2 - 0.08, 0.14, 0.42, { bevel: 0.065, seg: 3, at: [s * (w / 4), 0.65, -l / 2 + 0.3], rot: [-14, 0, 0] })), k.mat('fabric', { color: 0xffffff, name: 'Pillowcase' }), { parent: g });
  return g;
}
export function bedside(k, parent, { at, rot, lamp = true, name = 'Bedside table' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Table', [G.box(0.46, 0.5, 0.4, { bevel: 0.01, at: [0, 0.33, 0] })], wood(k, 'walnut'), { parent: g });
  k.part('Legs', legs([-0.2, 0.2], [-0.16, 0.16], 0.08), wood(k, 'walnut'), { parent: g });
  k.part('Drawer', [G.box(0.42, 0.18, 0.01, { bevel: 0.003, at: [0, 0.46, 0.2] }), G.box(0.12, 0.015, 0.02, { bevel: 0.005, at: [0, 0.46, 0.215] })], 'brass', { parent: g });
  if (lamp) {
    k.part('Lamp base', [G.lathe([[0.0001, 0], [0.07, 0], [0.09, 0.08], [0.06, 0.2], [0.02, 0.24], [0.0001, 0.24]], { seg: 24, at: [0, 0.58, 0] })], k.mat('porcelain', { color: 0x2f5d5a, name: 'Glazed ceramic' }), { parent: g });
    k.part('Lampshade', [G.cyl(0.14, 0.18, { r2: 0.1, seg: 28, open: true, at: [0, 0.8, 0] })], k.mat('fabric', { color: 0xf1e8d4, name: 'Lampshade', side: THREE.DoubleSide, emissive: 0x5a4220, emissiveIntensity: 0.6 }), { parent: g });
  }
  return g;
}
export function wardrobe(k, parent, { at, rot, w = 1.2, h = 2.1, name = 'Wardrobe' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Carcass', [G.box(w, h, 0.6, { bevel: 0.01, at: [0, h / 2 + 0.06, 0] }), G.box(w + 0.04, 0.04, 0.64, { bevel: 0.01, at: [0, h + 0.08, 0] })], wood(k, 'walnut'), { parent: g });
  k.part('Doors', [-1, 1].map((s) => G.box(w / 2 - 0.012, h - 0.04, 0.02, { bevel: 0.006, at: [s * w / 4, h / 2 + 0.06, 0.31] })), wood(k, 'walnut'), { parent: g });
  k.part('Handles', [-1, 1].map((s) => G.box(0.016, 0.3, 0.025, { bevel: 0.006, at: [s * 0.04, h / 2 + 0.1, 0.335] })), 'brass', { parent: g });
  return g;
}

// ------------------------------------------------------------------------------- kitchen & bathroom
export function kitchen(k, parent, { at, rot, w = 3.0, name = 'Kitchen' } = {}) {
  const g = k.group(name, parent, { at, rot });
  const doorM = paint(k, 0xe9e6df, 'Cabinet doors'), top = k.mat('marble', { name: 'Stone benchtop' });
  const n = Math.round(w / 0.6), cw = w / n;
  k.part('Base cabinets', [G.box(w, 0.78, 0.58, { at: [0, 0.49, 0] }), G.box(w, 0.1, 0.52, { at: [0, 0.05, -0.04] })], doorM, { parent: g });
  const doors = [], handles = [];
  for (let i = 0; i < n; i++) { const x = -w / 2 + cw * (i + 0.5); if (i === 1) continue; doors.push(G.box(cw - 0.006, 0.76, 0.018, { bevel: 0.004, at: [x, 0.49, 0.3] })); handles.push(G.box(0.25, 0.014, 0.025, { bevel: 0.006, at: [x, 0.8, 0.33] })); }
  k.part('Doors', doors, doorM, { parent: g });
  k.part('Handles', handles, 'steel', { parent: g });
  k.part('Benchtop', [G.box(w + 0.02, 0.04, 0.62, { bevel: 0.004, at: [0, 0.9, 0.01] })], top, { parent: g });
  const ox = -w / 2 + cw * 1.5;
  k.part('Oven', [G.box(cw - 0.01, 0.72, 0.02, { bevel: 0.004, at: [ox, 0.48, 0.3] }), G.box(cw - 0.06, 0.02, 0.02, { at: [ox, 0.78, 0.33] })], 'steel', { parent: g });
  k.part('Oven glass', [G.quad(cw - 0.14, 0.38, { at: [ox, 0.48, 0.312] })], k.mat('glass_tinted', { name: 'Oven glass', color: 0x0d0d0d, opacity: 1 }), { parent: g, shadow: false });
  k.part('Cooktop', [G.box(0.58, 0.008, 0.5, { at: [ox, 0.924, 0.01] })], k.mat('gloss', { color: 0x0a0a0a, name: 'Black glass', roughness: 0.05 }), { parent: g });
  k.part('Rings', [-1, 1].flatMap((sx) => [-1, 1].map((sz) => G.torus(0.08, 0.004, { at: [ox + sx * 0.14, 0.929, 0.01 + sz * 0.12], rot: [90, 0, 0], seg: 28 }))), k.mat('matte', { color: 0x5a5a5a, name: 'Ring markings' }), { parent: g, shadow: false });
  const sx = w / 2 - cw * 1.5;
  const sink = G.box(0.5, 0.2, 0.4, { at: [sx, 0.83, 0.01] });
  k.part('Sink', [G.box(0.54, 0.006, 0.44, { at: [sx, 0.922, 0.01] }), sink], 'steel', { parent: g });
  k.part('Tap', [G.cyl(0.02, 0.05, { at: [sx, 0.92, -0.2] }), G.tube([[sx, 0.97, -0.2], [sx, 1.25, -0.2], [sx, 1.3, -0.12], [sx, 1.2, -0.03]], 0.012, { seg: 20 })], 'chrome', { parent: g });
  k.part('Wall cabinets', [G.box(w, 0.7, 0.34, { bevel: 0.006, at: [0, 1.85, -0.12] })], doorM, { parent: g });
  k.part('Splashback', [G.box(w, 0.6, 0.01, { at: [0, 1.22, -0.285] })], 'tiles_white', { parent: g });
  k.part('Rangehood', [G.box(0.6, 0.12, 0.5, { bevel: 0.01, at: [ox, 1.45, -0.04] })], 'steel', { parent: g });
  return g;
}
export function fridge(k, parent, { at, rot, name = 'Fridge' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Body', [G.box(0.8, 1.8, 0.7, { bevel: 0.02, at: [0, 0.92, 0] })], 'steel', { parent: g });
  k.part('Doors', [G.box(0.39, 1.1, 0.04, { bevel: 0.01, at: [-0.2, 1.25, 0.37] }), G.box(0.39, 1.1, 0.04, { bevel: 0.01, at: [0.2, 1.25, 0.37] }), G.box(0.79, 0.6, 0.04, { bevel: 0.01, at: [0, 0.38, 0.37] })], 'steel', { parent: g });
  k.part('Handles', [G.cyl(0.012, 0.6, { at: [-0.04, 1.0, 0.42] }), G.cyl(0.012, 0.6, { at: [0.04, 1.0, 0.42] }), G.cyl(0.012, 0.5, { axis: 'x', at: [-0.25, 0.62, 0.42] })], 'chrome', { parent: g });
  return g;
}
export function clawfootBath(k, parent, { at, rot, name = 'Clawfoot bath', color = 0x1f3b2c } = {}) {
  const g = k.group(name, parent, { at, rot });
  const L = 1.7, W = 0.76, H = 0.62;
  const n = 40;
  const prof = (t) => { const a = t * Math.PI * 2; const x = Math.cos(a) * L / 2, z = Math.sin(a) * W / 2; const sq = Math.pow(Math.abs(Math.cos(a)), 0.45) * Math.sign(Math.cos(a)) * L / 2, sz = Math.pow(Math.abs(Math.sin(a)), 0.45) * Math.sign(Math.sin(a)) * W / 2; return [sq * 0.98 + x * 0.02, sz * 0.98 + z * 0.02]; };
  // tub: lofted rounded-rectangle rings (bottom smaller), with a rolled rim and an inner basin
  const rings = [[0.12, 0.82], [0.2, 0.93], [0.4, 0.99], [H, 1.0], [H + 0.025, 1.02], [H + 0.04, 0.99], [H - 0.02, 0.93], [0.24, 0.88], [0.18, 0.8]];
  const pos = [], idx = [];
  for (const [y, s] of rings) for (let i = 0; i < n; i++) { const [x, z] = prof(i / n); pos.push(x * s, y, z * s); }
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < n; i++) { const a = r * n + i, b = r * n + (i + 1) % n, c = a + n, d = b + n; idx.push(a, b, c, b, d, c); }
  const base = pos.length / 3; pos.push(0, 0.12, 0); for (let i = 0; i < n; i++) idx.push(base, (i + 1) % n, i);
  const base2 = pos.length / 3; pos.push(0, 0.18, 0); const last = (rings.length - 1) * n; for (let i = 0; i < n; i++) idx.push(base2, last + i, last + (i + 1) % n);
  const tub = new THREE.BufferGeometry(); tub.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tub.setIndex(idx); tub.computeVertexNormals();
  k.part('Tub', [tub], k.mat('porcelain', { color: 0xf6f4ef, name: 'Enamel' }), { parent: g });
  const feet = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) feet.push(G.lathe([[0.0001, 0], [0.05, 0], [0.06, 0.03], [0.035, 0.07], [0.04, 0.12], [0.06, 0.16], [0.0001, 0.17]], { seg: 14, at: [sx * (L / 2 - 0.22), 0, sz * (W / 2 - 0.15)] }));
  k.part('Feet', feet, 'brass', { parent: g });
  k.part('Tap', [G.cyl(0.015, 0.25, { at: [-L / 2 + 0.06, H, 0] }), G.tube([[-L / 2 + 0.06, H + 0.25, 0], [-L / 2 + 0.06, H + 0.32, 0], [-L / 2 + 0.16, H + 0.32, 0], [-L / 2 + 0.2, H + 0.25, 0]], 0.014, { seg: 16 })], 'brass', { parent: g });
  return g;
}
export function toilet(k, parent, { at, rot, name = 'Toilet' } = {}) {
  const g = k.group(name, parent, { at, rot });
  const por = k.mat('porcelain', { name: 'Porcelain' });
  k.part('Pan', [G.lathe([[0.0001, 0], [0.12, 0], [0.11, 0.12], [0.13, 0.3], [0.19, 0.4], [0.0001, 0.4]], { seg: 28, at: [0, 0, 0.08], scale: [1, 1, 1.25] })], por, { parent: g });
  k.part('Seat', [G.torus(0.15, 0.025, { at: [0, 0.42, 0.09], rot: [90, 0, 0], seg: 32, scale: [1, 1.25, 1] }), G.box(0.36, 0.03, 0.42, { bevel: 0.012, at: [0, 0.65, -0.2], rot: [-80, 0, 0] })], k.mat('plastic', { color: 0xfafafa, name: 'Seat plastic' }), { parent: g });
  k.part('Cistern', [G.box(0.38, 0.4, 0.18, { bevel: 0.03, seg: 2, at: [0, 0.6, -0.23] })], por, { parent: g });
  k.part('Button', [G.cyl(0.03, 0.01, { at: [0, 0.8, -0.23] })], 'chrome', { parent: g });
  return g;
}
export function vanity(k, parent, { at, rot, w = 0.9, name = 'Vanity' } = {}) {
  const g = k.group(name, parent, { at, rot });
  k.part('Cabinet', [G.box(w, 0.5, 0.46, { bevel: 0.01, at: [0, 0.6, 0] })], wood(k, 'oak'), { parent: g });
  k.part('Basin', [G.box(w - 0.04, 0.12, 0.42, { bevel: 0.03, seg: 2, at: [0, 0.91, 0.01] })], k.mat('porcelain', { name: 'Porcelain' }), { parent: g });
  k.part('Tap', [G.cyl(0.018, 0.12, { at: [0, 0.97, -0.15] }), G.tube([[0, 1.09, -0.15], [0, 1.12, -0.1], [0, 1.08, -0.05]], 0.012, { seg: 10 })], 'chrome', { parent: g });
  k.part('Mirror', [G.box(w - 0.1, 0.8, 0.02, { bevel: 0.006, at: [0, 1.6, -0.22] })], 'chrome', { parent: g });
  return g;
}

// ------------------------------------------------------------------------------- fireplace
export function fireplace(k, parent, { at, rot, name = 'Fireplace' } = {}) {
  const g = k.group(name, parent, { at, rot });
  const marble = k.mat('marble', { name: 'Marble' });
  const geos = [];
  for (const s of [-1, 1]) { geos.push(G.box(0.2, 1.05, 0.2, { bevel: 0.01, at: [s * 0.62, 0.525, 0] }), G.box(0.26, 0.12, 0.25, { bevel: 0.015, at: [s * 0.62, 1.1, 0] }), G.box(0.24, 0.1, 0.24, { bevel: 0.015, at: [s * 0.62, 0.05, 0] })); }
  geos.push(G.box(1.04, 0.22, 0.16, { bevel: 0.01, at: [0, 1.04, -0.02] }));
  geos.push(G.box(1.62, 0.06, 0.32, { bevel: 0.02, at: [0, 1.2, 0.02] }), G.box(1.5, 0.04, 0.28, { bevel: 0.01, at: [0, 1.15, 0.01] }));
  k.part('Mantel', geos, marble, { parent: g });
  const arch = []; for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; arch.push([Math.cos(a) * 0.36, 0.62 + Math.sin(a) * 0.3]); }
  k.part('Cast-iron insert', [G.extrude([[-0.52, 0], [0.52, 0], [0.52, 0.94], [-0.52, 0.94]], 0.05, { holes: [[[-0.36, 0.08], [0.36, 0.08], ...arch]], at: [0, 0, -0.06] }), G.span([-0.36, 0.0, -0.3], [0.36, 0.9, -0.28])], k.mat('iron', { name: 'Cast iron' }), { parent: g });
  k.part('Hearth', [G.box(1.6, 0.04, 0.5, { bevel: 0.006, at: [0, 0.02, 0.3] })], 'tessellated', { parent: g });
  k.part('Grate & coals', [G.span([-0.25, 0.05, -0.25], [0.25, 0.2, -0.05]), ...Array.from({ length: 12 }, (_, i) => G.sphere(0.04 + (i % 3) * 0.01, { seg: 8, at: [-0.2 + (i % 6) * 0.08, 0.22 + Math.floor(i / 6) * 0.04, -0.18 + (i % 2) * 0.06] }))], k.mat('matte', { color: 0x1a1412, name: 'Coal', emissive: 0x6a1d05, emissiveIntensity: 0.8 }), { parent: g });
  return g;
}

const one = (fn, o = {}) => (k) => { fn(k, k.root, o); return k; };
export default [
  { id: 'f_sofa', name: 'Three-seat Sofa', category: 'Furniture', env: 'INTERIOR', tags: ['sofa', 'couch', 'living room', 'fabric'], desc: 'Upholstered sofa with separate seat and back cushions on timber legs.', build: one(sofa) },
  { id: 'f_armchair', name: 'Armchair', category: 'Furniture', env: 'INTERIOR', tags: ['chair', 'living room'], desc: 'Matching single armchair.', build: one(armchair, { color: 0x8a5a3c }) },
  { id: 'f_coffee_table', name: 'Coffee Table', category: 'Furniture', env: 'INTERIOR', tags: ['table', 'walnut'], desc: 'Walnut coffee table with lower shelf.', build: one(coffeeTable) },
  { id: 'f_dining', name: 'Dining Set', category: 'Furniture', env: 'INTERIOR', tags: ['dining table', 'chairs', 'oak'], desc: 'Oak dining table with six chairs.', build: one(diningTable) },
  { id: 'f_chair', name: 'Dining Chair', category: 'Furniture', env: 'INTERIOR', tags: ['chair', 'oak'], desc: 'Slat-back timber chair.', build: one(chair) },
  { id: 'f_bed', name: 'Queen Bed', category: 'Furniture', env: 'INTERIOR', tags: ['bed', 'bedroom', 'pillows', 'duvet'], desc: 'Upholstered bed with mattress, duvet, throw and pillows.', build: one(bed) },
  { id: 'f_bedside', name: 'Bedside Table & Lamp', category: 'Furniture', env: 'INTERIOR', tags: ['bedside', 'lamp', 'bedroom'], desc: 'Walnut bedside table with drawer and ceramic lamp.', build: one(bedside) },
  { id: 'f_wardrobe', name: 'Wardrobe', category: 'Furniture', env: 'INTERIOR', tags: ['wardrobe', 'cupboard', 'bedroom'], desc: 'Two-door walnut wardrobe.', build: one(wardrobe) },
  { id: 'f_bookcase', name: 'Bookcase', category: 'Furniture', env: 'INTERIOR', tags: ['books', 'shelves', 'library'], desc: 'Tall bookcase filled with books.', build: one(bookcase) },
  { id: 'f_desk', name: 'Desk & Office Chair', category: 'Furniture', env: 'INTERIOR', tags: ['desk', 'office', 'study', 'laptop'], desc: 'Oak desk with drawers, laptop and swivel chair.', build: one(desk) },
  { id: 'f_tv', name: 'TV & Cabinet', category: 'Furniture', env: 'INTERIOR', tags: ['tv', 'television', 'media'], desc: 'Low media cabinet with flat-screen TV.', build: one(tvUnit) },
  { id: 'f_kitchen', name: 'Kitchen Run', category: 'Furniture', env: 'INTERIOR', tags: ['kitchen', 'cabinets', 'sink', 'oven', 'benchtop'], desc: '3 m kitchen: cabinets, stone benchtop, sink, oven, cooktop, rangehood and wall cupboards.', build: one(kitchen) },
  { id: 'f_fridge', name: 'Fridge', category: 'Furniture', env: 'INTERIOR', tags: ['fridge', 'refrigerator', 'kitchen'], desc: 'Stainless French-door fridge.', build: one(fridge) },
  { id: 'f_clawfoot', name: 'Clawfoot Bath', category: 'Furniture', env: 'INTERIOR', tags: ['bath', 'bathroom', 'victorian'], desc: 'Freestanding enamel bath on brass feet.', build: one(clawfootBath) },
  { id: 'f_toilet', name: 'Toilet', category: 'Furniture', env: 'INTERIOR', tags: ['toilet', 'bathroom', 'wc'], desc: 'Close-coupled toilet suite.', build: one(toilet) },
  { id: 'f_vanity', name: 'Vanity & Mirror', category: 'Furniture', env: 'INTERIOR', tags: ['vanity', 'basin', 'bathroom', 'mirror'], desc: 'Timber vanity, basin, tap and mirror.', build: one(vanity) },
  { id: 'f_fireplace', name: 'Victorian Fireplace', category: 'Furniture', env: 'INTERIOR', tags: ['fireplace', 'mantel', 'marble', 'victorian'], desc: 'Marble mantelpiece with arched cast-iron insert, glowing coals and tiled hearth.', build: one(fireplace) },
  { id: 'f_floor_lamp', name: 'Floor Lamp', category: 'Furniture', env: 'INTERIOR', tags: ['lamp', 'light'], desc: 'Brass floor lamp with fabric shade and a real light.', build: one(floorLamp) },
  { id: 'f_pendant', name: 'Pendant Light', category: 'Furniture', env: 'INTERIOR', tags: ['light', 'pendant', 'ceiling'], desc: 'Enamel pendant with bulb and light source.', build: (k) => { pendant(k, k.root, { at: [0, 2.6, 0] }); return k; } },
  { id: 'f_plant', name: 'Pot Plant', category: 'Furniture', env: 'INTERIOR', tags: ['plant', 'pot', 'indoor'], desc: 'Leafy plant in a terracotta pot.', build: one(plant) },
  { id: 'f_rug', name: 'Rug', category: 'Furniture', env: 'INTERIOR', tags: ['rug', 'carpet'], desc: 'Wool rug with border.', build: one(rug) },
];
