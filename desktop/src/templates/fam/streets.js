// Tram tracks, roads and street infrastructure: grooved-rail track pieces (straight, curve,
// crossing), a CBD street with tram lanes and overhead wiring, a signalised intersection, a
// residential street, a platform ("super") stop, overhead poles, traffic lights and the hook-turn sign.
// Roads run along X; the road surface is y = 0 and the rail heads sit flush with it.
import { G, slabXZ } from '../kit.js';
import * as A from '../arch.js';
import { GAUGE } from './trams.js';

const TRACK_SPACING = 3.4; // centre to centre of a double track
const WIRE_Y = 5.6;

// ------------------------------------------------------------------------------- geometry helpers
/** Offsets a 2D polyline [[x, z]…] sideways by d (positive = left of travel when looking down +Y… i.e. +z for +x travel). */
function offset(path, d) {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return [p[0] - tz / l * d, p[1] + tx / l * d];
  });
}
export function arc(cx, cz, r, a0, a1, n = 32) { const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return p; }
const line = (x0, z0, x1, z1, n = 2) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
const to3 = (p, y = 0) => p.map(([x, z]) => [x, y, z]);

/** Grooved tram rails for one track along a centre-line path: { rails, lips, grooves }. */
function railGeos(path) {
  const rails = [], lips = [], grooves = [];
  for (const s of [-1, 1]) {
    const c = offset(path, s * GAUGE / 2);
    rails.push(G.sweep([[-0.03, -0.12], [0.03, -0.12], [0.03, 0.002], [0.026, 0.006], [-0.026, 0.006], [-0.03, 0.002]], to3(c)));
    const lip = offset(path, s * (GAUGE / 2 - 0.058));
    lips.push(G.sweep([[-0.008, -0.05], [0.008, -0.05], [0.008, 0.003], [-0.008, 0.003]], to3(lip)));
    const gr = offset(path, s * (GAUGE / 2 - 0.04));
    grooves.push(G.sweep([[-0.012, -0.04], [0.012, -0.04], [0.012, 0.0015], [-0.012, 0.0015]], to3(gr)));
  }
  return { rails, lips, grooves };
}
function addTrack(k, parent, paths, name = 'Rails') {
  const r = { rails: [], lips: [], grooves: [] };
  for (const p of paths) { const g = railGeos(p); r.rails.push(...g.rails); r.lips.push(...g.lips); r.grooves.push(...g.grooves); }
  k.part(name, [...r.rails, ...r.lips], k.mat('steel', { name: 'Rail steel', roughness: 0.28 }), { parent, uv: 'keep' });
  k.part('Rail grooves', r.grooves, k.mat('matte', { color: 0x141414, name: 'Groove', roughness: 0.9 }), { parent, uv: 'keep', shadow: false });
}
/** A flat strip following a path (width w) at height y — road surfaces and markings on curves. */
function ribbon(path, w, y = 0, t = 0.02) { return G.sweep([[-w / 2, -t], [w / 2, -t], [w / 2, 0], [-w / 2, 0]], to3(path, y)); }
function dashes(path, w, dash, gap, y = 0.003) {
  const out = []; let acc = 0, on = true, cur = [path[0]];
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1]; const b = path[i]; let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (seg > 1e-6) {
      const lim = (on ? dash : gap) - acc, step = Math.min(lim, seg), t = step / seg;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (on) cur.push(p);
      acc += step; seg -= step; a = p;
      if (acc >= (on ? dash : gap) - 1e-6) { if (on && cur.length > 1) out.push(ribbon(cur, w, y, 0.004)); on = !on; acc = 0; cur = [p]; }
    }
  }
  if (on && cur.length > 1) out.push(ribbon(cur, w, y, 0.004));
  return out;
}

