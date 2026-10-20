// Buildings: contemporary apartment tower, glass office tower, Art Deco flats, modern house,
// bluestone church, sawtooth factory, garden shed and a garage. Front faces +Z.
import * as THREE from 'three';
import { G, planSlab, csg } from '../kit.js';
import * as A from '../arch.js';
import * as B from '../building.js';
import { signTexture } from '../decor.js';

const H = A.HERITAGE;

/** Contemporary Melbourne apartment tower: concrete frame, glazing, coloured spandrels and balconies. */
function apartmentTower(k, { floors = 12, W = 18, D = 16 } = {}) {
  const fh = 3.1, root = k.root, top = floors * fh + 1.2;
  const conc = k.mat('concrete', { name: 'Concrete', color: 0xd2cfca }), glass = k.mat('glass_tinted', { name: 'Curtain glass', color: 0x3a4a52, opacity: 0.85 });
  const cols = [0xe0573b, 0xf0b33a, 0x3a8fb7, 0x2f9e5b, 0xe8e4dc];
  const core = k.group('Tower', root);
  k.part('Podium', [G.span([-W / 2 - 1, 0, -D / 2 - 1], [W / 2 + 1, 4.2, D / 2 + 1])], conc, { parent: core, collision: 'col' });
  k.part('Lobby glass', [G.quad(W - 2, 3.4, { at: [0, 2.0, D / 2 + 1.01] })], 'glass', { parent: core, shadow: false });
  k.part('Glazing', [G.span([-W / 2 + 0.3, 4.2, -D / 2 + 0.3], [W / 2 - 0.3, top - 1.2, D / 2 - 0.3])], glass, { parent: core });
  const slabs = [], fins = [], panels = new Map(), rails = [];
  for (let f = 0; f <= floors; f++) { const y = 4.2 + f * fh; slabs.push(G.span([-W / 2, y - 0.25, -D / 2], [W / 2, y, D / 2])); }
  for (let f = 0; f < floors; f++) {
    const y = 4.2 + f * fh;
    for (let i = 0; i < 6; i++) {
      const x = -W / 2 + W / 6 * (i + 0.5), c = cols[(i * 3 + f * 2) % cols.length];
      if (!panels.has(c)) panels.set(c, []);
      if ((i + f) % 3 === 0) panels.get(c).push(G.span([x - W / 12 + 0.1, y, D / 2 - 0.05], [x + W / 12 - 0.1, y + 1.0, D / 2 + 0.02]));
      if ((i + f) % 2 === 1) { slabs.push(G.span([x - W / 12 + 0.15, y - 0.25, D / 2], [x + W / 12 - 0.15, y, D / 2 + 1.6])); rails.push(G.quad(W / 6 - 0.3, 1.05, { at: [x, y + 0.52, D / 2 + 1.58] })); }
    }
    for (let i = 0; i <= 6; i++) fins.push(G.span([-W / 2 + W / 6 * i - 0.12, y, D / 2 - 0.1], [-W / 2 + W / 6 * i + 0.12, y + fh - 0.25, D / 2 + 0.25]));
  }
  k.part('Floor slabs & balconies', slabs, conc, { parent: core });
  k.part('Fins', fins, conc, { parent: core });
  for (const [c, geos] of panels) k.part('Spandrel panels', geos, k.mat('gloss', { color: c, name: 'Facade panel' }), { parent: core });
  k.part('Glass balustrades', rails, 'glass', { parent: core, shadow: false });
  k.part('Roof plant', [G.span([-4, top - 1.2, -3], [4, top + 1.0, 3]), G.span([-W / 2, top - 1.2, -D / 2], [W / 2, top - 0.2, D / 2])], k.mat('steel_dark', { name: 'Plant screen', color: 0x50555a }), { parent: core });
  return k;
}

