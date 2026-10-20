// Melbourne architecture: Victorian terraces (single- and double-storey boom-style), weatherboard
// cottages, Italianate villa, Federation house, corner pub, shop row, bluestone warehouse.
// Everything is built from separate, named parts in real-world metres (front faces +Z, the
// front boundary is at z = 0 and the house extends towards -Z).
import { G } from '../kit.js';
import * as A from '../arch.js';

const H = A.HERITAGE;

/** Splits a horizontal band [y0, y1] across x0..x1 around openings (holes in the same x space). */
function bandSegments(x0, x1, y0, y1, holes) {
  let segs = [[x0, x1]];
  for (const h of holes) {
    if (h.y > y1 || h.y + h.h < y0) continue;
    const a = h.x - 0.12, b = h.x + h.w + 0.12;
    segs = segs.flatMap(([s, e]) => (b <= s || a >= e ? [[s, e]] : [[s, a], [b, e]].filter(([p, q]) => q - p > 0.05)));
  }
  return segs;
}

/** Victorian terrace house. */
export function terrace(k, o = {}) {
  const W = o.width ?? 5.2, storeys = o.storeys ?? 1, pw = 0.23, t = 0.23;
  const x0 = -W / 2 + pw / 2, x1 = W / 2 - pw / 2;
  const zF = o.setback ? -o.setback : -4.0, vd = o.verandahDepth ?? 2.0, zV = zF + vd, depth = o.depth ?? 10, zR = zF - depth;
  const FL = 0.35;
  const trim = o.trim ?? H.brunswick, cream = o.cream ?? H.cream, lace = o.lace ?? H.black;
  const facadeMat = o.facade === 'render' ? k.mat('render', { color: o.renderColor ?? 0xe6d8b8, name: 'Render (facade)' }) : (o.facade || 'brick_hawthorn');
  const dressMat = k.mat('render', { color: o.dressColor ?? H.stone, name: 'Render (dressings)' });
  const root = k.root;
  const two = storeys === 2;
  // levels
  const yB = two ? 3.45 : 3.05; // ground verandah beam top
  const FL2 = 3.95, yB2 = 6.75;
  const prof1 = A.bullnoseProfile(zF, zV - 0.06, two ? yB2 : yB, { R: 0.48, slope: 7 });
  const yVW = prof1[0][1]; // verandah roof meets the facade
  const yC = (two ? yVW : yVW) + 0.75, yP = yC + 0.85, yE = yC - 0.35;

  // ---------------------------------------------------------------- facade
  const fac = k.group('Facade', root);
  const holes = [];
  const door = { x: x0 + 0.42, y: FL, w: 1.02, h: 2.78 };
  const win = { x: x1 - 0.42 - 1.15, y: FL + 0.6, w: 1.15, h: 2.15, arch: o.archWindows ? 'segment' : null };
  holes.push(door, win);
  let up = [];
  if (two) { up = [{ x: x0 + 0.4, y: FL2, w: 1.45, h: 2.6, kind: 'french' }, { x: x1 - 0.42 - 1.05, y: FL2 + 0.15, w: 1.05, h: 2.1, kind: 'sash', arch: o.archWindows ? 'segment' : null }]; holes.push(...up); }
  const lh = holes.map((h) => ({ ...h, x: h.x - x0 }));
  k.part('Front wall', [G.wall(x1 - x0, yC, t, lh, { at: [x0, 0, zF - t / 2] })], facadeMat, { parent: fac });
  k.part('Plinth', [G.span([x0, 0, zF - 0.04], [x1, FL, zF + 0.03], { bevel: 0.008 })], 'bluestone', { parent: fac });
  if (o.facade !== 'render' && o.bands !== false) {
    // polychrome cream-brick bands and a dog-tooth band under the cornice
    const bands = [];
    const add = (y0, y1) => { for (const [a, b] of bandSegments(x0, x1, y0, y1, holes)) bands.push(G.span([a, y0, zF - 0.002], [b, y1, zF + 0.01])); };
    add(FL + 0.6 - 0.26, FL + 0.6 - 0.09); add(FL + 2.15 + 0.6 - 0.09, FL + 2.15 + 0.6 + 0.09);
    if (two) { add(FL2 - 0.1, FL2 + 0.08); add(FL2 + 2.3, FL2 + 2.47); }
    add(yC - 0.42, yC - 0.25);
    for (let x = x0 + 0.06; x < x1 - 0.1; x += 0.23) bands.push(G.extrude([[0, 0], [0.11, 0], [0.055, 0.08]], 0.03, { at: [x, yC - 0.2, zF - 0.01] }));
    k.part('Cream brick bands', bands, o.bandMat || 'brick_cream', { parent: fac });
  }
  // cornice, consoles and parapet
  const corn = k.group('Cornice & parapet', fac);
  k.part('Cornice', [G.sweep(A.CORNICE, [[x0 - 0.12, yC, zF], [x1 + 0.12, yC, zF]])], dressMat, { parent: corn });
  const cons = [];
  const nC = Math.max(3, Math.round((x1 - x0) / 0.9));
  for (let i = 0; i <= nC; i++) {
    const cx = x0 + 0.1 + (x1 - x0 - 0.2) * i / nC;
    cons.push(G.extrude([[0, 0], [0.04, 0], [0.06, 0.05], [0.07, 0.12], [0.11, 0.2], [0.18, 0.24], [0.18, 0.3], [0, 0.3]], 0.1, { at: [cx + 0.05, yC - 0.3, zF], rot: [0, -90, 0] }));
  }
  k.part('Consoles', cons, dressMat, { parent: corn });
  const par = [];
  par.push(G.span([x0 - 0.1, yC + 0.22, zF - t], [x1 + 0.1, yC + 0.34, zF - 0.02])); // plinth course
  const xm = (x0 + x1) / 2, pedW = 1.3, pierW = 0.38;
  par.push(G.span([x0 - 0.1, yP - 0.14, zF - t], [x1 + 0.1, yP, zF - 0.0], { bevel: 0.01 })); // top rail / coping
  for (const px of [x0 - 0.1 + pierW / 2, x1 + 0.1 - pierW / 2]) {
    par.push(G.span([px - pierW / 2, yC + 0.22, zF - t], [px + pierW / 2, yP + 0.12, zF + 0.02]));
    par.push(G.span([px - pierW / 2 - 0.04, yP + 0.12, zF - t - 0.04], [px + pierW / 2 + 0.04, yP + 0.2, zF + 0.06], { bevel: 0.01 }));
  }
  // central pediment panel
  par.push(G.span([xm - pedW / 2, yC + 0.22, zF - t], [xm + pedW / 2, yP, zF + 0.01]));
  const arc = []; const rise = 0.5;
  for (let i = 0; i <= 16; i++) { const tt = i / 16, x = xm - pedW / 2 - 0.08 + (pedW + 0.16) * tt; arc.push([x, yP + Math.sin(tt * Math.PI) * rise]); }
  par.push(G.extrude([...arc, [xm + pedW / 2 + 0.08, yP], [xm - pedW / 2 - 0.08, yP]].map(([x, y]) => [x, y]).reverse(), t - 0.02, { at: [0, 0, zF - t + 0.0] }));
  par.push(G.sweep([[0, 0], [0.06, 0], [0.06, 0.05], [0.02, 0.08], [0, 0.08]], arc.map(([x, y]) => [x, y, zF + 0.0])));
  // balusters either side of the pediment
  const balProf = [[0.0001, 0], [0.05, 0], [0.05, 0.04], [0.035, 0.06], [0.03, 0.12], [0.055, 0.22], [0.06, 0.3], [0.04, 0.38], [0.028, 0.42], [0.045, 0.45], [0.05, 0.48], [0.0001, 0.48]];
  const balH = yP - 0.14 - (yC + 0.34), sc = balH / 0.48;
  for (const [a, b] of [[x0 - 0.1 + pierW, xm - pedW / 2], [xm + pedW / 2, x1 + 0.1 - pierW]]) {
    const n = Math.max(2, Math.floor((b - a) / 0.17));
    for (let i = 0; i < n; i++) par.push(G.lathe(balProf.map(([r, y]) => [r * 1.05, y * sc]), { seg: 12, at: [a + (b - a) * (i + 0.5) / n, yC + 0.34, zF - t / 2 + 0.03] }));
  }
  k.part('Parapet', par, dressMat, { parent: corn });
  k.part('Urns', [A.urnGeo([x0 - 0.1 + pierW / 2, yP + 0.2, zF - t / 2 + 0.02], 1.1), A.urnGeo([x1 + 0.1 - pierW / 2, yP + 0.2, zF - t / 2 + 0.02], 1.1)], dressMat, { parent: corn });
  A.signPart(k, corn, 'Name plate', [o.houseName || 'ROSEDALE', o.year || '1888'], { bg: '#' + (o.dressColor ?? H.stone).toString(16).padStart(6, '0'), fg: '#5d5240', font: 'Georgia, serif', weight: 700, pad: 22, scale: 0.72, h: 360, w: 1024 }, { w: pedW - 0.2, at: [xm, yP - 0.14 + 0.02 + (pedW - 0.2) / (1024 / 360) / 2 - 0.0, zF + 0.012] });

  // ---------------------------------------------------------------- openings
  A.doorway(k, fac, { name: 'Front door', at: [door.x + door.w / 2, FL, zF], w: door.w, h: door.h, fan: 0.42, style: o.doorStyle || 'panel4', color: o.doorColor ?? trim, frame: cream });
  A.sashWindow(k, fac, { name: 'Front window', at: [win.x + win.w / 2, win.y, zF], w: win.w, h: win.h, arch: win.arch, frame: cream, sill: 'stone', surround: o.facade === 'render' ? 'moulded' : 'brick', surroundColor: o.dressColor ?? H.stone, panes: [[1, 1], [1, 1]] });
  if (two) {
    const fd = up[0], w2 = up[1];
    A.doorway(k, fac, { name: 'Balcony doors', at: [fd.x + fd.w / 2, fd.y, zF], w: fd.w, h: fd.h, fan: 0.35, style: 'french', double: true, color: cream, frame: cream });
    A.sashWindow(k, fac, { name: 'Upper window', at: [w2.x + w2.w / 2, w2.y, zF], w: w2.w, h: w2.h, arch: w2.arch, frame: cream, sill: 'stone', surround: o.facade === 'render' ? 'moulded' : 'brick', surroundColor: o.dressColor ?? H.stone });
  }

  // ---------------------------------------------------------------- party walls (wing walls + firewalls)
  const walls = k.group('Party walls', root);
  const roof = A.gableRoofGeos(x0, x1, zF - t, zR, yE, o.pitch ?? 24, { overhang: 0.05 });
  const yWing = (two ? yB2 : yB) + 0.42;
  for (const s of [-1, 1]) {
    const px = s * W / 2;
    // outline in (world z, y): wing wall at the front, rising to the parapet, then following the roof
    const pts = [[zV, 0], [zV, yWing]];
    for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push([zF + 0.7 - Math.sin(a) * 0.7, yWing + (1 - Math.cos(a)) * (yP + 0.12 - yWing)]); }
    pts.push([zF - t, yP + 0.12], [roof.ridgeZ, roof.ridgeY + 0.22], [zR, yE + 0.22], [zR, 0]);
    const shape = pts.map(([z, y]) => [-z, y]).reverse();
    k.part(s < 0 ? 'Left party wall' : 'Right party wall', [G.extrude(shape, pw, { at: [px - pw / 2, 0, 0], rot: [0, 90, 0] })].map((g) => { g.translate(0, 0, 0); return g; }), o.partyMat || 'brick_red', { parent: walls });
    // render pilaster on the wing-wall face, coping and console
    const cap = [];
    cap.push(G.span([px - pw / 2 - 0.03, 0, zV - 0.02], [px + pw / 2 + 0.03, yWing, zV + 0.03]));
    cap.push(G.sweep(A.COPING.map(([a, b]) => [a * 1.0, b]), [[px, yWing, zV + 0.05], ...pts.slice(2, 11).map(([z, y]) => [px, y, z]), [px, yP + 0.12, zF - t], [px, roof.ridgeY + 0.22, roof.ridgeZ], [px, yE + 0.22, zR - 0.05]].map((p, i, arr) => p)));
    cap.push(G.extrude([[0, 0], [0.05, 0], [0.05, 0.1], [0.12, 0.18], [0.16, 0.32], [0.12, 0.42], [0, 0.42]], pw + 0.06, { at: [px + (pw + 0.06) / 2, yWing - 0.42, zV + 0.03], rot: [0, -90, 0] }));
    k.part(s < 0 ? 'Left wing cap' : 'Right wing cap', cap, dressMat, { parent: walls });
  }

  // ---------------------------------------------------------------- verandah(s)
  const ver = k.group('Verandah', root);
  const stripeA = k.mat('corrugated_painted', { color: o.roofA ?? trim, name: 'Verandah iron (stripe A)' });
  const stripeB = k.mat('corrugated_painted', { color: o.roofB ?? cream, name: 'Verandah iron (stripe B)' });
  const sheetW = o.stripes === false ? (x1 - x0) : 0.762;
  const addSheets = (prof, name, parent) => {
    const a = [], b = [];
    for (let x = x0, i = 0; x < x1 - 1e-3; x += sheetW, i++) (i % 2 ? b : a).push(A.corrugatedSheet(x, Math.min(x1, x + sheetW), prof));
    k.part(name + ' A', a, stripeA, { parent, uv: 'keep' });
    if (b.length) k.part(name + ' B', b, stripeB, { parent, uv: 'keep' });
  };
  const beam = (y, name, parent) => k.part(name, [G.span([x0, y - 0.22, zV - 0.12], [x1, y, zV], { bevel: 0.006 })], k.mat('paint_timber', { color: trim, name: 'Verandah timber' }), { parent });
  if (two) {
    const g1 = k.group('Ground verandah', ver), g2 = k.group('Balcony', ver);
    beam(yB, 'Beam', g1);
    A.laceFrieze(k, g1, x0, x1, yB - 0.22, zV - 0.06, { color: lace });
    A.laceBracket(k, g1, x0, yB - 0.22, zV - 0.06, 1, { color: lace }); A.laceBracket(k, g1, x1, yB - 0.22, zV - 0.06, -1, { color: lace });
    // balcony floor: decking on joists, lined soffit, fascia
    k.part('Balcony floor', [G.span([x0, FL2 - 0.04, zF], [x1, FL2, zV])], 'decking', { parent: g2 });
    k.part('Balcony structure', [G.span([x0, yB, zF], [x1, FL2 - 0.04, zV - 0.0]), G.span([x0, yB, zV - 0.05], [x1, FL2 + 0.02, zV + 0.02], { bevel: 0.006 })], k.mat('paint_timber', { color: trim, name: 'Verandah timber' }), { parent: g2 });
    A.laceFrieze(k, g2, x0, x1, FL2 + 0.95, zV - 0.06, { h: 0.9, style: 'balustrade', color: lace, name: 'Lace balustrade' });
    k.part('Handrail', [G.span([x0, FL2 + 0.95, zV - 0.12], [x1, FL2 + 1.02, zV], { bevel: 0.012 })], k.mat('paint_timber', { color: trim, name: 'Verandah timber' }), { parent: g2 });
    beam(yB2, 'Upper beam', g2);
    A.laceFrieze(k, g2, x0, x1, yB2 - 0.22, zV - 0.06, { color: lace });
    A.laceBracket(k, g2, x0, yB2 - 0.22, zV - 0.06, 1, { color: lace }); A.laceBracket(k, g2, x1, yB2 - 0.22, zV - 0.06, -1, { color: lace });
    addSheets(prof1, 'Bullnose roof', g2);
  } else {
    beam(yB, 'Beam', ver);
    A.laceFrieze(k, ver, x0, x1, yB - 0.22, zV - 0.06, { color: lace });
    A.laceBracket(k, ver, x0, yB - 0.22, zV - 0.06, 1, { color: lace }); A.laceBracket(k, ver, x1, yB - 0.22, zV - 0.06, -1, { color: lace });
    addSheets(prof1, 'Bullnose roof', ver);
  }
  k.part('Flashing', [G.span([x0, yVW - 0.02, zF], [x1, yVW + 0.1, zF + 0.025])], 'steel', { parent: ver });
  k.part('Verandah floor', [G.span([x0, FL - 0.15, zF], [x1, FL, zV - 0.14])], 'tessellated', { parent: ver });
  k.part('Edge & step', [G.span([x0, FL - 0.18, zV - 0.15], [x1, FL, zV + 0.02], { bevel: 0.012 }), G.span([door.x - 0.15, 0, zV], [door.x + door.w + 0.15, FL - 0.17, zV + 0.32], { bevel: 0.012 })], 'bluestone', { parent: ver });

  // ---------------------------------------------------------------- main roof, chimney, rear
  const rf = k.group('Roof', root);
  k.part('Roof sheets', roof.sheets, o.roofMat || 'corrugated', { parent: rf, matOpts: o.roofMat === 'slate' ? {} : { color: o.roofColor ?? 0xc3c7cb } });
  k.part('Ridge capping', [G.cyl(0.07, x1 - x0, { axis: 'x', seg: 12, at: [x0, roof.ridgeY + 0.02, roof.ridgeZ], theta: Math.PI, theta0: -Math.PI / 2 })], o.roofMat === 'slate' ? 'terracotta' : 'steel', { parent: rf });
  k.part('Rear gutter', [G.sweep(A.QUAD_GUTTER, [[x1, yE - 0.13, zR - 0.02], [x0, yE - 0.13, zR - 0.02]])], 'steel', { parent: rf });
  A.chimney(k, rf, { x: W / 2, z: zF - 2.6, y0: roof.slopeAt(zF - 2.6) - 0.2, y1: roof.ridgeY + 0.85, w: 0.55, d: 0.95, mat: o.partyMat || 'brick_red', capColor: o.dressColor ?? H.stone });
  const rear = k.group('Rear wall', root);
  const rh = [{ x: 1.0, y: FL, w: 0.9, h: 2.1 }, { x: 2.8, y: FL + 0.8, w: 1.0, h: 1.5 }];
  k.part('Rear wall', [G.wall(x1 - x0, yE, t, rh, { at: [x0, 0, zR + t / 2] })], o.partyMat || 'brick_red', { parent: rear });
  A.doorway(k, rear, { name: 'Back door', at: [x0 + 1.45, FL, zR], rot: [0, 180, 0], w: 0.9, h: 2.1, style: 'ledged', color: H.olive, frame: H.cream, metal: 'iron' });
  A.sashWindow(k, rear, { name: 'Back window', at: [x0 + 3.3, FL + 0.8, zR], rot: [0, 180, 0], w: 1.0, h: 1.5, frame: H.cream, sill: 'stone' });
  k.part('Downpipe', A.downpipe(x1 - 0.15, yE - 0.1, zR - 0.1), 'steel', { parent: rear });

  // ---------------------------------------------------------------- interior blockout (seen through the glass)
  const int = k.group('Interior', root);
  const ceil = two ? FL2 - 0.3 : 3.7;
  k.part('Floor', [G.span([x0, FL - 0.05, zR + t], [x1, FL, zF - t])], 'floorboards', { parent: int });
  k.part('Linings', [G.span([x0, FL, zR + t], [x0 + 0.02, ceil, zF - t]), G.span([x1 - 0.02, FL, zR + t], [x1, ceil, zF - t]), G.span([x0, ceil, zR + t], [x1, ceil + 0.03, zF - t]), G.span([x0 + 1.25, FL, zF - 4.5], [x1, ceil, zF - 4.4])], k.mat('render', { color: 0xefe9dd, name: 'Plaster' }), { parent: int });
  if (two) k.part('Upper floor', [G.span([x0, FL2 - 0.05, zR + t], [x1, FL2, zF - t]), G.span([x0, FL2 + 2.9, zR + t], [x1, FL2 + 2.93, zF - t])], 'floorboards', { parent: int });

  // ---------------------------------------------------------------- front garden & fence
  const yard = k.group('Front garden', root);
  const px0 = door.x - 0.05, px1 = door.x + door.w + 0.05;
  k.part('Path', [G.span([px0, 0, zV + 0.32], [px1, 0.03, -0.3])], 'tessellated', { parent: yard });
  k.part('Path edging', [G.span([px0 - 0.06, 0, zV + 0.32], [px0, 0.06, -0.3], { bevel: 0.008 }), G.span([px1, 0, zV + 0.32], [px1 + 0.06, 0.06, -0.3], { bevel: 0.008 })], 'bluestone', { parent: yard });
  k.part('Garden bed', [G.span([px1 + 0.06, 0, zV], [x1, 0.04, -0.3])], 'grass', { parent: yard });
  if (px0 - 0.06 - x0 > 0.2) k.part('Garden bed', [G.span([x0, 0, zV], [px0 - 0.06, 0.04, -0.3])], 'grass', { parent: yard });
  A.palisadeFence(k, yard, -W / 2, W / 2, 0, { gate: [px0, px1], color: lace, pierColor: o.dressColor ?? H.stone });
  return k;
}

