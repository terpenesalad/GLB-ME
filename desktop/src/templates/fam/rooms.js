// Rooms (rectangular, L-shaped, hexagonal bay, round, attic, hallway…), furnished interiors and a
// modular building kit (2 m wall pieces with door/window openings, floors, stairs, columns, arches).
// Rooms are open-topped for easy viewing – each has a ceiling you can show from the Layers panel.
import * as THREE from 'three';
import { G, csg, slabXZ, xf } from '../kit.js';
import * as A from '../arch.js';
import * as F from './furniture.js';

const H = A.HERITAGE;

/** Offsets a closed polygon [[x,z]…] outward by d (assumes counter-clockwise in x–z). */
function offsetPoly(pts, d) {
  const n = pts.length, out = [];
  let area = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const s = area > 0 ? 1 : -1; // outward normal sign
  const lines = pts.map((a, i) => { const b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); const nx = s * dz / l, nz = -s * dx / l; return { p: [a[0] + nx * d, a[1] + nz * d], d: [dx / l, dz / l] }; });
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    const det = L1.d[0] * L2.d[1] - L1.d[1] * L2.d[0];
    if (Math.abs(det) < 1e-9) { out.push(L2.p); continue; }
    const t = ((L2.p[0] - L1.p[0]) * L2.d[1] - (L2.p[1] - L1.p[1]) * L2.d[0]) / det;
    out.push([L1.p[0] + L1.d[0] * t, L1.p[1] + L1.d[1] * t]);
  }
  return out;
}
const polyArea = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

/**
 * Room from a plan polygon. o: h, t (wall thickness), wall/floor materials & colours, openings
 * [{ edge, at (metres from the edge start to the opening centre), w, h, y, kind: 'door' | 'window' | 'arch' | 'gap', style }].
 */
