// More Melbourne: weatherboard cottage, Italianate villa, Federation villa, corner pub, Victorian
// shop row, bluestone warehouse and a bluestone laneway. Front faces +Z, ground at y = 0.
import * as THREE from 'three';
import { G } from '../kit.js';
import * as A from '../arch.js';
import * as B from '../building.js';
import { bayWindow } from './openings.js';
import { signTexture } from '../decor.js';

const H = A.HERITAGE;

function weatherboardCottage(k, o = {}) {
  const W = 9.2, D = 9, h = 3.4, FL = 0.45, root = k.root, trim = o.trim ?? H.brunswick;
  const wb = k.mat('weatherboard', { color: o.wall ?? 0xeee3c4, name: 'Weatherboards' });
  B.shell(k, root, { W, D, h, t: 0.15, mat: wb, trim: H.cream,
    front: [{ x: -2.6, y: FL + 0.55, w: 1.05, h: 1.95, kind: 'sash', sill: null }, { x: 2.6, y: FL + 0.55, w: 1.05, h: 1.95, kind: 'sash', sill: null }, { x: 0, y: FL, w: 1.75, h: 2.75, kind: 'door', fan: 0.4, side: 0.3, color: trim, style: 'panel4' }],
    right: [{ x: -2.0, y: FL + 0.55, w: 1.0, h: 1.8, kind: 'sash', sill: null }, { x: 1.8, y: FL + 0.55, w: 1.0, h: 1.8, kind: 'sash', sill: null }],
    left: [{ x: -2.0, y: FL + 0.55, w: 1.0, h: 1.8, kind: 'sash', sill: null }, { x: 1.8, y: FL + 0.55, w: 1.0, h: 1.8, kind: 'sash', sill: null }],
    back: [{ x: -1.5, y: FL, w: 0.9, h: 2.1, kind: 'door', style: 'ledged', color: H.olive }, { x: 2.0, y: FL + 0.8, w: 1.2, h: 1.2, kind: 'casement', bars: [2, 2] }] });
  const tr = k.mat('paint_timber', { color: H.cream, name: 'Trim paint' });
  k.part('Corner boards & plinth', [...[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => G.span([sx * W / 2 - 0.06, 0, sz * D / 2 - 0.06], [sx * W / 2 + 0.06, h, sz * D / 2 + 0.06])), G.span([-W / 2 - 0.03, 0, -D / 2 - 0.03], [W / 2 + 0.03, 0.2, D / 2 + 0.03])], tr, { parent: root });
  B.hipRoof(k, root, { W, D, y: h, pitch: 28, over: 0.45, mat: 'corrugated', matOpts: { color: 0xc3c7cb } });
  for (const x of [-2.5, 2.5]) A.chimney(k, root, { x, z: -0.6, y0: h, y1: h + 3.1, w: 0.55, d: 0.9, mat: 'brick_red', capColor: H.cream });
  B.postVerandah(k, root, { x0: -W / 2, x1: W / 2, zWall: D / 2, zFront: D / 2 + 2.1, yBeam: 2.95, stripes: true, trim, roofA: trim, roofB: H.cream, floorMat: 'decking', floorY: FL });
  k.part('Steps', [G.span([-0.9, 0, D / 2 + 2.1], [0.9, 0.3, D / 2 + 2.4], { bevel: 0.01 }), G.span([-0.9, 0, D / 2 + 2.4], [0.9, 0.15, D / 2 + 2.7], { bevel: 0.01 })], 'bluestone', { parent: root });
  B.interiorBox(k, root, { W, D, floors: [FL], h: 3.0, t: 0.15 });
  const yard = k.group('Front garden', root);
  k.part('Path', [G.span([-0.6, 0, D / 2 + 2.7], [0.6, 0.03, D / 2 + 6])], 'tessellated', { parent: yard });
  k.part('Lawn', [G.span([-W / 2, 0, D / 2 + 2.1], [-0.6, 0.02, D / 2 + 6]), G.span([0.6, 0, D / 2 + 2.1], [W / 2, 0.02, D / 2 + 6])], 'grass', { parent: yard });
  A.picketFence(k, yard, -W / 2, W / 2, D / 2 + 6, { gate: [-0.6, 0.6], color: H.white });
  return k;
}