// ------------------------------------------------------------------------------- street furniture
/** Overhead pole (tubular steel, decorative base and finial) at x, z. Returns the group. */
export function overheadPole(k, parent, x, z, { h = 8.2, name = 'Overhead pole', arm = 0 } = {}) {
  const g = k.group(name, parent, { at: [x, 0, z] });
  const geos = [G.lathe([[0.0001, 0], [0.24, 0], [0.24, 0.08], [0.2, 0.12], [0.2, 0.6], [0.16, 0.72], [0.15, 0.8], [0.0001, 0.8]], { seg: 24 }), G.cyl(0.13, h - 0.8, { r2: 0.085, seg: 20, at: [0, 0.8, 0] }), G.lathe([[0.0001, 0], [0.11, 0], [0.12, 0.05], [0.06, 0.12], [0.07, 0.2], [0.0001, 0.32]], { seg: 16, at: [0, h, 0] })];
  for (const y of [h - 1.3, h - 0.35]) geos.push(G.torus(0.105, 0.02, { at: [0, y, 0], rot: [90, 0, 0], seg: 24 }));
  if (arm) geos.push(G.rod([0, h - 1.0, 0], [0, WIRE_Y + 0.6, arm], 0.04), G.rod([0, h - 0.4, 0], [0, WIRE_Y + 0.65, arm], 0.025));
  k.part('Pole', geos, k.mat('paint_timber', { color: 0x3f4a44, name: 'Pole paint' }), { parent: g });
  return g;
}
/** Span wire between two points plus contact wires along the given track paths. */
function wiring(k, parent, spans, contacts) {
  const wire = k.mat('copper', { name: 'Overhead wire', color: 0x6b4b34, roughness: 0.45 }), geos = [];
  for (const [a, b] of spans) {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.35, (a[2] + b[2]) / 2];
    geos.push(G.tube([a, m, b], 0.008, { seg: 24, rseg: 5 }));
  }
  for (const p of contacts) {
    geos.push(G.tube(to3(p, WIRE_Y), 0.0065, { seg: Math.max(8, p.length * 2), rseg: 5 }));
  }
  k.part('Wires', geos, wire, { parent, uv: 'keep', shadow: false });
}
export function trafficLight(k, parent, x, z, { rotY = 0, name = 'Traffic light', arm = 0 } = {}) {
  const g = k.group(name, parent, { at: [x, 0, z], rot: [0, rotY, 0] });
  const dark = k.mat('matte', { color: 0x262a28, name: 'Signal housing', roughness: 0.5 });
  const geos = [G.cyl(0.07, 4.1, { seg: 16 }), G.cyl(0.11, 0.25, { seg: 16 }), G.box(0.12, 0.18, 0.1, { bevel: 0.01, at: [0, 1.1, 0.1] })];
  const lantern = (y, zz = 0.12, xx = 0) => { geos.push(G.box(0.34, 0.95, 0.24, { bevel: 0.03, at: [xx, y, zz + 0.12] })); for (let i = 0; i < 3; i++) geos.push(G.cyl(0.13, 0.22, { axis: 'z', seg: 18, theta0: Math.PI * 0.0, theta: Math.PI, at: [xx, y + 0.3 - i * 0.3 + 0.04, zz + 0.24] })); };
  lantern(3.0); lantern(3.0, -0.48);
  if (arm) { geos.push(G.rod([0, 4.0, 0], [0, 5.4, arm], 0.06), G.rod([0, 3.4, 0], [0, 5.3, arm * 0.7], 0.035)); lantern(5.0, arm - 0.1, 0); }
  k.part('Pole & lanterns', geos, dark, { parent: g });
  const lamp = (c, i, y, zz) => G.cyl(0.1, 0.02, { axis: 'z', seg: 18, at: [0, y + 0.3 - i * 0.3, zz + 0.24] });
  const on = [lamp(0, 0, 3.0, 0.12), lamp(0, 0, 3.0, -0.72)], off = [lamp(0, 1, 3.0, 0.12), lamp(0, 2, 3.0, 0.12), lamp(0, 1, 3.0, -0.72), lamp(0, 2, 3.0, -0.72)];
  if (arm) on.push(lamp(0, 0, 5.0, arm - 0.1)), off.push(lamp(0, 1, 5.0, arm - 0.1), lamp(0, 2, 5.0, arm - 0.1));
  k.part('Red lamps', on, k.mat('light', { name: 'Signal red', color: 0xff3b2f, emissive: 0xff2a1a, emissiveIntensity: 5 }), { parent: g, shadow: false });
  k.part('Lenses', off, k.mat('glass_tinted', { name: 'Signal lens', color: 0x1d2a22, opacity: 1 }), { parent: g, shadow: false });
  return g;
}
export function hookTurnSign(k, parent, x, z, { rotY = 0, standalone = true } = {}) {
  const g = k.group('Hook turn sign', parent, { at: [x, 0, z], rot: [0, rotY, 0] });
  if (standalone) k.part('Post', [G.cyl(0.04, 3.2, { seg: 12 })], 'aluminium', { parent: g });
  k.part('Board', [G.box(0.9, 0.9, 0.02, { bevel: 0.006, at: [0, 2.75, 0.05] })], 'aluminium', { parent: g });
  A.signPart(k, g, 'Hook turn face', ['RIGHT TURN', 'FROM', 'LEFT ONLY'], { bg: '#f7f7f2', fg: '#111', font: 'Arial, Helvetica, sans-serif', weight: 800, border: 16, borderColor: '#111', pad: 50, w: 512, h: 512, scale: 0.7 }, { w: 0.86, at: [0, 2.75, 0.062] });
  return g;
}

