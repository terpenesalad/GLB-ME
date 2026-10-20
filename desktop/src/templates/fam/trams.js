// Melbourne trams, old and new: W-class (green & cream and City Circle), 1880s cable grip car with
// trailer, Z3, articulated B2 and three-section E-class. Trams run along X, centred on the origin,
// with the rail head at y = 0 (standard gauge 1435 mm) so they sit on the track templates.
import * as THREE from 'three';
import { G, csg, clipY, planSlab, planPoints, sideSlab, xf } from '../kit.js';
import { signTexture } from '../decor.js';

export const GAUGE = 1.435;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------------------- running gear
/** Two-axle bogie centred at x (wheels on the rails). */
export function bogie(k, parent, x, { wheelR = 0.36, wb = 1.75, name = 'Bogie', motor = true } = {}) {
  const g = k.group(name, parent, { at: [x, 0, 0] });
  const wheels = [], frame = [], springs = [];
  const prof = [[0.0001, -0.065], [wheelR * 0.5, -0.065], [wheelR * 0.62, -0.05], [wheelR, -0.05], [wheelR, 0.045], [wheelR + 0.028, 0.055], [wheelR + 0.028, 0.07], [wheelR - 0.05, 0.075], [wheelR * 0.62, 0.06], [0.08, 0.06], [0.08, 0.12], [0.0001, 0.12]];
  for (const ax of [-wb / 2, wb / 2]) {
    for (const s of [-1, 1]) wheels.push(G.lathe(prof, { seg: 28, at: [ax, wheelR, s * GAUGE / 2], rot: [s > 0 ? -90 : 90, 0, 0] }));
    wheels.push(G.cyl(0.065, GAUGE + 0.3, { axis: 'z', seg: 12, at: [ax, wheelR, -(GAUGE + 0.3) / 2] }));
    for (const s of [-1, 1]) {
      const zf = s * (GAUGE / 2 + 0.2);
      frame.push(G.box(0.3, 0.26, 0.2, { bevel: 0.02, at: [ax, wheelR, zf] })); // axle box
      for (let i = 0; i < 2; i++) springs.push(G.tube(Array.from({ length: 33 }, (_, t) => { const a = t / 32 * Math.PI * 2 * 4; return [ax + (i ? 0.09 : -0.09) + Math.cos(a) * 0.055, wheelR + 0.14 + t / 32 * 0.22, zf + Math.sin(a) * 0.055]; }), 0.012, { seg: 96, rseg: 6 }));
    }
  }
  for (const s of [-1, 1]) {
    const zf = s * (GAUGE / 2 + 0.2);
    frame.push(G.extrude([[-wb / 2 - 0.45, 0], [wb / 2 + 0.45, 0], [wb / 2 + 0.3, 0.18], [wb / 2 - 0.25, 0.22], [-wb / 2 + 0.25, 0.22], [-wb / 2 - 0.3, 0.18]], 0.06, { at: [0, wheelR + 0.36, zf - 0.03], bevel: 0.01 }));
    frame.push(G.span([-wb / 2 - 0.1, wheelR - 0.08, zf - 0.05], [wb / 2 + 0.1, wheelR + 0.0, zf + 0.05], { bevel: 0.01 }));
    for (const ax of [-wb / 2, wb / 2]) frame.push(G.box(0.08, 0.2, 0.06, { at: [ax + Math.sign(ax) * -0.0 + (ax > 0 ? -1 : 1) * (wheelR + 0.04), wheelR, s * GAUGE / 2] })); // brake shoes
  }
  frame.push(G.span([-0.2, wheelR + 0.38, -GAUGE / 2 - 0.25], [0.2, wheelR + 0.6, GAUGE / 2 + 0.25], { bevel: 0.02 })); // bolster
  if (motor) for (const ax of [-wb / 2 + 0.55, wb / 2 - 0.55]) frame.push(G.cyl(0.24, 0.75, { axis: 'z', seg: 18, at: [ax, wheelR + 0.02, -0.38] }));
  k.part('Wheels', wheels, 'steel', { parent: g });
  k.part('Frame', frame, k.mat('steel_dark', { name: 'Bogie steel' }), { parent: g });
  k.part('Springs', springs, k.mat('steel_dark', { name: 'Bogie steel' }), { parent: g });
  return g;
}

/** Destination / route sign quad (faces +X in the parent before rotation). */
function signQuad(k, parent, name, lines, style, w, at, rotY, glow) {
  const s = signTexture(lines, style), h = w / s.aspect;
  const m = k.texMat('Sign: ' + [lines].flat().join(' '), { map: s.map, ...(glow ? { emissiveMap: s.map } : {}) }, { finish: 'matte', roughness: 0.35, ...(glow ? { emissive: 0xffffff, emissiveIntensity: 2.2 } : {}) });
  const mesh = k.part(name, [G.quad(w, h)], m, { parent, uv: 'keep', pivot: 'none', shadow: false });
  mesh.position.fromArray(at); mesh.rotation.set(0, rotY * D2R, 0);
  return mesh;
}

/** Trolley pole with base, spring and trolley head. raised: up to the wire, else hooked down. */
function trolleyPole(k, parent, x, yRoof, dir, raised, name) {
  const g = k.group(name, parent, { at: [x, yRoof, 0] });
  const ang = raised ? 24 : 2.5, L = 4.6, c = Math.cos(ang * D2R), s = Math.sin(ang * D2R);
  const tip = [dir * L * c, 0.22 + L * s, 0];
  const geos = [G.box(0.5, 0.12, 0.4, { bevel: 0.02, at: [0, 0.06, 0] }), G.cyl(0.08, 0.12, { at: [0, 0.12, 0] }), G.cyl(0.035, 0.2, { axis: 'z', seg: 10, at: [0, 0.22, -0.1] })];
  geos.push(G.rod([0, 0.22, 0], tip, 0.032, { r2: 0.02, seg: 10 }));
  geos.push(G.rod([dir * 0.1, 0.18, 0.06], [dir * 0.7 * c, 0.22 + 0.7 * s, 0.06], 0.025), G.rod([dir * 0.1, 0.18, -0.06], [dir * 0.7 * c, 0.22 + 0.7 * s, -0.06], 0.025));
  geos.push(G.box(0.16, 0.06, 0.08, { at: [tip[0], tip[1], 0] }), G.torus(0.06, 0.015, { at: [tip[0] + dir * 0.06, tip[1] + 0.05, 0], seg: 20 }));
  k.part('Pole', geos, k.mat('steel_dark', { name: 'Roof gear' }), { parent: g, pivot: 'none' });
  return g;
}

