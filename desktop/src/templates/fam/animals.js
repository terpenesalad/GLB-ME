// Animals – farm, pets, wildlife and Australian natives. Sculpted from smooth-blended signed
// distance shapes into single watertight meshes with painted vertex colours, glossy eyes and
// separate noses/beaks/horns/spines. Real-world sizes in metres; animals face +Z.
import * as THREE from 'three';
import { G } from '../kit.js';
import { sdfMesh, P, hex, fbm3 } from '../sdf.js';

const H3 = (c) => (Array.isArray(c) ? c : hex(c));
const E = (c, r, col, o) => P.ell(c, r, H3(col), o), C = (a, b, ra, rb, col, o) => P.cone(a, b, ra, rb, H3(col), o);
const M = (fn) => [fn(1), fn(-1)]; // mirror across z
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const face = (g) => { g.rotateY(-Math.PI / 2); return g; }; // authored along +X → face +Z

/** Assembles an animal: body mesh + eyes (+ extra hard-surface parts). */
function animal(k, spec) {
  const root = k.root;
  const vary = (p, c, n) => { const base = spec.color ? spec.color(p, c, n) : c; const v = 0.9 + fbm3(p[0] * 9 + 3, p[1] * 9, p[2] * 9) * 0.2; return base.map((x) => Math.min(1, x * v)); };
  const body = face(sdfMesh(spec.prims, { res: spec.res ?? 120, noise: spec.noise, colorFn: vary, seed: spec.seed ?? 3 }));
  k.part('Body', [body], k.mat(spec.finish || 'fur', { color: 0xffffff, name: spec.matName || 'Fur' }), { parent: root, uv: 'none' });
  const eyes = (spec.eyes || []).flatMap(([x, y, z, r]) => [G.sphere(r, { seg: 16, at: [x, y, z] }), G.sphere(r, { seg: 16, at: [x, y, -z] })]).map(face);
  if (eyes.length) k.part('Eyes', eyes, 'eye', { parent: root });
  for (const ex of spec.extra || []) k.part(ex.name, ex.geos.map(face), ex.mat.isMaterial ? ex.mat : k.mat(ex.mat, ex.matOpts || {}), { parent: root });
  return k;
}
const nose = (geos, color = 0x161210) => ({ name: 'Nose', geos, mat: 'eye', matOpts: { color, name: 'Nose' } });
const horn = (name, geos, color = 0xd9ccb0) => ({ name, geos, mat: 'porcelain', matOpts: { color, name: 'Horn', roughness: 0.4 } });

// ------------------------------------------------------------------------------- quadruped helper
/**
 * Joint-based quadruped: torso ellipsoids, shoulder/thigh muscle masses and three-segment legs
 * (upper → elbow/stifle → wrist/hock → foot), neck, skull and muzzle.
 */
function quad(o) {
  const c = o.col, prims = [];
  for (const [x, y, rx, ry, rz, rot] of o.torso) prims.push(E([x, y, 0], [rx, ry, rz], c.body, { k: o.tk ?? 0.08, rot: rot ? [0, 0, rot] : undefined }));
  prims.push(C(o.neck[0], o.neck[1], o.neck[2], o.neck[3], c.neck ?? c.body, { k: o.nk ?? 0.07 }));
  prims.push(E(o.head.c, o.head.r, c.head ?? c.body, { k: 0.05, rot: o.head.rot }));
  prims.push(C(o.snout[0], o.snout[1], o.snout[2], o.snout[3], c.snout ?? c.head ?? c.body, { k: o.sk ?? 0.04 }));
  for (const s of [1, -1]) {
    for (const L of [o.front, o.hind]) {
      const z = s * L.z, P3 = (p) => [p[0], p[1], z * (p[2] ?? 1)];
      const pts = [L.top, L.mid, L.low, L.foot];
      if (L.mass) prims.push(E([L.top[0], L.top[1] + L.mass[1] * 0.3, z], L.mass, c.body, { k: 0.07, rot: L.massRot ? [0, 0, L.massRot] : undefined }));
      for (let i = 0; i < 3; i++) prims.push(C(P3(pts[i]), P3(pts[i + 1]), L.r[i], L.r[i + 1], i === 2 ? (c.foot ?? c.leg ?? c.body) : (c.leg ?? c.body), { k: i === 0 ? 0.05 : 0.025 }));
      if (L.hoof) prims.push(C([L.foot[0], L.foot[1], z], [L.foot[0] + 0.01, 0.0, z], L.r[3], L.hoof, c.hoof ?? 0x1e1712, { k: 0.008 }));
      if (L.paw) prims.push(E([L.foot[0] + L.paw[0] * 0.5, L.paw[1], z], [L.paw[0], L.paw[1], L.paw[2]], c.foot ?? c.leg ?? c.body, { k: 0.02 }));
    }
  }
  if (o.tail) for (let i = 0; i < o.tail.length - 1; i++) prims.push(C(o.tail[i][0], o.tail[i + 1][0], o.tail[i][1], o.tail[i + 1][1], c.tail ?? c.body, { k: 0.03 }));
  return prims;
}
const belly = (base, light, yMax, nyMin = -0.2) => (p, c, n) => mixc(c, hex(light), sm(nyMin, -0.85, n[1]) * (p[1] < yMax ? 1 : 0));