// ------------------------------------------------------------------------------- roads
/**
 * Straight road segment along X (length L): optional double tram track in the centre, traffic and
 * parking lanes, bluestone kerb & channel, footpaths, markings and overhead wiring.
 */
export function road(k, o = {}) {
  const L = o.L ?? 20, tram = o.tram !== false, lanes = o.lanes ?? 1, park = o.parking ?? 2.3;
  const tramW = tram ? TRACK_SPACING + 3.0 : 0, half = tramW / 2 + lanes * 3.3 + park, fp = o.footpath ?? 4.0;
  const root = k.root, x0 = -L / 2, x1 = L / 2;
  const surf = k.group('Road surface', root);
  k.part('Asphalt', [G.span([x0, -0.12, -half], [x1, 0, half])], 'asphalt', { parent: surf, collision: 'col' });
  const kerbs = k.group('Kerbs & footpaths', root);
  const ch = 0.32, kw = 0.3, kh = 0.15;
  for (const s of [-1, 1]) {
    const zc = s * half;
    k.part(s < 0 ? 'Channel (south)' : 'Channel (north)', [G.span([x0, -0.03, s < 0 ? zc : zc - ch], [x1, 0.005, s < 0 ? zc + ch : zc])], 'bluestone_cobbles', { parent: kerbs });
    k.part(s < 0 ? 'Kerb (south)' : 'Kerb (north)', [G.sweep([[0, -0.12], [kw, -0.12], [kw, kh], [0.03, kh], [0.0, kh - 0.03]].map(([a, b]) => [s > 0 ? a : a, b]), [[s > 0 ? x0 : x1, 0, zc + s * 0.0], [s > 0 ? x1 : x0, 0, zc]], {})], 'bluestone', { parent: kerbs });
    k.part(s < 0 ? 'Footpath (south)' : 'Footpath (north)', [G.span([x0, -0.1, s < 0 ? -half - kw - fp : half + kw], [x1, kh, s < 0 ? -half - kw : half + kw + fp])], o.paving || 'footpath', { parent: kerbs, collision: 'col' });
  }
  const mk = k.group('Markings', root);
  const white = k.mat('matte', { color: 0xf2f2ee, name: 'Line paint', roughness: 0.6 }), yellow = k.mat('matte', { color: 0xf0c22a, name: 'Tram lane paint', roughness: 0.6 });
  const wl = [], yl = [];
  if (tram) {
    for (const s of [-1, 1]) yl.push(ribbon(line(x0, s * tramW / 2, x1, s * tramW / 2), 0.15, 0.003, 0.004));
    yl.push(...dashes(line(x0, 0, x1, 0, 4), 0.1, 1.5, 1.5));
  }
  for (const s of [-1, 1]) {
    for (let i = 1; i < lanes; i++) wl.push(...dashes(line(x0, s * (tramW / 2 + i * 3.3), x1, s * (tramW / 2 + i * 3.3), 4), 0.1, 3, 6));
    if (park) wl.push(ribbon(line(x0, s * (half - park), x1, s * (half - park)), 0.1, 0.003, 0.004));
    if (!tram && lanes === 1 && s > 0 && !o.noCentre) wl.push(...dashes(line(x0, 0, x1, 0, 4), 0.1, 3, 9));
  }
  if (wl.length) k.part('White lines', wl, white, { parent: mk, uv: 'keep', shadow: false });
  if (yl.length) k.part('Tram lane lines', yl, yellow, { parent: mk, uv: 'keep', shadow: false });
  if (tram) {
    const tr = k.group('Tram tracks', root), paths = [-1, 1].map((s) => line(x0, s * TRACK_SPACING / 2, x1, s * TRACK_SPACING / 2, 2));
    addTrack(k, tr, paths);
    if (o.overhead !== false) {
      const oh = k.group('Overhead', root), pz = half + kw + 0.6;
      const poles = o.poleX ?? [0];
      for (const px of poles) for (const s of [-1, 1]) overheadPole(k, oh, px, s * pz, { name: s < 0 ? 'Pole (south)' : 'Pole (north)' });
      wiring(k, oh, poles.map((px) => [[px, 7.2, -pz], [px, 7.2, pz]]), paths);
      const hangers = []; for (const px of poles) for (const s of [-1, 1]) hangers.push(G.rod([px, WIRE_Y, s * TRACK_SPACING / 2], [px, 7.2 - 0.33, s * TRACK_SPACING / 2], 0.006), G.box(0.12, 0.05, 0.05, { at: [px, WIRE_Y + 0.03, s * TRACK_SPACING / 2] }));
      k.part('Hangers & ears', hangers, 'steel', { parent: oh });
    }
  }
  return k;
}