export function room(k, o) {
  const pts = polyArea(o.plan) > 0 ? o.plan.slice() : o.plan.slice().reverse();
  const n = pts.length, h = o.h ?? 2.7, t = o.t ?? 0.12, root = k.root;
  const wallM = k.mat(o.wallMat || 'render', { color: o.wallColor ?? 0xf1ece2, name: 'Wall paint' });
  const outer = offsetPoly(pts, t);
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, z))); shape.holes.push(new THREE.Path(pts.map(([x, z]) => new THREE.Vector2(x, z))));
  let ring = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 24 }); ring.rotateX(Math.PI / 2); ring.translate(0, h, 0);
  const ops = (o.openings || []).map((op) => {
    const a = pts[op.edge % n], b = pts[(op.edge + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    const c = [a[0] + ux * op.at, a[1] + uz * op.at];
    const nx = uz, nz = -ux; // outward (plan is counter-clockwise)
    const rotY = Math.atan2(nx, nz) * 180 / Math.PI;
    const y = op.y ?? (op.kind === 'window' ? 0.9 : 0), oh = op.h ?? (op.kind === 'window' ? 1.4 : 2.1), ow = op.w ?? (op.kind === 'window' ? 1.2 : 0.9);
    return { ...op, c, nx, nz, rotY, y, oh, ow, ux, uz };
  });
  if (ops.length) ring = csg(ring, ops.map((op) => xf(op.arch ? G.extrude(A.openingPoints({ x: -op.ow / 2, y: op.y, w: op.ow, h: op.oh, arch: op.arch }, 24), t * 4, { center: true }) : G.box(op.ow, op.oh, t * 4, { at: [0, op.y + op.oh / 2, 0] }), { at: [op.c[0], 0, op.c[1]], rot: [0, op.rotY, 0] })));
  const walls = k.group('Walls', root);
  k.part('Walls', [ring], wallM, { parent: walls, collision: 'col' });
  // skirting & cornice (skirting breaks at doorways)
  const trim = k.mat('paint_timber', { color: o.trim ?? H.white, name: 'Trim paint' });
  const sk = [], corn = [];
  const loop = pts.concat([pts[0]]);
  const gaps = ops.filter((op) => op.kind !== 'window' && op.y < 0.2);
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let segs = [[0, L]];
    for (const g of gaps.filter((g) => g.edge % n === i)) { const g0 = g.at - g.ow / 2 - 0.02, g1 = g.at + g.ow / 2 + 0.02; segs = segs.flatMap(([s0, s1]) => (g1 <= s0 || g0 >= s1 ? [[s0, s1]] : [[s0, g0], [g1, s1]].filter(([p, q]) => q - p > 0.03))); }
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    for (const [s0, s1] of segs) sk.push(G.sweep(A.SKIRTING, [[a[0] + ux * (s0 - (s0 === 0 ? 0.0 : 0)), 0, a[1] + uz * s0], [a[0] + ux * s1, 0, a[1] + uz * s1]]));
  }
  const cove = [[0, 0], [0.13, 0], [0.13, -0.012], [0.09, -0.022], [0.05, -0.04], [0.02, -0.07], [0.006, -0.1], [0, -0.13]];
  corn.push(G.sweep(cove, loop.slice(0, -1).map(([x, z]) => [x, h, z]), { closed: true }));
  k.part('Skirting', sk, trim, { parent: walls });
  k.part('Cornice', corn, k.mat('render', { color: 0xf8f5ee, name: 'Ceiling paint' }), { parent: walls });
  // floor & (hidden) ceiling
  const fl = k.group('Floor & ceiling', root);
  k.part('Floor', [slabXZ(outer, -0.06, 0)], o.floorMat || 'floorboards', { parent: fl, collision: 'col', matOpts: o.floorColor ? { color: o.floorColor } : undefined });
  const ceil = k.part('Ceiling', [slabXZ(outer, h, h + 0.05)], k.mat('render', { color: 0xf8f5ee, name: 'Ceiling paint' }), { parent: fl });
  ceil.visible = false;
  // doors & windows in the openings
  const op3 = k.group('Doors & windows', root);
  for (const op of ops) {
    const at = [op.c[0] + op.nx * t, op.y, op.c[1] + op.nz * t];
    if (op.kind === 'door') { A.doorway(k, op3, { name: op.name || 'Door', at, rot: [0, op.rotY, 0], w: op.ow, h: op.oh, style: op.style || 'panel4', color: op.color ?? H.white, frame: o.trim ?? H.white, metal: 'brass', inset: (t - 0.14) / 2, open: op.open ?? 0, double: op.double, fan: op.fan || 0 }); }
    else if (op.kind === 'window') A.sashWindow(k, op3, { name: op.name || 'Window', at, rot: [0, op.rotY, 0], w: op.ow, h: op.oh, arch: op.arch, frame: o.trim ?? H.white, inset: (t - 0.13) / 2, sill: null, open: op.open || 0 });
    if (op.kind !== 'gap') {
      // interior architrave
      const ia = [op.c[0] - op.nx * 0.0, 0, op.c[1] - op.nz * 0.0];
      const g = k.group('Architrave', op3, { at: ia, rot: [0, op.rotY + 180, 0] });
      k.part('Architrave', [A.surround({ x: -op.ow / 2, y: op.y, w: op.ow, h: op.oh, arch: op.arch }, A.ARCHITRAVE, 0)], trim, { parent: g });
      if (op.kind === 'window') k.part('Window board', [G.span([-op.ow / 2 - 0.08, op.y - 0.03, -t + 0.02], [op.ow / 2 + 0.08, op.y, 0.04], { bevel: 0.005 })], trim, { parent: g });
    }
  }
  if (o.light !== false) { const c = pts.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]); F.pendant(k, k.group('Lighting', root), { at: [c[0], h, c[1]], drop: 0.55 }); }
  return { pts, h, t, ops };
}

