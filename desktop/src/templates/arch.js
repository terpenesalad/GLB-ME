// Architectural components shared by the template families: sash & casement windows, panelled
// doors with fanlights, cast-iron posts and lace, bullnose verandahs with real corrugations,
// mouldings, chimneys, roofs, fences and gutters. Components face +Z; `at` is the bottom centre of
// the opening on the wall's outer face unless noted.
import * as THREE from 'three';
import { G, xf, openingPoints } from './kit.js';
import { laceTexture, leadlightTexture, signTexture } from './decor.js';

export const HERITAGE = {
  brunswick: 0x2c4a37, indianRed: 0x7b2f27, cream: 0xe7d8b1, stone: 0xc9b68f, buff: 0xd9c08a, burgundy: 0x5a1f24,
  olive: 0x5d5f3a, black: 0x1e1f1f, white: 0xf3f0e8, ochre: 0xc08a3e, slate: 0x4a5560, teal: 0x2f5d5a, mustard: 0xc9a13b,
};

// ------------------------------------------------------------------------------- profiles
/** Classical cornice profile (x outward from the wall face, y up), closed. */
export const CORNICE = [[0, 0], [0.035, 0], [0.035, 0.02], [0.05, 0.035], [0.06, 0.06], [0.1, 0.075], [0.13, 0.1], [0.16, 0.135], [0.2, 0.15], [0.2, 0.185], [0.215, 0.185], [0.215, 0.22], [0, 0.22]];
export const STRING_COURSE = [[0, 0], [0.03, 0], [0.04, 0.012], [0.04, 0.06], [0.025, 0.075], [0, 0.075]];
export const SKIRTING = [[0, 0], [0.018, 0], [0.018, 0.14], [0.012, 0.155], [0.006, 0.17], [0, 0.17]];
export const ARCHITRAVE = [[0, 0], [0.012, 0], [0.018, 0.012], [0.025, 0.02], [0.06, 0.022], [0.075, 0.016], [0.08, 0.0], [0.08, -0.01], [0, -0.01]];
export const QUAD_GUTTER = [[0, 0], [0.11, 0], [0.13, 0.03], [0.14, 0.08], [0.15, 0.1], [0.14, 0.11], [0.128, 0.085], [0.118, 0.035], [0.1, 0.012], [0.006, 0.012], [0.006, 0.1], [0, 0.1]];
export const COPING = [[-0.15, 0], [0.15, 0], [0.15, 0.04], [0.13, 0.06], [0, 0.09], [-0.13, 0.06], [-0.15, 0.04]];

/** Moulded surround around an opening (follows its outline – rectangle or arch – up one jamb, over the head and down the other). */
export function surround(ho, profile = ARCHITRAVE, z = 0) {
  const pts = openingPoints(ho, 24).reverse(); pts.pop();
  const path = []; for (const [x, y] of pts) { const l = path.at(-1); if (!l || Math.hypot(l[0] - x, l[1] - y) > 1e-4) path.push([x, y, z]); }
  // profile x runs away from the opening, y out of the wall (up vector = +Z)
  return G.sweep(profile.map(([a, b]) => [-a, b]), path, { up: [0, 0, 1], caps: true });
}

// ------------------------------------------------------------------------------- windows
function sashGeos(x0, x1, y0, y1, zc, { th = 0.042, side = 0.045, top = 0.05, bot = 0.06, bars = [1, 1], horns = 0 } = {}) {
  const wood = [], glass = [];
  const b = 0.003;
  wood.push(G.span([x0, y0, zc - th / 2], [x0 + side, y1, zc + th / 2], { bevel: b }), G.span([x1 - side, y0, zc - th / 2], [x1, y1, zc + th / 2], { bevel: b }));
  wood.push(G.span([x0 + side, y1 - top, zc - th / 2], [x1 - side, y1, zc + th / 2], { bevel: b }), G.span([x0 + side, y0, zc - th / 2], [x1 - side, y0 + bot, zc + th / 2], { bevel: b }));
  if (horns) for (const x of [x0, x1 - side]) wood.push(G.span([x, y0 - horns, zc - th / 2 + 0.004], [x + side, y0, zc + th / 2 - 0.004], { bevel: b }));
  const gx0 = x0 + side, gx1 = x1 - side, gy0 = y0 + bot, gy1 = y1 - top;
  for (let i = 1; i < bars[0]; i++) { const x = gx0 + (gx1 - gx0) * i / bars[0]; wood.push(G.span([x - 0.011, gy0, zc - th * 0.35], [x + 0.011, gy1, zc + th * 0.35], { bevel: 0.002 })); }
  for (let i = 1; i < bars[1]; i++) { const y = gy0 + (gy1 - gy0) * i / bars[1]; wood.push(G.span([gx0, y - 0.011, zc - th * 0.35], [gx1, y + 0.011, zc + th * 0.35], { bevel: 0.002 })); }
  glass.push(G.quad(gx1 - gx0, gy1 - gy0, { at: [(gx0 + gx1) / 2, (gy0 + gy1) / 2, zc] }));
  return { wood, glass };
}

/**
 * Double-hung timber sash window in an opening { w, h } (optionally arched).
 * o: frame (colour), glass, sill: 'stone' | 'timber' | null, surround: 'moulded' | 'brick' | null,
 * panes: [[cols, rows] upper, [cols, rows] lower], open (0–1 lower sash raised), wall (thickness).
 */