function italianateVilla(k) {
  const W = 12, D = 11, h = 4.2, FL = 0.6, root = k.root;
  const ren = k.mat('render', { color: 0xe6d8b6, name: 'Render (walls)' }), dress = k.mat('render', { color: 0xcbb68c, name: 'Render (dressings)' });
  B.shell(k, root, { W, D, h, t: 0.3, mat: ren, trim: H.cream, surround: 'moulded', dressColor: 0xcbb68c,
    front: [{ x: 1.0, y: FL, w: 1.8, h: 3.0, kind: 'door', fan: 0.5, side: 0.32, color: H.indianRed, step: 0 }, { x: 4.0, y: FL + 0.5, w: 1.1, h: 2.6, kind: 'sash', arch: 'round' }],
    right: [{ x: -3, y: FL + 0.5, w: 1.1, h: 2.6, kind: 'sash', arch: 'round' }, { x: 1, y: FL + 0.5, w: 1.1, h: 2.6, kind: 'sash', arch: 'round' }, { x: 4, y: FL + 0.5, w: 1.1, h: 2.6, kind: 'sash', arch: 'round' }],
    left: [{ x: -3, y: FL + 0.5, w: 1.1, h: 2.6, kind: 'sash', arch: 'round' }, { x: 1, y: FL + 0.5, w: 1.1, h: 2.6, kind: 'sash', arch: 'round' }],
    back: [{ x: 0, y: FL, w: 0.9, h: 2.2, kind: 'door', color: H.olive }] });
  // projecting wing with a canted bay
  const wing = k.group('Front wing', root, { at: [-3.4, 0, D / 2] });
  B.wallWithOpenings(k, wing, { name: 'Wing side', len: 1.7, h, t: 0.3, mat: ren, at: [2.35, 0, 1.7], rot: [0, 90, 0] });
  B.wallWithOpenings(k, wing, { name: 'Wing side', len: 1.7, h, t: 0.3, mat: ren, at: [-2.35, 0, 0], rot: [0, -90, 0] });
  B.wallWithOpenings(k, wing, { name: 'Wing front', len: 4.7, h, t: 0.3, mat: ren, at: [-2.35, 0, 1.7], openings: [{ x: 2.35, y: 0.2, w: 2.6, h: 3.2, kind: 'gap' }] });
  bayWindow(k, { parent: wing, at: [0, 0, 1.7], name: 'Bay window' });
  k.part('Wing roof', [A.hipRoofGeo(-2.35, 2.35, -0.3, 1.7, h, 28, 0.45)], 'slate', { parent: wing });
  // quoins, eaves consoles, plinth
  const cons = []; for (let x = -W / 2 + 0.4; x <= W / 2 - 0.4; x += 0.8) cons.push(G.extrude([[0, 0], [0.05, 0], [0.08, 0.06], [0.1, 0.16], [0.22, 0.22], [0.26, 0.28], [0, 0.28]], 0.1, { at: [x + 0.05, h - 0.3, D / 2], rot: [0, -90, 0] }));
  k.part('Eaves brackets', cons, dress, { parent: root });
  k.part('Plinth', [G.span([-W / 2 - 0.04, 0, -D / 2 - 0.04], [W / 2 + 0.04, FL, D / 2 + 0.04], { bevel: 0.01 })], 'bluestone', { parent: root });
  k.part('String course', [G.sweep(A.STRING_COURSE, [[-W / 2, FL + 0.35, D / 2], [W / 2, FL + 0.35, D / 2]])], dress, { parent: root });
  B.hipRoof(k, root, { W, D, y: h, pitch: 30, over: 0.6, mat: 'slate' });
  for (const x of [-3, 3]) A.chimney(k, root, { x, z: -1, y0: h, y1: h + 3.6, w: 0.7, d: 1.0, mat: k.mat('render', { color: 0xe6d8b6, name: 'Render (walls)' }), capColor: 0xcbb68c });
  B.postVerandah(k, root, { x0: -1.05, x1: W / 2, zWall: D / 2, zFront: D / 2 + 2.4, yBeam: 3.3, trim: H.indianRed, roofA: H.indianRed, roofB: H.cream, stripes: true, floorY: FL });
  k.part('Steps', [G.span([0, 0, D / 2 + 2.4], [2, 0.4, D / 2 + 2.7], { bevel: 0.01 }), G.span([0, 0, D / 2 + 2.7], [2, 0.2, D / 2 + 3.0], { bevel: 0.01 })], 'bluestone', { parent: root });
  B.interiorBox(k, root, { W, D, floors: [FL], h: 3.5, t: 0.3 });
  const yard = k.group('Garden', root);
  k.part('Lawn', [G.span([-W / 2 - 1, 0, D / 2], [W / 2 + 1, 0.02, D / 2 + 7])], 'grass', { parent: yard });
  k.part('Path', [G.span([0.3, 0.0, D / 2 + 3.0], [1.7, 0.03, D / 2 + 7])], 'gravel', { parent: yard });
  A.palisadeFence(k, yard, -W / 2 - 1, W / 2 + 1, D / 2 + 7, { gate: [0.3, 1.7], pierColor: 0xcbb68c });
  return k;
}