/** Glass office tower with a crown and podium. */
function officeTower(k, { floors = 20 } = {}) {
  const W = 24, D = 24, fh = 3.8, root = k.root, h = 6 + floors * fh;
  const g = k.group('Office tower', root);
  k.part('Podium', [G.span([-W / 2 - 2, 0, -D / 2 - 2], [W / 2 + 2, 6, D / 2 + 2])], k.mat('sandstone', { name: 'Stone cladding' }), { parent: g, collision: 'col' });
  k.part('Curtain wall', [G.box(W, h - 6, D, { at: [0, 6 + (h - 6) / 2, 0] })], k.mat('glass_tinted', { name: 'Reflective glass', color: 0x2b3f4f, opacity: 1, metalness: 0.6 }), { parent: g });
  const mul = []; for (let i = 0; i <= 16; i++) { const t = -W / 2 + W * i / 16; mul.push(G.span([t - 0.05, 6, D / 2], [t + 0.05, h, D / 2 + 0.12]), G.span([t - 0.05, 6, -D / 2 - 0.12], [t + 0.05, h, -D / 2]), G.span([W / 2, 6, t - 0.05], [W / 2 + 0.12, h, t + 0.05]), G.span([-W / 2 - 0.12, 6, t - 0.05], [-W / 2, h, t + 0.05])); }
  for (let f = 0; f <= floors; f++) { const y = 6 + f * fh; mul.push(G.span([-W / 2 - 0.12, y - 0.08, -D / 2 - 0.12], [W / 2 + 0.12, y + 0.08, D / 2 + 0.12])); }
  k.part('Mullions', mul, k.mat('aluminium', { name: 'Mullions', color: 0xa9adb1 }), { parent: g });
  k.part('Crown', [G.span([-W / 2 - 0.3, h, -D / 2 - 0.3], [W / 2 + 0.3, h + 3, D / 2 + 0.3]), G.span([-3, h + 3, -3], [3, h + 8, 3])], k.mat('aluminium', { name: 'Crown', color: 0xd7d9db }), { parent: g });
  k.part('Entry glass', [G.quad(10, 4.5, { at: [0, 2.5, D / 2 + 2.01] })], 'glass', { parent: g, shadow: false });
  k.part('Entry canopy', [G.span([-6, 4.6, D / 2 + 2], [6, 4.8, D / 2 + 5])], 'steel', { parent: g });
  return k;
}