export function sashWindow(k, parent, o) {
  const { w, h } = o, arch = o.arch || null;
  const g = k.group(o.name || 'Window', parent, { at: o.at, rot: o.rot });
  const frame = k.mat('paint_timber', { color: o.frame ?? HERITAGE.cream, name: o.frameName || 'Window timber' });
  const glassM = k.mat('glass');
  const z0 = -(o.inset ?? 0.075), fd = 0.13, zb = z0 - fd, fw = 0.05;
  const wood = [], fx0 = -w / 2, fx1 = w / 2;
  const rise = arch === 'round' ? w / 2 : arch === 'segment' ? w * 0.18 : 0, sh = h - rise; // straight part
  wood.push(G.span([fx0, 0, zb], [fx0 + fw, sh, z0]), G.span([fx1 - fw, 0, zb], [fx1, sh, z0]));
  wood.push(G.span([fx0, 0, zb - 0.01], [fx1, 0.045, z0 + 0.035], { bevel: 0.004 })); // timber sill
  if (rise) {
    const hole = { x: fx0, y: 0, w, h, arch };
    const pts = openingPoints(hole, 24).filter(([, y]) => y > sh - 1e-4).map(([x, y]) => [x, y, z0]);
    pts.sort((a, b) => a[0] - b[0]);
    wood.push(G.sweep([[0, -fd], [fw, -fd], [fw, 0], [0, 0]], pts, { up: [0, 0, 1] }));
    wood.push(G.span([fx0, sh - 0.05, zb + 0.02], [fx1, sh, z0 - 0.02])); // transom at the springing
    const shape = new THREE.Shape(openingPoints({ x: fx0 + fw, y: sh, w: w - fw * 2, h: rise - 0.0, arch: arch === 'round' ? 'round' : 'segment' }, 24).filter(([, y]) => y >= sh - 1e-4).map(([x, y]) => new THREE.Vector2(x, y)));
    k.part('Fanlight glass', [xf(new THREE.ShapeGeometry(shape, 12), { at: [0, 0, z0 - fd / 2] })], glassM, { parent: g, shadow: false });
  } else wood.push(G.span([fx0, sh - fw, zb], [fx1, sh, z0]));
  k.part('Frame', wood, frame, { parent: g });
  // sashes
  const top = rise ? sh - 0.05 : sh - fw, bottom = 0.045, half = (top - bottom) / 2, lap = 0.02, open = Math.max(0, Math.min(1, o.open || 0));
  const pu = o.panes?.[0] || [1, 1], pl = o.panes?.[1] || [1, 1];
  const up = sashGeos(fx0 + fw - 0.005, fx1 - fw + 0.005, bottom + half - lap, top, z0 - 0.045, { bars: pu, bot: 0.04, horns: o.horns === false ? 0 : 0.05 });
  const lo = sashGeos(fx0 + fw - 0.005, fx1 - fw + 0.005, bottom, bottom + half + lap, z0 - 0.095, { bars: pl, top: 0.04, bot: 0.075 });
  const ug = k.group('Upper sash', g), lg = k.group('Lower sash', g, { at: [0, open * (half - 0.02), 0] });
  k.part('Sash', up.wood, frame, { parent: ug }); k.part('Glass', up.glass, glassM, { parent: ug, shadow: false });
  k.part('Sash', lo.wood, frame, { parent: lg }); k.part('Glass', lo.glass, glassM, { parent: lg, shadow: false });
  // sill and surround on the facade
  if (o.sill === 'stone') k.part('Sill', [G.span([fx0 - 0.07, -0.085, -0.13], [fx1 + 0.07, 0, 0.055], { bevel: 0.006 })], o.sillMat || 'bluestone', { parent: g });
  if (o.surround === 'moulded') {
    k.part('Architrave', [surround({ x: fx0, y: 0, w, h, arch }, o.profile || ARCHITRAVE, 0)], k.mat(o.surroundMat || 'render', { color: o.surroundColor ?? HERITAGE.stone }), { parent: g });
    if (o.keystone !== false) k.part('Keystone', [G.extrude([[-0.07, 0], [0.07, 0], [0.095, 0.2], [-0.095, 0.2]], 0.07, { at: [0, h - 0.05, -0.01] })], k.mat(o.surroundMat || 'render', { color: o.surroundColor ?? HERITAGE.stone }), { parent: g });
  } else if (o.surround === 'brick') {
    // polychrome dressing: cream brick quoins down the jambs and a voussoir head
    const qm = o.dressMat || 'brick_cream', qs = [];
    for (let y = 0, i = 0; y < sh - 0.05; y += 0.172, i++) { const wq = i % 2 ? 0.115 : 0.23; for (const s of [-1, 1]) qs.push(G.span([s < 0 ? fx0 - wq : fx1, y, -0.004], [s < 0 ? fx0 : fx1 + wq, Math.min(y + 0.172, sh), 0.012])); }
    if (rise) { const pts = openingPoints({ x: fx0 - 0.0, y: 0, w, h, arch }, 24).filter(([, y]) => y > sh - 1e-4).map(([x, y]) => [x, y, 0]); pts.sort((a, b) => a[0] - b[0]); qs.push(G.sweep([[-0.0, -0.004], [0.0 + 0.0, 0.012], [-0.23, 0.012], [-0.23, -0.004]].map(([a, b]) => [a, b]), pts, { up: [0, 0, 1] })); }
    else qs.push(G.span([fx0 - 0.12, sh, -0.004], [fx1 + 0.12, sh + 0.25, 0.012]));
    k.part('Brick dressing', qs, qm, { parent: g });
  }
  return g;
}