function federationVilla(k) {
  const W = 11, D = 11, h = 3.6, FL = 0.5, root = k.root;
  const brick = 'brick_red', white = H.white, timber = k.mat('paint_timber', { color: 0xf1ebdc, name: 'Trim (cream)' });
  B.shell(k, root, { W, D, h, t: 0.27, mat: brick, trim: white,
    front: [{ x: 1.4, y: FL, w: 1.1, h: 2.4, kind: 'door', style: 'glazed', color: 0x6b2a20, fan: 0 }, { x: 3.7, y: FL + 0.7, w: 1.6, h: 1.7, kind: 'casement', bars: [3, 3], frame: white }],
    right: [{ x: -2.5, y: FL + 0.7, w: 1.4, h: 1.7, kind: 'casement', bars: [2, 3] }, { x: 2, y: FL + 0.7, w: 1.4, h: 1.7, kind: 'casement', bars: [2, 3] }],
    left: [{ x: 0, y: FL + 0.7, w: 1.4, h: 1.7, kind: 'casement', bars: [2, 3] }],
    back: [{ x: 0, y: FL, w: 0.9, h: 2.1, kind: 'door', color: 0x6b2a20 }] });
  // projecting gabled wing on the left with a bay of casements
  const wing = k.group('Gabled wing', root, { at: [-2.9, 0, D / 2] }), wW = 5.0, wD = 2.0;
  B.wallWithOpenings(k, wing, { name: 'Wing front', len: wW, h, t: 0.27, mat: brick, at: [-wW / 2, 0, wD], openings: [{ x: wW / 2, y: FL + 0.7, w: 2.4, h: 1.7, kind: 'casement', bars: [4, 3], leaves: 3, frame: white }] });
  B.wallWithOpenings(k, wing, { name: 'Wing side', len: wD, h, t: 0.27, mat: brick, at: [wW / 2, 0, wD], rot: [0, 90, 0] });
  B.wallWithOpenings(k, wing, { name: 'Wing side', len: wD, h, t: 0.27, mat: brick, at: [-wW / 2, 0, 0], rot: [0, -90, 0] });
  // gable: half-timbered infill + barge boards + finial
  const pitch = 40, rise = (wW / 2 + 0.3) * Math.tan(pitch * Math.PI / 180);
  const tri = [[-wW / 2 - 0.3, 0], [wW / 2 + 0.3, 0], [0, rise]];
  k.part('Gable infill', [G.extrude(tri, 0.06, { at: [0, h, wD + 0.12] })], k.mat('render', { color: 0xe9e0c8, name: 'Roughcast' }), { parent: wing });
  const ht = []; for (let i = -3; i <= 3; i++) { const x = i * 0.55, top = rise * (1 - Math.abs(x) / (wW / 2 + 0.3)); if (top > 0.1) ht.push(G.span([x - 0.04, h, wD + 0.17], [x + 0.04, h + top, wD + 0.21])); }
  ht.push(G.span([-wW / 2, h + 0.0, wD + 0.17], [wW / 2, h + 0.1, wD + 0.21]));
  const L = Math.hypot(wW / 2 + 0.45, rise + 0.1), ang = Math.atan2(rise, wW / 2 + 0.3) * 180 / Math.PI;
  for (const s of [-1, 1]) ht.push(G.box(L, 0.25, 0.05, { at: [s * (wW / 4 + 0.15), h + rise / 2, wD + 0.25], rot: [0, 0, -s * ang] }));
  ht.push(G.lathe([[0.0001, 0], [0.06, 0], [0.04, 0.2], [0.07, 0.3], [0.03, 0.45], [0.0001, 0.7]], { seg: 12, at: [0, h + rise - 0.1, wD + 0.25] }));
  k.part('Half-timbering', ht, k.mat('paint_timber', { color: 0x4a2a1e, name: 'Dark timber' }), { parent: wing });
  // gable roof over the wing (ridge along Z)
  const rg = []; for (const s of [-1, 1]) { const sl = Math.hypot(wW / 2 + 0.4, rise + 0.1); rg.push(G.box(sl, 0.04, wD + 2.6, { at: [s * (wW / 4 + 0.1), h + rise / 2 + 0.05, wD / 2 - 0.9], rot: [0, 0, -s * ang] })); }
  k.part('Wing roof', rg, 'terracotta', { parent: wing });
  B.hipRoof(k, root, { W, D, y: h, pitch: 32, over: 0.55, mat: 'terracotta' });
  k.part('Ridge tiles', [G.cyl(0.09, D - (W - D) + 0.2, { axis: 'z', seg: 10, theta: Math.PI, theta0: -Math.PI / 2, at: [0, h + (D / 2 + 0.55) * Math.tan(32 * Math.PI / 180) - 0.32, -0.1] })], 'terracotta', { parent: root });
  for (const [x, z] of [[2.5, -1.5], [-2.5, 2.0]]) A.chimney(k, root, { x, z, y0: h, y1: h + 3.4, w: 0.6, d: 0.9, mat: brick, capMat: 'render', capColor: 0xe9e0c8, pots: 2 });
  // return verandah with turned timber posts & fretwork
  const v = k.group('Verandah', root), vx0 = -0.35, vx1 = W / 2, z0 = D / 2, z1 = D / 2 + 2.2, yb = 2.9;
  const posts = []; for (const x of [vx0 + 0.1, (vx0 + vx1) / 2, vx1 - 0.1]) posts.push(G.box(0.16, 0.25, 0.16, { at: [x, FL + 0.125, z1 - 0.1] }), G.lathe([[0.06, 0], [0.065, 0.1], [0.05, 0.25], [0.07, 0.6], [0.05, 1.0], [0.06, 1.8], [0.07, 1.9], [0.06, yb - FL - 0.25 - 0.1]], { seg: 14, at: [x, FL + 0.25, z1 - 0.1] }));
  k.part('Turned posts', posts, timber, { parent: v });
  k.part('Beam', [G.span([vx0, yb - 0.2, z1 - 0.18], [vx1, yb, z1 - 0.02])], timber, { parent: v });
  A.laceFrieze(k, v, vx0 + 0.1, vx1 - 0.1, yb - 0.2, z1 - 0.1, { color: 0xf1ebdc, h: 0.26 });
  const prof = A.skillionProfile(z0, z1 + 0.2, yb + 0.75, yb);
  k.part('Verandah roof', [A.corrugatedSheet(vx0, vx1 + 0.1, prof)], k.mat('corrugated_painted', { color: 0x8b2f24, name: 'Verandah iron (red)' }), { parent: v, uv: 'keep' });
  k.part('Verandah floor', [G.span([vx0, 0, z0], [vx1, FL, z1])], 'tessellated', { parent: v, collision: 'col' });
  k.part('Plinth', [G.span([-W / 2 - 0.03, 0, -D / 2 - 0.03], [W / 2 + 0.03, FL, D / 2 + 0.03])], 'brick_cream', { parent: root });
  B.interiorBox(k, root, { W, D, floors: [FL], h: 3.0, t: 0.27 });
  const yard = k.group('Garden', root);
  k.part('Lawn', [G.span([-W / 2, 0, D / 2], [W / 2, 0.02, D / 2 + 6])], 'grass', { parent: yard });
  A.picketFence(k, yard, -W / 2, W / 2, D / 2 + 6, { gate: [0.8, 2.0], color: 0xf1ebdc });
  return k;
}

