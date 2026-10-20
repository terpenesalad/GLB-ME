// Windows & doors: standalone assemblies that drop into wall openings (origin = bottom centre of
// the opening on the wall's outer face, outside = +Z). Doors and opening windows come with
// "Open" / "Close" animation clips that export to Godot, Blender, Unity and Unreal.
import * as THREE from 'three';
import { G } from '../kit.js';
import * as A from '../arch.js';

const H = A.HERITAGE;
const findAll = (k, re) => k.objects.filter((o) => o.ed.kind === 'group' && re.test(o.name));
const swing = (k, re, deg = 95) => k.openClose(findAll(k, re), (o) => { const right = /Right/.test(o.name) || o.userData.right; o.rotateY((right ? -1 : 1) * deg * Math.PI / 180); });

export function bayWindow(k, o = {}) {
  const g = k.group(o.name || 'Bay window', o.parent ?? k.root, { at: o.at, rot: o.rot }), w = 1.0, h = 2.0, side = 0.8, depth = side * Math.SQRT1_2, sill = 0.75, t = 0.23;
  const cx = w / 2 + depth; // half width of the bay
  // brick base and piers (plan: centre face at z = depth, angled sides back to the wall at z = 0)
  const plan = [[-cx, 0], [-w / 2, depth], [w / 2, depth], [cx, 0]];
  const outline = [...plan, [cx - 0.0, -t], [-cx, -t]];
  const shape = outline.map(([x, z]) => [x, z]);
  const slab = (y0, y1, grow = 0) => { const pts = shape.map(([x, z]) => [x * (1 + grow), z + (z > 0 ? grow : 0)]); const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))); const geo = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false }); geo.rotateX(Math.PI / 2); geo.translate(0, y1, 0); return geo; };
  k.part('Base', [slab(0, sill)], 'brick_red', { parent: g });
  k.part('Sill course', [slab(sill, sill + 0.08, 0.05)], 'bluestone', { parent: g });
  k.part('Head & fascia', [slab(sill + h + 0.08, sill + h + 0.32, 0.02)], k.mat('paint_timber', { color: H.cream, name: 'Window timber' }), { parent: g });
  // three sash windows: centre and two angled sides, separated by timber mullions
  const faces = [[0, depth, 0, w], [-(w / 2 + depth / 2), depth / 2, -45, side], [w / 2 + depth / 2, depth / 2, 45, side]];
  const mull = [];
  faces.forEach(([x, z, ry, ww], i) => { A.sashWindow(k, g, { name: ['Centre sash', 'Left sash', 'Right sash'][i], at: [x, sill + 0.08, z], rot: [0, ry, 0], w: ww - 0.08, h, frame: H.cream, inset: 0.0, sill: null }); });
  for (const [x, z] of plan) mull.push(G.box(0.1, h, 0.1, { at: [x, sill + 0.08 + h / 2, z - 0.03] }));
  k.part('Mullions', mull, k.mat('paint_timber', { color: H.cream, name: 'Window timber' }), { parent: g });
  // roof: low hipped zinc cap
  const roofPts = plan.map(([x, z]) => [x * 1.08, z + 0.08]);
  const ry0 = sill + h + 0.32, apex = [0, ry0 + 0.4, -0.05];
  const pos = [];
  for (let i = 0; i < roofPts.length - 1; i++) { const a = roofPts[i], b = roofPts[i + 1]; pos.push(a[0], ry0, a[1], b[0], ry0, b[1], apex[0], apex[1], apex[2]); }
  pos.push(roofPts[0][0], ry0, roofPts[0][1], apex[0], apex[1], apex[2], roofPts[0][0], ry0, -0.1, roofPts.at(-1)[0], ry0, roofPts.at(-1)[1], roofPts.at(-1)[0], ry0, -0.1, apex[0], apex[1], apex[2]);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.computeVertexNormals();
  const under = rg.clone(); { const p = under.attributes.position.array; for (let i = 0; i < p.length; i += 9) for (let c = 0; c < 3; c++) { const t2 = p[i + 3 + c]; p[i + 3 + c] = p[i + 6 + c]; p[i + 6 + c] = t2; } under.computeVertexNormals(); }
  k.part('Roof', [rg, under], k.mat('steel', { name: 'Zinc', color: 0x9aa0a4, roughness: 0.45 }), { parent: g });
  return k;
}