export default [
  { id: 'mel_terrace_fitzroy', name: 'Fitzroy Terrace', category: 'Melbourne', env: 'CITY', tags: ['victorian', 'house', 'terrace', 'iron lace', 'hawthorn brick'], desc: 'Single-fronted 1880s terrace: Hawthorn brick with cream bands, iron lace, striped bullnose verandah, balustraded parapet.', build: (k) => terrace(k, {}) },
  { id: 'mel_terrace_carlton', name: 'Carlton Boom Terrace', category: 'Melbourne', env: 'CITY', tags: ['victorian', 'house', 'terrace', 'two storey', 'balcony', 'lace'], desc: 'Two-storey boom-style terrace with lace balcony, rendered facade and French doors.', build: (k) => terrace(k, { storeys: 2, facade: 'render', renderColor: 0xe9dcc0, trim: H.indianRed, dressColor: 0xd8c7a2, doorColor: H.indianRed, roofA: H.indianRed, houseName: 'ST KILDA', year: '1889', archWindows: true }) },
  { id: 'mel_terrace_red', name: 'Collingwood Terrace', category: 'Melbourne', env: 'DAYLIGHT', tags: ['victorian', 'house', 'terrace', 'red brick'], desc: 'Red-brick worker’s terrace with arched window, black lace and plain iron verandah.', build: (k) => terrace(k, { facade: 'brick_red', bandMat: 'brick_cream', trim: H.black, cream: H.white, doorColor: 0x3b2a22, stripes: false, roofA: 0x8a8f94, houseName: 'ADELINE', year: '1891', archWindows: true, width: 4.8 }) },
];