/** Two-storey corner hotel with a posted verandah wrapping both street frontages. */
function cornerPub(k) {
  const W = 13, D = 15, h1 = 4.2, h2 = 3.8, root = k.root, H2 = h1 + h2;
  const ren = k.mat('render', { color: 0xd9c9a6, name: 'Render (walls)' }), dress = k.mat('render', { color: 0xf0e6cf, name: 'Render (dressings)' });
  const up = (n, len) => Array.from({ length: n }, (_, i) => ({ x: -len / 2 + len / (n + 0) * (i + 0.5), y: h1 + 0.8, w: 1.1, h: 2.2, kind: 'sash', arch: 'segment', surround: 'moulded' }));
  const down = (len, door) => [{ x: door, y: 0.15, w: 1.6, h: 3.2, kind: 'door', double: true, style: 'glazed', color: 0x1f3b2c, fan: 0.6 }, ...[-len / 2 + 1.6, -len / 2 + 4.0, len / 2 - 4.0, len / 2 - 1.6].filter((x) => Math.abs(x - door) > 1.8).map((x) => ({ x, y: 1.0, w: 1.6, h: 2.4, kind: 'casement', bars: [1, 2], frame: 0x1f3b2c }))];
  B.shell(k, root, { W, D, h: H2, t: 0.35, mat: ren, trim: H.cream, dressColor: 0xf0e6cf,
    front: [...down(W, W / 2 - 1.4), ...up(5, W)], right: [...down(D, D / 2 - 1.4), ...up(6, D)], left: up(6, D), back: [{ x: 0, y: 0.15, w: 2.4, h: 2.6, kind: 'gap' }] });
  // glazed-tile dado, cornices, parapet with lettering
  const dado = [G.span([-W / 2 - 0.02, 0, D / 2 - 0.02], [W / 2 + 0.02, 1.1, D / 2 + 0.03]), G.span([W / 2 - 0.02, 0, -D / 2], [W / 2 + 0.03, 1.1, D / 2])];
  k.part('Tiled dado', dado, k.mat('tiles_white', { color: 0x2f5e45, name: 'Glazed tiles (green)' }), { parent: root });
  const run = [[-W / 2, 0, D / 2], [W / 2, 0, D / 2], [W / 2, 0, -D / 2]];
  k.part('Cornices', [G.sweep(A.STRING_COURSE, run.map(([x, , z]) => [x, h1 - 0.05, z])), G.sweep(A.CORNICE, run.map(([x, , z]) => [x, H2, z]))], dress, { parent: root });
  B.flatRoof(k, root, { W, D, y: H2 + 0.22, parapet: 1.1, t: 0.35, mat: ren });
  const sign = signTexture(['THE TRAMWAY HOTEL'], { bg: '#d9c9a6', fg: '#3b2a1c', font: 'Georgia, serif', weight: 700, pad: 20, w: 2048, h: 200, spacing: 6 });
  k.part('Parapet lettering', [G.quad(W - 1.5, (W - 1.5) / sign.aspect, { at: [0, H2 + 0.75, D / 2 + 0.012] })], k.texMat('Sign: hotel', { map: sign.map }, { finish: 'matte', roughness: 0.8 }), { parent: root, uv: 'keep' });
  A.signPart(k, root, 'Hotel sign', ['HOTEL'], { bg: '#1f3b2c', fg: '#e8c76a', font: 'Georgia, serif', weight: 700, pad: 20, w: 1024, h: 256, border: 10, borderColor: '#e8c76a' }, { w: 2.4, at: [W / 2 + 0.02, h1 + 0.3, 0], rot: [0, 90, 0] });
  // verandahs over the footpaths (front and side)
  B.postVerandah(k, root, { x0: -W / 2, x1: W / 2 + 3, zWall: D / 2, zFront: D / 2 + 3, yBeam: 3.6, trim: 0x1f3b2c, roofA: 0x1f3b2c, stripes: false, floor: false, name: 'Front verandah' });
  const side = k.group('Side verandah', root, { at: [W / 2, 0, D / 2], rot: [0, 90, 0] });
  B.postVerandah(k, side, { x0: 0, x1: D, zWall: 0, zFront: 3, yBeam: 3.6, trim: 0x1f3b2c, roofA: 0x1f3b2c, stripes: false, floor: false, name: 'Side verandah' });
  k.part('Footpath', [G.span([-W / 2, -0.05, D / 2], [W / 2 + 3.6, 0.0, D / 2 + 3.6]), G.span([W / 2, -0.05, -D / 2], [W / 2 + 3.6, 0.0, D / 2])], 'bluestone', { parent: root, collision: 'col' });
  B.interiorBox(k, root, { W, D, floors: [0.15, h1], h: 3.4, t: 0.35 });
  return k;
}