/** Four-way signalised intersection with tram tracks crossing (a "grand union" junction without the curves). */
export function intersection(k, o = {}) {
  const arm = o.arm ?? 12, half = o.half ?? 9.0, R = 4.0, kw = 0.3, kh = 0.15, root = k.root;
  const ext = half + arm;
  const surf = k.group('Road surface', root);
  k.part('Asphalt', [G.span([-ext, -0.12, -half], [ext, 0, half]), G.span([-half, -0.12, -ext], [half, 0, -half]), G.span([-half, -0.12, half], [half, 0, ext])], 'asphalt', { parent: surf, collision: 'col' });
  // corner blocks: footpath with a rounded kerb return
  const kerbs = k.group('Kerbs & footpaths', root);
  const fpG = [], kerbG = [], chG = [];
  const KERB = [[0, -0.12], [kw, -0.12], [kw, kh], [0.03, kh], [0, kh - 0.03]], CHAN = [[0, -0.03], [0.32, -0.03], [0.32, 0.005], [0, 0.005]];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const C = [sx * (half + R), sz * (half + R)], a0 = Math.atan2(-sz, 0); let a1 = Math.atan2(0, -sx);
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; a1 = a0 + d;
    const path = [[sx * ext, sz * half], ...arc(C[0], C[1], R, a0, a1, 14), [sx * half, sz * ext]];
    const f = -sx * sz; // profile sign that points to the footpath side
    kerbG.push(G.sweep(KERB.map(([a, b]) => [a * f, b]), to3(path)));
    chG.push(G.sweep(CHAN.map(([a, b]) => [-a * f, b]), to3(path)));
    const inner = arc(C[0], C[1], R - kw, a1, a0, 14);
    fpG.push(slabXZ([[sx * ext, sz * (half + kw)], [sx * ext, sz * ext], [sx * (half + kw), sz * ext], ...inner], -0.1, kh));
  }
  k.part('Kerbs', kerbG, 'bluestone', { parent: kerbs });
  k.part('Channels', chG, 'bluestone_cobbles', { parent: kerbs });
  k.part('Footpaths', fpG, o.paving || 'footpath', { parent: kerbs, collision: 'col' });
  // tracks both ways (they cross in the middle)
  const tr = k.group('Tram tracks', root);
  addTrack(k, tr, [-1, 1].map((s) => line(-ext, s * TRACK_SPACING / 2, ext, s * TRACK_SPACING / 2)), 'Rails (east–west)');
  addTrack(k, tr, [-1, 1].map((s) => line(s * TRACK_SPACING / 2, -ext, s * TRACK_SPACING / 2, ext)), 'Rails (north–south)');
  // markings: pedestrian crossings, stop lines (left-hand traffic), tram lane lines on each arm
  const mk = k.group('Markings', root), wl = [], yl = [];
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const P = (dd, off) => [ax * dd - az * off, az * dd + ax * off]; // along the arm, offset to the approach's left
    for (const dd of [half + 1.0, half + 4.0]) { const a = P(dd, -half), b = P(dd, half); wl.push(ribbon(line(a[0], a[1], b[0], b[1]), 0.15, 0.003, 0.004)); }
    { const a = P(half + 5.5, (TRACK_SPACING + 3) / 2), b = P(half + 5.5, half); wl.push(ribbon(line(a[0], a[1], b[0], b[1]), 0.3, 0.003, 0.004)); }
    for (const s of [-1, 1]) { const a = P(half + 5.5, s * (TRACK_SPACING + 3) / 2), b = P(ext, s * (TRACK_SPACING + 3) / 2); yl.push(ribbon(line(a[0], a[1], b[0], b[1]), 0.15, 0.003, 0.004)); }
  }
  k.part('White lines', wl, k.mat('matte', { color: 0xf2f2ee, name: 'Line paint', roughness: 0.6 }), { parent: mk, uv: 'keep', shadow: false });
  k.part('Tram lane lines', yl, k.mat('matte', { color: 0xf0c22a, name: 'Tram lane paint', roughness: 0.6 }), { parent: mk, uv: 'keep', shadow: false });
  // signals on the four corners, hook-turn signs, overhead
  const sig = k.group('Signals', root), c = half + kw + 0.6;
  trafficLight(k, sig, c, c, { rotY: 180, name: 'Traffic light NE', arm: 3 }); trafficLight(k, sig, -c, -c, { rotY: 0, name: 'Traffic light SW', arm: 3 });
  trafficLight(k, sig, c, -c, { rotY: 90, name: 'Traffic light SE' }); trafficLight(k, sig, -c, c, { rotY: -90, name: 'Traffic light NW' });
  hookTurnSign(k, sig, c + 1.2, -c, { rotY: 90 }); hookTurnSign(k, sig, -c - 1.2, c, { rotY: -90 });
  const oh = k.group('Overhead', root), pz = c + 0.4;
  for (const [x, z] of [[pz, pz], [-pz, -pz], [pz, -pz], [-pz, pz]]) overheadPole(k, oh, x, z, { name: 'Pole' });
  wiring(k, oh, [[[pz, 7.2, pz], [-pz, 7.2, -pz]], [[pz, 7.2, -pz], [-pz, 7.2, pz]]], [...[-1, 1].map((s) => line(-ext, s * TRACK_SPACING / 2, ext, s * TRACK_SPACING / 2)), ...[-1, 1].map((s) => line(s * TRACK_SPACING / 2, -ext, s * TRACK_SPACING / 2, ext))]);
  return k;
}