function porthole(k, { r = 0.35 } = {}) {
  const g = k.group('Porthole window', k.root, { at: [0, r + 0.05, 0] });
  k.part('Frame', [G.torus(r, 0.045, { rseg: 16, seg: 48 }), G.cyl(r + 0.02, 0.14, { axis: 'z', seg: 48, open: true, at: [0, 0, -0.14] })], 'brass', { parent: g });
  const bolts = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; bolts.push(G.sphere(0.015, { seg: 8, at: [Math.cos(a) * (r + 0.02), Math.sin(a) * (r + 0.02), 0.035] })); }
  k.part('Bolts', bolts, 'brass', { parent: g });
  k.part('Glass', [G.cyl(r - 0.01, 0.01, { axis: 'z', seg: 48, at: [0, 0, -0.03] })], 'glass', { parent: g, shadow: false });
  return k;
}

export function shopfront(k, o = {}) {
  const g = k.group(o.name || 'Shopfront', o.parent ?? k.root, { at: o.at, rot: o.rot }), W = o.W ?? 3.6, H2 = 3.2, stall = 0.55, transom = 2.6;
  const tc = o.color ?? 0x1f3b2c, timber = k.mat('paint_timber', { color: tc, name: 'Shopfront timber' });
  const geos = [G.span([-W / 2, 0, -0.15], [W / 2, stall, 0.02], { bevel: 0.01 }), G.span([-W / 2, stall, -0.12], [W / 2, stall + 0.08, 0.05], { bevel: 0.006 })];
  for (const x of [-W / 2, -0.55, 0.55, W / 2 - 0.08]) geos.push(G.span([x, stall, -0.1], [x + 0.08, H2, 0.0]));
  geos.push(G.span([-W / 2, transom, -0.1], [W / 2, transom + 0.08, 0.01]), G.span([-W / 2, H2 - 0.08, -0.12], [W / 2, H2, 0.02]));
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) geos.push(G.box(0.38, 0.12, 0.03, { bevel: 0.01, at: [s * (W / 2 - 0.62) + (i - 1) * 0.4, stall * 0.5, 0.025] }));
  k.part('Frame & stallboard', geos, timber, { parent: g });
  k.part('Shop glass', [G.quad(W / 2 - 0.6, transom - stall - 0.08, { at: [-(W / 4 + 0.27), (transom + stall + 0.08) / 2, -0.05] }), G.quad(W / 2 - 0.6, transom - stall - 0.08, { at: [W / 4 + 0.27, (transom + stall + 0.08) / 2, -0.05] }), G.quad(W - 0.16, H2 - transom - 0.16, { at: [0, (H2 + transom) / 2, -0.05] })], 'glass', { parent: g, shadow: false });
  A.doorway(k, g, { name: 'Shop door', at: [0, 0, 0], w: 1.1, h: transom, fan: 0, style: 'glazed', color: tc, frame: tc, inset: 0.0 });
  if (o.sign !== false) A.signPart(k, g, 'Sign', [o.sign || 'GENERAL STORE'], { bg: '#' + tc.toString(16).padStart(6, '0'), fg: '#e8c76a', font: 'Georgia, serif', weight: 700, pad: 30, border: 8, borderColor: '#e8c76a', w: 1024, h: 180 }, { w: W - 0.2, at: [0, H2 + 0.35, 0.03] });
  if (o.sign !== false) k.part('Sign board', [G.box(W, 0.72, 0.05, { bevel: 0.01, at: [0, H2 + 0.36, 0.0] })], timber, { parent: g });
  return k;
}