/** 1930s Art Deco flats in cream brick with a rounded stair tower and horizontal bands. */
function decoFlats(k) {
  const W = 16, D = 12, f = 3.0, n = 3, root = k.root, h = n * f;
  const g = k.group('Flats', root);
  const win = (x, y) => ({ x, y, w: 1.8, h: 1.6, kind: 'metal', bars: [3, 2], frame: 0x1f2a24, sill: true });
  for (let i = 0; i < n; i++) B.shell(k, g, { name: 'Level ' + (i + 1), W, D, h: f, t: 0.3, y0: i * f, mat: 'brick_cream', front: [win(-5.5, 0.9), win(-2.2, 0.9), win(2.2, 0.9), win(5.5, 0.9)], back: [win(-4, 0.9), win(4, 0.9)], left: [win(-2, 0.9), win(2.5, 0.9)], right: [win(-2, 0.9), win(2.5, 0.9)] });
  const bands = []; for (let i = 0; i <= n; i++) bands.push(G.span([-W / 2 - 0.08, i * f + (i ? -0.12 : 0), -D / 2 - 0.08], [W / 2 + 0.08, i * f + 0.18, D / 2 + 0.08]));
  k.part('Render bands', bands, k.mat('render', { color: 0xf3ead6, name: 'Render (bands)' }), { parent: g });
  // rounded stair tower with a glass strip and a flag fin
  let tower = csg(planSlab(3.2, 3.2, 1.6, 0, h + 1.5), [G.box(0.9, h - 1.2, 4, { at: [0, h / 2 + 0.6, 1.6] })]);
  tower = tower.translate(0, 0, D / 2 + 0.6);
  k.part('Stair tower', [tower], 'brick_cream', { parent: g, uv: 'world' });
  k.part('Tower glass', [G.quad(0.9, h - 1.2, { at: [0, h / 2 + 0.6, D / 2 + 1.5] })], k.mat('glass', { name: 'Glass bricks', color: 0xcfe0e6, opacity: 0.6 }), { parent: g, shadow: false });
  k.part('Fin', [G.span([-0.12, 2.5, D / 2 + 2.2], [0.12, h + 2.6, D / 2 + 2.9]), G.cyl(0.03, 2.5, { at: [0, h + 2.6, D / 2 + 2.5] })], k.mat('render', { color: 0xf3ead6, name: 'Render (bands)' }), { parent: g });
  A.doorway(k, g, { name: 'Entry', at: [0, 0, D / 2 + 2.2], w: 1.4, h: 2.4, style: 'glazed', double: true, color: 0x1f2a24, frame: 0x1f2a24, metal: 'chrome', inset: 0.0 });
  const sign = signTexture(['ALDEBARAN COURT'], { bg: '#f3ead6', fg: '#1f2a24', font: 'Futura, "Century Gothic", Arial, sans-serif', weight: 700, pad: 16, w: 2048, h: 180, spacing: 8 });
  k.part('Name', [G.quad(5, 5 / sign.aspect, { at: [0, 2.85, D / 2 + 2.215] })], k.texMat('Sign: deco', { map: sign.map }, { finish: 'matte' }), { parent: g, uv: 'keep' });
  B.flatRoof(k, g, { W, D, y: h + 0.15, parapet: 0.8, t: 0.3, mat: 'brick_cream' });
  B.interiorBox(k, g, { W, D, floors: [0.05, f, 2 * f], h: f - 0.3, t: 0.3 });
  return k;
}

/** Contemporary house: timber-clad box, cantilevered upper level, big glazing and a flat roof. */
function modernHouse(k) {
  const root = k.root, g = k.group('House', root);
  const lower = { W: 12, D: 9, h: 3.0 }, upper = { W: 9, D: 8, h: 2.9 };
  const cladM = k.mat('oak', { name: 'Timber cladding', color: 0xd9b38a }), renM = k.mat('render', { color: 0xeeeeea, name: 'Render (white)' });
  B.shell(k, g, { name: 'Ground floor', W: lower.W, D: lower.D, h: lower.h, t: 0.25, mat: renM, front: [{ x: -2.5, y: 0.05, w: 5.4, h: 2.6, kind: 'metal', leaves: 3, frame: 0x222222, tint: true }, { x: 3.5, y: 0.05, w: 1.2, h: 2.5, kind: 'door', style: 'flush', color: 0x222222, metal: 'steel' }], left: [{ x: 0, y: 0.9, w: 2.0, h: 1.2, kind: 'metal', frame: 0x222222 }], back: [{ x: 0, y: 0.05, w: 6, h: 2.6, kind: 'metal', leaves: 3, frame: 0x222222 }] });
  const up = k.group('Upper floor', g, { at: [1.5, lower.h, -0.5] });
  B.shell(k, up, { W: upper.W, D: upper.D, h: upper.h, t: 0.25, mat: cladM, front: [{ x: -1.0, y: 0.1, w: 6.0, h: 2.4, kind: 'metal', leaves: 3, frame: 0x222222, tint: true }], right: [{ x: 0, y: 0.8, w: 2.0, h: 1.2, kind: 'metal', frame: 0x222222 }] });
  k.part('Upper slab', [G.span([-upper.W / 2 - 0.3, -0.3, -upper.D / 2 - 0.3], [upper.W / 2 + 0.3, 0.0, upper.D / 2 + 1.0])], renM, { parent: up });
  B.flatRoof(k, up, { W: upper.W + 0.6, D: upper.D + 0.6, y: upper.h + 0.3, parapet: 0.3, t: 0.3, mat: renM, coping: false });
  B.flatRoof(k, g, { W: lower.W, D: lower.D, y: lower.h, parapet: 0, mat: renM });
  k.part('Deck', [G.span([-lower.W / 2, 0, lower.D / 2], [lower.W / 2, 0.15, lower.D / 2 + 3])], 'decking', { parent: g, collision: 'col' });
  k.part('Lawn', [G.span([-lower.W / 2 - 3, -0.05, lower.D / 2 + 3], [lower.W / 2 + 3, 0.0, lower.D / 2 + 9])], 'grass', { parent: g });
  B.interiorBox(k, g, { W: lower.W, D: lower.D, floors: [0.05], h: 2.9, t: 0.25 });
  return k;
}