// ------------------------------------------------------------------------------- room presets
const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
// edges of rect: 0 = back (z = -d/2), 1 = right (x = +w/2), 2 = front (z = +d/2), 3 = left
function livingRoom(k) {
  room(k, { plan: rect(5.2, 4.4), h: 3.2, wallColor: 0xe9dfcc, trim: H.white, openings: [{ edge: 0, at: 1.3, kind: 'window', w: 1.1, h: 2.0, y: 0.75 }, { edge: 0, at: 3.9, kind: 'window', w: 1.1, h: 2.0, y: 0.75 }, { edge: 3, at: 3.4, kind: 'door', w: 0.94, h: 2.25, open: 30 }] });
  const f = k.group('Furniture', k.root);
  F.fireplace(k, f, { at: [2.58, 0, 0], rot: [0, -90, 0] });
  F.sofa(k, f, { at: [-0.9, 0, 0], rot: [0, 90, 0], color: 0x4b5d52 });
  F.armchair(k, f, { at: [0.6, 0, 1.55], rot: [0, 200, 0], color: 0x8a5a3c });
  F.coffeeTable(k, f, { at: [0.3, 0, 0], rot: [0, 90, 0] });
  F.rug(k, f, { at: [0.4, 0, 0], rot: [0, 90, 0] });
  F.bookcase(k, f, { at: [-2.4, 0, -1.55], rot: [0, 90, 0] });
  F.floorLamp(k, f, { at: [-2.1, 0, 1.6] });
  F.plant(k, f, { at: [2.2, 0, -1.8] });
  return k;
}
function bedroom(k) {
  room(k, { plan: rect(4.0, 3.8), h: 2.9, wallColor: 0xdfe5e8, trim: H.white, floorMat: 'carpet', floorColor: 0xb7ab98, openings: [{ edge: 1, at: 1.9, kind: 'window', w: 1.2, h: 1.6, y: 0.9 }, { edge: 2, at: 0.8, kind: 'door', w: 0.86, h: 2.1, style: 'panel4', open: 60 }] });
  const f = k.group('Furniture', k.root);
  F.bed(k, f, { at: [-0.4, 0, -0.85] });
  F.bedside(k, f, { at: [-1.5, 0, -1.65] }); F.bedside(k, f, { at: [0.7, 0, -1.65], lamp: false });
  F.wardrobe(k, f, { at: [-1.65, 0, 1.15], rot: [0, 90, 0] });
  F.rug(k, f, { at: [-0.4, 0, 0.3], w: 2.0, d: 1.4, color: 0x41607a });
  F.plant(k, f, { at: [1.6, 0, 1.6], s: 0.8 });
  return k;
}
function kitchenRoom(k) {
  room(k, { plan: rect(4.4, 3.6), h: 2.8, wallColor: 0xf3f0ea, trim: H.white, floorMat: 'tiles_floor', openings: [{ edge: 0, at: 3.4, kind: 'window', w: 1.0, h: 1.1, y: 1.15 }, { edge: 2, at: 3.4, kind: 'gap', w: 1.2, h: 2.2 }] });
  const f = k.group('Furniture', k.root);
  F.kitchen(k, f, { at: [-0.5, 0, -1.48], w: 3.0 });
  F.fridge(k, f, { at: [1.55, 0, -1.43] });
  F.diningTable(k, f, { at: [-0.5, 0, 0.55], w: 1.6, d: 0.85 });
  return k;
}
function bathroom(k) {
  room(k, { plan: rect(2.8, 2.6), h: 2.7, wallMat: 'tiles_white', wallColor: 0xffffff, trim: H.white, floorMat: 'tessellated', openings: [{ edge: 1, at: 1.0, kind: 'window', w: 0.7, h: 0.9, y: 1.3 }, { edge: 2, at: 2.2, kind: 'door', w: 0.82, h: 2.05, open: 70 }] });
  const f = k.group('Fittings', k.root);
  F.clawfootBath(k, f, { at: [-0.4, 0, -0.8] });
  F.toilet(k, f, { at: [1.0, 0, -0.95] });
  F.vanity(k, f, { at: [-1.13, 0, 0.6], rot: [0, 90, 0], w: 0.8 });
  return k;
}
function study(k) {
  room(k, { plan: rect(3.4, 3.2), h: 2.9, wallColor: 0x2f4a3a, trim: H.cream, openings: [{ edge: 0, at: 1.7, kind: 'window', w: 1.2, h: 1.7, y: 0.85 }, { edge: 3, at: 2.4, kind: 'door', w: 0.86, h: 2.1, open: 20 }] });
  const f = k.group('Furniture', k.root);
  F.desk(k, f, { at: [0, 0, -1.15] });
  F.bookcase(k, f, { at: [1.52, 0, 0.2], rot: [0, -90, 0], seed: 7 }); F.bookcase(k, f, { at: [1.52, 0, -0.85], rot: [0, -90, 0], seed: 11 });
  F.armchair(k, f, { at: [-0.9, 0, 0.9], rot: [0, 140, 0], color: 0x6b3a2a });
  F.rug(k, f, { at: [0, 0, 0.2], w: 2.0, d: 1.5, color: 0x6b2a20 });
  return k;
}

