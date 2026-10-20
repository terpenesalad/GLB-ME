// Street & park props: heritage lamp, park bench, bin, bollards, bike hoops, post box, parking sign,
// picnic table, drinking fountain, bus shelter, traffic cone, fire hydrant, planter, café setting.
import * as THREE from 'three';
import { G } from '../kit.js';
import * as A from '../arch.js';
import { leafTexture } from '../decor.js';

const H = A.HERITAGE;
const one = (fn) => (k) => { fn(k, k.root); return k; };

function streetLamp(k, root) {
  const g = k.group('Heritage street lamp', root), m = k.mat('iron', { color: 0x1f2e26, name: 'Lamp iron' });
  const geos = [G.lathe([[0.0001, 0], [0.22, 0], [0.22, 0.1], [0.16, 0.18], [0.16, 0.7], [0.12, 0.85], [0.08, 0.95], [0.0001, 0.95]], { seg: 20 }), G.cyl(0.06, 3.2, { r2: 0.045, seg: 14, at: [0, 0.95, 0] }), G.torus(0.065, 0.02, { at: [0, 2.6, 0], rot: [90, 0, 0] })];
  for (const s of [-1, 1]) { geos.push(G.tube([[0, 3.9, 0], [s * 0.3, 4.05, 0], [s * 0.6, 4.0, 0]], 0.025, { seg: 12 })); geos.push(G.lathe([[0.0001, 0], [0.04, 0], [0.12, 0.12], [0.03, 0.18], [0.0001, 0.2]], { seg: 6, at: [s * 0.6, 4.02, 0], rot: [180, 0, 0] })); geos.push(G.lathe([[0.0001, 0.02], [0.15, 0.02], [0.03, 0.12], [0.03, 0.2], [0.0001, 0.25]], { seg: 6, at: [s * 0.6, 4.02, 0] })); }
  geos.push(G.lathe([[0.0001, 0], [0.05, 0], [0.02, 0.15], [0.0001, 0.3]], { seg: 12, at: [0, 4.1, 0] }));
  k.part('Post', geos, m, { parent: g });
  k.part('Lanterns', [-1, 1].map((s) => G.lathe([[0.04, 0], [0.13, 0.1], [0.13, 0.32], [0.05, 0.4]], { seg: 6, at: [s * 0.6, 3.6, 0] })), k.mat('light', { name: 'Lamp glass', color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 2.5 }), { parent: g, shadow: false });
  for (const s of [-1, 1]) k.light('point', 'Lamp light', { parent: g, at: [s * 0.6, 3.75, 0], color: 0xffd9a0, intensity: 8, distance: 14 });
}
function bench(k, root) {
  const g = k.group('Park bench', root), iron = k.mat('iron', { color: 0x1f2e26, name: 'Cast iron' });
  const ends = []; for (const x of [-0.85, 0.85]) ends.push(G.extrude([[-0.3, 0], [-0.24, 0], [-0.2, 0.42], [0.22, 0.4], [0.26, 0], [0.32, 0], [0.27, 0.46], [-0.22, 0.48], [-0.32, 0.95], [-0.38, 0.95], [-0.27, 0.46]].map(([z, y]) => [z, y]), 0.05, { at: [x - 0.025, 0, 0], rot: [0, 90, 0] }));
  k.part('Iron ends', ends, iron, { parent: g });
  const slats = []; for (let i = 0; i < 5; i++) slats.push(G.box(1.9, 0.035, 0.07, { bevel: 0.008, at: [0, 0.46, -0.18 + i * 0.09] }));
  for (let i = 0; i < 3; i++) slats.push(G.box(1.9, 0.07, 0.035, { bevel: 0.008, at: [0, 0.6 + i * 0.11, -0.25 - i * 0.025], rot: [-12, 0, 0] }));
  k.part('Slats', slats, k.mat('paint_timber', { color: H.brunswick, name: 'Bench slats' }), { parent: g });
}
function bin(k, root) {
  const g = k.group('Street bin', root);
  k.part('Bin', [G.cyl(0.28, 0.95, { seg: 28, at: [0, 0.08, 0] }), G.cyl(0.3, 0.06, { seg: 28, at: [0, 1.0, 0] }), G.lathe([[0.0001, 0], [0.3, 0], [0.22, 0.12], [0.0001, 0.14]], { seg: 28, at: [0, 1.06, 0] })], k.mat('gloss', { color: 0x2b4a3a, name: 'Bin enamel' }), { parent: g });
  k.part('Base', [G.cyl(0.24, 0.08, { seg: 28 })], 'steel_dark', { parent: g });
  k.part('Slot', [G.box(0.25, 0.12, 0.02, { at: [0, 0.82, 0.28] })], 'rubber', { parent: g });
}
function bollards(k, root) {
  const g = k.group('Bollards', root), geos = [];
  for (let i = 0; i < 4; i++) geos.push(G.lathe([[0.0001, 0], [0.1, 0], [0.1, 0.85], [0.08, 0.92], [0.05, 0.95], [0.0001, 0.96]], { seg: 20, at: [i * 1.4 - 2.1, 0, 0] }));
  k.part('Bollards', geos, 'steel', { parent: g });
  k.part('Bands', [0, 1, 2, 3].map((i) => G.cyl(0.102, 0.05, { seg: 20, at: [i * 1.4 - 2.1, 0.75, 0] })), k.mat('matte', { color: 0xf0c22a, name: 'Reflective band' }), { parent: g });
}
function bikeHoops(k, root) {
  const g = k.group('Bike hoops', root), geos = [];
  for (let i = 0; i < 3; i++) { const x = i * 1.0 - 1; geos.push(G.tube([[x, 0, -0.35], [x, 0.7, -0.35], [x, 0.85, -0.2], [x, 0.85, 0.2], [x, 0.7, 0.35], [x, 0, 0.35]], 0.03, { seg: 40, tension: 0.2 })); }
  k.part('Hoops', geos, 'steel', { parent: g });
}
function postBox(k, root) {
  const g = k.group('Post box', root), red = k.mat('gloss', { color: 0xc8211d, name: 'Red enamel' });
  k.part('Pillar', [G.box(0.45, 1.05, 0.4, { bevel: 0.04, at: [0, 0.55, 0] }), G.lathe([[0.0001, 0], [0.3, 0], [0.3, 0.05], [0.0001, 0.18]], { seg: 4, at: [0, 1.08, 0], rot: [0, 45, 0], scale: [1.05, 1, 0.95] })], red, { parent: g });
  k.part('Slot & plate', [G.box(0.25, 0.04, 0.02, { at: [0, 0.85, 0.205] }), G.box(0.2, 0.12, 0.01, { at: [0, 0.65, 0.205] })], 'rubber', { parent: g });
  k.part('Plinth', [G.box(0.5, 0.06, 0.45, { bevel: 0.01, at: [0, 0.03, 0] })], 'concrete', { parent: g });
}
function parkingSign(k, root) {
  const g = k.group('Parking sign', root);
  k.part('Post', [G.cyl(0.035, 2.8, { seg: 12 })], 'aluminium', { parent: g });
  A.signPart(k, g, 'Sign', ['2P', '8AM–6PM', 'MON–SAT'], { bg: '#ffffff', fg: '#1f8a3a', font: 'Arial, Helvetica, sans-serif', weight: 800, border: 14, borderColor: '#1f8a3a', pad: 40, w: 512, h: 700 }, { w: 0.45, at: [0, 2.35, 0.04], both: true });
}
function picnicTable(k, root) {
  const g = k.group('Picnic table', root), t = k.mat('decking', { name: 'Hardwood' });
  const geos = [];
  for (let i = 0; i < 5; i++) geos.push(G.box(1.8, 0.04, 0.14, { bevel: 0.006, at: [0, 0.76, -0.32 + i * 0.16] }));
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) geos.push(G.box(1.8, 0.04, 0.14, { bevel: 0.006, at: [0, 0.45, s * (0.6 + i * 0.16)] }));
  for (const x of [-0.7, 0.7]) { geos.push(G.box(0.07, 0.07, 1.6, { at: [x, 0.42, 0] })); for (const s of [-1, 1]) geos.push(G.box(0.07, 0.85, 0.07, { at: [x, 0.38, s * 0.42], rot: [s * -25, 0, 0] })); }
  k.part('Table', geos, t, { parent: g });
}
function fountain(k, root) {
  const g = k.group('Drinking fountain', root);
  k.part('Column', [G.lathe([[0.0001, 0], [0.25, 0], [0.25, 0.1], [0.16, 0.2], [0.12, 0.8], [0.18, 0.9], [0.25, 0.95], [0.0001, 0.95]], { seg: 24 })], 'bluestone', { parent: g, uv: 'world' });
  k.part('Bowl & spout', [G.lathe([[0.0001, 0], [0.18, 0.02], [0.2, 0.1], [0.18, 0.1], [0.0001, 0.04]], { seg: 24, at: [0, 0.95, 0] }), G.tube([[0, 0.95, -0.1], [0, 1.15, -0.1], [0, 1.18, 0]], 0.015, { seg: 10 })], 'brass', { parent: g });
}
function busShelter(k, root) {
  const g = k.group('Bus shelter', root), steel = k.mat('steel_dark', { name: 'Shelter steel', color: 0x2d3a35 });
  const f = []; for (const x of [-1.8, 0, 1.8]) f.push(G.span([x - 0.05, 0, -0.8], [x + 0.05, 2.4, -0.7])); for (const x of [-1.8, 1.8]) f.push(G.span([x - 0.05, 0, 0.6], [x + 0.05, 2.4, 0.7]));
  f.push(G.extrude([[-2.0, 0], [2.0, 0], [2.0, 0.08], [-2.0, 0.18]], 1.8, { at: [0, 2.4, -0.9] }));
  k.part('Frame & roof', f, steel, { parent: g });
  k.part('Glass', [G.quad(3.5, 2.2, { at: [0, 1.2, -0.75] }), G.quad(1.3, 2.2, { at: [-1.8, 1.2, -0.05], rot: [0, 90, 0] }), G.quad(1.3, 2.2, { at: [1.8, 1.2, -0.05], rot: [0, 90, 0] })], 'glass', { parent: g, shadow: false });
  k.part('Seat', [G.span([-1.4, 0.45, -0.7], [1.4, 0.5, -0.35], { bevel: 0.01 })], 'steel', { parent: g });
  k.part('Slab', [G.span([-2.1, -0.05, -1.0], [2.1, 0.03, 1.0])], 'concrete', { parent: g });
}
function cone(k, root) {
  const g = k.group('Traffic cone', root);
  k.part('Cone', [G.lathe([[0.0001, 0.03], [0.14, 0.03], [0.035, 0.7], [0.0001, 0.7]], { seg: 24 })], k.mat('plastic', { color: 0xff5a1f, name: 'Cone orange' }), { parent: g });
  k.part('Reflective bands', [G.cyl(0.105, 0.08, { r2: 0.085, seg: 24, open: true, at: [0, 0.28, 0] }), G.cyl(0.072, 0.06, { r2: 0.058, seg: 24, open: true, at: [0, 0.48, 0] })], k.mat('gloss', { color: 0xf4f4f4, name: 'Reflective white' }), { parent: g });
  k.part('Base', [G.box(0.38, 0.03, 0.38, { bevel: 0.01, at: [0, 0.015, 0] })], 'rubber', { parent: g });
}
function hydrant(k, root) {
  const g = k.group('Fire hydrant', root), red = k.mat('gloss', { color: 0xc8211d, name: 'Red enamel' });
  k.part('Body', [G.lathe([[0.0001, 0], [0.14, 0], [0.14, 0.05], [0.1, 0.08], [0.1, 0.6], [0.12, 0.62], [0.12, 0.66], [0.08, 0.72], [0.03, 0.78], [0.0001, 0.8]], { seg: 20 }), G.cyl(0.05, 0.36, { axis: 'x', seg: 12, at: [-0.18, 0.45, 0] }), G.cyl(0.06, 0.12, { axis: 'z', seg: 12, at: [0, 0.45, 0.06] })], red, { parent: g });
}
function planter(k, root) {
  const g = k.group('Planter', root);
  k.part('Planter box', [G.box(1.6, 0.6, 0.6, { bevel: 0.02, at: [0, 0.3, 0] })], k.mat('corrugated_rusty', { name: 'Corten steel', color: 0x9a5a3a }), { parent: g, uv: 'world' });
  k.part('Soil', [G.box(1.5, 0.02, 0.5, { at: [0, 0.58, 0] })], k.mat('matte', { color: 0x3b2a1e, name: 'Soil' }), { parent: g });
  const cards = []; let r = 5; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) cards.push(G.quad(0.5, 0.5, { at: [(rnd() - 0.5) * 1.3, 0.82, (rnd() - 0.5) * 0.35], rot: [0, rnd() * 180, 0] }));
  k.part('Plants', cards, k.texMat('Leaves (grass)', leafTexture('grass'), { finish: 'leaf', alphaTest: 0.4, side: THREE.DoubleSide }), { parent: g, uv: 'keep' });
}
function cafeSetting(k, root) {
  const g = k.group('Café setting', root);
  const tab = (x, z) => { k.part('Table', [G.cyl(0.35, 0.03, { seg: 28, at: [x, 0.72, z] }), G.cyl(0.03, 0.72, { seg: 10, at: [x, 0, z] }), G.cyl(0.25, 0.03, { seg: 20, at: [x, 0, z] })], 'aluminium', { parent: g }); };
  const chair = (x, z, ry) => { const c = k.group('Chair', g, { at: [x, 0, z], rot: [0, ry, 0] }); const geos = [G.box(0.42, 0.03, 0.42, { bevel: 0.01, at: [0, 0.45, 0] }), G.box(0.42, 0.4, 0.03, { bevel: 0.01, at: [0, 0.68, -0.2], rot: [-8, 0, 0] })]; for (const sx of [-1, 1]) for (const sz of [-1, 1]) geos.push(G.cyl(0.012, 0.45, { seg: 8, at: [sx * 0.18, 0, sz * 0.18] })); k.part('Chair', geos, k.mat('gloss', { color: 0x2f5d5a, name: 'Chair paint' }), { parent: c }); };
  tab(0, 0); chair(0, 0.55, 180); chair(0, -0.55, 0); chair(0.55, 0, -90);
  k.part('Umbrella', [G.cyl(0.02, 2.4, { seg: 8, at: [0, 0, 0] }), G.cyl(1.3, 0.35, { r2: 0.02, seg: 8, at: [0, 2.1, 0], open: false })], k.mat('fabric', { color: 0xe9e1cf, name: 'Canvas' }), { parent: g });
}