/** Single-arm pantograph standing on the roof at x (collector up near 5.4 m). */
function pantograph(k, parent, x, yRoof, h = 1.6) {
  const g = k.group('Pantograph', parent, { at: [x, yRoof, 0] });
  const m = k.mat('steel', { name: 'Pantograph' }), ins = k.mat('porcelain', { color: 0x7b5a3a, name: 'Insulators' });
  const geos = [], insul = [];
  for (const sx of [-0.45, 0.45]) for (const sz of [-0.35, 0.35]) insul.push(G.lathe([[0.0001, 0], [0.06, 0], [0.06, 0.02], [0.04, 0.04], [0.07, 0.06], [0.04, 0.08], [0.07, 0.1], [0.04, 0.12], [0.05, 0.15], [0.0001, 0.15]], { seg: 14, at: [sx, 0, sz] }));
  geos.push(G.span([-0.55, 0.15, -0.42], [0.55, 0.21, 0.42], { bevel: 0.01 }));
  const knee = [-0.7, 0.21 + h * 0.5, 0], head = [0.15, 0.21 + h, 0];
  for (const z of [-0.12, 0.12]) geos.push(G.rod([0.35, 0.24, z], [knee[0], knee[1], z * 0.4], 0.03));
  geos.push(G.rod([0.25, 0.24, 0], [knee[0] + 0.1, knee[1] - 0.05, 0], 0.012));
  geos.push(G.rod(knee, head, 0.022));
  geos.push(G.rod([head[0], head[1], -0.35], [head[0], head[1], 0.35], 0.02));
  for (const z of [-0.85, 0.85]) geos.push(G.rod([head[0] - 0.06, head[1] + 0.05, z * 0.75], [head[0] - 0.06, head[1] + 0.05, -z * 0.0], 0.0001 + 0.018));
  geos.push(G.box(0.08, 0.05, 1.5, { bevel: 0.015, at: [head[0] - 0.06, head[1] + 0.08, 0] }));
  for (const s of [-1, 1]) geos.push(G.tube([[head[0] - 0.06, head[1] + 0.08, s * 0.75], [head[0] - 0.06, head[1] + 0.03, s * 0.86], [head[0] - 0.06, head[1] - 0.06, s * 0.88]], 0.016, { seg: 8 }));
  k.part('Arm & head', geos, m, { parent: g, pivot: 'none' });
  k.part('Insulators', insul, ins, { parent: g, pivot: 'none' });
  return g;
}

// ------------------------------------------------------------------------------- heritage trams
/**
 * Heritage bogie tram (W-class style): rounded-end timber body with real window openings,
 * drop-centre doorways, timber interior, clerestory-free arched roof and trolley poles.
 */