const ROOMS = [
  { id: 'room_living', name: 'Victorian Living Room', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'interior', 'living room', 'lounge', 'fireplace', 'furnished'], desc: 'High-ceilinged sitting room: fireplace, sofa, armchair, bookcase, rug, lamps, sash windows and a panelled door.', build: livingRoom },
  { id: 'room_bedroom', name: 'Bedroom', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'interior', 'bedroom', 'furnished', 'bed'], desc: 'Furnished bedroom with queen bed, bedsides, wardrobe and window.', build: bedroom },
  { id: 'room_kitchen', name: 'Kitchen & Dining', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'interior', 'kitchen', 'dining', 'furnished'], desc: 'Kitchen run with fridge and a dining setting.', build: kitchenRoom },
  { id: 'room_bathroom', name: 'Bathroom', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'interior', 'bathroom', 'clawfoot', 'tiles'], desc: 'Tiled bathroom with clawfoot bath, toilet and vanity on a tessellated floor.', build: bathroom },
  { id: 'room_study', name: 'Study', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'interior', 'study', 'office', 'library'], desc: 'Dark green study lined with books, desk and reading chair.', build: study },
  { id: 'room_empty', name: 'Empty Room', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'empty', 'rectangular', 'blank'], desc: '4 × 5 m room with door and two windows, ready to furnish.', build: (k) => { room(k, { plan: rect(5, 4), openings: [{ edge: 0, at: 2.5, kind: 'window' }, { edge: 1, at: 1.0, kind: 'window', w: 0.9 }, { edge: 2, at: 1.0, kind: 'door' }] }); return k; } },
  { id: 'room_l', name: 'L-shaped Room', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'l-shaped', 'open plan'], desc: 'Open-plan L-shaped room with three windows and a door.', build: (k) => { room(k, { plan: [[-3, -3], [3, -3], [3, 0], [0, 0], [0, 3], [-3, 3]], floorMat: 'oak', openings: [{ edge: 0, at: 1.5, kind: 'window' }, { edge: 0, at: 4.5, kind: 'window' }, { edge: 1, at: 1.5, kind: 'window', w: 1.0 }, { edge: 4, at: 1.5, kind: 'door' }] }); return k; } },
  { id: 'room_hex', name: 'Bay-window Room', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'bay window', 'angled', 'hexagonal'], desc: 'Room ending in a three-window canted bay.', build: (k) => { room(k, { plan: [[-2.2, -2.5], [2.2, -2.5], [2.2, 1.2], [1.0, 2.4], [-1.0, 2.4], [-2.2, 1.2]], h: 3.0, openings: [{ edge: 2, at: 0.85, kind: 'window', w: 0.8, h: 1.9, y: 0.6 }, { edge: 3, at: 1.0, kind: 'window', w: 1.1, h: 1.9, y: 0.6 }, { edge: 4, at: 0.85, kind: 'window', w: 0.8, h: 1.9, y: 0.6 }, { edge: 0, at: 1.0, kind: 'door' }] }); return k; } },
  { id: 'room_round', name: 'Round Room', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'round', 'circular', 'tower', 'turret'], desc: 'Circular turret room with arched windows.', build: (k) => { const p = []; for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; p.push([Math.cos(a) * 2.5, Math.sin(a) * 2.5]); } room(k, { plan: p, h: 3.0, floorMat: 'marble', openings: [0, 5, 10].map((e) => ({ edge: e, at: 0.39, kind: 'window', w: 0.6, h: 1.6, y: 0.9 })).concat([{ edge: 15, at: 0.39, kind: 'gap', w: 0.7, h: 2.1 }]) }); return k; } },
  { id: 'room_hallway', name: 'Long Hallway', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'hallway', 'corridor', 'arch', 'doors'], desc: 'Victorian hallway with an arch and four doors off it.', build: (k) => { room(k, { plan: rect(1.4, 9), h: 3.2, floorMat: 'tessellated', wallColor: 0xe0d2b6, openings: [{ edge: 1, at: 2.0, kind: 'door' }, { edge: 1, at: 6.5, kind: 'door' }, { edge: 3, at: 2.5, kind: 'door' }, { edge: 3, at: 7.0, kind: 'door' }, { edge: 2, at: 0.7, kind: 'door', w: 1.0, h: 2.6, fan: 0.4 }] }); const a = k.group('Arch', k.root); k.part('Arch', [G.wall(1.4, 3.2, 0.14, [{ x: 0.15, y: 0, w: 1.1, h: 2.75, arch: 'round' }], { at: [-0.7, 0, 0] })], 'render', { parent: a, matOpts: { color: 0xe0d2b6, name: 'Wall paint' } }); return k; } },
  { id: 'room_attic', name: 'Attic Room', category: 'Rooms', env: 'INTERIOR', tags: ['room', 'attic', 'loft', 'sloped ceiling', 'skylight'], desc: 'Loft with raked ceilings, exposed rafters and a dormer-style window.', build: (k) => attic(k) },
];