/** Side-hung casement window (one or two leaves), modern or cottage. */
export function casementWindow(k, parent, o) {
  const { w, h } = o; const g = k.group(o.name || 'Casement window', parent, { at: o.at, rot: o.rot });
  const frameM = k.mat(o.metal ? 'aluminium' : 'paint_timber', { color: o.frame ?? (o.metal ? 0x2b2d30 : HERITAGE.white), name: o.metal ? 'Window frame (aluminium)' : 'Window timber' });
  const glassM = k.mat(o.tint ? 'glass_tinted' : 'glass');
  const z0 = -(o.inset ?? 0.06), fd = 0.1, fw = o.metal ? 0.04 : 0.055, leaves = o.leaves || (w > 1 ? 2 : 1);
  const wood = [G.span([-w / 2, 0, z0 - fd], [-w / 2 + fw, h, z0]), G.span([w / 2 - fw, 0, z0 - fd], [w / 2, h, z0]), G.span([-w / 2, h - fw, z0 - fd], [w / 2, h, z0]), G.span([-w / 2, 0, z0 - fd - 0.01], [w / 2, fw, z0 + 0.02], { bevel: 0.003 })];
  k.part('Frame', wood, frameM, { parent: g });
  const lw = (w - fw * 2) / leaves;
  for (let i = 0; i < leaves; i++) {
    const x0 = -w / 2 + fw + i * lw, hinge = i === 0 ? x0 : x0 + lw;
    const lg = k.group(leaves > 1 ? (i ? 'Right leaf' : 'Left leaf') : 'Leaf', g, { at: [hinge, 0, z0 - 0.03], rot: [0, (o.open || 0) * (i ? -1 : 1), 0] });
    const s = sashGeos(x0 - hinge, x0 + lw - hinge, fw, h - fw, 0, { th: 0.04, side: o.metal ? 0.035 : 0.05, top: o.metal ? 0.035 : 0.05, bot: o.metal ? 0.035 : 0.06, bars: o.bars || [1, 1] });
    k.part('Sash', s.wood, frameM, { parent: lg }); k.part('Glass', s.glass, glassM, { parent: lg, shadow: false });
  }
  if (o.sill) k.part('Sill', [G.span([-w / 2 - 0.04, -0.05, -0.1], [w / 2 + 0.04, 0, 0.04], { bevel: 0.004 })], o.sill === true ? 'concrete' : o.sill, { parent: g });
  return g;
}

