// Trees and plants (river red gum, London plane, Canary Island palm, tree fern, conifer), shrubs,
// hedges, grass, flower beds, rocks and logs. Trees use bark textures on branching tubes and
// alpha-cut leaf cards with canopy-shaped normals (the standard real-time foliage technique).
import * as THREE from 'three';
import { G, mergeAll } from '../kit.js';
import { leafTexture, barkTexture } from '../decor.js';
import { sdfMesh, P, hex, fbm3 } from '../sdf.js';

const rng = (seed) => { let s = seed * 9973 + 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const V = (a) => new THREE.Vector3(...a);

/** Tube with bark UVs in metres (u around, v along). */
function barkTube(pts, r0, r1, seg = 10) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V));
  const L = curve.getLength(), n = Math.max(4, Math.round(L * 6));
  const g = new THREE.TubeGeometry(curve, n, 1, seg, false);
  // taper: scale each ring around its centre
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i <= n; i++) {
    const c = curve.getPointAt(i / n), r = r0 + (r1 - r0) * (i / n);
    for (let j = 0; j <= seg; j++) { const v = i * (seg + 1) + j; p.setXYZ(v, c.x + (p.getX(v) - c.x) * r, c.y + (p.getY(v) - c.y) * r, c.z + (p.getZ(v) - c.z) * r); uv.setXY(v, j / seg * 2 * Math.PI * (r0 + r1) / 2 / 0.8, i / n * L / 1.2); }
  }
  g.computeVertexNormals();
  return g;
}
/** Leaf cluster: crossed alpha cards around a point. */
function cluster(c, s, rnd, cards = 3) {
  const out = [];
  for (let i = 0; i < cards; i++) out.push(G.quad(s, s, { at: c, rot: [rnd() * 70 - 35 + (i === 0 ? 90 : 0), rnd() * 180, rnd() * 40 - 20] }));
  return out;
}
/** Merges leaf cards and points their normals away from the canopy centre (soft, volumetric shading). */
function canopyGeo(cards, centre, squash = 1) {
  const g = mergeAll(cards, { uv: 'keep' });
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i) - centre[0], (p.getY(i) - centre[1]) / squash, p.getZ(i) - centre[2]).normalize(); v.y = v.y * 0.8 + 0.2; v.normalize(); n.setXYZ(i, v.x, v.y, v.z); }
  return g;
}

/** Recursive branching tree. */
function branchingTree(k, { seed = 1, height = 9, trunkR = 0.28, lean = 0.1, levels = 3, spread = 0.9, leaf = 'plane', bark = 'gum', leafSize = 1.4, clusterAt = 2, crown = 0.5, name = 'Tree', droop = 0 } = {}) {
  const rnd = rng(seed), root = k.root, tubes = [], cards = [];
  const grow = (base, dir, len, r, lvl) => {
    const pts = [base];
    let p = V(base), d = V(dir).normalize();
    for (let i = 1; i <= 3; i++) { d.add(new THREE.Vector3((rnd() - 0.5) * 0.35, (rnd() - 0.5) * 0.15 - droop * i * 0.08, (rnd() - 0.5) * 0.35)).normalize(); p = p.clone().addScaledVector(d, len / 3); pts.push(p.toArray()); }
    const rEnd = r * (lvl === 0 ? 0.55 : 0.45);
    tubes.push(barkTube(pts, r, rEnd, lvl === 0 ? 14 : lvl === 1 ? 9 : 6));
    if (lvl >= levels) { cards.push(...cluster(pts.at(-1), leafSize * (0.8 + rnd() * 0.5), rnd, 3)); return; }
    const kids = lvl === 0 ? 4 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < kids; i++) {
      const t = lvl === 0 ? crown + (1 - crown) * (i / kids) : 0.55 + rnd() * 0.45;
      const at = new THREE.CatmullRomCurve3(pts.map(V)).getPointAt(Math.min(1, t)).toArray();
      const a = (i / kids) * Math.PI * 2 + rnd() * 0.8, up = 0.55 + rnd() * 0.5;
      const nd = [Math.cos(a) * spread, up, Math.sin(a) * spread];
      grow(at, nd, len * (0.55 + rnd() * 0.2), r * (lvl === 0 ? 0.45 : 0.55), lvl + 1);
      if (lvl >= clusterAt - 1) cards.push(...cluster(at, leafSize * 0.8, rnd, 2));
    }
  };
  grow([0, 0, 0], [lean, 1, lean * 0.5], height * 0.55, trunkR, 0);
  const g = k.group(name, root);
  k.part('Trunk & branches', tubes, k.texMat('Bark (' + bark + ')', barkTexture(bark), { finish: 'matte', roughness: 0.9 }), { parent: g, uv: 'keep' });
  const ys = cards.map((c) => c.boundingBox ? 0 : 0); void ys;
  const box = new THREE.Box3(); for (const c of cards) { c.computeBoundingBox(); box.union(c.boundingBox); }
  const cen = box.getCenter(new THREE.Vector3()).toArray();
  k.part('Leaves', [canopyGeo(cards, cen, 0.7)], k.texMat('Leaves (' + leaf + ')', leafTexture(leaf), { finish: 'leaf', alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 }), { parent: g, uv: 'keep', shadow: true });
  return k;
}