function attic(k) {
  const W = 5, D = 4, kh = 1.2, pitch = 40, root = k.root;
  const rise = (W / 2) * Math.tan(pitch * Math.PI / 180);
  const g = k.group('Attic', root);
  k.part('Floor', [G.span([-W / 2, -0.06, -D / 2], [W / 2, 0, D / 2])], 'floorboards', { parent: g, collision: 'col' });
  k.part('Knee walls', [G.span([-W / 2 - 0.1, 0, -D / 2], [-W / 2, kh, D / 2]), G.span([W / 2, 0, -D / 2], [W / 2 + 0.1, kh, D / 2])], k.mat('render', { color: 0xf3efe6, name: 'Wall paint' }), { parent: g });
  const gable = [[-W / 2 - 0.1, 0], [W / 2 + 0.1, 0], [W / 2 + 0.1, kh], [0, kh + rise], [-W / 2 - 0.1, kh]];
  k.part('Gable wall', [csg(G.extrude(gable, 0.12, { at: [0, 0, -D / 2 - 0.12] }), [G.box(1.0, 1.2, 1, { at: [0, kh + 0.6, -D / 2] })])], k.mat('render', { color: 0xf3efe6, name: 'Wall paint' }), { parent: g });
  A.casementWindow(k, g, { name: 'Gable window', at: [0, kh, -D / 2 - 0.12], rot: [0, 180, 0], w: 1.0, h: 1.2, inset: 0.0, frame: H.white, bars: [2, 2] });
  const slope = Math.hypot(W / 2, rise), ang = Math.atan2(rise, W / 2) * 180 / Math.PI;
  const ceil = []; for (const s of [-1, 1]) ceil.push(G.box(slope + 0.1, 0.03, D, { at: [s * W / 4, kh + rise / 2 + 0.02, 0], rot: [0, 0, -s * ang] }));
  k.part('Raked ceiling', ceil, k.mat('paint_timber', { color: 0xf6f2e9, name: 'Lining boards' }), { parent: g });
  const raf = []; for (let z = -D / 2 + 0.3; z < D / 2; z += 0.6) for (const s of [-1, 1]) raf.push(G.box(slope, 0.17, 0.06, { at: [s * W / 4, kh + rise / 2 - 0.07, z], rot: [0, 0, -s * ang] }));
  raf.push(G.box(0.05, 0.22, D, { at: [0, kh + rise - 0.1, 0] }));
  k.part('Rafters', raf, 'oak', { parent: g });
  const f = k.group('Furniture', root);
  F.bed(k, f, { at: [0, 0, 0.6], rot: [0, 180, 0], w: 1.4, l: 2.0, color: 0xe8e1d0, accent: 0x7b2f27 });
  F.plant(k, f, { at: [1.9, 0, -1.6], s: 0.8 });
  F.pendant(k, k.group('Lighting', root), { at: [0, kh + rise - 0.1, 0], drop: 0.9 });
  return k;
}