/** Bluestone Gothic Revival church with spire, buttresses and lancet windows. */
function church(k) {
  const root = k.root, W = 11, D = 22, h = 7.5, g = k.group('Church', root);
  const lancet = (x) => ({ x, y: 2.0, w: 1.0, h: 4.2, kind: 'gap', arch: 'round' });
  B.shell(k, g, { name: 'Nave', W, D, h, t: 0.6, mat: 'bluestone', left: [-7.5, -2.5, 2.5, 7.5].map(lancet), right: [-7.5, -2.5, 2.5, 7.5].map(lancet), front: [{ x: 0, y: 0, w: 2.2, h: 4.0, kind: 'gap', arch: 'round' }, { x: 0, y: 5.0, w: 2.6, h: 4.5, kind: 'gap', arch: 'round' }] });
  const pitch = 50, rise = (W / 2 + 0.4) * Math.tan(pitch * Math.PI / 180);
  k.part('Gable', [G.extrude([[-W / 2, 0], [W / 2, 0], [0, rise - 0.3]], 0.6, { at: [0, h, D / 2 - 0.6], holes: [] })], 'bluestone', { parent: g });
  const rf = []; const sl = Math.hypot(W / 2 + 0.5, rise), ang = Math.atan2(rise, W / 2 + 0.4) * 180 / Math.PI;
  for (const s of [-1, 1]) rf.push(G.box(sl, 0.05, D + 0.6, { at: [s * (W / 4 + 0.15), h + rise / 2, 0], rot: [0, 0, -s * ang] }));
  k.part('Roof', rf, 'slate', { parent: g });
  const glassM = k.texMat('Stained glass', { map: signTexture([' '], { bg: '#2b4f8a', w: 64, h: 128 }).map }, { finish: 'glass', color: 0x6a5aa8, opacity: 0.9, transparent: true, emissive: 0x302860, emissiveIntensity: 0.4 });
  const glass = [];
  for (const s of [-1, 1]) for (const z of [-7.5, -2.5, 2.5, 7.5]) glass.push(G.quad(1.0, 4.7, { at: [s * (W / 2 - 0.3), 2.0 + 2.35, z], rot: [0, s * 90, 0] }));
  glass.push(G.quad(2.6, 5.0, { at: [0, 5.0 + 2.5, D / 2 - 0.3] }));
  k.part('Leadlight', glass, glassM, { parent: g, shadow: false });
  A.doorway(k, g, { name: 'Doors', at: [0, 0, D / 2], w: 2.2, h: 3.0, style: 'ledged', double: true, color: 0x5a1f24, frame: 0x3b2a22, metal: 'iron', inset: 0.3 });
  const butt = []; for (const s of [-1, 1]) for (const z of [-10, -5, 0, 5, 10]) butt.push(G.extrude([[0, 0], [0.9, 0], [0.9, 2.5], [0.4, 5.5], [0, 6.5]], 0.7, { at: [s * (W / 2), 0, z - 0.35], rot: [0, s > 0 ? 0 : 180, 0] }).translate(0, 0, s > 0 ? 0 : 0.7));
  k.part('Buttresses', butt, 'bluestone', { parent: g });
  // tower & spire at the front left
  const T = 4.2, th = 16, tw = k.group('Tower', g, { at: [-W / 2 - T / 2 + 0.3, 0, D / 2 - T / 2] });
  B.shell(k, tw, { W: T, D: T, h: th, t: 0.6, mat: 'bluestone', front: [{ x: 0, y: 11.5, w: 1.0, h: 2.6, kind: 'gap', arch: 'round' }], left: [{ x: 0, y: 11.5, w: 1.0, h: 2.6, kind: 'gap', arch: 'round' }], right: [{ x: 0, y: 11.5, w: 1.0, h: 2.6, kind: 'gap', arch: 'round' }], back: [{ x: 0, y: 11.5, w: 1.0, h: 2.6, kind: 'gap', arch: 'round' }] });
  const spire = new THREE.ConeGeometry(T * 0.62, 14, 8, 1, false, Math.PI / 8); spire.translate(0, th + 7, 0);
  k.part('Spire', [spire], 'slate', { parent: tw });
  k.part('Cross', [G.box(0.12, 1.4, 0.12, { at: [0, th + 14.6, 0] }), G.box(0.8, 0.12, 0.12, { at: [0, th + 14.8, 0] })], 'iron', { parent: tw });
  k.part('Pinnacles', [-1, 1].flatMap((sx) => [-1, 1].map((sz) => G.cyl(0.25, 2.2, { r2: 0.02, seg: 8, at: [sx * (T / 2 - 0.25), th, sz * (T / 2 - 0.25)] }))), 'sandstone', { parent: tw });
  return k;
}

