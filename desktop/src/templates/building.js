// Building helpers: walls with openings filled by windows/doors/shopfronts, rectangular shells,
// hip/flat roofs with gutters and parapets, and posted verandahs with iron lace.
import * as THREE from 'three';
import { G } from './kit.js';
import * as A from './arch.js';
import { shopfront } from './fam/openings.js';

/**
 * Wall panel (local +X from 0 to len, outer face z = 0, thickness towards -Z) with openings
 * { x (centre), y, w, h, kind: 'sash' | 'casement' | 'metal' | 'door' | 'shop' | 'gap' | 'fixed', … }.
 */
export function wallWithOpenings(k, parent, o) {
  const g = k.group(o.name || 'Wall', parent, { at: o.at, rot: o.rot });
  const t = o.t ?? 0.25, holes = (o.openings || []).map((op) => ({ x: op.x - op.w / 2, y: op.y, w: op.w, h: op.h, arch: op.arch }));
  k.part(o.partName || 'Wall', [G.wall(o.len, o.h, t, holes, { at: [0, o.y0 ?? 0, -t / 2] })], o.mat, { parent: g, collision: 'col', matOpts: o.matOpts });
  for (const op of o.openings || []) {
    const at = [op.x, (o.y0 ?? 0) + op.y, 0];
    if (op.kind === 'sash') A.sashWindow(k, g, { name: op.name || 'Window', at, w: op.w, h: op.h, arch: op.arch, frame: op.frame ?? o.trim ?? A.HERITAGE.cream, sill: op.sill ?? 'stone', surround: op.surround ?? o.surround, surroundColor: o.dressColor, panes: op.panes, inset: op.inset });
    else if (op.kind === 'casement' || op.kind === 'metal') A.casementWindow(k, g, { name: op.name || 'Window', at, w: op.w, h: op.h, metal: op.kind === 'metal', frame: op.frame ?? o.trim, bars: op.bars, leaves: op.leaves, sill: op.sill, tint: op.tint, inset: op.inset });
    else if (op.kind === 'door') A.doorway(k, g, { name: op.name || 'Door', at, w: op.w, h: op.h, fan: op.fan, side: op.side, style: op.style || 'panel4', color: op.color, frame: op.frame ?? o.trim, double: op.double, metal: op.metal, step: op.step });
    else if (op.kind === 'shop') shopfront(k, { parent: g, at: [op.x, (o.y0 ?? 0) + op.y, -0.05], W: op.w, sign: op.sign, color: op.color });
  }
  return g;
}
/** Four walls round a W × D footprint centred on the origin (front faces +Z). Sides are inset so corners don't overlap. */
export function shell(k, parent, o) {
  const { W, D, h } = o, t = o.t ?? 0.25, base = { h, t, mat: o.mat, matOpts: o.matOpts, trim: o.trim, surround: o.surround, dressColor: o.dressColor, y0: o.y0 };
  const g = k.group(o.name || 'Walls', parent);
  const shift = (ops, d) => (ops || []).map((op) => ({ ...op, x: op.x + d }));
  wallWithOpenings(k, g, { ...base, name: 'Front wall', len: W, at: [-W / 2, 0, D / 2], openings: shift(o.front, W / 2) });
  wallWithOpenings(k, g, { ...base, name: 'Back wall', len: W, at: [W / 2, 0, -D / 2], rot: [0, 180, 0], openings: shift(o.back, W / 2) });
  wallWithOpenings(k, g, { ...base, name: 'Right wall', len: D - 2 * t, at: [W / 2, 0, D / 2 - t], rot: [0, 90, 0], openings: shift(o.right, D / 2 - t) });
  wallWithOpenings(k, g, { ...base, name: 'Left wall', len: D - 2 * t, at: [-W / 2, 0, -D / 2 + t], rot: [0, -90, 0], openings: shift(o.left, D / 2 - t) });
  return g;
}
/** Hip roof with fascia and quad gutters. */
export function hipRoof(k, parent, { W, D, y, pitch = 25, over = 0.45, mat = 'corrugated', matOpts, gutter = true, name = 'Roof' }) {
  const g = k.group(name, parent);
  k.part('Roof', [A.hipRoofGeo(-W / 2, W / 2, -D / 2, D / 2, y, pitch, over)], mat, { parent: g, matOpts });
  if (gutter) {
    const e = y - over * Math.tan(pitch * Math.PI / 180), x = W / 2 + over, z = D / 2 + over;
    const loop = [[-x, e - 0.1, z], [x, e - 0.1, z], [x, e - 0.1, -z], [-x, e - 0.1, -z]];
    k.part('Gutters', [G.sweep(A.QUAD_GUTTER, loop, { closed: true })], k.mat('steel', { name: 'Gutter steel', color: 0xb9bdc0 }), { parent: g });
    k.part('Eaves lining', [G.span([-x, e - 0.12, -z], [x, e - 0.1, z])], k.mat('paint_timber', { color: 0xf3efe6, name: 'Eaves lining' }), { parent: g });
  }
  return g;
}
/** Flat roof with a parapet and coping. */
export function flatRoof(k, parent, { W, D, y, parapet = 0.6, t = 0.25, mat = 'render', matOpts, coping = true, name = 'Roof' }) {
  const g = k.group(name, parent);
  k.part('Roof deck', [G.span([-W / 2 + t, y - 0.25, -D / 2 + t], [W / 2 - t, y, D / 2 - t])], k.mat('concrete', { name: 'Roof membrane', color: 0x8a8d90 }), { parent: g });
  if (parapet) {
    const geos = [G.span([-W / 2, y, D / 2 - t], [W / 2, y + parapet, D / 2]), G.span([-W / 2, y, -D / 2], [W / 2, y + parapet, -D / 2 + t]), G.span([-W / 2, y, -D / 2 + t], [-W / 2 + t, y + parapet, D / 2 - t]), G.span([W / 2 - t, y, -D / 2 + t], [W / 2, y + parapet, D / 2 - t])];
    k.part('Parapet', geos, mat, { parent: g, matOpts });
    if (coping) k.part('Coping', [G.sweep([[-t - 0.03, 0], [0.03, 0], [0.03, 0.06], [-t - 0.03, 0.06]], [[-W / 2, y + parapet, D / 2], [W / 2, y + parapet, D / 2], [W / 2, y + parapet, -D / 2], [-W / 2, y + parapet, -D / 2]].map(([x, yy, z]) => [x, yy, z]), { closed: true }).translate(0, 0, 0)], k.mat('concrete', { name: 'Coping', color: 0xb8b4ac }), { parent: g });
  }
  return g;
}
/**
 * Posted verandah across x0..x1 from the wall (zWall) to zFront, beam top at yBeam, with cast-iron
 * posts, lace frieze & brackets and a bullnose (or skillion) corrugated roof.
 */