// ------------------------------------------------------------------------------- building kit
const KIT_H = 3.0, KIT_T = 0.2;
function kitWall(k, kind) {
  const w = 2, root = k.root, mat = 'brick_red', inner = k.mat('render', { color: 0xf1ece2, name: 'Wall paint' });
  const holes = kind === 'door' ? [{ x: 0.5, y: 0, w: 1.0, h: 2.2 }] : kind === 'window' ? [{ x: 0.45, y: 0.9, w: 1.1, h: 1.5 }] : kind === 'arch' ? [{ x: 0.4, y: 0, w: 1.2, h: 2.5, arch: 'round' }] : [];
  const g = k.group('Wall', root);
  k.part('Brick face', [G.wall(w, KIT_H, KIT_T * 0.6, holes, { at: [-w / 2, 0, KIT_T * 0.2] })], mat, { parent: g, collision: 'col' });
  k.part('Plaster face', [G.wall(w, KIT_H, KIT_T * 0.4, holes, { at: [-w / 2, 0, -KIT_T * 0.3] })], inner, { parent: g });
  if (kind === 'door') A.doorway(k, g, { at: [0, 0, KIT_T / 2], w: 1.0, h: 2.2, style: 'panel4', color: H.brunswick, frame: H.cream, inset: 0.03 });
  if (kind === 'window') A.sashWindow(k, g, { at: [0, 0.9, KIT_T / 2], w: 1.1, h: 1.5, frame: H.cream, sill: 'stone', inset: 0.05 });
  return k;
}
export const kitPieces = [
  { id: 'kit_wall', name: 'Wall 2 m', desc: '2 × 3 m wall panel: brick outside, plaster inside. Snap at 2 m.', build: (k) => kitWall(k, 'plain') },
  { id: 'kit_wall_door', name: 'Wall with Door', desc: '2 m wall panel with a panelled door.', build: (k) => kitWall(k, 'door') },
  { id: 'kit_wall_window', name: 'Wall with Window', desc: '2 m wall panel with a sash window.', build: (k) => kitWall(k, 'window') },
  { id: 'kit_wall_arch', name: 'Wall with Arch', desc: '2 m wall panel with a round-arched opening.', build: (k) => kitWall(k, 'arch') },
  { id: 'kit_corner', name: 'Corner Pillar', desc: 'Brick corner pier for joining wall panels.', build: (k) => { k.part('Pier', [G.span([-KIT_T / 2 - 0.05, 0, -KIT_T / 2 - 0.05], [KIT_T / 2 + 0.05, KIT_H, KIT_T / 2 + 0.05])], 'brick_red', { parent: k.root, collision: 'col' }); return k; } },
  { id: 'kit_floor', name: 'Floor Tile 2 × 2 m', desc: 'Floorboards on a 2 m grid.', build: (k) => { k.part('Floor', [G.span([-1, -0.1, -1], [1, 0, 1])], 'floorboards', { parent: k.root, collision: 'col' }); return k; } },
  { id: 'kit_floor_tiles', name: 'Tiled Floor 2 × 2 m', desc: 'Tessellated tile floor piece.', build: (k) => { k.part('Floor', [G.span([-1, -0.1, -1], [1, 0, 1])], 'tessellated', { parent: k.root, collision: 'col' }); return k; } },
  { id: 'kit_stairs', name: 'Staircase', desc: 'Straight timber stair (3 m rise) with balusters and handrail.', build: (k) => stairs(k) },
  { id: 'kit_column', name: 'Classical Column', desc: 'Tuscan column with base and capital, 3 m.', build: (k) => { k.part('Column', [G.box(0.5, 0.12, 0.5, { bevel: 0.01, at: [0, 0.06, 0] }), G.lathe([[0.0001, 0.12], [0.22, 0.12], [0.22, 0.18], [0.19, 0.22], [0.17, 0.3], [0.15, KIT_H - 0.35], [0.17, KIT_H - 0.28], [0.21, KIT_H - 0.2], [0.0001, KIT_H - 0.2]], { seg: 32 }), G.box(0.5, 0.2, 0.5, { bevel: 0.01, at: [0, KIT_H - 0.1, 0] })], k.mat('render', { color: 0xe9dfc6, name: 'Stucco' }), { parent: k.root, collision: 'convcol' }); return k; } },
  { id: 'kit_railing', name: 'Balustrade 2 m', desc: 'Turned timber balusters with handrail.', build: (k) => { const g = []; for (let i = 0; i < 13; i++) g.push(G.lathe([[0.0001, 0], [0.025, 0], [0.025, 0.08], [0.018, 0.12], [0.03, 0.4], [0.018, 0.7], [0.025, 0.82], [0.025, 0.9], [0.0001, 0.9]], { seg: 12, at: [-0.96 + i * 0.16, 0.05, 0] })); g.push(G.span([-1, 0, -0.05], [1, 0.05, 0.05]), G.box(2, 0.07, 0.1, { bevel: 0.02, at: [0, 0.98, 0] })); k.part('Balustrade', g, k.mat('paint_timber', { color: H.white, name: 'Trim paint' }), { parent: k.root }); return k; } },
].map((t) => ({ ...t, category: 'Building kit', env: 'DAYLIGHT', tags: ['modular', 'kit', 'snap', ...t.name.toLowerCase().split(/\W+/)] }));