export function heritageTram(k, o) {
  const L = o.L ?? 14.15, W = o.W ?? 2.74, R = o.endR ?? 0.62, root = k.root;
  const C = o.colors;
  const yS = 0.62, yBelt = 1.58, yWin1 = 2.42, yEave = 2.74, rise = 0.32, dc = o.dropCentre ?? 2.45, yF = 1.0, yFc = 0.7;
  const lowerM = k.mat('gloss', { color: C.lower, name: 'Livery (lower)' }), upperM = k.mat('gloss', { color: C.upper, name: 'Livery (upper)' });
  const liningM = k.mat('gloss', { color: C.lining, name: 'Lining' }), roofM = k.mat('matte', { color: C.roof ?? 0x8b8f8f, name: 'Roof canvas', roughness: 0.85 });
  const timberM = k.mat('oak', { name: 'Varnished timber' }), blackM = k.mat('matte', { color: 0x161616, name: 'Black', roughness: 0.6 });
  const body = k.group('Body', root);
  const doors = o.doors ?? [-dc - 0.45, dc + 0.45].map((x) => ({ x, w: 0.86 }));
  // window layout: end saloons and the drop centre
  const wins = [];
  const endWins = o.endWindows ?? 5, ww = 0.62;
  for (const s of [-1, 1]) for (let i = 0; i < endWins; i++) wins.push({ x: s * (dc + 1.15 + i * 0.78), w: ww });
  const cw = o.centreWindows ?? 4; for (let i = 0; i < cw; i++) wins.push({ x: (i - (cw - 1) / 2) * ((dc * 2 - 0.5) / cw), w: ww });
  const front = [-0.55, 0, 0.55];
  const sideCut = (x, w, y0, y1) => G.box(w, y1 - y0, W + 1, { at: [x, (y0 + y1) / 2, 0] });
  const endCut = (z, w, y0, y1) => G.box(1.4, y1 - y0, w, { at: [0, (y0 + y1) / 2, z] });
  // lower band (shell with door openings)
  let lower = csg(planSlab(L, W, R, yS, yBelt), [planSlab(L - 0.1, W - 0.1, R - 0.05, yS - 0.1, yBelt + 0.1)]);
  lower = csg(lower, doors.map((d) => sideCut(d.x, d.w, 0, yWin1)));
  const skirt = [G.span([-dc, 0.42, W / 2 - 0.05], [dc, yS + 0.02, W / 2]), G.span([-dc, 0.42, -W / 2], [dc, yS + 0.02, -W / 2 + 0.05])];
  k.part('Lower panels', [lower, ...skirt], lowerM, { parent: body, uv: 'keep' });
  // window band (shell with window, door and cab openings)
  let upper = csg(planSlab(L, W, R, yBelt, yEave), [planSlab(L - 0.1, W - 0.1, R - 0.05, yBelt - 0.1, yEave + 0.1)]);
  const cuts = [...wins.map((w) => sideCut(w.x, w.w, yBelt + 0.1, yWin1)), ...doors.map((d) => sideCut(d.x, d.w, 0, yWin1))];
  for (const s of [-1, 1]) for (const z of front) cuts.push(xf(endCut(z, 0.46, yBelt + 0.1, yWin1), { at: [s * (L / 2 - 0.3), 0, 0] }));
  upper = csg(upper, cuts);
  k.part('Window band', [upper], upperM, { parent: body, uv: 'keep' });
  // lining strips along the belt and above the windows (broken at the doorways)
  // densely sampled outline so the strips break cleanly at the doorways
  const ring0 = planPoints(L + 0.012, W + 0.012, R + 0.006, 8), ring = [];
  for (let i = 0; i < ring0.length; i++) { const a = ring0[i], b = ring0[(i + 1) % ring0.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05)); for (let t = 0; t < n; t++) ring.push([a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n]); }
  const strips = [];
  for (const y of [yBelt - 0.035, yWin1 + 0.04, yS + 0.05]) {
    let run = [];
    const flush = () => { if (run.length > 1) strips.push(G.sweep([[0, 0], [0.008, 0], [0.008, 0.025], [0, 0.025]], run.map(([x, z]) => [x, y, z]), { caps: true })); run = []; };
    const gap = ([x, z]) => y < yWin1 && Math.abs(z) > W / 2 - 0.1 && doors.some((d) => Math.abs(x - d.x) < d.w / 2 + 0.02);
    const start = ring.findIndex((p) => gap(p)); // begin inside a gap so every run is open
    const order = start < 0 ? ring.concat([ring[0]]) : [...ring.slice(start), ...ring.slice(0, start)];
    for (const p of order) { if (gap(p)) flush(); else run.push(p); }
    flush();
  }
  k.part('Lining', strips, liningM, { parent: body, uv: 'keep' });
  // glass, sash rails and pillars' inner timber
  const glass = [], sash = [];
  for (const w of wins) for (const s of [-1, 1]) {
    glass.push(G.quad(w.w, yWin1 - yBelt - 0.1, { at: [w.x, (yBelt + 0.1 + yWin1) / 2, s * (W / 2 - 0.035)], rot: [0, s > 0 ? 0 : 180, 0] }));
    sash.push(G.span([w.x - w.w / 2, yBelt + 0.52, s * (W / 2 - 0.05) - 0.012], [w.x + w.w / 2, yBelt + 0.56, s * (W / 2 - 0.05) + 0.012]));
    sash.push(G.span([w.x - w.w / 2, yBelt + 0.1, s * (W / 2 - 0.06) - 0.02], [w.x + w.w / 2, yBelt + 0.14, s * (W / 2 - 0.06) + 0.02]));
  }
  for (const s of [-1, 1]) for (const z of front) glass.push(G.quad(0.46, yWin1 - yBelt - 0.1, { at: [s * (L / 2 - 0.035), (yBelt + 0.1 + yWin1) / 2, z], rot: [0, s * 90, 0] }));
  k.part('Glass', glass, 'glass', { parent: body, shadow: false });
  k.part('Sash rails', sash, timberM, { parent: body });
  // roof: domed at the ends, overhanging slightly, with a rain strip
  const roofGeo = (() => {
    const nx = 72, nz = 18, hl = L / 2 + 0.03, hw = W / 2 + 0.03, r = R + 0.03, e = 1.0;
    const pos = [], idx = [], uv = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      let x = -hl + 2 * hl * i / nx, z = -hw + 2 * hw * j / nz;
      const cx = Math.sign(x) * (hl - r), cz = Math.sign(z) * (hw - r);
      if (Math.abs(x) > hl - r && Math.abs(z) > hw - r) { const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz); if (d > r) { x = cx + dx / d * r; z = cz + dz / d * r; } }
      const fz = Math.pow(Math.max(0, 1 - (z / hw) ** 2), 0.55), ax = Math.abs(x), fx = ax > hl - e ? Math.sqrt(Math.max(0, 1 - ((ax - (hl - e)) / e) ** 2)) : 1;
      pos.push(x, yEave + rise * fz * fx, z); uv.push(x, z);
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const a = i * (nz + 1) + j, b = a + nz + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const under = g.clone(); under.translate(0, -0.03, 0); const ix = under.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } under.computeVertexNormals();
    return [g, under];
  })();
  const roof = k.group('Roof', root);
  k.part('Roof', roofGeo, roofM, { parent: roof, uv: 'keep' });
  k.part('Rain strip', [G.sweep([[0, -0.06], [0.03, -0.06], [0.03, 0.02], [0, 0.02]], planPoints(L, W, R, 8).map(([x, z]) => [x, yEave, z]), { closed: true })], upperM, { parent: roof, uv: 'keep' });
  const vents = []; for (const x of [-4.5, -1.5, 1.5, 4.5]) vents.push(G.lathe([[0.0001, 0], [0.16, 0], [0.15, 0.05], [0.1, 0.11], [0.0001, 0.13]], { seg: 16, at: [x, yEave + rise - 0.01, 0] }));
  k.part('Ventilators', vents, upperM, { parent: roof });
  // destination & route boxes at both ends
  for (const s of [-1, 1]) {
    const bx = s * (L / 2 - 0.5);
    k.part('Destination box', [G.box(0.28, 0.32, 1.25, { bevel: 0.03, at: [bx, yEave + rise - 0.02, 0] })], blackM, { parent: roof });
    signQuad(k, roof, 'Destination', o.dest, { bg: '#111', fg: '#f4f1e6', font: 'Arial Narrow, Arial, sans-serif', weight: 700, pad: 18, w: 1024, h: 240 }, 1.15, [bx + s * 0.142, yEave + rise - 0.02, 0], s > 0 ? 90 : -90, false);
    signQuad(k, roof, 'Route number', String(o.route), { bg: '#111', fg: '#f4f1e6', font: 'Arial, sans-serif', weight: 800, pad: 10, w: 256, h: 256 }, 0.34, [s * (L / 2 - 0.02), yWin1 + 0.17, 0.62 * -s], s > 0 ? 90 : -90, false);
  }
  // interior: floors, bulkheads, seats, ceiling, grab poles
  const int = k.group('Interior', root);
  const floors = [G.span([-dc, yFc - 0.05, -W / 2 + 0.05], [dc, yFc, W / 2 - 0.05])];
  for (const s of [-1, 1]) floors.push(xf(planSlab(L - 0.1, W - 0.1, R - 0.05, yF - 0.05, yF), {}));
  const fl = csg(floors[1], [G.box(dc * 2, 2, W + 1, { at: [0, yF, 0] })]);
  k.part('Floor', [floors[0], fl], k.mat('decking', { name: 'Floor slats' }), { parent: int });
  const steps = []; for (const d of doors) for (const s of [-1, 1]) { steps.push(G.span([d.x - d.w / 2, 0.36, s * (W / 2 - 0.02) - 0.18], [d.x + d.w / 2, 0.4, s * (W / 2 - 0.02) + 0.04])); }
  for (const s of [-1, 1]) steps.push(G.span([s * dc - 0.03, yFc, -W / 2 + 0.05], [s * dc + 0.03, yF, W / 2 - 0.05]));
  k.part('Steps', steps, k.mat('steel_dark', { name: 'Tread plate' }), { parent: int });
  const seats = [];
  const seat = (x, z, w, facing) => { seats.push(G.span([x - 0.22, yF + 0.0, z - w / 2], [x + 0.22, yF + 0.45, z + w / 2], { bevel: 0.02 })); seats.push(G.box(0.06, 0.48, w, { bevel: 0.015, at: [x - facing * 0.2, yF + 0.68, z] })); };
  for (const s of [-1, 1]) for (let i = 0; i < endWins - 1; i++) { const x = s * (dc + 1.25 + i * 0.78); for (const z of [-0.78, 0.78]) seat(x, z, 0.9, s); }
  for (const z of [-1, 1]) seats.push(G.span([-dc + 0.3, yFc, z * (W / 2 - 0.3) - 0.22], [dc - 0.3, yFc + 0.45, z * (W / 2 - 0.3) + 0.22], { bevel: 0.02 }), G.span([-dc + 0.3, yFc + 0.45, z * (W / 2 - 0.08) - 0.04], [dc - 0.3, yFc + 0.95, z * (W / 2 - 0.08) + 0.03], { bevel: 0.015 }));
  for (const s of [-1, 1]) { const bulk = G.wall(W - 0.1, yEave - yF, 0.05, [{ x: (W - 0.1) / 2 - 0.4, y: 0, w: 0.8, h: 1.9 }], { at: [s * dc, yFc, (W - 0.1) / 2], rot: [0, 90, 0] }); seats.push(bulk); }
  k.part('Seats & bulkheads', seats, timberM, { parent: int });
  k.part('Ceiling', [G.span([-L / 2 + 0.3, yEave - 0.02, -W / 2 + 0.05], [L / 2 - 0.3, yEave, W / 2 - 0.05])], k.mat('matte', { color: 0xefe6cf, name: 'Ceiling paint' }), { parent: int });
  const poles = []; for (const d of doors) for (const s of [-1, 1]) for (const e of [-1, 1]) poles.push(G.cyl(0.018, yEave - 0.4, { seg: 10, at: [d.x + e * (d.w / 2 + 0.04), 0.4, s * (W / 2 - 0.12)] }));
  for (const s of [-1, 1]) poles.push(G.box(0.25, 1.0, 0.25, { bevel: 0.03, at: [s * (L / 2 - 0.55), yF + 0.5, 0] }), G.cyl(0.02, 0.25, { at: [s * (L / 2 - 0.55), yF + 1.0, 0] }));
  k.part('Brass fittings', poles, 'brass', { parent: int });
  const lamps = []; for (let x = -L / 2 + 1.2; x < L / 2 - 1; x += 1.6) lamps.push(G.sphere(0.06, { seg: 12, at: [x, yEave - 0.06, 0] }));
  k.part('Ceiling lamps', lamps, k.mat('light', { name: 'Lamp glow', emissiveIntensity: 1.5 }), { parent: int, shadow: false });
  // underframe, ends, lights, lifeguards
  const under = k.group('Underframe', root);
  k.part('Chassis', [G.span([-L / 2 + 0.7, 0.68, -W / 2 + 0.25], [-dc, yS + 0.02, W / 2 - 0.25]), G.span([dc, 0.68, -W / 2 + 0.25], [L / 2 - 0.7, yS + 0.02, W / 2 - 0.25]), G.span([-dc, 0.42, -0.6], [dc, 0.5, 0.6])], blackM, { parent: under });
  const ends = [], lens = [];
  for (const s of [-1, 1]) {
    const ex = s * (L / 2);
    ends.push(G.span([ex - 0.12, 0.3, -1.0], [ex + 0.1 * s, 0.34, 1.0]));
    for (let i = 0; i < 7; i++) ends.push(G.span([ex + s * 0.05 - 0.05, 0.2, -0.9 + i * 0.3], [ex + s * 0.05 + 0.05, 0.32, -0.9 + i * 0.3 + 0.08]));
    ends.push(G.box(0.12, 0.12, 2.2, { bevel: 0.03, at: [ex + s * 0.05, 0.55, 0] }));
    ends.push(G.lathe([[0.0001, 0], [0.13, 0], [0.13, 0.12], [0.11, 0.14], [0.0001, 0.14]], { seg: 20, at: [ex - s * 0.0, 1.2, 0], rot: [0, 0, -90 * s] }));
    lens.push(G.cyl(0.1, 0.02, { seg: 20, axis: 'x', at: [ex + s * 0.14 - (s < 0 ? 0.02 : 0), 1.2, 0] }));
  }
  k.part('Lifeguards & bumpers', ends, blackM, { parent: under });
  k.part('Headlights', lens, k.mat('light', { name: 'Headlight', color: 0xfff6e0, emissive: 0xfff2d0, emissiveIntensity: 4 }), { parent: under, shadow: false });
  for (const s of [-1, 1]) bogie(k, under, s * (o.bogieX ?? 4.6), { name: s < 0 ? 'Bogie A' : 'Bogie B', wheelR: 0.36 });
  // trolley poles (one raised to the wire, one hooked down)
  trolleyPole(k, roof, 1.2, yEave + rise - 0.02, -1, true, 'Trolley pole (up)');
  trolleyPole(k, roof, -1.2, yEave + rise - 0.02, 1, false, 'Trolley pole (down)');
  return k;
}