export function postVerandah(k, parent, o) {
  const { x0, x1, zWall, zFront, yBeam } = o, g = k.group(o.name || 'Verandah', parent);
  const lace = o.lace ?? A.HERITAGE.black, n = Math.max(1, Math.round((x1 - x0) / (o.bay ?? 2.6)));
  const posts = []; for (let i = 0; i <= n; i++) posts.push(x0 + 0.1 + (x1 - x0 - 0.2) * i / n);
  k.part('Posts', posts.flatMap((x) => A.ironPostGeos(yBeam - 0.22).map((p) => p.translate(x, 0, zFront - 0.1))), k.mat('iron', { color: o.postColor ?? lace, name: 'Cast iron' }), { parent: g });
  k.part('Beam', [G.span([x0, yBeam - 0.22, zFront - 0.18], [x1, yBeam, zFront - 0.02], { bevel: 0.006 })], k.mat('paint_timber', { color: o.trim ?? A.HERITAGE.brunswick, name: 'Verandah timber' }), { parent: g });
  for (let i = 0; i < n; i++) A.laceFrieze(k, g, posts[i] + 0.09, posts[i + 1] - 0.09, yBeam - 0.22, zFront - 0.1, { color: lace });
  for (let i = 0; i <= n; i++) { if (i > 0) A.laceBracket(k, g, posts[i] - 0.09, yBeam - 0.22, zFront - 0.1, -1, { color: lace, s: 0.38 }); if (i < n) A.laceBracket(k, g, posts[i] + 0.09, yBeam - 0.22, zFront - 0.1, 1, { color: lace, s: 0.38 }); }
  const prof = o.style === 'skillion' ? A.skillionProfile(zWall, zFront + 0.05, o.yWall ?? yBeam + 0.6, yBeam + 0.02) : A.bullnoseProfile(zWall, zFront - 0.04, yBeam, { R: 0.48, slope: 6 });
  const sheet = o.stripes ? 0.762 : x1 - x0 + 0.1, a = [], b = [];
  for (let x = x0 - 0.05, i = 0; x < x1 + 0.05 - 1e-3; x += sheet, i++) (i % 2 ? b : a).push(A.corrugatedSheet(x, Math.min(x1 + 0.05, x + sheet), prof));
  k.part('Verandah roof', a, k.mat('corrugated_painted', { color: o.roofA ?? o.trim ?? A.HERITAGE.brunswick, name: 'Verandah iron (stripe A)' }), { parent: g, uv: 'keep' });
  if (b.length) k.part('Verandah roof B', b, k.mat('corrugated_painted', { color: o.roofB ?? A.HERITAGE.cream, name: 'Verandah iron (stripe B)' }), { parent: g, uv: 'keep' });
  if (o.floor !== false) k.part('Verandah floor', [G.span([x0, 0, zWall], [x1, o.floorY ?? 0.3, zFront])], o.floorMat || 'tessellated', { parent: g, collision: 'col' });
  if (o.floor !== false) k.part('Verandah edge', [G.span([x0, 0, zFront - 0.05], [x1, (o.floorY ?? 0.3) + 0.01, zFront + 0.1], { bevel: 0.01 })], 'bluestone', { parent: g });
  return { group: g, yWall: prof[0][1] };
}
/** Interior blockout behind facade glazing so windows read as rooms, not voids. */
export function interiorBox(k, parent, { W, D, floors = [0.3], h = 3, t = 0.25 }) {
  const g = k.group('Interior', parent), geos = [];
  for (const y of floors) geos.push(G.span([-W / 2 + t, y - 0.05, -D / 2 + t], [W / 2 - t, y, D / 2 - t]), G.span([-W / 2 + t, y + h - 0.05, -D / 2 + t], [W / 2 - t, y + h, D / 2 - t]));
  k.part('Floors & ceilings', geos, k.mat('render', { color: 0xe8e2d6, name: 'Plaster' }), { parent: g, shadow: false });
  return g;
}
export { THREE };