/** Track pieces on a concrete bed (for building your own layouts). kind: 'straight' | 'curve' | 'crossing' | 'single' */
export function trackPiece(k, kind) {
  const root = k.root, bed = k.group('Track bed', root), tr = k.group('Rails', root);
  if (kind === 'straight' || kind === 'single') {
    const L = 12, n = kind === 'single' ? [0] : [-1, 1];
    const paths = n.map((s) => line(-L / 2, s * TRACK_SPACING / 2, L / 2, s * TRACK_SPACING / 2));
    k.part('Concrete bed', [G.span([-L / 2, -0.25, -(kind === 'single' ? 1.6 : TRACK_SPACING / 2 + 1.6)], [L / 2, 0, kind === 'single' ? 1.6 : TRACK_SPACING / 2 + 1.6])], 'concrete', { parent: bed, collision: 'col' });
    addTrack(k, tr, paths);
  } else if (kind === 'curve') {
    const R = 18, paths = [-1, 1].map((s) => arc(0, R, R + s * TRACK_SPACING / 2, -Math.PI / 2, 0, 48).map(([x, z]) => [x, z]));
    k.part('Concrete bed', [ribbon(arc(0, R, R, -Math.PI / 2, 0, 48), TRACK_SPACING + 3.2, 0, 0.25)], 'concrete', { parent: bed, collision: 'col', uv: 'world' });
    addTrack(k, tr, paths);
  } else if (kind === 'crossing') {
    const L = 12;
    k.part('Concrete bed', [G.span([-L / 2, -0.25, -L / 2], [L / 2, 0, L / 2])], 'concrete', { parent: bed, collision: 'col' });
    addTrack(k, tr, [-1, 1].map((s) => line(-L / 2, s * TRACK_SPACING / 2, L / 2, s * TRACK_SPACING / 2)), 'Rails (east–west)');
    addTrack(k, tr, [-1, 1].map((s) => line(s * TRACK_SPACING / 2, -L / 2, s * TRACK_SPACING / 2, L / 2)), 'Rails (north–south)');
  }
  return k;
}