// ------------------------------------------------------------------------------- definitions
const DOG = () => ({
  prims: [...quad({ col: { body: 0xd3a15e, snout: 0xd8aa6c }, torso: [[0.18, 0.47, 0.15, 0.15, 0.12], [0.0, 0.47, 0.2, 0.12, 0.11], [-0.18, 0.48, 0.14, 0.13, 0.11]],
    neck: [[0.22, 0.52, 0], [0.33, 0.68, 0], 0.085, 0.065], head: { c: [0.37, 0.71, 0], r: [0.085, 0.08, 0.075] }, snout: [[0.41, 0.69, 0], [0.52, 0.665, 0], 0.05, 0.038],
    front: { z: 0.07, top: [0.2, 0.42], mid: [0.19, 0.27], low: [0.2, 0.08], foot: [0.21, 0.03], r: [0.055, 0.035, 0.028, 0.03], mass: [0.08, 0.1, 0.05], paw: [0.035, 0.022, 0.03] },
    hind: { z: 0.07, top: [-0.2, 0.43], mid: [-0.16, 0.27], low: [-0.26, 0.12], foot: [-0.24, 0.03], r: [0.07, 0.04, 0.028, 0.03], mass: [0.1, 0.11, 0.06], paw: [0.035, 0.022, 0.03] },
    tail: [[[-0.3, 0.53, 0], 0.035], [[-0.42, 0.5, 0], 0.025], [[-0.52, 0.42, 0], 0.012]] }),
    ...M((s) => E([0.35, 0.72, s * 0.075], [0.045, 0.08, 0.018], 0xb2804a, { rot: [s * 12, 0, 10], k: 0.02 })), E([0.47, 0.645, 0], [0.04, 0.02, 0.035], 0xd8aa6c, { k: 0.02 })],
  eyes: [[0.435, 0.73, 0.042, 0.014]],
  extra: [nose([G.sphere(0.019, { seg: 14, at: [0.522, 0.672, 0], scale: [0.8, 0.8, 1.1] })])],
  color: belly(0, 0xeacb98, 0.5),
});
const CAT = () => ({
  prims: [...quad({ col: { body: 0x9a8a78 }, torso: [[0.1, 0.22, 0.09, 0.075, 0.07], [-0.03, 0.22, 0.12, 0.07, 0.068], [-0.13, 0.23, 0.08, 0.08, 0.07]],
    neck: [[0.13, 0.25, 0], [0.2, 0.32, 0], 0.05, 0.045], head: { c: [0.23, 0.34, 0], r: [0.058, 0.055, 0.062] }, snout: [[0.26, 0.325, 0], [0.295, 0.318, 0], 0.03, 0.022],
    front: { z: 0.042, top: [0.12, 0.19], mid: [0.12, 0.11], low: [0.13, 0.03], foot: [0.135, 0.013], r: [0.03, 0.019, 0.016, 0.016], mass: [0.045, 0.06, 0.03], paw: [0.02, 0.012, 0.018] },
    hind: { z: 0.045, top: [-0.13, 0.2], mid: [-0.09, 0.11], low: [-0.17, 0.05], foot: [-0.15, 0.013], r: [0.04, 0.02, 0.016, 0.016], mass: [0.06, 0.07, 0.035], paw: [0.02, 0.012, 0.018] },
    tail: [[[-0.2, 0.26, 0], 0.022], [[-0.3, 0.33, 0], 0.017], [[-0.33, 0.45, 0], 0.015]] }),
    ...M((s) => C([0.22, 0.38, s * 0.035], [0.225, 0.43, s * 0.045], 0.022, 0.004, 0x8a7a68, { k: 0.012 }))],
  eyes: [[0.27, 0.35, 0.03, 0.012]],
  extra: [nose([G.sphere(0.007, { seg: 10, at: [0.298, 0.325, 0] })], 0x9a5a5a)],
  color: (p, c, n) => { const st = sm(0.3, 0.6, Math.sin(p[0] * 70 + Math.sin(p[1] * 30) * 2)) * (p[1] > 0.12 ? 1 : 0); let r = c.map((v) => v * (1 - st * 0.45)); return mixc(r, hex(0xe8dccb), sm(-0.2, -0.7, n[1]) + sm(0.29, 0.3, p[0]) * sm(0.34, 0.31, p[1])); },
});
const HORSE = () => ({
  prims: [...quad({ col: { body: 0x7a4a2a, leg: 0x6b3f22, foot: 0x241a14, tail: 0x1e1712 }, torso: [[0.42, 1.18, 0.32, 0.3, 0.24], [0.0, 1.2, 0.42, 0.27, 0.27], [-0.48, 1.23, 0.32, 0.29, 0.25]],
    neck: [[0.5, 1.35, 0], [0.82, 1.72, 0], 0.21, 0.11], nk: 0.12, head: { c: [0.88, 1.75, 0], r: [0.11, 0.1, 0.085], rot: [0, 0, -30] }, snout: [[0.92, 1.68, 0], [1.08, 1.43, 0], 0.085, 0.07],
    front: { z: 0.16, top: [0.48, 1.05], mid: [0.47, 0.8], low: [0.5, 0.45], foot: [0.51, 0.1], r: [0.11, 0.075, 0.05, 0.045], mass: [0.16, 0.18, 0.1], hoof: 0.06 },
    hind: { z: 0.16, top: [-0.5, 1.1], mid: [-0.38, 0.85], low: [-0.62, 0.55], foot: [-0.58, 0.1], r: [0.14, 0.08, 0.05, 0.045], mass: [0.2, 0.24, 0.11], hoof: 0.06 },
    tail: [[[-0.78, 1.35, 0], 0.07], [[-0.88, 1.1, 0], 0.07], [[-0.9, 0.75, 0], 0.04]] }),
    E([0.66, 1.62, 0], [0.24, 0.06, 0.035], 0x1e1712, { rot: [0, 0, -50], k: 0.03 }), E([0.86, 1.86, 0], [0.04, 0.03, 0.05], 0x1e1712, { k: 0.02 }),
    ...M((s) => C([0.84, 1.84, s * 0.05], [0.83, 1.95, s * 0.06], 0.032, 0.008, 0x6b3f22, { k: 0.015 }))],
  eyes: [[0.93, 1.73, 0.075, 0.02]],
  color: (p, c) => mixc(c, hex(0x241a14), sm(0.5, 0.3, p[1])),
});
const COW = () => ({
  prims: [...quad({ col: { body: 0xf2f0ea, foot: 0x2a2420, snout: 0xe8b5a8, head: 0xf2f0ea }, torso: [[0.42, 1.0, 0.3, 0.32, 0.28], [0.0, 1.02, 0.45, 0.32, 0.32], [-0.5, 1.08, 0.3, 0.3, 0.29]],
    neck: [[0.55, 1.08, 0], [0.82, 1.15, 0], 0.24, 0.16], head: { c: [0.92, 1.13, 0], r: [0.13, 0.15, 0.12], rot: [0, 0, -40] }, snout: [[0.96, 1.05, 0], [1.04, 0.94, 0], 0.1, 0.095],
    front: { z: 0.19, top: [0.48, 0.85], mid: [0.47, 0.6], low: [0.48, 0.32], foot: [0.49, 0.08], r: [0.11, 0.08, 0.06, 0.055], mass: [0.14, 0.18, 0.1], hoof: 0.065 },
    hind: { z: 0.19, top: [-0.55, 0.9], mid: [-0.46, 0.62], low: [-0.62, 0.38], foot: [-0.58, 0.08], r: [0.13, 0.08, 0.06, 0.055], mass: [0.18, 0.22, 0.12], hoof: 0.065 },
    tail: [[[-0.75, 1.28, 0], 0.035], [[-0.8, 0.9, 0], 0.03], [[-0.8, 0.55, 0], 0.03]] }),
    E([-0.4, 0.68, 0], [0.13, 0.08, 0.11], 0xf0b8b0, { k: 0.06 }),
    ...M((s) => E([0.88, 1.24, s * 0.15], [0.05, 0.03, 0.08], 0xf2f0ea, { k: 0.02 }))],
  eyes: [[0.97, 1.19, 0.1, 0.019]],
  extra: [horn('Horns', M((s) => G.tube([[0.86, 1.3, s * 0.07], [0.87, 1.35, s * 0.15], [0.92, 1.42, s * 0.19]], 0.017, { seg: 8 })).flat())],
  color: (p, c) => { if (c[0] < 0.3 || (c[0] > 0.9 && c[1] < 0.8) || p[1] < 0.12) return c; const v = fbm3(p[0] * 3.2 + 4, p[1] * 3.2, p[2] * 3.2); return mixc(c, hex(0x1d1a18), sm(0.52, 0.56, v)); },
});
const FOX = () => ({
  prims: [...quad({ col: { body: 0xc8622a, leg: 0x2a1c16, snout: 0xc8622a }, torso: [[0.14, 0.34, 0.1, 0.1, 0.08], [0.0, 0.35, 0.14, 0.08, 0.075], [-0.14, 0.36, 0.1, 0.09, 0.08]],
    neck: [[0.16, 0.38, 0], [0.26, 0.48, 0], 0.065, 0.055], head: { c: [0.29, 0.5, 0], r: [0.07, 0.065, 0.07] }, snout: [[0.33, 0.48, 0], [0.45, 0.46, 0], 0.04, 0.012],
    front: { z: 0.055, top: [0.15, 0.3], mid: [0.15, 0.18], low: [0.16, 0.05], foot: [0.17, 0.02], r: [0.035, 0.022, 0.018, 0.02], mass: [0.05, 0.07, 0.04], paw: [0.025, 0.015, 0.02] },
    hind: { z: 0.055, top: [-0.15, 0.32], mid: [-0.11, 0.2], low: [-0.2, 0.08], foot: [-0.18, 0.02], r: [0.045, 0.025, 0.018, 0.02], mass: [0.07, 0.08, 0.045], paw: [0.025, 0.015, 0.02] },
    tail: [[[-0.22, 0.37, 0], 0.04], [[-0.38, 0.32, 0], 0.075], [[-0.58, 0.26, 0], 0.05], [[-0.66, 0.24, 0], 0.01]] }),
    ...M((s) => C([0.27, 0.56, s * 0.04], [0.26, 0.64, s * 0.052], 0.03, 0.003, 0xc8622a, { k: 0.012 }))],
  eyes: [[0.345, 0.515, 0.037, 0.01]],
  extra: [nose([G.sphere(0.011, { at: [0.452, 0.462, 0] })])],
  color: (p, c, n) => { const cream = [0.96, 0.94, 0.9]; let r = mixc(c, cream, Math.max(sm(-0.55, -0.6, p[0]), sm(-0.2, -0.6, n[1]) * (p[1] > 0.22 ? 1 : 0), sm(0.3, 0.36, p[0]) * sm(0.5, 0.47, p[1]))); return r; },
});
const DEER = () => ({
  prims: [...quad({ col: { body: 0x9a6a42, foot: 0x2a2018 }, torso: [[0.3, 0.92, 0.2, 0.2, 0.15], [0.0, 0.93, 0.3, 0.18, 0.16], [-0.32, 0.96, 0.2, 0.19, 0.16]],
    neck: [[0.35, 1.0, 0], [0.6, 1.3, 0], 0.11, 0.065], head: { c: [0.65, 1.34, 0], r: [0.09, 0.07, 0.065], rot: [0, 0, -20] }, snout: [[0.69, 1.31, 0], [0.81, 1.25, 0], 0.048, 0.033],
    front: { z: 0.1, top: [0.32, 0.8], mid: [0.31, 0.6], low: [0.33, 0.3], foot: [0.34, 0.06], r: [0.065, 0.04, 0.025, 0.022], mass: [0.09, 0.12, 0.07], hoof: 0.03 },
    hind: { z: 0.1, top: [-0.33, 0.85], mid: [-0.25, 0.62], low: [-0.43, 0.38], foot: [-0.4, 0.06], r: [0.08, 0.045, 0.025, 0.022], mass: [0.12, 0.15, 0.08], hoof: 0.03 },
    tail: [[[-0.5, 1.0, 0], 0.035], [[-0.55, 0.93, 0], 0.02]] }),
    ...M((s) => E([0.61, 1.41, s * 0.07], [0.025, 0.06, 0.015], 0x9a6a42, { rot: [50 * s, 0, 0], k: 0.015 }))],
  eyes: [[0.72, 1.36, 0.048, 0.013]],
  extra: [nose([G.sphere(0.017, { at: [0.815, 1.255, 0] })]), horn('Antlers', M((s) => { const b = [0.61, 1.42, s * 0.04]; return [G.tube([b, [0.57, 1.58, s * 0.15], [0.53, 1.76, s * 0.22], [0.55, 1.88, s * 0.25]], 0.014, { seg: 16 }), G.rod([0.57, 1.58, s * 0.15], [0.67, 1.7, s * 0.17], 0.009), G.rod([0.54, 1.73, s * 0.21], [0.63, 1.84, s * 0.22], 0.008)]; }).flat(), 0xcbb48e)],
  color: (p, c, n) => mixc(c, [0.93, 0.9, 0.84], sm(-0.3, -0.7, n[1]) * (p[1] > 0.5 ? 1 : 0) + sm(-0.48, -0.55, p[0]) * 0.8),
});
const BEAR = () => ({
  prims: [...quad({ col: { body: 0x5a3a24, snout: 0x8a6448 }, torso: [[0.32, 0.82, 0.3, 0.32, 0.28], [0.0, 0.78, 0.38, 0.28, 0.3], [-0.38, 0.76, 0.28, 0.27, 0.27]],
    neck: [[0.45, 0.85, 0], [0.62, 0.82, 0], 0.22, 0.17], head: { c: [0.72, 0.82, 0], r: [0.15, 0.14, 0.14] }, snout: [[0.8, 0.78, 0], [0.94, 0.74, 0], 0.075, 0.055],
    front: { z: 0.2, top: [0.36, 0.62], mid: [0.36, 0.42], low: [0.37, 0.15], foot: [0.39, 0.06], r: [0.12, 0.1, 0.085, 0.08], mass: [0.16, 0.2, 0.12], paw: [0.07, 0.045, 0.08] },
    hind: { z: 0.2, top: [-0.4, 0.6], mid: [-0.36, 0.38], low: [-0.43, 0.15], foot: [-0.41, 0.06], r: [0.14, 0.1, 0.085, 0.08], mass: [0.18, 0.22, 0.13], paw: [0.07, 0.045, 0.08] },
    tail: [[[-0.65, 0.8, 0], 0.05], [[-0.7, 0.78, 0], 0.03]] }),
    ...M((s) => E([0.68, 0.96, s * 0.11], [0.04, 0.045, 0.03], 0x5a3a24, { k: 0.03 }))],
  noise: { amp: 0.008, freq: 28 },
  eyes: [[0.84, 0.87, 0.075, 0.015]],
  extra: [nose([G.sphere(0.028, { at: [0.95, 0.745, 0] })])],
});
const SHEEP = () => ({
  prims: [E([0, 0.68, 0], [0.42, 0.28, 0.27], hex(0xefe9dc), { k: 0.08 }), E([0.32, 0.72, 0], [0.18, 0.22, 0.2], hex(0xefe9dc), { k: 0.08 }),
    C([0.42, 0.8, 0], [0.55, 0.85, 0], 0.09, 0.075, hex(0x1f1b18), { k: 0.04 }), E([0.6, 0.85, 0], [0.1, 0.075, 0.07], hex(0x1f1b18), { rot: [0, 0, -25], k: 0.03 }),
    ...M((s) => E([0.55, 0.88, s * 0.085], [0.025, 0.06, 0.015], hex(0x1f1b18), { rot: [60 * s, 0, 0], k: 0.01 })),
    ...M((s) => C([0.25, 0.45, s * 0.12], [0.27, 0.03, s * 0.12], 0.045, 0.032, hex(0x1f1b18), { k: 0.03 })), ...M((s) => C([-0.27, 0.45, s * 0.12], [-0.29, 0.03, s * 0.12], 0.05, 0.032, hex(0x1f1b18), { k: 0.03 })),
    C([-0.42, 0.75, 0], [-0.5, 0.6, 0], 0.05, 0.035, hex(0xefe9dc))],
  noise: { amp: 0.018, freq: 22, mask: (x, y) => Math.max(0, Math.min(1, (y - 0.42) / 0.08)) * (x < 0.46 ? 1 : 0) }, res: 120,
  eyes: [[0.64, 0.875, 0.045, 0.013]],
  color: (p, c) => (c[0] > 0.8 ? mixc(c, hex(0xd8cfbd), fbm3(p[0] * 20, p[1] * 20, p[2] * 20) * 0.8) : c),
});
const PIG = () => ({
  prims: [E([0, 0.45, 0], [0.45, 0.25, 0.22], hex(0xf0b4a6), { k: 0.06 }), E([0.4, 0.47, 0], [0.18, 0.2, 0.18], hex(0xf0b4a6), { k: 0.1 }),
    C([0.5, 0.45, 0], [0.64, 0.42, 0], 0.11, 0.08, hex(0xf0b4a6), { k: 0.05 }), P.cone([0.63, 0.42, 0], [0.68, 0.42, 0], 0.07, 0.07, hex(0xe89a8c), { k: 0.01 }),
    ...M((s) => E([0.45, 0.62, s * 0.1], [0.06, 0.07, 0.02], hex(0xe8a294), { rot: [0, 30 * s, -30], k: 0.02 })),
    ...M((s) => C([0.28, 0.3, s * 0.12], [0.3, 0.02, s * 0.12], 0.05, 0.035, hex(0xf0b4a6), { k: 0.04 })), ...M((s) => C([-0.3, 0.3, s * 0.12], [-0.3, 0.02, s * 0.12], 0.055, 0.035, hex(0xf0b4a6), { k: 0.04 }))],
  eyes: [[0.56, 0.53, 0.08, 0.014]],
  extra: [{ name: 'Tail', geos: [G.tube(Array.from({ length: 20 }, (_, i) => { const a = i / 19 * Math.PI * 3; return [-0.44 - i * 0.004, 0.52 + Math.sin(a) * 0.025, Math.cos(a) * 0.025]; }), 0.008, { seg: 40 })], mat: 'skin', matOpts: { color: 0xf0b4a6, name: 'Pig skin' } }, nose([G.sphere(0.012, { at: [0.682, 0.43, 0.025] }), G.sphere(0.012, { at: [0.682, 0.43, -0.025] })], 0x8a4a44)],
  finish: 'skin', matName: 'Skin',
});
const CHICKEN = () => ({
  prims: [E([0, 0.32, 0], [0.17, 0.13, 0.11], hex(0xa8572a), { k: 0.04 }), E([0.1, 0.38, 0], [0.09, 0.1, 0.08], hex(0xa8572a), { k: 0.06 }),
    E([0.14, 0.5, 0], [0.055, 0.06, 0.05], hex(0xa8572a), { k: 0.04 }), E([-0.15, 0.4, 0], [0.08, 0.1, 0.03], hex(0x6b3415), { rot: [0, 0, -40], k: 0.04 }),
    E([0.16, 0.57, 0], [0.04, 0.025, 0.008], hex(0xd02c1f), { k: 0.01 }), E([0.19, 0.46, 0], [0.012, 0.02, 0.008], hex(0xd02c1f), { k: 0.01 }),
    ...M((s) => E([0.0, 0.33, s * 0.1], [0.12, 0.07, 0.02], hex(0x8a4520), { rot: [0, 0, 10], k: 0.02 }))],
  eyes: [[0.175, 0.515, 0.03, 0.008]],
  extra: [{ name: 'Beak & legs', geos: [G.cyl(0.012, 0.04, { r2: 0.002, axis: 'x', at: [0.185, 0.495, 0] }), ...M((s) => [G.cyl(0.008, 0.2, { at: [0.0, 0.0, s * 0.04] }), G.box(0.07, 0.008, 0.012, { at: [0.025, 0.004, s * 0.04] })]).flat()], mat: 'matte', matOpts: { color: 0xe0a32e, name: 'Beak & feet' } }],
  finish: 'fur', matName: 'Feathers',
});
const DUCK = () => ({
  prims: [E([0, 0.15, 0], [0.2, 0.09, 0.1], hex(0x9a9a92), { k: 0.04 }), E([0.12, 0.18, 0], [0.09, 0.09, 0.08], hex(0x6a4030), { k: 0.06 }),
    C([0.14, 0.2, 0], [0.18, 0.32, 0], 0.045, 0.035, hex(0x1f5a3a), { k: 0.03 }), E([0.19, 0.34, 0], [0.06, 0.05, 0.045], hex(0x1f5a3a), { k: 0.03 }),
    E([-0.18, 0.2, 0], [0.06, 0.03, 0.04], hex(0x2a2a2a), { rot: [0, 0, 25], k: 0.02 })],
  eyes: [[0.22, 0.355, 0.035, 0.008]],
  color: (p, c) => (Math.abs(p[1] - 0.255) < 0.012 && p[0] > 0.1 ? [0.95, 0.95, 0.95] : c),
  extra: [{ name: 'Bill & feet', geos: [G.box(0.07, 0.016, 0.04, { bevel: 0.007, at: [0.265, 0.33, 0] }), ...M((s) => [G.cyl(0.006, 0.08, { at: [0.03, 0.0, s * 0.04] }), G.box(0.05, 0.005, 0.04, { at: [0.05, 0.003, s * 0.04] })]).flat()], mat: 'matte', matOpts: { color: 0xe3a52b, name: 'Bill & feet' } }],
  finish: 'fur', matName: 'Feathers',
});
const RABBIT = () => ({
  prims: [E([0, 0.13, 0], [0.13, 0.11, 0.09], hex(0x9a8572), { k: 0.05 }), E([0.1, 0.2, 0], [0.065, 0.07, 0.06], hex(0x9a8572), { k: 0.05 }),
    ...M((s) => C([0.08, 0.25, s * 0.025], [0.04, 0.38, s * 0.04], 0.02, 0.016, hex(0x9a8572), { k: 0.01 })),
    ...M((s) => E([-0.03, 0.04, s * 0.06], [0.08, 0.025, 0.03], hex(0x9a8572), { k: 0.03 })), ...M((s) => C([0.08, 0.1, s * 0.04], [0.1, 0.01, s * 0.04], 0.018, 0.015, hex(0x9a8572), { k: 0.02 })),
    E([-0.13, 0.13, 0], [0.035, 0.035, 0.035], hex(0xf4f0e8), { k: 0.02 })],
  eyes: [[0.135, 0.225, 0.04, 0.011]],
  extra: [nose([G.sphere(0.008, { at: [0.163, 0.2, 0] })], 0x9a5a5a)],
  color: belly(0, 0xe8ddd0, 0.2, -0.1),
});
// Australian natives
const KANGAROO = () => ({
  prims: [E([0, 0.7, 0], [0.22, 0.32, 0.18], hex(0xb46a3c), { rot: [0, 0, -35], k: 0.08 }), E([-0.12, 0.5, 0], [0.24, 0.24, 0.2], hex(0xb46a3c), { k: 0.1 }),
    C([0.1, 0.95, 0], [0.18, 1.2, 0], 0.09, 0.06, hex(0xb46a3c), { k: 0.06 }), E([0.24, 1.26, 0], [0.11, 0.07, 0.065], hex(0xb46a3c), { rot: [0, 0, -10], k: 0.04 }), C([0.28, 1.24, 0], [0.38, 1.21, 0], 0.05, 0.032, hex(0xb46a3c), { k: 0.03 }),
    ...M((s) => E([0.2, 1.37, s * 0.05], [0.03, 0.08, 0.02], hex(0xa05a30), { rot: [-15 * s, 0, 10], k: 0.012 })),
    ...M((s) => C([0.14, 0.85, s * 0.11], [0.22, 0.65, s * 0.1], 0.04, 0.025, hex(0xb46a3c), { k: 0.04 })),
    ...M((s) => E([-0.1, 0.38, s * 0.13], [0.2, 0.17, 0.08], hex(0xb46a3c), { k: 0.06 })),
    ...M((s) => C([-0.05, 0.25, s * 0.13], [-0.15, 0.04, s * 0.11], 0.05, 0.03, hex(0xb46a3c), { k: 0.04 })),
    ...M((s) => C([-0.15, 0.03, s * 0.1], [0.17, 0.02, s * 0.1], 0.03, 0.022, hex(0x8a4e2a), { k: 0.03 })),
    C([-0.3, 0.42, 0], [-0.95, 0.04, 0], 0.09, 0.03, hex(0xb46a3c), { k: 0.08 })],
  eyes: [[0.3, 1.29, 0.05, 0.014]],
  extra: [nose([G.sphere(0.016, { at: [0.385, 1.215, 0] })])],
  color: (p, c, n) => mixc(c, [0.9, 0.82, 0.7], 0.75 * sm(0.2, 0.7, n[0]) * sm(0.35, 0.5, p[1]) * sm(1.15, 1.0, p[1])),
});
const KOALA = () => ({
  prims: [E([0, 0.25, 0], [0.16, 0.22, 0.15], hex(0x6e6c69), { k: 0.06 }), E([0.03, 0.52, 0], [0.13, 0.12, 0.13], hex(0x6e6c69), { k: 0.06 }),
    ...M((s) => E([0.0, 0.6, s * 0.15], [0.05, 0.075, 0.06], hex(0x6e6c69), { k: 0.03 })),
    ...M((s) => C([0.06, 0.38, s * 0.12], [0.16, 0.25, s * 0.08], 0.05, 0.04, hex(0x6e6c69), { k: 0.04 })),
    ...M((s) => C([0.0, 0.1, s * 0.1], [0.14, 0.05, s * 0.09], 0.06, 0.045, hex(0x6e6c69), { k: 0.04 }))],
  noise: { amp: 0.004, freq: 40 },
  eyes: [[0.13, 0.55, 0.05, 0.011]],
  extra: [nose([G.box(0.04, 0.07, 0.05, { bevel: 0.02, at: [0.155, 0.51, 0] })], 0x1c1a1a)],
  color: (p, c, n) => mixc(mixc(c, [0.97, 0.96, 0.94], 0.75 * sm(0.55, 0.62, p[1]) * sm(0.12, 0.17, Math.abs(p[2]))), [0.93, 0.91, 0.88], 0.6 * sm(0.3, 0.8, n[0]) * sm(0.46, 0.38, p[1]) * sm(0.15, 0.25, p[1])),
});
const WOMBAT = () => ({
  prims: [E([0, 0.25, 0], [0.38, 0.2, 0.2], hex(0x6a5a4a), { k: 0.08 }), E([0.36, 0.25, 0], [0.13, 0.12, 0.13], hex(0x6a5a4a), { k: 0.08 }), C([0.42, 0.22, 0], [0.53, 0.2, 0], 0.08, 0.07, hex(0x6a5a4a), { k: 0.05 }),
    ...M((s) => E([0.38, 0.37, s * 0.08], [0.03, 0.045, 0.02], hex(0x5a4a3a), { k: 0.02 })),
    ...M((s) => C([0.22, 0.15, s * 0.12], [0.24, 0.02, s * 0.13], 0.06, 0.05, hex(0x5a4a3a), { k: 0.04 })), ...M((s) => C([-0.24, 0.15, s * 0.12], [-0.25, 0.02, s * 0.13], 0.065, 0.05, hex(0x5a4a3a), { k: 0.04 }))],
  noise: { amp: 0.005, freq: 30 },
  eyes: [[0.47, 0.28, 0.065, 0.01]],
  extra: [nose([G.box(0.05, 0.05, 0.08, { bevel: 0.02, at: [0.54, 0.21, 0] })], 0x252020)],
});
const EMU = () => ({
  prims: [E([0, 1.08, 0], [0.42, 0.33, 0.28], hex(0x6a5848), { rot: [0, 0, -12], k: 0.08 }),
    C([0.3, 1.25, 0], [0.4, 1.65, 0], 0.13, 0.07, hex(0x4e4a52), { k: 0.12 }), E([0.44, 1.7, 0], [0.08, 0.06, 0.055], hex(0x3a3a46), { k: 0.04 }),
    ...M((s) => C([0.02, 0.95, s * 0.12], [-0.06, 0.55, s * 0.1], 0.1, 0.05, hex(0x6a5848), { k: 0.08 })), ...M((s) => C([-0.06, 0.55, s * 0.1], [0.0, 0.04, s * 0.09], 0.04, 0.032, hex(0x5a4e44), { k: 0.02 }))],
  noise: { amp: 0.02, freq: 14, oct: 4 }, res: 120,
  eyes: [[0.48, 1.72, 0.045, 0.013]],
  extra: [{ name: 'Beak & feet', geos: [G.cyl(0.022, 0.08, { r2: 0.006, axis: 'x', at: [0.5, 1.69, 0] }), ...M((s) => [0, 30, -30].map((a) => G.box(0.12, 0.012, 0.018, { at: [0.05, 0.006, s * 0.09], rot: [0, a, 0] }))).flat()], mat: 'matte', matOpts: { color: 0x3a3330, name: 'Beak & feet' } }],
  color: (p, c) => mixc(mixc(c, hex(0x3f3226), fbm3(p[0] * 12, p[1] * 12, p[2] * 12) * 0.7), hex(0x5a6a8a), 0.35 * sm(1.3, 1.5, p[1])),
  finish: 'fur', matName: 'Feathers',
});
const KOOKABURRA = () => ({
  prims: [E([0, 0.2, 0], [0.09, 0.12, 0.08], hex(0xefe8da), { rot: [0, 0, -25], k: 0.04 }), E([0.05, 0.33, 0], [0.08, 0.07, 0.07], hex(0xefe8da), { k: 0.05 }),
    ...M((s) => E([-0.03, 0.22, s * 0.07], [0.12, 0.08, 0.02], hex(0x6a4e36), { rot: [0, 0, -35], k: 0.02 })),
    E([-0.12, 0.08, 0], [0.09, 0.04, 0.03], hex(0x7a4a2a), { rot: [0, 0, -60], k: 0.02 })],
  eyes: [[0.09, 0.345, 0.05, 0.01]],
  color: (p, c, n) => (Math.abs(p[2]) > 0.045 && p[1] > 0.31 && p[1] < 0.36 ? hex(0x4a3a2a) : p[1] > 0.37 ? mixc(c, hex(0x8a7a62), 0.7) : c),
  extra: [{ name: 'Beak', geos: [G.extrude([[0, -0.015], [0.11, -0.005], [0.12, 0.0], [0, 0.025]], 0.026, { center: true, at: [0.11, 0.32, 0] })], mat: 'matte', matOpts: { color: 0x3a3430, name: 'Beak', roughness: 0.4 } }, { name: 'Perch', geos: [G.cyl(0.025, 0.5, { axis: 'z', at: [0.0, 0.065, -0.25] })], mat: 'oak', matOpts: { name: 'Branch' } }],
  finish: 'fur', matName: 'Feathers',
});
const MAGPIE = () => ({
  prims: [E([0, 0.15, 0], [0.12, 0.07, 0.06], hex(0x161616), { rot: [0, 0, -15], k: 0.03 }), E([0.1, 0.22, 0], [0.05, 0.05, 0.045], hex(0x161616), { k: 0.04 }),
    ...M((s) => E([-0.02, 0.17, s * 0.055], [0.11, 0.045, 0.012], hex(0xf2f2f2), { rot: [0, 0, -10], k: 0.012 })),
    E([-0.2, 0.12, 0], [0.11, 0.015, 0.035], hex(0x161616), { rot: [0, 0, 10], k: 0.02 })],
  eyes: [[0.13, 0.235, 0.032, 0.007]],
  color: (p, c) => (p[0] < -0.05 && p[0] > -0.14 && p[1] > 0.17 ? [0.95, 0.95, 0.95] : c),
  extra: [{ name: 'Beak & legs', geos: [G.cyl(0.012, 0.06, { r2: 0.002, axis: 'x', at: [0.145, 0.215, 0] }), ...M((s) => G.cyl(0.005, 0.1, { at: [0.0, 0.0, s * 0.025] }))], mat: 'matte', matOpts: { color: 0xd8d4cc, name: 'Beak & legs' } }],
  finish: 'fur', matName: 'Feathers',
});
const PLATYPUS = () => ({
  prims: [E([0, 0.06, 0], [0.18, 0.055, 0.08], hex(0x5a4030), { k: 0.04 }), E([0.17, 0.065, 0], [0.06, 0.045, 0.055], hex(0x5a4030), { k: 0.05 }),
    E([-0.24, 0.045, 0], [0.09, 0.015, 0.06], hex(0x4a3428), { k: 0.03 }),
    ...M((s) => E([0.1, 0.02, s * 0.09], [0.04, 0.01, 0.03], hex(0x4a3428), { k: 0.02 })), ...M((s) => E([-0.12, 0.02, s * 0.09], [0.04, 0.01, 0.03], hex(0x4a3428), { k: 0.02 }))],
  eyes: [[0.21, 0.085, 0.035, 0.006]],
  extra: [{ name: 'Bill', geos: [G.box(0.1, 0.02, 0.07, { bevel: 0.01, at: [0.27, 0.06, 0] })], mat: 'skin', matOpts: { color: 0x3a3632, name: 'Bill', roughness: 0.4 } }],
});
const ECHIDNA = () => {
  const spines = []; let r = 7; const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 150; i++) { const u = rnd() * Math.PI * 2, v = rnd() * 0.9; const x = Math.cos(u) * Math.sin(v * Math.PI / 2) * 0.2, z = Math.sin(u) * Math.sin(v * Math.PI / 2) * 0.13, y = 0.08 + Math.cos(v * Math.PI / 2) * 0.12; if (x > 0.12) continue; const n = [x / 0.2, (y - 0.06) / 0.12, z / 0.13], l = Math.hypot(...n); spines.push(G.rod([x, y, z], [x + n[0] / l * 0.07 - 0.02, y + n[1] / l * 0.07, z + n[2] / l * 0.07], 0.005, { r2: 0.0005, seg: 5 })); }
  return {
    prims: [E([0, 0.09, 0], [0.2, 0.12, 0.13], hex(0x4a3a2c), { k: 0.04 }), C([0.15, 0.08, 0], [0.32, 0.04, 0], 0.04, 0.008, hex(0x2a2420), { k: 0.04 }), ...M((s) => C([0.1, 0.06, s * 0.09], [0.12, 0.0, s * 0.11], 0.025, 0.02, hex(0x2a2420))), ...M((s) => C([-0.1, 0.06, s * 0.09], [-0.12, 0.0, s * 0.11], 0.025, 0.02, hex(0x2a2420)))],
    eyes: [[0.17, 0.12, 0.05, 0.007]],
    extra: [{ name: 'Spines', geos: spines, mat: 'porcelain', matOpts: { color: 0xe3d6b8, name: 'Spines', roughness: 0.5 } }],
  };
};
const POSSUM = () => ({
  prims: [E([0, 0.18, 0], [0.18, 0.12, 0.1], hex(0x7d7a78), { k: 0.06 }), E([0.18, 0.24, 0], [0.07, 0.065, 0.065], hex(0x7d7a78), { k: 0.05 }), C([0.2, 0.23, 0], [0.29, 0.21, 0], 0.04, 0.02, hex(0x7d7a78), { k: 0.03 }),
    ...M((s) => E([0.16, 0.31, s * 0.045], [0.02, 0.04, 0.025], hex(0x6a6766), { k: 0.012 })),
    ...M((s) => C([0.1, 0.12, s * 0.06], [0.12, 0.01, s * 0.07], 0.03, 0.02, hex(0x7d7a78))), ...M((s) => C([-0.1, 0.12, s * 0.06], [-0.12, 0.01, s * 0.07], 0.035, 0.02, hex(0x7d7a78))),
    C([-0.17, 0.2, 0], [-0.45, 0.06, 0], 0.06, 0.03, hex(0x2a2826), { k: 0.05 })],
  noise: { amp: 0.004, freq: 40 },
  eyes: [[0.235, 0.255, 0.04, 0.013]],
  extra: [nose([G.sphere(0.01, { at: [0.293, 0.21, 0] })], 0x6a4a4a)],
  color: belly(0, 0xe9e4dc, 0.2, -0.1),
});