function palm(k, { seed = 5, height = 7 } = {}) {
  const rnd = rng(seed), g = k.group('Canary Island palm', k.root);
  const trunk = barkTube([[0, 0, 0], [0.1, height * 0.35, 0.05], [0.15, height * 0.7, 0.0], [0.12, height, -0.05]], 0.42, 0.36, 18);
  k.part('Trunk', [trunk], k.texMat('Bark (palm)', barkTexture('palm'), { finish: 'matte', roughness: 0.95 }), { parent: g, uv: 'keep' });
  const top = [0.12, height, -0.05], fronds = [];
  for (let i = 0; i < 34; i++) {
    const a = i * 2.4 + rnd() * 0.3, up = i < 10 ? 0.9 : i < 22 ? 0.4 : -0.1, L = 3.6 + rnd() * 0.8;
    const pts = []; for (let s = 0; s <= 10; s++) { const t = s / 10; pts.push([top[0] + Math.cos(a) * L * t, top[1] + 0.3 + L * (up * t - 0.45 * t * t), top[2] + Math.sin(a) * L * t]); }
    // frond ribbon (width tapers), texture u along, v across
    const pos = [], uv = [], idx = [];
    for (let s = 0; s <= 10; s++) {
      const t = s / 10, w = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05)), p = pts[s], side = [-Math.sin(a), 0.25, Math.cos(a)];
      for (const e of [-1, 1]) { pos.push(p[0] + side[0] * w * e, p[1] + side[1] * w * Math.abs(e) * 0.5, p[2] + side[2] * w * e); uv.push(t, e > 0 ? 1 : 0); }
      if (s) { const b = (s - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); fg.setIndex(idx); fg.computeVertexNormals();
    fronds.push(fg);
  }
  k.part('Fronds', [canopyGeo(fronds, [top[0], top[1] + 0.5, top[2]], 0.5)], k.texMat('Leaves (palm)', leafTexture('palm'), { finish: 'leaf', alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 }), { parent: g, uv: 'keep' });
  return k;
}
function treeFern(k) {
  const rnd = rng(11), g = k.group('Tree fern', k.root), h = 2.6;
  k.part('Trunk', [barkTube([[0, 0, 0], [0.05, h * 0.5, 0.02], [0.02, h, 0.0]], 0.16, 0.14, 12)], k.texMat('Bark (fern)', barkTexture('rough'), { finish: 'matte', color: 0x6a4a3a, roughness: 1 }), { parent: g, uv: 'keep' });
  const fronds = [];
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4, L = 2.0 + rnd() * 0.5, pts = [];
    for (let s = 0; s <= 10; s++) { const t = s / 10; pts.push([Math.cos(a) * L * t, h + 0.1 + L * (0.7 * t - 0.75 * t * t), Math.sin(a) * L * t]); }
    const pos = [], uv = [], idx = [];
    for (let s = 0; s <= 10; s++) { const t = s / 10, w = 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.05)), p = pts[s]; for (const e of [-1, 1]) { pos.push(p[0] - Math.sin(a) * w * e, p[1], p[2] + Math.cos(a) * w * e); uv.push(t, e > 0 ? 1 : 0); } if (s) { const b = (s - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); } }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); fg.setIndex(idx); fg.computeVertexNormals(); fronds.push(fg);
  }
  k.part('Fronds', [canopyGeo(fronds, [0, h + 0.4, 0], 0.5)], k.texMat('Leaves (fern)', leafTexture('palm'), { finish: 'leaf', color: 0x9fc27a, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 }), { parent: g, uv: 'keep' });
  return k;
}
function conifer(k, { seed = 3, h = 7 } = {}) {
  const prims = [P.cone([0, 0, 0], [0, h * 0.3, 0], 0.18, 0.14, hex(0x5a4030), { k: 0.05 })];
  for (let i = 0; i < 6; i++) { const y = h * (0.2 + i * 0.13), r = (1 - i / 6) * h * 0.22 + 0.2; prims.push(P.cone([0, y, 0], [0, y + h * 0.22, 0], r, 0.05, hex(i % 2 ? 0x2c4a2a : 0x335a30), { k: 0.25 })); }
  const geo = sdfMesh(prims, { res: 90, noise: { amp: 0.08, freq: 3.5, oct: 4 }, seed, colorFn: (p, c) => p[1] < h * 0.18 ? c : [c[0] * (0.75 + fbm3(p[0] * 4, p[1] * 4, p[2] * 4) * 0.5), c[1] * (0.75 + fbm3(p[0] * 4, p[1] * 4, p[2] * 4) * 0.5), c[2]] });
  k.part('Conifer', [geo], k.mat('fur', { color: 0xffffff, name: 'Foliage' }), { parent: k.root, uv: 'none' });
  return k;
}
function shrub(k, { kind = 'round', box = false, seed = 4 } = {}) {
  const prims = box ? [P.box([0, 0.6, 0], [2.4, 1.2, 0.8], 0.15, hex(0x2f5426), { k: 0.1 })] : [P.ell([0, 0.55, 0], [0.7, 0.55, 0.65], hex(0x3b6a2c), { k: 0.2 }), P.ell([0.35, 0.45, 0.2], [0.4, 0.4, 0.4], hex(0x3f702e), { k: 0.25 }), P.ell([-0.3, 0.42, -0.25], [0.42, 0.38, 0.4], hex(0x35622a), { k: 0.25 })];
  const geo = sdfMesh(prims, { res: box ? 110 : 80, noise: { amp: box ? 0.025 : 0.06, freq: box ? 12 : 6, oct: 4 }, seed, colorFn: (p, c, n) => { const v = 0.7 + fbm3(p[0] * 9, p[1] * 9, p[2] * 9) * 0.6; const top = n[1] > 0.4 ? 1.1 : 1; return [c[0] * v * top, c[1] * v * top, c[2] * v]; } });
  k.part(box ? 'Hedge' : 'Shrub', [geo], k.mat('fur', { color: 0xffffff, name: 'Foliage', roughness: 0.9, sheen: 0.4 }), { parent: k.root, uv: 'none' });
  if (!box) { const rnd = rng(seed), cards = []; for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, e = rnd() * 1.2; cards.push(...cluster([Math.cos(a) * 0.55 * Math.cos(e * 0.6), 0.5 + Math.sin(e) * 0.45, Math.sin(a) * 0.5 * Math.cos(e * 0.6)], 0.5, rnd, 1)); } k.part('Leaf cards', [canopyGeo(cards, [0, 0.5, 0])], k.texMat('Leaves (' + kind + ')', leafTexture(kind), { finish: 'leaf', alphaTest: 0.45, side: THREE.DoubleSide }), { parent: k.root, uv: 'keep' }); }
  return k;
}
function grass(k) {
  const rnd = rng(9), cards = [];
  for (let i = 0; i < 9; i++) { const x = (rnd() - 0.5) * 0.5, z = (rnd() - 0.5) * 0.5, s = 0.4 + rnd() * 0.25; for (let j = 0; j < 3; j++) cards.push(G.quad(s, s, { at: [x, s / 2, z], rot: [0, j * 60 + rnd() * 30, 0] })); }
  k.part('Grass', [canopyGeo(cards, [0, -0.3, 0])], k.texMat('Leaves (grass)', leafTexture('grass'), { finish: 'leaf', alphaTest: 0.4, side: THREE.DoubleSide }), { parent: k.root, uv: 'keep' });
  return k;
}
function flowerBed(k) {
  const rnd = rng(13), root = k.root;
  k.part('Edging', [G.span([-1.25, 0, -0.65], [1.25, 0.18, -0.55], { bevel: 0.01 }), G.span([-1.25, 0, 0.55], [1.25, 0.18, 0.65], { bevel: 0.01 }), G.span([-1.25, 0, -0.55], [-1.15, 0.18, 0.55], { bevel: 0.01 }), G.span([1.15, 0, -0.55], [1.25, 0.18, 0.55], { bevel: 0.01 })], 'bluestone', { parent: root });
  k.part('Soil', [G.span([-1.15, 0, -0.55], [1.15, 0.14, 0.55])], k.mat('gravel', { color: 0x7a5a42, name: 'Garden soil' }), { parent: root });
  const cards = [], stems = [], heads = new Map();
  const cols = [0xd8344a, 0xf2c230, 0xf2f0ea, 0x8a5ac8, 0xff7a3a];
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - 0.5) * 2.1, z = (rnd() - 0.5) * 1.0, h = 0.25 + rnd() * 0.25;
    stems.push(G.cyl(0.004, h, { seg: 4, at: [x, 0.14, z] }));
    const c = cols[i % cols.length]; if (!heads.has(c)) heads.set(c, []);
    const hh = heads.get(c); for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2; hh.push(G.sphere(0.018, { seg: 6, rings: 4, at: [x + Math.cos(a) * 0.022, 0.14 + h, z + Math.sin(a) * 0.022], scale: [1, 0.4, 1] })); }
    hh.push(G.sphere(0.012, { seg: 6, rings: 4, at: [x, 0.145 + h, z] }));
    if (i % 3 === 0) cards.push(G.quad(0.3, 0.3, { at: [x, 0.28, z], rot: [0, rnd() * 180, 0] }));
  }
  k.part('Stems', stems, k.mat('matte', { color: 0x3f6a2a, name: 'Stem' }), { parent: root });
  for (const [c, geos] of heads) k.part('Flowers', geos, k.mat('fur', { color: c, name: 'Petals', roughness: 0.6 }), { parent: root });
  k.part('Foliage', [canopyGeo(cards, [0, 0, 0])], k.texMat('Leaves (grass)', leafTexture('grass'), { finish: 'leaf', alphaTest: 0.4, side: THREE.DoubleSide }), { parent: root, uv: 'keep' });
  return k;
}
function rocks(k, { seed = 2, big = false } = {}) {
  const rnd = rng(seed), prims = [];
  const n = big ? 1 : 4;
  for (let i = 0; i < n; i++) { const s = big ? 1.4 : 0.25 + rnd() * 0.35, x = big ? 0 : (rnd() - 0.5) * 1.6, z = big ? 0 : (rnd() - 0.5) * 1.2; prims.push(P.ell([x, s * 0.35, z], [s, s * 0.7, s * 0.85], hex(0x6b6862), { rot: [rnd() * 20, rnd() * 180, rnd() * 20], k: 0.05 })); }
  const geo = sdfMesh(prims, { res: big ? 110 : 90, noise: { amp: big ? 0.18 : 0.05, freq: big ? 1.6 : 5, oct: 5 }, seed, colorFn: (p, c, nn) => { const v = 0.75 + fbm3(p[0] * 6, p[1] * 6, p[2] * 6) * 0.45; const moss = nn[1] > 0.6 ? 0.35 : 0; return [c[0] * v * (1 - moss) + 0.32 * moss, c[1] * v * (1 - moss) + 0.42 * moss, c[2] * v * (1 - moss) + 0.2 * moss]; } });
  geo.translate(0, -0.06, 0);
  k.part(big ? 'Boulder' : 'Rocks', [geo], k.mat('matte', { color: 0xffffff, name: 'Stone', roughness: 0.92 }), { parent: k.root, uv: 'none', collision: 'convcol' });
  return k;
}
function log(k) {
  const g = k.root, L = 2.6, r = 0.25;
  const body = barkTube([[-L / 2, r, 0], [0, r * 1.02, 0.05], [L / 2, r, 0]], r, r * 0.9, 16);
  k.part('Log', [body], k.texMat('Bark (rough)', barkTexture('rough'), { finish: 'matte', roughness: 0.95 }), { parent: g, uv: 'keep' });
  k.part('End grain', [G.cyl(r * 0.97, 0.01, { axis: 'x', seg: 20, at: [L / 2 - 0.006, r, 0] }), G.cyl(r * 0.87, 0.01, { axis: 'x', seg: 20, at: [-L / 2 - 0.004, r, 0] })], k.mat('oak', { name: 'End grain', color: 0xd8c09a }), { parent: g });
  return k;
}