/** 1880s Melbourne cable tram: open grip car and enclosed trailer. */
export function cableTram(k, o = {}) {
  const root = k.root, C = { body: 0x6b1e1e, cream: 0xe9dcb8, lining: 0xc9a14a, ...o.colors };
  const paint = k.mat('gloss', { color: C.body, name: 'Livery (body)' }), cream = k.mat('gloss', { color: C.cream, name: 'Livery (cream)' }), lining = k.mat('gloss', { color: C.lining, name: 'Lining' });
  const timber = k.mat('oak', { name: 'Varnished timber' }), black = k.mat('matte', { color: 0x161616, name: 'Black', roughness: 0.6 }), roofM = k.mat('matte', { color: 0xd9d4c4, name: 'Roof canvas', roughness: 0.9 });
  // ---- grip car (open, cross-bench seats, grip lever in the middle)
  const gL = 5.2, gW = 2.3, yF = 0.75, yR = 2.95;
  const grip = k.group('Grip car', root, { at: [-3.3, 0, 0] });
  k.part('Floor', [G.span([-gL / 2, yF - 0.08, -gW / 2], [gL / 2, yF, gW / 2], { bevel: 0.01 })], timber, { parent: grip });
  k.part('Side panels', [G.span([-gL / 2, yF - 0.35, -gW / 2 - 0.02], [gL / 2, yF - 0.04, -gW / 2 + 0.02]), G.span([-gL / 2, yF - 0.35, gW / 2 - 0.02], [gL / 2, yF - 0.04, gW / 2 + 0.02])], paint, { parent: grip });
  const benches = [], posts = [];
  for (let i = 0; i < 5; i++) {
    const x = -gL / 2 + 0.55 + i * 1.03; if (i === 2) continue;
    benches.push(G.span([x - 0.22, yF + 0.38, -gW / 2 + 0.1], [x + 0.22, yF + 0.44, gW / 2 - 0.1], { bevel: 0.01 }));
    benches.push(G.span([x - 0.2, yF, -gW / 2 + 0.15], [x + 0.2, yF + 0.38, -gW / 2 + 0.2]), G.span([x - 0.2, yF, gW / 2 - 0.2], [x + 0.2, yF + 0.38, gW / 2 - 0.15]));
    benches.push(G.span([x + (i < 2 ? 0.2 : -0.24), yF + 0.44, -gW / 2 + 0.1], [x + (i < 2 ? 0.24 : -0.2), yF + 0.95, gW / 2 - 0.1], { bevel: 0.01 }));
  }
  benches.push(G.span([-0.5, yF + 0.38, -gW / 2 + 0.1], [-0.2, yF + 0.44, gW / 2 - 0.1]), G.span([0.2, yF + 0.38, -gW / 2 + 0.1], [0.5, yF + 0.44, gW / 2 - 0.1]));
  for (const x of [-gL / 2 + 0.06, -gL / 2 + 1.6, gL / 2 - 1.6, gL / 2 - 0.06]) for (const z of [-gW / 2 + 0.05, gW / 2 - 0.05]) posts.push(G.cyl(0.035, yR - yF, { seg: 10, at: [x, yF, z] }));
  k.part('Benches', benches, timber, { parent: grip });
  k.part('Roof posts', posts, cream, { parent: grip });
  const roofProf = []; for (let i = 0; i <= 12; i++) { const t = i / 12, z = (t - 0.5) * (gW + 0.4); roofProf.push([z, 0.25 * (1 - (2 * t - 1) ** 2)]); }
  const rg = []; for (let i = 0; i <= 12; i++) rg.push([roofProf[i][0], roofProf[i][1]]);
  const roofG = G.extrude([...rg.map(([z, y]) => [z, y + 0.04]), ...rg.slice().reverse().map(([z, y]) => [z, y])], gL + 0.6, { center: true, at: [0, yR, 0], rot: [0, 90, 0] });
  k.part('Roof', [roofG], roofM, { parent: grip, uv: 'keep' });
  k.part('Roof edge', [G.span([-gL / 2 - 0.3, yR - 0.12, -gW / 2 - 0.2], [gL / 2 + 0.3, yR, -gW / 2 - 0.16]), G.span([-gL / 2 - 0.3, yR - 0.12, gW / 2 + 0.16], [gL / 2 + 0.3, yR, gW / 2 + 0.2])], paint, { parent: grip });
  k.part('Grip lever', [G.span([-0.15, yF, -0.25], [0.15, yF + 0.5, 0.25], { bevel: 0.02 }), G.rod([0, yF + 0.4, 0], [0.25, yF + 1.35, 0], 0.025), G.sphere(0.04, { at: [0.25, yF + 1.37, 0] }), G.rod([-0.3, yF + 0.2, 0.15], [-0.35, yF + 1.1, 0.15], 0.02)], 'brass', { parent: grip });
  k.part('Lining', [G.span([-gL / 2, yF - 0.2, -gW / 2 - 0.03], [gL / 2, yF - 0.17, -gW / 2 - 0.02]), G.span([-gL / 2, yF - 0.2, gW / 2 + 0.02], [gL / 2, yF - 0.17, gW / 2 + 0.03])], lining, { parent: grip });
  signQuad(k, grip, 'Destination', 'RICHMOND', { bg: '#e9dcb8', fg: '#6b1e1e', font: 'Georgia, serif', weight: 700, pad: 14, w: 1024, h: 200 }, 1.6, [-gL / 2 - 0.31, yR - 0.06, 0], -90, false);
  // ---- trailer (enclosed saloon with clerestory, end platforms)
  const tL = 6.6, tW = 2.3, ty0 = 0.95, tyE = 2.75;
  const tr = k.group('Trailer', root, { at: [3.75, 0, 0] });
  const sL = tL - 1.6;
  const wins = []; for (let i = 0; i < 7; i++) wins.push(-sL / 2 + 0.38 + i * ((sL - 0.76) / 6));
  let sh = csg(planSlab(sL, tW, 0.05, ty0 - 0.35, tyE), [planSlab(sL - 0.08, tW - 0.08, 0.04, ty0 - 0.5, tyE + 0.1)]);
  sh = csg(sh, [...wins.map((x) => G.box(0.5, 0.75, tW + 1, { at: [x, 1.95, 0] })), G.box(1, 1.9, 0.75, { at: [sL / 2, ty0 + 0.95, 0] }), G.box(1, 1.9, 0.75, { at: [-sL / 2, ty0 + 0.95, 0] })]);
  const lowerSh = csg(sh, [G.box(sL + 1, 2, tW + 1, { at: [0, 1.55 + 1, 0] })]), upperSh = csg(sh, [G.box(sL + 1, 2, tW + 1, { at: [0, 1.55 - 1, 0] })]);
  k.part('Lower panels', [lowerSh], paint, { parent: tr, uv: 'keep' });
  k.part('Window band', [upperSh], timber, { parent: tr });
  k.part('Glass', wins.flatMap((x) => [-1, 1].map((s) => G.quad(0.5, 0.75, { at: [x, 1.95, s * (tW / 2 - 0.03)], rot: [0, s > 0 ? 0 : 180, 0] }))), 'glass', { parent: tr, shadow: false });
  k.part('Platforms', [G.span([-tL / 2, ty0 - 0.08, -tW / 2 + 0.1], [tL / 2, ty0, tW / 2 - 0.1], { bevel: 0.01 })], timber, { parent: tr });
  const rails = []; for (const s of [-1, 1]) { const x = s * (tL / 2 - 0.05); rails.push(G.rod([x, ty0, -tW / 2 + 0.15], [x, ty0 + 1.0, -tW / 2 + 0.15], 0.02), G.rod([x, ty0, tW / 2 - 0.15], [x, ty0 + 1.0, tW / 2 - 0.15], 0.02), G.rod([x, ty0 + 1.0, -tW / 2 + 0.15], [x, ty0 + 1.0, tW / 2 - 0.15], 0.02)); for (const z of [-tW / 2 + 0.15, tW / 2 - 0.15]) rails.push(G.cyl(0.03, tyE + 0.05 - ty0, { seg: 10, at: [x, ty0, z] })); }
  k.part('Platform rails', rails, 'brass', { parent: tr });
  const clr = G.span([-sL / 2, tyE + 0.12, -0.6], [sL / 2, tyE + 0.38, 0.6], { bevel: 0.02 });
  const troof = G.extrude([...rg.map(([z, y]) => [z * 1.0, y + 0.04]), ...rg.slice().reverse().map(([z, y]) => [z, y])], tL + 0.2, { center: true, at: [0, tyE + 0.02, 0], rot: [0, 90, 0] });
  k.part('Roof', [troof, clr], roofM, { parent: tr, uv: 'keep' });
  const clw = []; for (let i = 0; i < 12; i++) for (const s of [-1, 1]) clw.push(G.quad(0.24, 0.14, { at: [-sL / 2 + 0.3 + i * ((sL - 0.6) / 11), tyE + 0.25, s * 0.605], rot: [0, s > 0 ? 0 : 180, 0] }));
  k.part('Clerestory lights', clw, 'glass', { parent: tr, shadow: false });
  k.part('Lining', [G.span([-sL / 2, 1.5, -tW / 2 - 0.01], [sL / 2, 1.53, -tW / 2]), G.span([-sL / 2, 1.5, tW / 2], [sL / 2, 1.53, tW / 2 + 0.01])], lining, { parent: tr });
  signQuad(k, tr, 'Side board', 'RICHMOND · BRIDGE RD · CITY', { bg: '#e9dcb8', fg: '#6b1e1e', font: 'Georgia, serif', weight: 700, pad: 16, w: 2048, h: 160 }, 4.6, [0, tyE - 0.08, tW / 2 + 0.012], 0, false);
  signQuad(k, tr, 'Side board', 'RICHMOND · BRIDGE RD · CITY', { bg: '#e9dcb8', fg: '#6b1e1e', font: 'Georgia, serif', weight: 700, pad: 16, w: 2048, h: 160 }, 4.6, [0, tyE - 0.08, -tW / 2 - 0.012], 180, false);
  // trucks: single 4-wheel trucks (no motors – the cable does the work)
  const wheelsT = (grp, xs) => { const geos = []; for (const x of xs) { for (const s of [-1, 1]) geos.push(G.lathe([[0.0001, -0.06], [0.3, -0.06], [0.3, 0.04], [0.325, 0.05], [0.325, 0.065], [0.2, 0.07], [0.0001, 0.07]], { seg: 24, at: [x, 0.3, s * GAUGE / 2], rot: [s > 0 ? -90 : 90, 0, 0] })); geos.push(G.cyl(0.05, GAUGE + 0.2, { axis: 'z', at: [x, 0.3, -(GAUGE + 0.2) / 2] })); } k.part('Wheels', geos, 'steel', { parent: grp }); };
  wheelsT(grip, [-1.1, 1.1]); wheelsT(tr, [-1.6, 1.6]);
  k.part('Truck frame', [G.span([-1.5, 0.5, -GAUGE / 2 - 0.15], [1.5, 0.65, GAUGE / 2 + 0.15])], black, { parent: grip });
  k.part('Truck frame', [G.span([-2.1, 0.5, -GAUGE / 2 - 0.15], [2.1, 0.65, GAUGE / 2 + 0.15]), G.span([-tL / 2 + 0.2, 0.65, -tW / 2 + 0.1], [tL / 2 - 0.2, ty0 - 0.08, tW / 2 - 0.1])], black, { parent: tr });
  k.part('Grip & drawbar', [G.span([-0.12, 0.05, -0.04], [0.12, yF - 0.08, 0.04]), G.span([-gL / 2 + 0.5, 0.45, -0.05], [gL / 2 + 1.6, 0.5, 0.05])], black, { parent: grip });
  return k;
}