function stairs(k) {
  const n = 16, rise = KIT_H / n, run = 0.26, w = 1.0, root = k.root;
  const treads = [], strings = [], bal = [];
  for (let i = 0; i < n; i++) { treads.push(G.box(w, 0.035, run + 0.03, { bevel: 0.006, at: [0, rise * (i + 1) - 0.017, -i * run] })); treads.push(G.box(w - 0.02, rise - 0.035, 0.02, { at: [0, rise * i + rise / 2 - 0.02, -i * run + run / 2] })); }
  const L = Math.hypot(n * run, KIT_H), ang = Math.atan2(KIT_H, n * run) * 180 / Math.PI;
  for (const s of [-1, 1]) strings.push(G.box(0.05, 0.3, L, { at: [s * (w / 2 + 0.025), KIT_H / 2 - 0.05, -(n - 1) * run / 2], rot: [ang, 0, 0] }));
  for (let i = 0; i < n; i++) bal.push(G.cyl(0.018, 0.9, { seg: 8, at: [w / 2 + 0.025, rise * (i + 1), -i * run] }));
  bal.push(G.rod([w / 2 + 0.025, rise + 0.9, 0.1], [w / 2 + 0.025, KIT_H + 0.9, -(n - 1) * run - 0.1], 0.03));
  bal.push(G.lathe([[0.0001, 0], [0.06, 0], [0.06, 1.0], [0.07, 1.05], [0.04, 1.12], [0.0001, 1.15]], { seg: 16, at: [w / 2 + 0.025, 0, 0.15] }));
  k.part('Treads & risers', treads, 'oak', { parent: root, collision: 'col' });
  k.part('Stringers', strings, k.mat('paint_timber', { color: H.white, name: 'Trim paint' }), { parent: root });
  k.part('Balusters & rail', bal, 'walnut', { parent: root });
  return k;
}

export default [...ROOMS, ...kitPieces];