export default [
  { id: 'n_red_gum', name: 'River Red Gum', category: 'Nature', env: 'PARK', tags: ['tree', 'eucalyptus', 'gum tree', 'australian', 'native'], desc: 'Sprawling eucalypt with smooth, patchy bark and drooping grey-green leaves.', build: (k) => branchingTree(k, { name: 'River red gum', seed: 4, height: 12, trunkR: 0.45, lean: 0.18, spread: 1.4, leaf: 'gum', bark: 'gum', leafSize: 2.0, crown: 0.4, droop: 0.4 }) },
  { id: 'n_plane', name: 'London Plane Tree', category: 'Nature', env: 'PARK', tags: ['tree', 'plane tree', 'street tree', 'deciduous', 'melbourne'], desc: 'The classic Melbourne street tree: mottled trunk and a broad, leafy crown.', build: (k) => branchingTree(k, { name: 'London plane', seed: 7, height: 11, trunkR: 0.32, lean: 0.03, spread: 0.85, leaf: 'plane', bark: 'gum', leafSize: 1.7, crown: 0.45 }) },
  { id: 'n_oak', name: 'Oak Tree', category: 'Nature', env: 'PARK', tags: ['tree', 'oak', 'deciduous', 'park'], desc: 'Broad park tree with rough bark and dense foliage.', build: (k) => branchingTree(k, { name: 'Oak', seed: 12, height: 9, trunkR: 0.4, lean: 0.05, spread: 1.3, leaf: 'round', bark: 'rough', leafSize: 1.6, crown: 0.35 }) },
  { id: 'n_palm', name: 'Canary Island Palm', category: 'Nature', env: 'PARK', tags: ['palm', 'tree', 'st kilda', 'tropical'], desc: 'Stout date palm with a full crown of arching fronds (St Kilda Road style).', build: (k) => palm(k) },
  { id: 'n_tree_fern', name: 'Tree Fern', category: 'Nature', env: 'FOREST', tags: ['fern', 'tree fern', 'australian', 'native', 'rainforest'], desc: 'Soft tree fern with a fibrous trunk and arching fronds.', build: (k) => treeFern(k) },
  { id: 'n_conifer', name: 'Conifer', category: 'Nature', env: 'FOREST', tags: ['pine', 'conifer', 'tree', 'evergreen'], desc: 'Layered evergreen conifer.', build: (k) => conifer(k) },
  { id: 'n_shrub', name: 'Shrub', category: 'Nature', env: 'PARK', tags: ['bush', 'shrub', 'garden'], desc: 'Rounded garden shrub with leafy edges.', build: (k) => shrub(k) },
  { id: 'n_hedge', name: 'Clipped Hedge', category: 'Nature', env: 'PARK', tags: ['hedge', 'garden', 'box hedge'], desc: '2.4 m clipped box hedge.', build: (k) => shrub(k, { box: true }) },
  { id: 'n_grass', name: 'Grass Tuft', category: 'Nature', env: 'PARK', tags: ['grass', 'tussock', 'plant'], desc: 'Clump of long grass.', build: (k) => grass(k) },
  { id: 'n_flower_bed', name: 'Flower Bed', category: 'Nature', env: 'PARK', tags: ['flowers', 'garden', 'bed'], desc: 'Bluestone-edged bed of mixed flowers.', build: (k) => flowerBed(k) },
  { id: 'n_rocks', name: 'Rocks', category: 'Nature', env: 'PARK', tags: ['rocks', 'stones', 'landscape'], desc: 'Cluster of weathered rocks with moss.', build: (k) => rocks(k) },
  { id: 'n_boulder', name: 'Boulder', category: 'Nature', env: 'PARK', tags: ['rock', 'boulder', 'landscape'], desc: 'Large mossy boulder.', build: (k) => rocks(k, { big: true, seed: 6 }) },
  { id: 'n_log', name: 'Fallen Log', category: 'Nature', env: 'FOREST', tags: ['log', 'wood', 'forest'], desc: 'Bark-covered log with cut ends.', build: (k) => log(k) },
];