export default [
  { id: 'p_street_lamp', name: 'Heritage Street Lamp', category: 'Street props', env: 'GOLDEN', tags: ['lamp', 'street light', 'heritage', 'cast iron'], desc: 'Double-arm cast-iron lamp post with glowing lanterns and real lights.', build: one(streetLamp) },
  { id: 'p_bench', name: 'Park Bench', category: 'Street props', env: 'PARK', tags: ['bench', 'seat', 'park', 'cast iron'], desc: 'Slatted timber bench with cast-iron ends.', build: one(bench) },
  { id: 'p_bin', name: 'Street Bin', category: 'Street props', env: 'CITY', tags: ['bin', 'rubbish', 'litter'], desc: 'Round enamel street bin.', build: one(bin) },
  { id: 'p_bollards', name: 'Bollards', category: 'Street props', env: 'CITY', tags: ['bollard', 'barrier'], desc: 'Row of stainless bollards with reflective bands.', build: one(bollards) },
  { id: 'p_bike_hoops', name: 'Bike Hoops', category: 'Street props', env: 'CITY', tags: ['bike rack', 'bicycle', 'hoop'], desc: 'Three stainless bike hoops.', build: one(bikeHoops) },
  { id: 'p_post_box', name: 'Post Box', category: 'Street props', env: 'CITY', tags: ['post box', 'mail', 'letterbox'], desc: 'Red pillar post box.', build: one(postBox) },
  { id: 'p_parking_sign', name: 'Parking Sign', category: 'Street props', env: 'CITY', tags: ['sign', 'parking', 'road sign'], desc: '2P parking sign on a post.', build: one(parkingSign) },
  { id: 'p_picnic', name: 'Picnic Table', category: 'Street props', env: 'PARK', tags: ['picnic', 'table', 'park', 'bbq'], desc: 'Hardwood picnic table with bench seats.', build: one(picnicTable) },
  { id: 'p_fountain', name: 'Drinking Fountain', category: 'Street props', env: 'PARK', tags: ['fountain', 'water', 'park', 'bluestone'], desc: 'Bluestone drinking fountain with brass bowl.', build: one(fountain) },
  { id: 'p_bus_shelter', name: 'Bus Shelter', category: 'Street props', env: 'CITY', tags: ['bus stop', 'shelter', 'transport'], desc: 'Glass bus shelter with seat.', build: one(busShelter) },
  { id: 'p_cone', name: 'Traffic Cone', category: 'Street props', env: 'CITY', tags: ['cone', 'roadworks', 'traffic'], desc: 'Orange traffic cone with reflective bands.', build: one(cone) },
  { id: 'p_hydrant', name: 'Fire Hydrant', category: 'Street props', env: 'CITY', tags: ['hydrant', 'fire'], desc: 'Red pillar fire hydrant.', build: one(hydrant) },
  { id: 'p_planter', name: 'Planter Box', category: 'Street props', env: 'CITY', tags: ['planter', 'garden', 'corten'], desc: 'Weathered-steel planter with grasses.', build: one(planter) },
  { id: 'p_cafe', name: 'Café Setting', category: 'Street props', env: 'CITY', tags: ['cafe', 'table', 'chairs', 'umbrella', 'outdoor dining'], desc: 'Footpath café table, three chairs and an umbrella.', build: one(cafeSetting) },
];