// ------------------------------------------------------------------------------- modern trams
/**
 * Modern tram section built by intersecting a side profile with a rounded plan, then split into
 * livery bands (flush dark glazing for the window band). sec: { x0, x1, noseA, noseB, doors, panto }
 */
function modernSection(k, parent, sec, o) {
  const W = o.W, len = sec.x1 - sec.x0, cx = (sec.x0 + sec.x1) / 2;
  const yb = o.skirt, top = o.roofY, g = k.group(sec.name, parent);
  const noseProf = (xe, dir) => { // outline points for a nose at x = xe facing dir (±1)
    const n = o.nose; return [[xe - dir * 0.0, yb], [xe, n.y0], [xe - dir * n.s0, n.y1], [xe - dir * n.s1, n.y2], [xe - dir * n.s2, top]];
  };
  const left = sec.noseA ? noseProf(sec.x0, -1) : [[sec.x0, yb], [sec.x0, top]], right = sec.noseB ? noseProf(sec.x1, 1) : [[sec.x1, yb], [sec.x1, top]];
  const outline = [left[0], right[0], ...right.slice(1), ...left.slice(1).reverse()];
  const side = sideSlab(outline.map(([x, y]) => [x, y]), W + 0.4);
  const plan = planSlab(len, W, [sec.noseA ? o.noseR : 0.06, sec.noseB ? o.noseR : 0.06], yb - 0.2, top + 0.2, { at: [cx, 0, 0], curve: 14 });
  const body = csg(side, [plan], 'and');
  const band = (y0, y1) => clipY(body, y0, y1);
  for (const b of o.bands) if (b.y1 > b.y0 + 0.01) k.part(b.name, [band(b.y0, b.y1)], b.mat, { parent: g, uv: 'keep' });
  // window pillars over the glazing, doors, door handrails
  const pil = [], doorG = [], doorGlass = [];
  const yw0 = o.winY0, yw1 = o.winY1;
  const doorXs = sec.doors || [];
  const winSpan = [sec.x0 + (sec.noseA ? 2.2 : 0.4), sec.x1 - (sec.noseB ? 2.2 : 0.4)];
  for (let x = winSpan[0]; x <= winSpan[1] + 1e-3; x += o.pillarStep) {
    if (doorXs.some((d) => Math.abs(x - d) < o.doorW / 2 + 0.15)) continue;
    for (const s of [-1, 1]) pil.push(G.span([x - 0.06, yw0, s * (W / 2) - 0.02], [x + 0.06, yw1, s * (W / 2) + 0.012]));
  }
  for (const d of doorXs) for (const s of [-1, 1]) {
    const z = s * (W / 2 + 0.006);
    for (const e of [-1, 1]) {
      const lx0 = d + (e < 0 ? -o.doorW / 2 : 0.01), lx1 = d + (e < 0 ? -0.01 : o.doorW / 2);
      doorG.push(G.span([lx0, o.doorY0, z - 0.012], [lx1, o.doorY1, z + 0.012], { bevel: 0.006 }));
      doorGlass.push(G.quad(lx1 - lx0 - 0.12, o.doorY1 - o.doorY0 - 0.6, { at: [(lx0 + lx1) / 2, (o.doorY0 + o.doorY1) / 2 + 0.18, z + s * 0.014], rot: [0, s > 0 ? 0 : 180, 0] }));
    }
  }
  if (pil.length) k.part('Window pillars', pil, o.pillarMat, { parent: g });
  if (doorG.length) { k.part('Doors', doorG, o.doorMat, { parent: g }); k.part('Door glass', doorGlass, k.mat('glass_tinted', { name: 'Tinted glass' }), { parent: g, shadow: false }); }
  // lights and destination display on noses
  for (const [isN, xe, dir] of [[sec.noseA, sec.x0, -1], [sec.noseB, sec.x1, 1]]) {
    if (!isN) continue;
    const lights = [];
    for (const z of [-W / 2 + 0.35, W / 2 - 0.35]) lights.push(G.box(0.05, 0.12, 0.32, { bevel: 0.02, at: [xe + dir * 0.0, o.nose.y0 - 0.18, z * 0.92] }));
    k.part('Headlights', lights, k.mat('light', { name: 'Headlight', color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 5 }), { parent: g, shadow: false });
    const dy = o.destY, dxp = xe - dir * (o.destInset ?? 0.25);
    signQuad(k, g, 'Destination display', [o.dest], { bg: '#090909', fg: '#ffb23a', font: 'Arial Narrow, Arial, sans-serif', weight: 700, pad: 14, w: 1024, h: 140, glow: true, dots: 6 }, 1.5, [dxp, dy, 0], dir > 0 ? 90 : -90, true);
  }
  if (sec.panto != null) pantograph(k, g, sec.panto, top);
  if (sec.pods?.length) k.part('Roof pods', sec.pods.map((x) => G.box(1.8, 0.35, W - 0.5, { bevel: 0.12, seg: 2, at: [x, top + 0.17, 0] })), o.roofMat, { parent: g });
  return g;
}
function bellows(k, parent, x, o) {
  const geos = []; for (let i = 0; i < 6; i++) geos.push(G.box(0.05, o.roofY - o.skirt - 0.2, o.W - 0.25 - (i % 2) * 0.06, { bevel: 0.02, at: [x - 0.15 + i * 0.06, (o.roofY + o.skirt) / 2, 0] }));
  k.part('Articulation bellows', geos, k.mat('rubber', { name: 'Bellows rubber' }), { parent });
}
export function modernTram(k, o) {
  const root = k.root, body = k.group('Body', root), under = k.group('Underframe', root);
  for (const sec of o.sections) modernSection(k, body, sec, o);
  for (const x of o.joints || []) bellows(k, body, x, o);
  o.bogies.forEach((x, i) => bogie(k, under, x, { name: 'Bogie ' + 'ABCD'[i], wheelR: o.wheelR ?? 0.33, wb: o.wb ?? 1.8 }));
  if (o.skirt > 0.5) k.part('Underframe', [G.span([o.sections[0].x0 + 1.2, 0.72, -o.W / 2 + 0.3], [o.sections.at(-1).x1 - 1.2, o.skirt + 0.02, o.W / 2 - 0.3])], k.mat('matte', { color: 0x1a1a1a, name: 'Underframe', roughness: 0.7 }), { parent: under });
  return k;
}