/** Brick factory with a sawtooth roof. */
function factory(k) {
  const root = k.root, W = 24, D = 18, h = 5.5, g = k.group('Factory', root), n = 4, bay = D / n;
  const win = (x) => ({ x, y: 1.4, w: 2.2, h: 2.6, kind: 'metal', bars: [4, 4], frame: 0x2a2a2a, sill: 'concrete' });
  B.shell(k, g, { W, D, h, t: 0.35, mat: 'brick_modern', front: [-8, -4, 4, 8].map(win).concat([{ x: 0, y: 0.05, w: 4, h: 4.2, kind: 'gap' }]), back: [-8, 0, 8].map(win), left: [-5, 0, 5].map(win), right: [-5, 0, 5].map(win) });
  const saw = [], glz = [];
  for (let i = 0; i < n; i++) {
    const z0 = -D / 2 + bay * i, z1 = z0 + bay, peak = 2.6;
    saw.push(G.extrude([[z0, 0], [z1, 0], [z1, peak]].map(([z, y]) => [-z, y]), W + 0.4, { at: [-W / 2 - 0.2, h, 0], rot: [0, 90, 0] }));
    glz.push(G.quad(W, peak - 0.3, { at: [0, h + peak / 2, z1 + 0.02], rot: [0, 0, 0] }));
  }
  k.part('Sawtooth roof', saw, 'corrugated', { parent: g, matOpts: { color: 0xa9b0b5 } });
  k.part('Roof glazing', glz, k.mat('glass_frosted', { name: 'Wired glass' }), { parent: g, shadow: false });
  const d = k.group('Roller door', g, { at: [0, 0, D / 2] });
  const slats = []; for (let y = 0; y < 4.2; y += 0.08) slats.push(G.box(4, 0.075, 0.03, { at: [0, y + 0.04, -0.15] }));
  k.part('Roller door', slats, k.mat('corrugated_painted', { color: 0x9aa3a8, name: 'Roller door' }), { parent: d, uv: 'keep' });
  const sign = signTexture(['SMITH & SONS', 'ENGINEERING WORKS'], { bg: '#f1ece2', fg: '#7b2f27', font: 'Georgia, serif', weight: 700, pad: 20, w: 2048, h: 400 });
  k.part('Painted sign', [G.quad(12, 12 / sign.aspect, { at: [0, h - 0.4, D / 2 + 0.012] })], k.texMat('Sign: factory', { map: sign.map }, { finish: 'matte', roughness: 0.85 }), { parent: g, uv: 'keep' });
  k.part('Forecourt', [G.span([-W / 2 - 2, -0.1, D / 2], [W / 2 + 2, 0, D / 2 + 6])], 'concrete', { parent: g, collision: 'col' });
  return k;
}