function rollerDoor(k, { w = 2.6, h = 2.2 } = {}) {
  const g = k.root;
  k.part('Frame', [G.span([-w / 2 - 0.08, 0, -0.1], [-w / 2, h, 0.02]), G.span([w / 2, 0, -0.1], [w / 2 + 0.08, h, 0.02]), G.box(w + 0.16, 0.4, 0.4, { bevel: 0.04, at: [0, h + 0.2, -0.1] })], 'steel_dark', { parent: g });
  const cur = k.group('Curtain', g, { at: [0, 0, -0.05] });
  const slats = []; for (let y = 0; y < h; y += 0.075) slats.push(G.box(w, 0.07, 0.02, { bevel: 0.008, at: [0, y + 0.035, 0] }));
  slats.push(G.box(w, 0.05, 0.05, { bevel: 0.01, at: [0, 0.025, 0] }));
  k.part('Slats', slats, k.mat('corrugated_painted', { color: 0xb9bdbf, name: 'Colorbond (door)' }), { parent: cur, uv: 'keep' });
  k.part('Handle', [G.box(0.25, 0.04, 0.05, { bevel: 0.01, at: [0, 0.5, 0.03] })], 'steel', { parent: cur });
  k.openClose([cur], (o) => { o.scale.y = 0.04; o.position.y = h - 0.04; });
  return k;
}

function slidingDoor(k, { w = 2.4, h = 2.1 } = {}) {
  const g = k.root, alu = k.mat('aluminium', { color: 0x2b2d30, name: 'Window frame (aluminium)' });
  k.part('Frame', [G.span([-w / 2, 0, -0.12], [-w / 2 + 0.05, h, 0]), G.span([w / 2 - 0.05, 0, -0.12], [w / 2, h, 0]), G.span([-w / 2, h - 0.05, -0.12], [w / 2, h, 0]), G.span([-w / 2, 0, -0.12], [w / 2, 0.03, 0.01])], alu, { parent: g });
  const pw = w / 2;
  const panel = (name, x, z) => { const p = k.group(name, g, { at: [x, 0.03, z] }); k.part('Frame', [G.span([-pw / 2, 0, -0.02], [-pw / 2 + 0.06, h - 0.08, 0.02]), G.span([pw / 2 - 0.06, 0, -0.02], [pw / 2, h - 0.08, 0.02]), G.span([-pw / 2, 0, -0.02], [pw / 2, 0.08, 0.02]), G.span([-pw / 2, h - 0.14, -0.02], [pw / 2, h - 0.08, 0.02])], alu, { parent: p }); k.part('Glass', [G.quad(pw - 0.12, h - 0.22, { at: [0, (h - 0.06) / 2, 0] })], 'glass', { parent: p, shadow: false }); return p; };
  panel('Fixed panel', w / 4 - 0.01, -0.09);
  const s = panel('Sliding panel', -w / 4 + 0.01, -0.04);
  k.part('Handle', [G.box(0.03, 0.3, 0.04, { bevel: 0.01, at: [-w / 4 + pw / 2 - 0.1, 1.0, -0.0] })], 'steel', { parent: s });
  k.openClose([s], (o) => { o.position.x += pw - 0.1; });
  return k;
}