// ------------------------------------------------------------------------------- doors
/** Door leaf geometry (hinge at x = 0, leaf in +x): { wood, glass, metal } for style 'panel4' | 'panel2' | 'glazed' | 'flush' | 'french' | 'ledged'. */
export function doorLeafGeos(w, h, th = 0.045, style = 'panel4', handleSide = 1) {
  const wood = [], glass = [], lead = [], metal = [];
  const st = 0.12, tr = 0.12, br = 0.22, lr = 0.95, lrh = 0.2, mu = 0.1;
  const ri = th * 0.225; // panel board half thickness
  let panels = [], glazed = [];
  if (style === 'panel4') panels = [[st, lr + lrh, w / 2 - mu / 2, h - tr], [w / 2 + mu / 2, lr + lrh, w - st, h - tr], [st, br, w / 2 - mu / 2, lr], [w / 2 + mu / 2, br, w - st, lr]];
  else if (style === 'panel2') panels = [[st, lr + lrh, w - st, h - tr], [st, br, w - st, lr]];
  else if (style === 'glazed') { glazed = [[st, lr + lrh, w - st, h - tr]]; panels = [[st, br, w / 2 - mu / 2, lr], [w / 2 + mu / 2, br, w - st, lr]]; }
  else if (style === 'french') glazed = [[0.1, 0.25, w - 0.1, h - 0.1]];
  if (style === 'flush') wood.push(G.span([0, 0, -th / 2], [w, h, th / 2], { bevel: 0.003 }));
  else if (style === 'ledged') {
    const n = Math.max(3, Math.round(w / 0.11)), bw = w / n;
    for (let i = 0; i < n; i++) wood.push(G.span([i * bw + 0.002, 0, -th / 2 + 0.012], [(i + 1) * bw - 0.002, h, th / 2], { bevel: 0.004 }));
    for (const y of [0.2, h / 2, h - 0.3]) wood.push(G.span([0.06, y, -th / 2 - 0.012], [w - 0.06, y + 0.15, -th / 2 + 0.012], { bevel: 0.005 }));
    metal.push(...[0.25, h - 0.25].map((y) => G.span([-0.005, y - 0.02, th / 2], [0.4, y + 0.02, th / 2 + 0.006])));
  } else {
    const holes = [...panels, ...glazed].map(([x0, y0, x1, y1]) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
    wood.push(G.wall(w, h, th, holes));
    for (const [x0, y0, x1, y1] of panels) {
      const pw = x1 - x0, ph = y1 - y0;
      wood.push(G.span([x0, y0, -ri], [x1, y1, ri]));
      for (const s of [1, -1]) {
        wood.push(G.box(pw - 0.07, ph - 0.07, 0.016, { bevel: 0.0075, seg: 2, at: [(x0 + x1) / 2, (y0 + y1) / 2, s * (ri + 0.002)] }));
        // quarter-round bead in the corner between frame and panel
        const r = th / 2 - ri, path = s > 0 ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
        wood.push(G.sweep([[0, 0], [0, r], [-r * 0.3, r * 0.95], [-r * 0.7, r * 0.7], [-r * 0.95, r * 0.3], [-r, 0]], path.map(([x, y]) => [x, y, s * ri]), { closed: true, up: [0, 0, s] }));
      }
    }
    for (const [x0, y0, x1, y1] of glazed) {
      if (style === 'french') { const n = 4, gw = x1 - x0, gh = y1 - y0; for (let i = 1; i < n; i++) wood.push(G.span([x0, y0 + gh * i / n - 0.012, -0.012], [x1, y0 + gh * i / n + 0.012, 0.012])); wood.push(G.span([x0 + gw / 2 - 0.012, y0, -0.012], [x0 + gw / 2 + 0.012, y1, 0.012])); glass.push(G.quad(gw, gh, { at: [(x0 + x1) / 2, (y0 + y1) / 2, 0] })); }
      else lead.push(G.quad(x1 - x0, y1 - y0, { at: [(x0 + x1) / 2, (y0 + y1) / 2, 0] }));
    }
  }
  // hardware
  if (handleSide) {
    const hx = w - 0.065;
    for (const s of [1, -1]) {
      metal.push(G.lathe([[0.0001, 0], [0.026, 0], [0.026, 0.006], [0.01, 0.012], [0.008, 0.045], [0.024, 0.055], [0.028, 0.07], [0.02, 0.085], [0.0001, 0.088]], { seg: 20, at: [hx, lr + 0.1, s * th / 2], rot: [s > 0 ? 90 : -90, 0, 0] }));
      metal.push(G.span([hx - 0.018, lr + 0.03, s * th / 2 - 0.002], [hx + 0.018, lr + 0.17, s * th / 2 + 0.002]));
    }
    if (style === 'panel4' || style === 'panel2') { metal.push(G.span([w / 2 - 0.13, lr + 0.06, th / 2], [w / 2 + 0.13, lr + 0.14, th / 2 + 0.006], { bevel: 0.002 })); metal.push(G.torus(0.05, 0.008, { at: [w / 2, h - tr - 0.45, th / 2 + 0.012], seg: 24 })); }
  }
  for (const y of [0.25, h - 0.3]) metal.push(G.span([-0.004, y, -th / 2 + 0.005], [0.012, y + 0.1, th / 2 - 0.005]));
  return { wood, glass, lead, metal };
}

/**
 * Doorway with frame, optional fanlight and sidelights. o: w (opening), h (opening incl. fanlight),
 * fan (fanlight height), side (sidelight width), style, color (door), frame, open (degrees), double.
 */
export function doorway(k, parent, o) {
  const { w, h } = o, fan = o.fan ?? 0, side = o.side ?? 0, fw = 0.06, z0 = -(o.inset ?? 0.09), fd = 0.14;
  const g = k.group(o.name || 'Door', parent, { at: o.at, rot: o.rot });
  const frameM = k.mat('paint_timber', { color: o.frame ?? HERITAGE.cream, name: o.frameName || 'Door frame' });
  const leafM = k.mat(o.leafMat || 'paint_timber', { color: o.color ?? HERITAGE.brunswick, name: o.leafName || 'Door' });
  const metalM = k.mat(o.metal || 'brass');
  const doorH = h - (fan ? fan + 0.07 : 0) - fw * (fan ? 0 : 1);
  const frame = [G.span([-w / 2, 0, z0 - fd], [-w / 2 + fw, h, z0]), G.span([w / 2 - fw, 0, z0 - fd], [w / 2, h, z0]), G.span([-w / 2, h - fw, z0 - fd], [w / 2, h, z0])];
  if (fan) frame.push(G.span([-w / 2, doorH, z0 - fd], [w / 2, doorH + 0.07, z0 + 0.01], { bevel: 0.004 }));
  const lx0 = -w / 2 + fw + (side ? side + fw : 0), lx1 = w / 2 - fw - (side ? side + fw : 0), lw = lx1 - lx0;
  if (side) for (const s of [-1, 1]) {
    const mx = s < 0 ? lx0 - fw : lx1; frame.push(G.span([mx, 0, z0 - fd], [mx + fw, doorH, z0]));
    const sx0 = s < 0 ? -w / 2 + fw : lx1 + fw, sx1 = sx0 + side;
    frame.push(G.span([sx0, 0, z0 - fd + 0.03], [sx1, 0.7, z0 - 0.03], { bevel: 0.004 })); // panelled base
    frame.push(G.box(side - 0.07, 0.5, 0.012, { bevel: 0.005, seg: 2, at: [(sx0 + sx1) / 2, 0.35, z0 - 0.03] }));
    k.part('Sidelight', [G.quad(side, doorH - 0.7, { at: [(sx0 + sx1) / 2, 0.7 + (doorH - 0.7) / 2, z0 - fd / 2] })], k.texMat('Leadlight (side)', { map: leadlightTexture('side') }, { finish: 'glass', roughness: 0.05, opacity: 0.88, transparent: true }), { parent: g, shadow: false });
  }
  frame.push(G.span([-w / 2 - 0.01, -0.02, z0 - fd], [w / 2 + 0.01, 0.0, z0 + 0.02])); // threshold
  k.part('Frame', frame, frameM, { parent: g });
  if (fan) k.part('Fanlight', [G.quad(w - fw * 2, fan, { at: [0, doorH + 0.07 + fan / 2, z0 - fd / 2] })], k.texMat('Leadlight (fanlight)', { map: leadlightTexture('fan') }, { finish: 'glass', roughness: 0.05, opacity: 0.88, transparent: true }), { parent: g, shadow: false });
  const leaves = o.double ? 2 : 1, each = lw / leaves;
  for (let i = 0; i < leaves; i++) {
    const right = i === 1 || o.hinge === 'right';
    const hingeX = right ? lx1 : lx0;
    const lg = k.group(leaves > 1 ? (i ? 'Right leaf' : 'Left leaf') : 'Door leaf', g, { at: [hingeX, 0.003, z0 - fd + 0.06], rot: [0, (o.open || 0) * (right ? -1 : 1), 0] });
    const d = doorLeafGeos(each - 0.006, doorH - 0.006, 0.045, o.style || 'panel4', 1);
    const mir = (geos) => right ? geos.map((x) => { x.scale(-1, 1, 1); const idx = x.index; if (idx) { for (let j = 0; j < idx.count; j += 3) { const a = idx.getX(j + 1); idx.setX(j + 1, idx.getX(j + 2)); idx.setX(j + 2, a); } } else { const p = x.attributes.position, n = x.attributes.normal; for (let j = 0; j < p.count; j += 3) for (const att of [p, n, x.attributes.uv].filter(Boolean)) { const s = att.itemSize; for (let c = 0; c < s; c++) { const t = att.array[(j + 1) * s + c]; att.array[(j + 1) * s + c] = att.array[(j + 2) * s + c]; att.array[(j + 2) * s + c] = t; } } } if (x.attributes.normal) x.computeVertexNormals(); return x; }) : geos;
    k.part('Leaf', mir(d.wood), leafM, { parent: lg, pivot: 'none' });
    if (d.metal.length) k.part('Hardware', mir(d.metal), metalM, { parent: lg, pivot: 'none' });
    if (d.glass.length) k.part('Glass', mir(d.glass), 'glass', { parent: lg, pivot: 'none', shadow: false });
    if (d.lead.length) k.part('Leadlight', mir(d.lead), k.texMat('Leadlight (door)', { map: leadlightTexture('door') }, { finish: 'glass', roughness: 0.05, opacity: 0.9, transparent: true }), { parent: lg, pivot: 'none', shadow: false });
  }
  if (o.step) k.part('Step', [G.span([-w / 2 - 0.1, -o.step, 0], [w / 2 + 0.1, 0, 0.35], { bevel: 0.01 })], o.stepMat || 'bluestone', { parent: g });
  return g;
}

// ------------------------------------------------------------------------------- verandahs
/** Fluted cast-iron verandah post (base at y = 0). */
export function ironPostGeos(H, { r = 0.05 } = {}) {
  const base = 0.24, capH = 0.32;
  const prof = [[0.0001, base], [r * 1.6, base], [r * 1.6, base + 0.03], [r * 1.25, base + 0.06], [r * 1.25, base + 0.1], [r * 1.05, base + 0.14], [r, base + 0.2], [r, H - capH], [r * 1.25, H - capH + 0.03], [r * 1.05, H - capH + 0.06], [r * 1.1, H - capH + 0.12], [r * 1.6, H - capH + 0.24], [r * 1.9, H - 0.06], [r * 1.9, H - 0.04], [0.0001, H - 0.04]];
  return [G.box(0.17, base, 0.17, { bevel: 0.01, at: [0, base / 2, 0] }), G.lathe(prof, { seg: 20 }), G.box(0.2, 0.04, 0.2, { bevel: 0.006, at: [0, H - 0.02, 0] })];
}
/** Lace frieze strip (both sides) from x0 to x1 at height y (top of frieze), facing ±Z. */
export function laceFrieze(k, parent, x0, x1, yTop, z, { h = 0.3, color = HERITAGE.black, style = 'frieze', name = 'Lace frieze' } = {}) {
  const L = x1 - x0, g = G.quad(L, h, { at: [(x0 + x1) / 2, yTop - h / 2, z] });
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * L / (style === 'balustrade' ? h * 1.0 : 0.6));
  const m = k.texMat('Cast-iron lace', laceTexture(style), { color, finish: 'iron', roughness: 0.45, metalness: 0.3, alphaTest: 0.5, side: THREE.DoubleSide, normalScale: 1.2 });
  return k.part(name, [g], m, { parent, uv: 'keep' });
}
/** Lace corner brackets: at a post or wall (x, yTop) projecting in dir (±1) along X. */
export function laceBracket(k, parent, x, yTop, z, dir = 1, { s = 0.42, color = HERITAGE.black } = {}) {
  const g = G.quad(s, s, { at: [x + dir * s / 2, yTop - s / 2, z] });
  if (dir < 0) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); }
  const m = k.texMat('Cast-iron lace bracket', laceTexture('bracket'), { color, finish: 'iron', roughness: 0.45, metalness: 0.3, alphaTest: 0.5, side: THREE.DoubleSide, normalScale: 1.2 });
  return k.part('Lace bracket', [g], m, { parent, uv: 'keep' });
}