/** Row of three two-storey Victorian shops with a continuous posted verandah. */
function shopRow(k) {
  const n = 3, sw = 5.6, W = n * sw, D = 12, h1 = 4.0, h2 = 3.6, root = k.root, H2 = h1 + h2;
  const names = ['BAKERY', 'NEWSAGENCY', 'HARDWARE'], cols = [0x7b2f27, 0x1f3b2c, 0x2b4f6a], years = ['1887', '1887', '1889'];
  const ren = k.mat('render', { color: 0xe3d3b1, name: 'Render (walls)' }), dress = k.mat('render', { color: 0xf2e8d0, name: 'Render (dressings)' });
  const front = [];
  for (let i = 0; i < n; i++) { const cx = -W / 2 + sw * (i + 0.5); front.push({ x: cx, y: 0, w: 4.4, h: 3.6, kind: 'shop', sign: names[i], color: cols[i] }, { x: cx - 1.2, y: h1 + 0.8, w: 1.1, h: 2.1, kind: 'sash', surround: 'moulded' }, { x: cx + 1.2, y: h1 + 0.8, w: 1.1, h: 2.1, kind: 'sash', surround: 'moulded' }); }
  B.shell(k, root, { W, D, h: H2, t: 0.3, mat: ren, trim: H.cream, dressColor: 0xf2e8d0, front: front.map((f) => ({ ...f, x: f.x })), back: [{ x: -W / 3, y: 0, w: 0.9, h: 2.1, kind: 'door', style: 'ledged', color: H.olive }, { x: W / 3, y: 0, w: 0.9, h: 2.1, kind: 'door', style: 'ledged', color: H.olive }] });
  const pil = [], ped = [];
  for (let i = 0; i <= n; i++) { const x = -W / 2 + sw * i; pil.push(G.span([x - 0.22, h1, D / 2 - 0.02], [x + 0.22, H2 + 1.2, D / 2 + 0.08])); pil.push(G.span([x - 0.28, H2 + 1.2, D / 2 - 0.05], [x + 0.28, H2 + 1.32, D / 2 + 0.12], { bevel: 0.01 })); }
  for (let i = 0; i < n; i++) { const cx = -W / 2 + sw * (i + 0.5); const arc = []; for (let j = 0; j <= 14; j++) { const t = j / 14; arc.push([cx - 1.4 + 2.8 * t, H2 + 1.2 + Math.sin(t * Math.PI) * 0.55]); } ped.push(G.extrude([...arc, [cx + 1.4, H2 + 1.2], [cx - 1.4, H2 + 1.2]].reverse(), 0.25, { at: [0, 0, D / 2 - 0.25] })); ped.push(G.sweep([[0, 0], [0.06, 0], [0.06, 0.05], [0, 0.07]], arc.map(([x, y]) => [x, y, D / 2]))); }
  k.part('Pilasters', pil, dress, { parent: root });
  k.part('Pediments', ped, dress, { parent: root });
  k.part('Cornice', [G.sweep(A.CORNICE, [[-W / 2, H2, D / 2], [W / 2, H2, D / 2]])], dress, { parent: root });
  B.flatRoof(k, root, { W, D, y: H2 + 0.22, parapet: 1.0, t: 0.3, mat: ren, coping: true });
  for (let i = 0; i < n; i++) { const cx = -W / 2 + sw * (i + 0.5); A.signPart(k, root, 'Date plate', [years[i]], { bg: '#f2e8d0', fg: '#6a5a42', font: 'Georgia, serif', weight: 700, pad: 10, w: 512, h: 160 }, { w: 0.9, at: [cx, H2 + 1.45, D / 2 + 0.012] }); }
  B.postVerandah(k, root, { x0: -W / 2, x1: W / 2, zWall: D / 2, zFront: D / 2 + 3.2, yBeam: 3.75, trim: 0x2b2b2b, roofA: 0x6f7378, stripes: false, floor: false, bay: 2.8 });
  k.part('Footpath', [G.span([-W / 2, -0.05, D / 2], [W / 2, 0, D / 2 + 3.5])], 'bluestone', { parent: root, collision: 'col' });
  k.part('Kerb', [G.span([-W / 2, -0.15, D / 2 + 3.5], [W / 2, 0.0, D / 2 + 3.8], { bevel: 0.02 })], 'bluestone', { parent: root });
  B.interiorBox(k, root, { W, D, floors: [0.05, h1], h: 3.4, t: 0.3 });
  return k;
}