/** Platform ("super") stop: raised accessible platform with ramps, shelter, seat, rails and display. */
export function platformStop(k, o = {}) {
  const L = o.L ?? 24, Wp = 2.6, h = 0.3, root = k.root, z0 = 0;
  const pl = k.group('Platform', root);
  const ramp = 4.0;
  const shape = [[-L / 2 - ramp, 0], [-L / 2, h], [L / 2, h], [L / 2 + ramp, 0]];
  k.part('Platform', [G.extrude(shape, Wp, { at: [0, 0, z0 - Wp / 2] })], 'footpath', { parent: pl, collision: 'col', uv: 'world' });
  k.part('Edge tactiles', [G.span([-L / 2, h, z0 + Wp / 2 - 0.45], [L / 2, h + 0.006, z0 + Wp / 2 - 0.15])], 'tactile', { parent: pl, shadow: false });
  k.part('Edge strip', [G.span([-L / 2, h - 0.02, z0 + Wp / 2 - 0.12], [L / 2, h + 0.004, z0 + Wp / 2])], k.mat('matte', { color: 0xf0c22a, name: 'Safety yellow', roughness: 0.55 }), { parent: pl });
  const rail = [];
  for (let x = -L / 2 - ramp + 0.3; x <= L / 2 + ramp - 0.3; x += 2.0) { const y = Math.abs(x) > L / 2 ? h * (1 - (Math.abs(x) - L / 2) / ramp) : h; rail.push(G.cyl(0.025, 1.0, { seg: 10, at: [x, y, z0 - Wp / 2 + 0.08] })); }
  const top = []; for (let x = -L / 2 - ramp + 0.3; x <= L / 2 + ramp - 0.29; x += 0.5) { const y = Math.abs(x) > L / 2 ? h * (1 - (Math.abs(x) - L / 2) / ramp) : h; top.push([x, y + 1.0, z0 - Wp / 2 + 0.08]); }
  rail.push(G.tube(top, 0.025, { seg: top.length * 2 }), G.tube(top.map(([x, y, z]) => [x, y - 0.45, z]), 0.018, { seg: top.length * 2 }));
  k.part('Railing', rail, 'steel', { parent: pl });
  const sh = k.group('Shelter', root, { at: [0, h, z0 - 0.4] });
  const frame = [], glass = [];
  for (const x of [-2.4, 0, 2.4]) frame.push(G.span([x - 0.05, 0, -0.65], [x + 0.05, 2.5, -0.55]));
  frame.push(G.extrude([[-2.6, 0], [2.6, 0], [2.6, 0.08], [-2.6, 0.18]].map(([x, y]) => [x, y]), 1.9, { at: [0, 2.5, -0.75] }));
  frame.push(G.span([-2.45, 0.0, -0.7], [2.45, 0.08, -0.5]));
  for (const x of [-1.2, 1.2]) glass.push(G.quad(2.3, 2.3, { at: [x, 1.25, -0.6] }));
  for (const s of [-1, 1]) glass.push(G.quad(1.0, 2.2, { at: [s * 2.42, 1.25, -0.1], rot: [0, 90, 0] }));
  k.part('Frame & roof', frame, k.mat('steel_dark', { name: 'Shelter steel', color: 0x2d3a35 }), { parent: sh });
  k.part('Glass', glass, 'glass', { parent: sh, shadow: false });
  k.part('Seat', [G.span([-1.6, 0.42, -0.5], [1.6, 0.47, -0.1], { bevel: 0.01 }), ...[-1.4, 0, 1.4].map((x) => G.span([x - 0.03, 0, -0.35], [x + 0.03, 0.42, -0.25]))], 'steel', { parent: sh });
  k.part('Display housing', [G.box(1.2, 0.36, 0.1, { bevel: 0.02, at: [1.2, 2.25, -0.4] }), G.rod([1.2, 2.43, -0.4], [1.2, 2.5, -0.4], 0.03)], k.mat('steel_dark', { name: 'Shelter steel', color: 0x2d3a35 }), { parent: sh });
  A.signPart(k, sh, 'Passenger display', ['96  St Kilda Beach   2 min', '96  St Kilda Beach  11 min'], { bg: '#070707', fg: '#ffb23a', font: 'Arial Narrow, Arial, sans-serif', weight: 700, align: 'left', pad: 16, w: 1024, h: 300, glow: true, dots: 5 }, { w: 1.1, at: [1.2, 2.25, -0.348], glow: true });
  const pole = k.group('Stop sign', root, { at: [L / 2 - 1.0, h, z0 - Wp / 2 + 0.25] });
  k.part('Post', [G.cyl(0.04, 3.0, { seg: 12 })], 'aluminium', { parent: pole });
  A.signPart(k, pole, 'Stop sign', ['TRAM', 'STOP 8'], { bg: '#2f9e5b', fg: '#ffffff', font: 'Arial, Helvetica, sans-serif', weight: 800, pad: 40, w: 512, h: 512 }, { w: 0.55, at: [0, 2.7, 0.05], both: true });
  return k;
}