function sectionalGarage(k, { w = 4.8, h = 2.1 } = {}) {
  const g = k.root;
  k.part('Frame', [G.span([-w / 2 - 0.1, 0, -0.12], [-w / 2, h + 0.1, 0.02]), G.span([w / 2, 0, -0.12], [w / 2 + 0.1, h + 0.1, 0.02]), G.span([-w / 2 - 0.1, h, -0.12], [w / 2 + 0.1, h + 0.1, 0.02])], k.mat('paint_timber', { color: 0xf0eee8, name: 'Trim' }), { parent: g });
  const d = k.group('Door', g, { at: [0, 0, -0.06] });
  const panels = []; const n = 4, ph = h / n;
  for (let i = 0; i < n; i++) { panels.push(G.box(w, ph - 0.01, 0.04, { bevel: 0.006, at: [0, ph * (i + 0.5), 0] })); for (let j = 0; j < 8; j++) panels.push(G.box(w / 8 - 0.08, ph - 0.12, 0.012, { bevel: 0.01, at: [-w / 2 + w / 8 * (j + 0.5), ph * (i + 0.5), 0.022] })); }
  k.part('Panels', panels, k.mat('gloss', { color: 0x3a3d40, name: 'Garage door paint', roughness: 0.35 }), { parent: d });
  k.openClose([d], (o) => { o.position.y = h - 0.15; o.position.z = -1.2; o.rotation.x = -Math.PI / 2; o.position.y = h; });
  return k;
}

const win = (o) => (k) => { A.sashWindow(k, k.root, { at: [0, 0, 0], ...o }); if (o.anim) k.openClose(findAll(k, /^Lower sash$/), (x) => { x.position.y += o.h * 0.42; }); return k; };
const door = (o, anim = true) => (k) => { A.doorway(k, k.root, { at: [0, 0, 0], ...o }); if (anim) swing(k, /leaf$/i); return k; };