/** 1860s bluestone bond store: two bluestone storeys, a brick top floor, loading doors and a hoist. */
function warehouse(k) {
  const W = 14, D = 16, f = 3.8, root = k.root, T = 0.5;
  const g = k.group('Warehouse', root);
  const doors = (y) => ({ x: 0, y, w: 2.0, h: 2.8, kind: 'door', style: 'ledged', double: true, color: 0x3b2e24, frame: 0x2a2420, metal: 'iron' });
  const iron = (x, y, arch) => ({ x, y, w: 1.4, h: 2.0, kind: 'metal', bars: [3, 4], frame: 0x2a2a2a, arch, sill: 'bluestone' });
  for (let lvl = 0; lvl < 3; lvl++) {
    const mat = lvl < 2 ? 'bluestone' : 'brick_red', y0 = lvl * f;
    const openings = [doors(lvl ? 0.4 : 0.05), iron(-4.5, 0.9), iron(4.5, 0.9)];
    const side = [-5, -1.7, 1.7, 5].map((x) => iron(x, 0.9));
    B.shell(k, g, { name: ['Ground floor', 'First floor', 'Top floor'][lvl], W, D, h: f, t: T, mat, trim: 0x2a2a2a, y0, front: openings, back: [iron(-3, 0.9), iron(3, 0.9)], left: side, right: side });
  }
  k.part('Floor bands', [0, 1, 2].map((i) => G.span([-W / 2 - 0.05, f * i + (i ? -0.12 : 0), -D / 2 - 0.05], [W / 2 + 0.05, f * i + 0.15, D / 2 + 0.05])), 'sandstone', { parent: g });
  B.flatRoof(k, g, { W, D, y: 3 * f, parapet: 1.2, t: T, mat: 'brick_red' });
  const sign = signTexture(['BOND STORE', 'EST. 1868'], { bg: '#2a2420', fg: '#e8dcc2', font: 'Georgia, serif', weight: 700, pad: 24, w: 1024, h: 320 });
  k.part('Painted sign', [G.quad(6, 6 / sign.aspect, { at: [0, 3 * f + 0.6, D / 2 + 0.012] })], k.texMat('Sign: bond store', { map: sign.map }, { finish: 'matte', roughness: 0.85 }), { parent: g, uv: 'keep' });
  k.part('Hoist beam', [G.span([-0.12, 3 * f - 0.2, D / 2 - 0.5], [0.12, 3 * f + 0.05, D / 2 + 1.4]), G.cyl(0.1, 0.12, { axis: 'z', at: [0, 3 * f - 0.3, D / 2 + 1.2] }), G.rod([0, 3 * f - 0.35, D / 2 + 1.25], [0, 4.2, D / 2 + 1.25], 0.012), G.torus(0.06, 0.015, { at: [0, 4.15, D / 2 + 1.25], seg: 16 })], 'steel_dark', { parent: g });
  k.part('Laneway', [G.span([-W / 2 - 1, -0.1, D / 2], [W / 2 + 1, 0, D / 2 + 5])], 'bluestone_cobbles', { parent: root, collision: 'col' });
  B.interiorBox(k, g, { W, D, floors: [0.05, f, 2 * f], h: f - 0.3, t: T });
  return k;
}