// ------------------------------------------------------------------------------- catalogue
const W_GREEN = { lower: 0x2c5a3b, upper: 0xe6d7a6, lining: 0xd8b448, roof: 0x5f6361 };
const CITY_CIRCLE = { lower: 0x5b1a22, upper: 0xe7d3a0, lining: 0xc79a3a, roof: 0x5c5e5b };
const modernBase = (dest, extra) => {
  const white = 0xf2f2ef, green = 0x2f9e5b, teal = 0x0f6b6e, dark = 0x1b1d20;
  return {
    W: 2.65, skirt: 0.32, roofY: 3.35, winY0: 1.18, winY1: 2.45, doorY0: 0.36, doorY1: 2.3, doorW: 1.3, pillarStep: 1.45, destY: 2.62, dest,
    nose: { y0: 1.05, y1: 1.2, y2: 2.55, s0: 0.12, s1: 0.65, s2: 1.05 }, noseR: 0.7,
    get bands() { return this._bands; },
    ...extra,
    _mk(k) {
      const m = (c, n, f = 'gloss') => k.mat(f, { color: c, name: n });
      this.pillarMat = m(white, 'Livery (white)'); this.doorMat = m(this.doorColor ?? green, 'Doors'); this.roofMat = m(0xd5d7d8, 'Roof', 'matte');
      this._bands = [
        { name: 'Skirt', y0: this.skirt - 0.01, y1: 0.75, mat: m(this.skirtColor ?? green, 'Livery (skirt)') },
        { name: 'Lower body', y0: 0.75, y1: 0.95, mat: m(white, 'Livery (white)') },
        { name: 'Stripe', y0: 0.95, y1: 1.06, mat: m(this.stripe ?? teal, 'Livery (stripe)') },
        { name: 'Belt', y0: 1.06, y1: this.winY0, mat: m(white, 'Livery (white)') },
        { name: 'Glazing', y0: this.winY0, y1: this.winY1, mat: k.mat('glass_tinted', { name: 'Flush glazing', color: dark, opacity: 0.94 }) },
        { name: 'Upper body', y0: this.winY1, y1: this.roofY - 0.25, mat: m(white, 'Livery (white)') },
        { name: 'Roof', y0: this.roofY - 0.25, y1: this.roofY + 0.01, mat: this.roofMat },
      ];
    },
  };
};
const mk = (spec) => (k) => { spec._mk(k); return modernTram(k, spec); };