/**
 * Corrugated iron sheet with real corrugations following a side profile [[z, y], …] across x0..x1.
 * Two-sided, UVs in metres (u across, v along the profile).
 */
export function corrugatedSheet(x0, x1, profile, { amp = 0.008, pitch = 1 / 13, thick = 0.004 } = {}) {
  const cols = Math.max(2, Math.round((x1 - x0) / pitch * 6)), rows = profile.length;
  const pos = [], uv = [], idx = [];
  // profile normals (in the z–y plane, pointing up/out)
  const nrm = profile.map((p, i) => { const a = profile[Math.max(0, i - 1)], b = profile[Math.min(rows - 1, i + 1)]; const dz = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dz, dy) || 1; return [-dy / l, dz / l]; });
  const len = [0]; for (let i = 1; i < rows; i++) len.push(len[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) {
      const x = x0 + (x1 - x0) * c / cols, wv = Math.sin((x - x0) / pitch * Math.PI * 2) * amp + (side < 0 ? -thick : 0);
      const [nz, ny] = nrm[r];
      pos.push(x, profile[r][1] + ny * wv, profile[r][0] + nz * wv); uv.push(x - x0, len[r]);
    }
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
      const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      if (side > 0) idx.push(a, d, b, b, d, e); else idx.push(a, b, d, b, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  // the profile was given as (z, y) with z increasing towards the street: orientation check
  return g;
}
/** Bullnose (quarter-round) verandah profile from the wall (zWall) out to zFront, ending at yFront. */
export function bullnoseProfile(zWall, zFront, yFront, { R = 0.5, slope = 7, n = 14 } = {}) {
  const zc = zFront - R, yc = yFront, t0 = (90 - slope) * Math.PI / 180;
  const zs = zc + R * Math.cos(t0), ys = yc + R * Math.sin(t0), yw = ys + (zs - zWall) * Math.tan(slope * Math.PI / 180);
  const pts = [[zWall, yw]];
  for (let i = 1; i <= 3; i++) pts.push([zWall + (zs - zWall) * i / 3, yw + (ys - yw) * i / 3]);
  for (let i = 1; i <= n; i++) { const t = t0 * (1 - i / n); pts.push([zc + R * Math.cos(t), yc + R * Math.sin(t)]); }
  return pts;
}
export function skillionProfile(zWall, zFront, yWall, yFront, n = 6) { const p = []; for (let i = 0; i <= n; i++) p.push([zWall + (zFront - zWall) * i / n, yWall + (yFront - yWall) * i / n]); return p; }

// ------------------------------------------------------------------------------- roofs & chimneys
/**
 * Gable roof between x0..x1 (ridge parallel to X) with eaves at zA and zB, eave height yE.
 * Returns { sheets: [geo, geo], ridgeY, ridgeZ, slopeAt(z) → roof height }.
 */
export function gableRoofGeos(x0, x1, zA, zB, yE, pitch = 25, { overhang = 0.3, thick = 0.025, extendX = 0 } = {}) {
  const zR = (zA + zB) / 2, rise = Math.abs(zB - zA) / 2 * Math.tan(pitch * Math.PI / 180), yR = yE + rise;
  const slope = (ze) => {
    const dz = zR - ze, dy = rise, L = Math.hypot(dz, dy), ux = dz / L, uy = dy / L;
    const sz = ze - ux * overhang, sy = yE - uy * overhang; // start beyond the eave
    const len = L + overhang, cz = (sz + zR) / 2 + (-uy) * 0 , cy = (sy + yR) / 2;
    const phi = Math.atan2(-uy, ux) * 180 / Math.PI;
    // offset by half the thickness along the roof normal (0, ux, -uy)·sign so the underside sits on the rafter line
    const nz = -uy * Math.sign(dz), ny = Math.abs(ux);
    return G.box(x1 - x0 + extendX * 2, thick, len, { at: [(x0 + x1) / 2, cy + ny * thick / 2, cz + nz * thick / 2], rot: [phi, 0, 0] });
  };
  return { sheets: [slope(zA), slope(zB)], ridgeY: yR, ridgeZ: zR, slopeAt: (z) => yR - Math.abs(z - zR) * Math.tan(pitch * Math.PI / 180) };
}
/** Hip roof footprint x0..x1 × z0..z1 at eave height, pitch in degrees: returns a closed shell geometry. */
export function hipRoofGeo(x0, x1, z0, z1, yEave, pitch = 25, overhang = 0.4) {
  x0 -= overhang; x1 += overhang; z0 -= overhang; z1 += overhang; yEave -= overhang * Math.tan(pitch * Math.PI / 180);
  const w = x1 - x0, d = z1 - z0, t = Math.tan(pitch * Math.PI / 180), r = Math.min(w, d) / 2, H = r * t;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const ra = w >= d ? [[x0 + r, cz], [x1 - r, cz]] : [[cx, z0 + r], [cx, z1 - r]];
  const P = (x, y, z) => [x, y, z];
  const c = [P(x0, yEave, z1), P(x1, yEave, z1), P(x1, yEave, z0), P(x0, yEave, z0)]; // front-left, front-right, back-right, back-left
  const A = P(ra[0][0], yEave + H, ra[0][1]), B = P(ra[1][0], yEave + H, ra[1][1]);
  const tris = w >= d ? [[c[0], c[1], B], [c[0], B, A], [c[2], c[3], A], [c[2], A, B], [c[1], c[2], B], [c[3], c[0], A]] : [[c[0], c[1], B], [c[2], c[3], A], [c[1], c[2], A], [c[1], A, B], [c[3], c[0], B], [c[3], B, A]];
  const pos = []; for (const tr of tris) for (const p of tr) pos.push(...p);
  // underside (soffit)
  for (const [a, b, cc] of [[c[0], c[2], c[1]], [c[0], c[3], c[2]]]) pos.push(...a, ...b, ...cc);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
/** Chimney stack with moulded cap and terracotta pots (base at y0, top at y1, centred at x, z). */
export function chimney(k, parent, { x, z, y0, y1, w = 0.9, d = 0.5, pots = 2, mat = 'brick_red', capMat = 'render', capColor = HERITAGE.cream }) {
  const g = k.group('Chimney', parent);
  k.part('Stack', [G.span([x - w / 2, y0, z - d / 2], [x + w / 2, y1, z + d / 2])], mat, { parent: g });
  const cap = [[0, 0], [0.03, 0], [0.03, 0.04], [0.06, 0.07], [0.07, 0.1], [0.07, 0.16], [0, 0.16]];
  const ring = [[x - w / 2, y1 - 0.24, z + d / 2], [x + w / 2, y1 - 0.24, z + d / 2], [x + w / 2, y1 - 0.24, z - d / 2], [x - w / 2, y1 - 0.24, z - d / 2]];
  k.part('Cap', [G.sweep(cap, ring, { closed: true }), G.span([x - w / 2 - 0.07, y1 - 0.08, z - d / 2 - 0.07], [x + w / 2 + 0.07, y1, z + d / 2 + 0.07], { bevel: 0.01 })], capMat, { parent: g, matOpts: { color: capColor } });
  const potProf = [[0.0001, 0], [0.13, 0], [0.13, 0.04], [0.11, 0.07], [0.1, 0.3], [0.085, 0.42], [0.09, 0.47], [0.11, 0.5], [0.105, 0.53], [0.075, 0.53], [0.075, 0.1], [0.0001, 0.1]];
  const pg = []; for (let i = 0; i < pots; i++) pg.push(G.lathe(potProf, { seg: 20, at: [x + (pots > 1 ? (i / (pots - 1) - 0.5) * (w - 0.3) : 0), y1, z] }));
  k.part('Chimney pots', pg, 'terracotta', { parent: g, uv: 'keep', matOpts: { name: 'Terracotta pot' } });
  return g;
}

// ------------------------------------------------------------------------------- fences
/** Cast-iron palisade fence on a bluestone plinth, from x0 to x1 at z (front face), gate gap [gx0, gx1]. */
export function palisadeFence(k, parent, x0, x1, z, { gate = null, h = 1.1, color = HERITAGE.black, plinth = 'bluestone', piers = 'render', pierColor = HERITAGE.cream } = {}) {
  const g = k.group('Front fence', parent);
  const iron = k.mat('iron', { color, name: 'Cast iron' }), ph = 0.35, pd = 0.3;
  const segs = gate ? [[x0, gate[0]], [gate[1], x1]] : [[x0, x1]];
  const plinths = [], pickets = [], rails = [];
  const pierW = 0.34, pierH = h + 0.05;
  const pierX = [x0 + pierW / 2, x1 - pierW / 2, ...(gate ? [gate[0] - pierW / 2, gate[1] + pierW / 2] : [])];
  const piersG = [];
  for (const px of pierX) { piersG.push(G.span([px - pierW / 2, 0, z - pierW / 2 - 0.03], [px + pierW / 2, pierH, z + pierW / 2 - 0.03])); piersG.push(G.span([px - pierW / 2 - 0.04, pierH, z - pierW / 2 - 0.07], [px + pierW / 2 + 0.04, pierH + 0.08, z + pierW / 2 + 0.01], { bevel: 0.01 })); piersG.push(G.lathe([[0.0001, 0], [0.09, 0], [0.09, 0.03], [0.12, 0.12], [0.1, 0.2], [0.0001, 0.24]], { seg: 16, at: [px, pierH + 0.08, z - 0.03] })); }
  for (const [a, b] of segs) {
    const s0 = a + (pierX.some((p) => Math.abs(p - (a + pierW / 2)) < 0.01) ? pierW : 0), s1 = b - (pierX.some((p) => Math.abs(p - (b - pierW / 2)) < 0.01) ? pierW : 0);
    if (s1 - s0 < 0.05) continue;
    plinths.push(G.span([s0, 0, z - pd], [s1, ph, z], { bevel: 0.012 }));
    for (const y of [ph + 0.09, h - 0.06]) rails.push(G.span([s0, y - 0.015, z - pd / 2 - 0.012], [s1, y + 0.015, z - pd / 2 + 0.012]));
    const n = Math.max(2, Math.round((s1 - s0) / 0.11));
    for (let i = 0; i <= n; i++) {
      const px = s0 + 0.05 + (s1 - s0 - 0.1) * i / n;
      pickets.push(G.cyl(0.011, h - ph + 0.05, { seg: 8, at: [px, ph, z - pd / 2] }));
      pickets.push(G.lathe([[0.0001, 0], [0.018, 0.0], [0.03, 0.05], [0.0001, 0.13]], { seg: 8, at: [px, h + 0.05, z - pd / 2] })); // spear top
    }
  }
  k.part('Plinth', plinths, plinth, { parent: g });
  k.part('Piers', piersG, piers, { parent: g, matOpts: { color: pierColor } });
  k.part('Palisade', [...pickets, ...rails], iron, { parent: g });
  if (gate) {
    const gg = k.group('Gate', g, { at: [gate[0], 0, z - pd / 2] }), gw = gate[1] - gate[0] - 0.02, gp = [];
    for (const y of [0.15, 0.55, h - 0.06]) gp.push(G.span([0.01, y - 0.015, -0.012], [gw, y + 0.015, 0.012]));
    gp.push(G.span([0.01, 0.12, -0.015], [0.04, h, 0.015]), G.span([gw - 0.03, 0.12, -0.015], [gw, h, 0.015]));
    const n = Math.round(gw / 0.11); for (let i = 1; i < n; i++) { const px = gw * i / n; gp.push(G.cyl(0.011, h - 0.12, { seg: 8, at: [px, 0.12, 0] })); gp.push(G.lathe([[0.0001, 0], [0.018, 0.0], [0.03, 0.05], [0.0001, 0.13]], { seg: 8, at: [px, h, 0] })); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; gp.push(G.torus(0.06, 0.008, { at: [gw / 2 + Math.cos(a) * 0.0, 0.35, 0], seg: 20 })); break; }
    k.part('Gate', gp, iron, { parent: gg, pivot: 'none' });
  }
  return g;
}
/** Timber picket fence from x0 to x1 at z. */
export function picketFence(k, parent, x0, x1, z, { h = 1.0, color = HERITAGE.white, gate = null } = {}) {
  const g = k.group('Picket fence', parent), m = k.mat('paint_timber', { color, name: 'Fence paint' }), geos = [];
  const segs = gate ? [[x0, gate[0]], [gate[1], x1]] : [[x0, x1]];
  for (const [a, b] of segs) {
    for (const px of [a, b]) { geos.push(G.span([px - 0.05, 0, z - 0.05], [px + 0.05, h + 0.12, z + 0.05], { bevel: 0.006 })); geos.push(G.box(0.12, 0.04, 0.12, { bevel: 0.01, at: [px, h + 0.14, z] })); }
    for (const y of [0.2, h - 0.2]) geos.push(G.span([a, y, z - 0.08], [b, y + 0.07, z - 0.05]));
    const n = Math.round((b - a) / 0.12);
    for (let i = 1; i < n; i++) { const px = a + (b - a) * i / n; geos.push(G.extrude([[-0.035, 0.05], [0.035, 0.05], [0.035, h - 0.04], [0, h + 0.03], [-0.035, h - 0.04]], 0.019, { at: [px, 0, z - 0.03] })); }
  }
  k.part('Pickets', geos, m, { parent: g });
  return g;
}

// ------------------------------------------------------------------------------- misc
export function urnGeo(at, s = 1) {
  return G.lathe([[0.0001, 0], [0.12, 0], [0.12, 0.04], [0.07, 0.07], [0.06, 0.12], [0.13, 0.2], [0.16, 0.3], [0.15, 0.36], [0.1, 0.4], [0.12, 0.43], [0.11, 0.46], [0.04, 0.48], [0.045, 0.52], [0.0001, 0.56]].map(([r, y]) => [r * s, y * s]), { seg: 24, at });
}
/** Downpipe from a gutter at (x, yTop, z) to the ground. */
export function downpipe(x, yTop, z, r = 0.045) { return [G.cyl(r, yTop - 0.15, { seg: 12, at: [x, 0.15, z] }), G.lathe([[r, 0], [r * 1.6, 0.03], [r * 1.6, 0.15], [r, 0.15]], { seg: 12, at: [x, 0, z] })]; }
/** Name plate / sign quad with canvas text (faces +Z; two-sided when `both`). */
export function signPart(k, parent, name, lines, style, { w, at = [0, 0, 0], rot = [0, 0, 0], glow = false, both = false } = {}) {
  const s = signTexture(lines, style), h = w / s.aspect;
  const m = k.texMat('Sign: ' + (Array.isArray(lines) ? lines.join(' ') : lines), { map: s.map, ...(glow ? { emissiveMap: s.map } : {}) }, { finish: glow ? 'matte' : 'gloss', roughness: 0.45, ...(glow ? { emissive: 0xffffff, emissiveIntensity: 1.6 } : {}) });
  const geos = [G.quad(w, h)]; if (both) geos.push(G.quad(w, h, { rot: [0, 180, 0], at: [0, 0, -0.002] }));
  const mesh = k.part(name, geos, m, { parent, uv: 'keep', pivot: 'none' });
  mesh.position.fromArray(at); mesh.rotation.set(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180, 'YXZ');
  return mesh;
}