/** Bluestone laneway: pitchers with a central dish drain, brick walls, murals, bins and festoon lights. */
function laneway(k) {
  const L = 24, w = 4.6, hW = 9, root = k.root;
  const ground = k.group('Laneway', root);
  for (const s of [-1, 1]) k.part(s < 0 ? 'Pitchers (west)' : 'Pitchers (east)', [G.extrude([[0, 0], [s * w / 2, 0.08], [s * w / 2, -0.2], [0, -0.2]].map(([x, y]) => [x, y]), L, { center: true })], 'bluestone_cobbles', { parent: ground, collision: 'col', uv: 'world' });
  k.part('Drain grate', [G.span([-0.12, -0.03, -L / 2], [0.12, 0.005, -L / 2 + 0.8])], 'steel_dark', { parent: ground });
  const walls = k.group('Walls', root);
  const win = (x, y) => ({ x, y, w: 1.2, h: 1.6, kind: 'metal', bars: [2, 3], frame: 0x2b2b2b, sill: 'bluestone' });
  B.wallWithOpenings(k, walls, { name: 'West wall', len: L, h: hW, t: 0.35, mat: 'brick_red', at: [-w / 2, 0, L / 2], rot: [0, 90, 0], openings: [win(-6, 4.5), win(0, 4.5), win(6, 4.5), { x: -3, y: 0.05, w: 1.0, h: 2.2, kind: 'door', style: 'ledged', color: 0x2f4f3a, metal: 'iron' }].map((o) => ({ ...o, x: o.x + L / 2 })) });
  B.wallWithOpenings(k, walls, { name: 'East wall', len: L, h: hW - 1.5, t: 0.35, mat: 'brick_painted', matOpts: { color: 0xe8e2d4 }, at: [w / 2, 0, -L / 2], rot: [0, -90, 0], openings: [win(-6, 4.0), win(6, 4.0), { x: 4, y: 0.05, w: 2.6, h: 2.8, kind: 'gap' }].map((o) => ({ ...o, x: o.x + L / 2 })) });
  // murals: procedural, abstract street art panels
  const mural = (seed, w2, h2) => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h2 / w2); const x = c.getContext('2d'); let r = seed * 7919; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    const pal = [['#ff4f7b', '#ffd23f', '#3ec1d3', '#1d1d2c', '#f6f7eb'], ['#7b2ff7', '#f107a3', '#00d1b2', '#ffe156', '#101820'], ['#ff6b35', '#004e89', '#1a659e', '#efefd0', '#f7c59f']][seed % 3];
    x.fillStyle = pal[4]; x.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 40; i++) { x.fillStyle = pal[Math.floor(rnd() * 4)]; x.globalAlpha = 0.85; x.beginPath(); const cx = rnd() * c.width, cy = rnd() * c.height, rr = 30 + rnd() * 180; if (rnd() > 0.5) x.arc(cx, cy, rr, 0, Math.PI * 2); else { x.moveTo(cx, cy - rr); x.lineTo(cx + rr, cy + rr); x.lineTo(cx - rr, cy + rr); } x.fill(); }
    x.globalAlpha = 1; x.lineWidth = 14; x.lineCap = 'round';
    for (let i = 0; i < 8; i++) { x.strokeStyle = pal[3]; x.beginPath(); let px = rnd() * c.width, py = rnd() * c.height; x.moveTo(px, py); for (let j = 0; j < 5; j++) { px += (rnd() - 0.5) * 300; py += (rnd() - 0.5) * 200; x.quadraticCurveTo(px + 60, py - 80, px, py); } x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.name = 'Mural'; return t;
  };
  const m1 = k.texMat('Mural A', { map: mural(1, 6, 3.5) }, { finish: 'matte', roughness: 0.85 }), m2 = k.texMat('Mural B', { map: mural(2, 5, 3) }, { finish: 'matte', roughness: 0.85 });
  k.part('Mural', [G.quad(6, 3.5, { at: [-w / 2 + 0.002, 2.0, 3.0], rot: [0, 90, 0] })], m1, { parent: walls, uv: 'keep', pivot: 'center' });
  k.part('Mural', [G.quad(5, 3, { at: [w / 2 - 0.002, 1.8, -2.0], rot: [0, -90, 0] })], m2, { parent: walls, uv: 'keep', pivot: 'center' });
  // bins and festoon lights
  const props = k.group('Props', root);
  const bin = (x, z, c) => { const g2 = k.group('Wheelie bin', props, { at: [x, 0, z], rot: [0, 90, 0] }); k.part('Bin', [G.box(0.58, 0.95, 0.7, { bevel: 0.03, at: [0, 0.5, 0] }), G.box(0.62, 0.05, 0.75, { bevel: 0.02, at: [0, 1.0, 0.02] })], k.mat('plastic', { color: c, name: 'Bin plastic' }), { parent: g2 }); k.part('Wheels', [G.cyl(0.1, 0.06, { axis: 'z', at: [0.25, 0.1, -0.38] }), G.cyl(0.1, 0.06, { axis: 'z', at: [-0.25, 0.1, -0.38] })], 'rubber', { parent: g2 }); };
  bin(-w / 2 + 0.5, -5, 0x2f6b3a); bin(-w / 2 + 0.5, -5.8, 0xc9a13b); bin(w / 2 - 0.5, 7, 0x8a2a2a);
  const wire = [], bulbs = [];
  for (let i = 0; i < 4; i++) { const z = -9 + i * 6, a = [-w / 2, 6.0, z - 1.5], b = [w / 2, 6.0, z + 1.5], m = [0, 5.4, z]; wire.push(G.tube([a, m, b], 0.006, { seg: 24, rseg: 4 })); for (let j = 1; j < 10; j++) { const t = j / 10, p = [a[0] + (b[0] - a[0]) * t, 6.0 - Math.sin(t * Math.PI) * 0.6, a[2] + (b[2] - a[2]) * t]; bulbs.push(G.sphere(0.045, { seg: 10, at: [p[0], p[1] - 0.06, p[2]] })); } }
  k.part('Festoon wire', wire, 'rubber', { parent: props, uv: 'keep' });
  k.part('Festoon bulbs', bulbs, k.mat('light', { name: 'Warm bulbs', color: 0xffe3b0, emissive: 0xffc070, emissiveIntensity: 4 }), { parent: props, shadow: false });
  return k;
}