export default [
  { id: 'w_sash', name: 'Victorian Sash Window', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['window', 'sash', 'double hung', 'victorian'], desc: 'Double-hung timber sash with horns, bluestone sill and moulded architrave. Lower sash slides open.', build: win({ name: 'Sash window', w: 1.1, h: 2.1, sill: 'stone', surround: 'moulded', frame: H.cream, anim: true }) },
  { id: 'w_sash_arched', name: 'Arched Sash Window', category: 'Windows & doors', env: 'DAYLIGHT', tags: ['window', 'sash', 'arched', 'segmental'], desc: 'Segmental-arched sash with cream-brick dressings.', build: win({ name: 'Arched sash window', w: 1.0, h: 2.0, arch: 'segment', sill: 'stone', surround: 'brick', frame: H.white }) },
  { id: 'w_sash_round', name: 'Round-headed Window', category: 'Windows & doors', env: 'DAYLIGHT', tags: ['window', 'arched', 'round', 'italianate'], desc: 'Italianate round-headed sash with keystone surround.', build: win({ name: 'Round-headed window', w: 0.95, h: 2.2, arch: 'round', sill: 'stone', surround: 'moulded', frame: H.cream }) },
  { id: 'w_georgian', name: 'Georgian Sash (6 over 6)', category: 'Windows & doors', env: 'DAYLIGHT', tags: ['window', 'sash', 'colonial', 'georgian', 'glazing bars'], desc: 'Six-over-six colonial sash with glazing bars.', build: win({ name: 'Georgian sash', w: 1.0, h: 1.8, sill: 'stone', panes: [[3, 2], [3, 2]], frame: H.white, horns: false }) },
  { id: 'w_casement', name: 'Cottage Casement', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['window', 'casement', 'cottage', 'glazing bars'], desc: 'Pair of side-hung casements with glazing bars; leaves swing open.', build: (k) => { A.casementWindow(k, k.root, { w: 1.2, h: 1.2, bars: [2, 3], sill: 'bluestone', frame: H.white }); swing(k, /leaf$/i, 80); return k; } },
  { id: 'w_aluminium', name: 'Modern Aluminium Window', category: 'Windows & doors', env: 'DAYLIGHT', tags: ['window', 'modern', 'aluminium', 'black frame'], desc: 'Slim black aluminium window with fixed and opening panes.', build: (k) => { A.casementWindow(k, k.root, { w: 1.8, h: 1.5, metal: true, leaves: 2, sill: true }); return k; } },
  { id: 'w_bay', name: 'Canted Bay Window', category: 'Windows & doors', env: 'DAYLIGHT', tags: ['window', 'bay', 'victorian', 'italianate'], desc: 'Three-sash canted bay on a brick base with zinc roof – drop against any facade.', build: (k) => bayWindow(k) },
  { id: 'w_porthole', name: 'Porthole Window', category: 'Windows & doors', env: 'DAYLIGHT', tags: ['window', 'round', 'porthole', 'brass', 'nautical'], desc: 'Round brass porthole with bolts.', build: (k) => porthole(k) },
  { id: 'w_shopfront', name: 'Victorian Shopfront', category: 'Windows & doors', env: 'CITY', tags: ['shop', 'shopfront', 'window', 'sign', 'retail'], desc: 'Timber shopfront: stallboard, display windows, transom lights, glazed door and signboard.', build: (k) => shopfront(k) },
  { id: 'd_victorian', name: 'Victorian Front Door', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['door', 'front door', 'four panel', 'fanlight', 'sidelights', 'leadlight'], desc: 'Four-panel door with leadlight fanlight and sidelights, brass knocker, letter slot and knob. Swings open.', build: door({ name: 'Front door', w: 1.7, h: 2.75, fan: 0.42, side: 0.3, style: 'panel4', color: H.brunswick, frame: H.cream, step: 0.18 }) },
  { id: 'd_panel', name: 'Four-panel Door', category: 'Windows & doors', env: 'INTERIOR', animated: true, tags: ['door', 'interior door', 'panel'], desc: 'Classic four-panel interior door in a frame. Swings open.', build: door({ name: 'Panel door', w: 0.94, h: 2.1, style: 'panel4', color: H.white, frame: H.white, metal: 'chrome' }) },
  { id: 'd_flush', name: 'Modern Flush Door', category: 'Windows & doors', env: 'INTERIOR', animated: true, tags: ['door', 'modern', 'oak', 'flush'], desc: 'Flush oak-veneer door with chrome lever. Swings open.', build: door({ name: 'Flush door', w: 0.94, h: 2.1, style: 'flush', leafMat: 'oak', color: 0xffffff, frame: H.white, metal: 'chrome' }) },
  { id: 'd_french', name: 'French Doors', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['door', 'french doors', 'glazed', 'double'], desc: 'Pair of glazed French doors with fanlight. Both leaves open.', build: door({ name: 'French doors', w: 1.6, h: 2.6, fan: 0.35, style: 'french', double: true, color: H.white, frame: H.white, metal: 'brass' }) },
  { id: 'd_glazed', name: 'Half-glazed Door', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['door', 'glazed', 'leadlight', 'federation'], desc: 'Federation-style door with leadlight upper panel.', build: door({ name: 'Glazed door', w: 1.0, h: 2.1, style: 'glazed', color: 0x6b2a20, frame: H.cream }) },
  { id: 'd_ledged', name: 'Ledged Shed Door', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['door', 'barn', 'shed', 'rustic', 'ledged'], desc: 'Board-and-ledge door with black strap hinges.', build: door({ name: 'Shed door', w: 1.0, h: 2.1, style: 'ledged', color: H.olive, frame: H.cream, metal: 'iron' }) },
  { id: 'd_sliding', name: 'Sliding Glass Door', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['door', 'sliding', 'glass', 'patio', 'aluminium'], desc: 'Aluminium patio door; the sliding panel glides open.', build: (k) => slidingDoor(k) },
  { id: 'd_roller', name: 'Roller Door', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['door', 'roller', 'garage', 'warehouse'], desc: 'Steel roller door that rolls up into its drum.', build: (k) => rollerDoor(k) },
  { id: 'd_garage', name: 'Sectional Garage Door', category: 'Windows & doors', env: 'DAYLIGHT', animated: true, tags: ['door', 'garage', 'panel lift'], desc: 'Double garage door with raised panels; lifts up and back.', build: (k) => sectionalGarage(k) },
];