const LIST = [
  ['dog', 'Dog', DOG, 'Friendly golden retriever-style dog.', ['dog', 'pet', 'puppy']],
  ['cat', 'Tabby Cat', CAT, 'Striped tabby with pointed ears.', ['cat', 'pet', 'kitten']],
  ['horse', 'Horse', HORSE, 'Bay horse with black mane, tail and hooves.', ['horse', 'farm', 'pony']],
  ['cow', 'Cow', COW, 'Black-and-white dairy cow with horns.', ['cow', 'farm', 'cattle']],
  ['sheep', 'Sheep', SHEEP, 'Woolly merino-style sheep.', ['sheep', 'farm', 'wool', 'lamb']],
  ['pig', 'Pig', PIG, 'Pink pig with a curly tail.', ['pig', 'farm']],
  ['chicken', 'Chicken', CHICKEN, 'Brown hen with red comb.', ['chicken', 'hen', 'farm', 'bird']],
  ['duck', 'Duck', DUCK, 'Mallard drake.', ['duck', 'bird', 'pond']],
  ['rabbit', 'Rabbit', RABBIT, 'Sitting rabbit.', ['rabbit', 'bunny']],
  ['fox', 'Fox', FOX, 'Red fox with white-tipped brush.', ['fox', 'wildlife']],
  ['deer', 'Deer', DEER, 'Stag with antlers.', ['deer', 'stag', 'wildlife']],
  ['bear', 'Bear', BEAR, 'Brown bear.', ['bear', 'wildlife']],
  ['kangaroo', 'Kangaroo', KANGAROO, 'Red kangaroo standing on its tail.', ['kangaroo', 'australian', 'marsupial', 'native']],
  ['koala', 'Koala', KOALA, 'Sitting koala with fluffy ears.', ['koala', 'australian', 'marsupial', 'native']],
  ['wombat', 'Wombat', WOMBAT, 'Stocky common wombat.', ['wombat', 'australian', 'marsupial', 'native']],
  ['emu', 'Emu', EMU, 'Shaggy emu, 1.8 m tall.', ['emu', 'australian', 'bird', 'native']],
  ['kookaburra', 'Kookaburra', KOOKABURRA, 'Laughing kookaburra on a branch.', ['kookaburra', 'australian', 'bird', 'native']],
  ['magpie', 'Australian Magpie', MAGPIE, 'Black-and-white magpie.', ['magpie', 'australian', 'bird', 'native']],
  ['platypus', 'Platypus', PLATYPUS, 'Duck-billed platypus.', ['platypus', 'australian', 'monotreme', 'native']],
  ['echidna', 'Echidna', ECHIDNA, 'Short-beaked echidna with spines.', ['echidna', 'australian', 'monotreme', 'native']],
  ['possum', 'Brushtail Possum', POSSUM, 'Common brushtail possum.', ['possum', 'australian', 'marsupial', 'native']],
];
export default LIST.map(([id, name, fn, desc, tags]) => ({ id: 'a_' + id, name, category: 'Animals', env: 'PARK', tags: ['animal', ...tags], desc, build: (k) => animal(k, fn()) }));