/** Narrow residential street with nature strips (no trams). */
export function residentialStreet(k) {
  const L = 20, half = 3.7, ns = 2.2, fp = 1.5, root = k.root;
  road(k, { L, tram: false, lanes: 1, parking: 0, footpath: 0.0001, overhead: false });
  const v = k.group('Verge', root);
  for (const s of [-1, 1]) {
    k.part('Nature strip', [G.span([-L / 2, 0, s < 0 ? -half - 0.3 - ns : half + 0.3], [L / 2, 0.16, s < 0 ? -half - 0.3 : half + 0.3 + ns])], 'grass', { parent: v });
    k.part('Footpath', [G.span([-L / 2, -0.1, s < 0 ? -half - 0.3 - ns - fp : half + 0.3 + ns], [L / 2, 0.15, s < 0 ? -half - 0.3 - ns : half + 0.3 + ns + fp])], 'footpath', { parent: v, collision: 'col' });
  }
  return k;
}

export default [
  { id: 'road_cbd_tram', name: 'CBD Street with Tram Lines', category: 'Trams & roads', env: 'CITY', tags: ['road', 'street', 'tram tracks', 'overhead', 'melbourne', 'bluestone kerb'], desc: '20 m Melbourne street: double grooved tram track, yellow tram lanes, bluestone kerbs, footpaths and overhead wiring. Tiles end to end.', build: (k) => road(k, { L: 20 }) },
  { id: 'road_intersection', name: 'Tram Intersection', category: 'Trams & roads', env: 'CITY', tags: ['road', 'intersection', 'junction', 'traffic lights', 'hook turn', 'tram tracks'], desc: 'Four-way signalised junction with crossing tram tracks, pedestrian crossings, traffic lights and hook-turn signs.', build: (k) => intersection(k) },
  { id: 'road_residential', name: 'Residential Street', category: 'Trams & roads', env: 'DAYLIGHT', tags: ['road', 'street', 'suburb', 'nature strip', 'footpath'], desc: 'Suburban street with bluestone kerb & channel, nature strips and footpaths.', build: (k) => residentialStreet(k) },
  { id: 'road_arterial', name: 'Arterial Road (no trams)', category: 'Trams & roads', env: 'DAYLIGHT', tags: ['road', 'street', 'lanes', 'parking'], desc: 'Two lanes each way with parking lanes, kerbs and footpaths.', build: (k) => road(k, { tram: false, lanes: 2, noCentre: true }) },
  { id: 'track_straight', name: 'Tram Track – Straight', category: 'Trams & roads', env: 'DAYLIGHT', tags: ['tram tracks', 'rails', 'track piece', 'modular'], desc: '12 m double track on a concrete bed (1435 mm gauge). Snap pieces together to build a network.', build: (k) => trackPiece(k, 'straight') },
  { id: 'track_curve', name: 'Tram Track – 90° Curve', category: 'Trams & roads', env: 'DAYLIGHT', tags: ['tram tracks', 'rails', 'curve', 'modular'], desc: 'Double-track quarter curve, 18 m centre radius.', build: (k) => trackPiece(k, 'curve') },
  { id: 'track_crossing', name: 'Tram Track – Crossing', category: 'Trams & roads', env: 'DAYLIGHT', tags: ['tram tracks', 'rails', 'diamond', 'crossing', 'modular'], desc: 'Two double tracks crossing at right angles.', build: (k) => trackPiece(k, 'crossing') },
  { id: 'track_single', name: 'Tram Track – Single', category: 'Trams & roads', env: 'DAYLIGHT', tags: ['tram tracks', 'rails', 'single', 'modular'], desc: '12 m single track piece.', build: (k) => trackPiece(k, 'single') },
  { id: 'tram_stop_platform', name: 'Tram Platform Stop', category: 'Trams & roads', env: 'CITY', tags: ['tram stop', 'super stop', 'shelter', 'platform', 'accessible'], desc: 'Accessible platform stop with ramps, tactile edge, shelter, seat, railing and live departures display.', build: (k) => platformStop(k) },
  { id: 'overhead_pole', name: 'Overhead Wire Pole', category: 'Trams & roads', env: 'CITY', tags: ['overhead', 'pole', 'tram wire', 'span'], desc: 'Decorative tubular steel pole with span wire and contact wires over a double track.', build: (k) => { const oh = k.group('Overhead', k.root); for (const s of [-1, 1]) overheadPole(k, oh, 0, s * 6.5); wiring(k, oh, [[[0, 7.2, -6.5], [0, 7.2, 6.5]]], [-1, 1].map((s) => line(-3, s * TRACK_SPACING / 2, 3, s * TRACK_SPACING / 2))); return k; } },
  { id: 'traffic_light', name: 'Traffic Light', category: 'Street props', env: 'CITY', tags: ['traffic signal', 'lights', 'road'], desc: 'Mast-arm traffic signal with lanterns and pedestrian button.', build: (k) => { trafficLight(k, k.root, 0, 0, { arm: 3 }); return k; } },
  { id: 'hook_turn_sign', name: 'Hook Turn Sign', category: 'Street props', env: 'CITY', tags: ['sign', 'hook turn', 'melbourne', 'road sign'], desc: 'Melbourne’s famous “Right turn from left only” sign on a post.', build: (k) => { hookTurnSign(k, k.root, 0, 0); return k; } },
];