export default [
  { id: 'mel_weatherboard', name: 'Weatherboard Cottage', category: 'Melbourne', env: 'DAYLIGHT', tags: ['victorian', 'house', 'weatherboard', 'cottage', 'double fronted', 'verandah', 'northcote'], desc: 'Double-fronted Victorian weatherboard with hip roof, striped bullnose verandah, iron lace and picket fence.', build: (k) => weatherboardCottage(k) },
  { id: 'mel_weatherboard_blue', name: 'Weatherboard Cottage (Blue)', category: 'Melbourne', env: 'GOLDEN', tags: ['victorian', 'house', 'weatherboard', 'cottage'], desc: 'The cottage in heritage blue-grey with Indian red trims.', build: (k) => weatherboardCottage(k, { wall: 0x9fb0bb, trim: H.indianRed }) },
  { id: 'mel_italianate', name: 'Italianate Villa', category: 'Melbourne', env: 'DAYLIGHT', tags: ['victorian', 'villa', 'italianate', 'mansion', 'bay window', 'slate'], desc: 'Rendered boom-era villa: canted bay wing, round-headed windows, eaves brackets, slate roof and lace verandah.', build: (k) => italianateVilla(k) },
  { id: 'mel_federation', name: 'Federation Villa', category: 'Melbourne', env: 'GOLDEN', tags: ['federation', 'edwardian', 'house', 'red brick', 'terracotta', 'gable', 'half timber'], desc: 'Red-brick Federation house with terracotta roof, half-timbered gable, leadlight casements and a fretwork verandah.', build: (k) => federationVilla(k) },
  { id: 'mel_corner_pub', name: 'Corner Pub', category: 'Melbourne', env: 'CITY', tags: ['pub', 'hotel', 'corner', 'victorian', 'verandah', 'two storey'], desc: 'Two-storey Victorian corner hotel with tiled dado, lettered parapet and verandahs over both footpaths.', build: (k) => cornerPub(k) },
  { id: 'mel_shop_row', name: 'Victorian Shop Row', category: 'Melbourne', env: 'CITY', tags: ['shops', 'shopfront', 'high street', 'victorian', 'verandah', 'two storey'], desc: 'Three two-storey shops with timber shopfronts, pediments, date plates and a posted verandah.', build: (k) => shopRow(k) },
  { id: 'mel_warehouse', name: 'Bluestone Warehouse', category: 'Melbourne', env: 'CITY', tags: ['warehouse', 'bluestone', 'bond store', 'industrial', 'heritage'], desc: '1860s bond store: bluestone walls, brick top floor, iron windows, loading doors and hoist beam.', build: (k) => warehouse(k) },
  { id: 'mel_laneway', name: 'Bluestone Laneway', category: 'Melbourne', env: 'CITY', tags: ['laneway', 'lane', 'street art', 'mural', 'bluestone', 'cobbles', 'festoon'], desc: 'Melbourne laneway: bluestone pitchers with a dish drain, brick walls, murals, bins and festoon lights.', build: (k) => laneway(k) },
];