function shed(k) {
  const root = k.root, W = 3, D = 2.4, h = 2.1, g = k.group('Shed', root);
  B.shell(k, g, { W, D, h, t: 0.05, mat: k.mat('corrugated_painted', { color: 0x5d7a5a, name: 'Colorbond (shed)' }), front: [{ x: 0, y: 0.02, w: 1.6, h: 1.9, kind: 'gap' }], right: [{ x: 0, y: 1.0, w: 0.8, h: 0.6, kind: 'metal', frame: 0xdddddd }] });
  k.part('Roof', [G.box(W + 0.3, 0.04, D + 0.3, { at: [0, h + 0.04, 0], rot: [-6, 0, 0] })], k.mat('corrugated_painted', { color: 0xd8d8d0, name: 'Colorbond (roof)' }), { parent: g });
  for (const s of [-1, 1]) { const dg = k.group(s < 0 ? 'Left door' : 'Right door', g, { at: [s * 0.8, 0.02, D / 2 + 0.03] }); k.part('Door', [G.box(0.8, 1.88, 0.03, { at: [-s * 0.4, 0.94, 0] })], k.mat('corrugated_painted', { color: 0x5d7a5a, name: 'Colorbond (shed)' }), { parent: dg }); }
  k.part('Slab', [G.span([-W / 2 - 0.1, -0.1, -D / 2 - 0.1], [W / 2 + 0.1, 0.02, D / 2 + 0.3])], 'concrete', { parent: g });
  return k;
}

export default [
  { id: 'b_apartments', name: 'Apartment Tower', category: 'Buildings', env: 'CITY', tags: ['apartments', 'tower', 'modern', 'high rise', 'balconies', 'melbourne'], desc: '12-storey contemporary tower: concrete fins, glazing, coloured spandrel panels and glass balconies.', build: (k) => apartmentTower(k) },
  { id: 'b_office', name: 'Office Tower', category: 'Buildings', env: 'CITY', tags: ['office', 'skyscraper', 'glass', 'cbd', 'tower'], desc: '20-storey reflective glass tower on a stone podium with a lit crown.', build: (k) => officeTower(k) },
  { id: 'b_deco_flats', name: 'Art Deco Flats', category: 'Buildings', env: 'GOLDEN', tags: ['art deco', 'flats', '1930s', 'cream brick', 'apartments'], desc: '1930s cream-brick flats with render bands, a rounded stair tower and a flag fin.', build: (k) => decoFlats(k) },
  { id: 'b_modern_house', name: 'Modern House', category: 'Buildings', env: 'DAYLIGHT', tags: ['house', 'modern', 'contemporary', 'timber', 'cantilever'], desc: 'Two-storey contemporary house with a timber-clad cantilevered upper level and big glazing.', build: (k) => modernHouse(k) },
  { id: 'b_church', name: 'Bluestone Church', category: 'Buildings', env: 'GOLDEN', tags: ['church', 'gothic', 'spire', 'bluestone', 'heritage'], desc: 'Gothic Revival church: bluestone walls, buttresses, lancet windows, slate roof and spire.', build: (k) => church(k) },
  { id: 'b_factory', name: 'Sawtooth Factory', category: 'Buildings', env: 'DAYLIGHT', tags: ['factory', 'industrial', 'warehouse', 'sawtooth'], desc: 'Brick factory with a glazed sawtooth roof, roller door and painted sign.', build: (k) => factory(k) },
  { id: 'b_shed', name: 'Garden Shed', category: 'Buildings', env: 'PARK', tags: ['shed', 'garden', 'backyard', 'colorbond'], desc: 'Colorbond backyard shed with double doors.', build: (k) => shed(k) },
];