export default [
  { id: 'tram_w_class', name: 'W-class Tram', category: 'Trams & roads', env: 'CITY', tags: ['melbourne', 'tram', 'heritage', 'w8', 'green', 'trolley pole'], desc: 'Melbourne’s icon: green & cream W-class with drop-centre doorways, timber interior and trolley poles.', build: (k) => heritageTram(k, { colors: W_GREEN, route: 35, dest: 'CITY · FLINDERS ST' }) },
  { id: 'tram_city_circle', name: 'City Circle Tram', category: 'Trams & roads', env: 'GOLDEN', tags: ['melbourne', 'tram', 'heritage', 'w class', 'city circle', 'burgundy'], desc: 'W-class in the burgundy, cream and gold City Circle livery.', build: (k) => heritageTram(k, { colors: CITY_CIRCLE, route: 35, dest: 'CITY CIRCLE' }) },
  { id: 'tram_cable', name: 'Cable Tram (1880s)', category: 'Trams & roads', env: 'DAYLIGHT', tags: ['melbourne', 'cable tram', 'grip car', 'trailer', 'victorian'], desc: 'Open grip car hauling a clerestory-roofed trailer, as on Melbourne’s 1885–1940 cable network.', build: (k) => cableTram(k) },
  { id: 'tram_z3', name: 'Z3-class Tram', category: 'Trams & roads', env: 'CITY', tags: ['melbourne', 'tram', 'modern', '1980s', 'z class'], desc: '1980s single-car Z3 with pantograph, sliding doors and LED destination.', build: mk(modernBase('57 WEST MARIBYRNONG', { roofY: 3.3, skirt: 0.78, nose: { y0: 1.15, y1: 1.25, y2: 2.5, s0: 0.05, s1: 0.18, s2: 0.32 }, noseR: 0.35, destInset: 0.2, destY: 2.6, sections: [{ name: 'Car', x0: -8.3, x1: 8.3, noseA: true, noseB: true, doors: [-5.9, -0.9, 5.9], panto: -1.0, pods: [3.6] }], bogies: [-4.7, 4.7], wheelR: 0.36, skirtColor: 0x2f9e5b, stripe: 0xf2c230 })) },
  { id: 'tram_b2', name: 'B2-class Tram', category: 'Trams & roads', env: 'CITY', tags: ['melbourne', 'tram', 'articulated', '1990s', 'b class'], desc: 'Articulated two-section B2 with bellows, three bogies and roof pods.', build: mk(modernBase('109 PORT MELBOURNE', { skirt: 0.76, nose: { y0: 1.12, y1: 1.24, y2: 2.52, s0: 0.08, s1: 0.4, s2: 0.6 }, noseR: 0.5, sections: [{ name: 'Section A', x0: -11.8, x1: -0.25, noseA: true, doors: [-9.2, -4.6], panto: -6.5, pods: [-2.6] }, { name: 'Section B', x0: 0.25, x1: 11.8, noseB: true, doors: [4.6, 9.2], pods: [2.6, 6.8] }], joints: [0], bogies: [-8.1, 0, 8.1] })) },
  { id: 'tram_e_class', name: 'E-class Tram', category: 'Trams & roads', env: 'CITY', tags: ['melbourne', 'tram', 'low floor', 'modern', 'e class', 'articulated'], desc: 'Three-section low-floor E-class: sleek noses, flush glazing, full skirts and pantograph.', build: mk(modernBase('96 ST KILDA BEACH', { skirt: 0.24, roofY: 3.4, sections: [{ name: 'Section A', x0: -16.7, x1: -5.9, noseA: true, doors: [-13.9, -8.6], pods: [-11.2] }, { name: 'Section B', x0: -5.5, x1: 5.5, doors: [-2.8, 2.8], panto: 0, pods: [] }, { name: 'Section C', x0: 5.9, x1: 16.7, noseB: true, doors: [8.6, 13.9], pods: [11.2] }], joints: [-5.7, 5.7], bogies: [-12.2, 0, 12.2], wheelR: 0.3, doorColor: 0x0f6b6e, skirtColor: 0x2f9e5b })) },
];
