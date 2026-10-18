// Parametric shapes (25), all centred and editable through their parameters.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { normalize, computeNormals, flatShaded, ensureColors } from './mesh.js';
import { TileNoise } from './texgen.js';

const P = (key, label, min, max, def, int = false) => ({ key, label, min, max, def, int });

export const SHAPES = {
  SCULPT_SPHERE: { label: 'Sculpt ball', icon: 'globe', params: [P('radius', 'Radius', 0.05, 5, 0.5), P('res', 'Resolution', 4, 96, 40, true)] },
  CUBE: { label: 'Cube', icon: 'box', params: [P('width', 'Width', 0.02, 10, 1), P('height', 'Height', 0.02, 10, 1), P('depth', 'Depth', 0.02, 10, 1), P('divisions', 'Divisions', 1, 64, 8, true)] },
  ROUNDED_BOX: { label: 'Rounded box', icon: 'square', params: [P('width', 'Width', 0.02, 10, 1), P('height', 'Height', 0.02, 10, 1), P('depth', 'Depth', 0.02, 10, 1), P('radius', 'Roundness', 0, 0.5, 0.15), P('res', 'Smoothness', 1, 12, 5, true)] },
  SPHERE: { label: 'Sphere', icon: 'circle', params: [P('radius', 'Radius', 0.05, 5, 0.5), P('segments', 'Segments', 3, 128, 48, true), P('rings', 'Rings', 2, 96, 24, true)] },
  ICOSPHERE: { label: 'Ico ball', icon: 'hexagon', params: [P('radius', 'Radius', 0.05, 5, 0.5), P('detail', 'Detail', 0, 6, 3, true)] },
  CYLINDER: { label: 'Cylinder', icon: 'cylinder', params: [P('radius', 'Radius', 0.02, 5, 0.5), P('height', 'Height', 0.02, 10, 1), P('segments', 'Segments', 3, 128, 40, true)] },
  CONE: { label: 'Cone', icon: 'cone', params: [P('radius', 'Radius', 0.02, 5, 0.5), P('top', 'Top radius', 0, 5, 0), P('height', 'Height', 0.02, 10, 1), P('segments', 'Segments', 3, 128, 40, true)] },
  TORUS: { label: 'Torus', icon: 'torus', params: [P('major', 'Ring radius', 0.05, 5, 0.4), P('minor', 'Tube radius', 0.01, 2, 0.15), P('segments', 'Segments', 3, 192, 64, true), P('sides', 'Sides', 3, 64, 24, true)] },
  CAPSULE: { label: 'Capsule', icon: 'pill', params: [P('radius', 'Radius', 0.02, 5, 0.3), P('length', 'Length', 0, 10, 0.6), P('segments', 'Segments', 4, 64, 24, true)] },
  TUBE: { label: 'Tube', icon: 'circle-dot', params: [P('outer', 'Outer radius', 0.05, 5, 0.5), P('inner', 'Inner radius', 0.01, 5, 0.35), P('height', 'Height', 0.02, 10, 1), P('segments', 'Segments', 3, 128, 48, true)] },
  PLANE: { label: 'Plane', icon: 'square-dashed', params: [P('width', 'Width', 0.02, 20, 2), P('depth', 'Depth', 0.02, 20, 2), P('divisions', 'Divisions', 1, 128, 8, true)] },
  PYRAMID: { label: 'Pyramid', icon: 'triangle', params: [P('size', 'Base', 0.05, 5, 1), P('height', 'Height', 0.05, 10, 1), P('sides', 'Sides', 3, 12, 4, true)] },
  DOME: { label: 'Dome', icon: 'circle-dashed', params: [P('radius', 'Radius', 0.05, 5, 0.5), P('segments', 'Segments', 6, 128, 48, true)] },
  PRISM: { label: 'Prism', icon: 'hexagon', params: [P('radius', 'Radius', 0.05, 5, 0.5), P('height', 'Height', 0.05, 10, 1), P('sides', 'Sides', 3, 16, 6, true)] },
  WEDGE: { label: 'Wedge', icon: 'triangle-right', params: [P('width', 'Width', 0.05, 10, 1), P('height', 'Height', 0.05, 10, 1), P('depth', 'Depth', 0.05, 10, 1)] },
  GEM: { label: 'Gem', icon: 'gem', params: [P('radius', 'Radius', 0.05, 5, 0.5), P('detail', 'Facets', 0, 2, 0, true)] },
  STAR: { label: 'Star', icon: 'star', params: [P('points', 'Points', 3, 16, 5, true), P('outer', 'Size', 0.1, 5, 0.6), P('inner', 'Inner ratio', 0.1, 0.95, 0.45), P('depth', 'Thickness', 0.01, 3, 0.25), P('bevel', 'Bevel', 0, 0.2, 0.03)] },
  HEART: { label: 'Heart', icon: 'heart', params: [P('size', 'Size', 0.1, 5, 1), P('depth', 'Thickness', 0.01, 3, 0.25), P('bevel', 'Bevel', 0, 0.2, 0.04)] },
  GEAR: { label: 'Gear', icon: 'cog', params: [P('teeth', 'Teeth', 4, 64, 14, true), P('radius', 'Radius', 0.1, 5, 0.6), P('tooth', 'Tooth depth', 0.01, 1, 0.12), P('depth', 'Thickness', 0.01, 3, 0.2), P('hole', 'Hole', 0, 2, 0.15), P('bevel', 'Bevel', 0, 0.1, 0.01)] },
  ARROW: { label: 'Arrow', icon: 'arrow-right', params: [P('length', 'Length', 0.1, 10, 1.4), P('width', 'Width', 0.05, 5, 0.7), P('depth', 'Thickness', 0.01, 3, 0.2), P('bevel', 'Bevel', 0, 0.1, 0.02)] },
  SPRING: { label: 'Spring', icon: 'waves', params: [P('radius', 'Radius', 0.05, 5, 0.4), P('wire', 'Wire', 0.005, 1, 0.05), P('turns', 'Turns', 0.5, 30, 6), P('height', 'Height', 0.05, 10, 1.2)] },
  KNOT: { label: 'Knot', icon: 'infinity', params: [P('p', 'Loops P', 1, 10, 2, true), P('q', 'Loops Q', 1, 10, 3, true), P('radius', 'Radius', 0.1, 5, 0.6), P('tube', 'Tube', 0.01, 1, 0.12)] },
  STAIRS: { label: 'Stairs', icon: 'chart-no-axes-column-increasing', params: [P('steps', 'Steps', 1, 40, 6, true), P('width', 'Width', 0.1, 10, 1), P('stepHeight', 'Step height', 0.02, 2, 0.18), P('stepDepth', 'Step depth', 0.02, 2, 0.28)] },
  ARCH: { label: 'Arch', icon: 'door-closed', params: [P('width', 'Width', 0.2, 10, 1.6), P('height', 'Height', 0.2, 10, 1.6), P('opening', 'Opening', 0.05, 9, 0.9), P('depth', 'Depth', 0.05, 5, 0.35)] },
  TERRAIN: { label: 'Terrain', icon: 'mountain', params: [P('size', 'Size', 0.5, 50, 4), P('height', 'Height', 0, 10, 0.8), P('roughness', 'Roughness', 0, 1, 0.5), P('seed', 'Variation', 1, 999, 7, true), P('res', 'Detail', 8, 256, 96, true)] },
};
export const BASIC = ['SCULPT_SPHERE', 'CUBE', 'ROUNDED_BOX', 'SPHERE', 'ICOSPHERE', 'CYLINDER', 'CONE', 'TORUS', 'CAPSULE', 'TUBE', 'PLANE', 'PYRAMID'];
export const MORE = ['DOME', 'PRISM', 'WEDGE', 'GEM', 'STAR', 'HEART', 'GEAR', 'ARROW', 'SPRING', 'KNOT', 'STAIRS', 'ARCH', 'TERRAIN'];

export function defaultParams(type) {
  const o = {}; for (const p of SHAPES[type].params) o[p.key] = p.def; return o;
}

function extrude(shapes, depth, bevel, segs = 3) {
  const maxB = Math.min(depth * 0.45, bevel);
  const g = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(1e-3, depth - 2 * maxB), bevelEnabled: maxB > 0, bevelThickness: maxB, bevelSize: maxB * 0.9,
    bevelSegments: segs, curveSegments: 24, steps: 1,
  });
  g.center();
  return g;
}

function shapeFrom(pts) { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; }

function sculptBall(r, res) {
  const g = new THREE.BoxGeometry(1, 1, 1, res, res, res);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    // spherified cube: even vertex distribution
    const x = p.getX(i) * 2, y = p.getY(i) * 2, z = p.getZ(i) * 2;
    const sx = x * Math.sqrt(1 - y * y / 2 - z * z / 2 + y * y * z * z / 3);
    const sy = y * Math.sqrt(1 - z * z / 2 - x * x / 2 + z * z * x * x / 3);
    const sz = z * Math.sqrt(1 - x * x / 2 - y * y / 2 + x * x * y * y / 3);
    p.setXYZ(i, sx * r, sy * r, sz * r);
  }
  return g;
}

function heartOutline(size, n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2, st = Math.sin(t);
    const x = 16 * st * (st * st * 0.9 + 0.1);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x / 34 * size, (y + 2.5) / 34 * size]);
  }
  return pts.reverse();
}

function terrain({ size, height, roughness, seed, res }) {
  const g = new THREE.PlaneGeometry(size, size, res, res).rotateX(-Math.PI / 2);
  const noise = new TileNoise(seed | 0), p = g.attributes.position;
  const freq = 1.6 / size, oct = Math.min(7, Math.max(2, (3 + roughness * 4) | 0));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const e = noise.fbm(x * freq * 2 + 100, z * freq * 2 + 100, 64, oct);
    const edgeD = Math.max(Math.abs(x), Math.abs(z));
    const t = Math.min(1, Math.max(0, (size * 0.5 - edgeD) / (size * 0.12)));
    const edge = t * t * (3 - 2 * t);
    p.setY(i, Math.pow(Math.max(0, e * 0.5 + 0.5), 1.4) * height * (0.35 + 0.65 * edge));
  }
  normalize(g);
  const c = ensureColors(g);
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const cols = [lin(0xD9C79A), lin(0x5E9E3E), lin(0x7B7468), lin(0xF2F4F7)];
  for (let i = 0; i < p.count; i++) {
    const t = height > 0 ? p.getY(i) / height : 0;
    const col = cols[t < 0.12 ? 0 : t < 0.45 ? 1 : t < 0.75 ? 2 : 3];
    c[i * 4] = col.r; c[i * 4 + 1] = col.g; c[i * 4 + 2] = col.b; c[i * 4 + 3] = 1;
  }
  return g;
}

/** Build the geometry for a shape spec. Always indexed, Float32, with normals and UVs. */
export function buildShape(type, prm) {
  const q = { ...defaultParams(type), ...prm };
  const I = (v) => Math.max(1, Math.round(v));
  let g, flat = false;
  switch (type) {
    case 'SCULPT_SPHERE': g = sculptBall(q.radius, I(q.res)); break;
    case 'CUBE': { const d = I(q.divisions); g = new THREE.BoxGeometry(q.width, q.height, q.depth, d, d, d); flat = true; break; }
    case 'ROUNDED_BOX': g = new RoundedBoxGeometry(q.width, q.height, q.depth, I(q.res), Math.min(q.radius, Math.min(q.width, q.height, q.depth) / 2 * 0.999)); break;
    case 'SPHERE': g = new THREE.SphereGeometry(q.radius, I(q.segments), I(q.rings)); break;
    case 'ICOSPHERE': g = new THREE.IcosahedronGeometry(q.radius, Math.round(q.detail)); g = indexify(g); break;
    case 'CYLINDER': g = new THREE.CylinderGeometry(q.radius, q.radius, q.height, I(q.segments), Math.max(1, Math.round(q.height / q.radius * 2))); flat = false; break;
    case 'CONE': g = new THREE.CylinderGeometry(q.top, q.radius, q.height, I(q.segments), 4); break;
    case 'TORUS': g = new THREE.TorusGeometry(q.major, Math.min(q.minor, q.major * 0.99), I(q.sides), I(q.segments)); g.rotateX(Math.PI / 2); break;
    case 'CAPSULE': g = new THREE.CapsuleGeometry(q.radius, q.length, Math.max(2, I(q.segments) / 4 | 0), I(q.segments)); break;
    case 'TUBE': {
      const inner = Math.min(q.inner, q.outer * 0.98), h = q.height / 2;
      g = new THREE.LatheGeometry([new THREE.Vector2(inner, -h), new THREE.Vector2(q.outer, -h), new THREE.Vector2(q.outer, h), new THREE.Vector2(inner, h), new THREE.Vector2(inner, -h)], I(q.segments));
      g = flatSplitLathe(g); break;
    }
    case 'PLANE': { const d = I(q.divisions); g = new THREE.PlaneGeometry(q.width, q.depth, d, d).rotateX(-Math.PI / 2); break; }
    case 'PYRAMID': g = new THREE.ConeGeometry(q.size / Math.SQRT2, q.height, I(q.sides), 1); g.rotateY(Math.PI / I(q.sides)); flat = true; break;
    case 'DOME': {
      const pts = []; const n = Math.max(8, I(q.segments) / 2 | 0);
      pts.push(new THREE.Vector2(0, 0));
      for (let i = 0; i <= n; i++) { const a = i / n * Math.PI / 2; pts.push(new THREE.Vector2(q.radius * Math.cos(a), q.radius * Math.sin(a))); }
      pts[pts.length - 1].x = 0;
      g = new THREE.LatheGeometry(pts, I(q.segments)); g.translate(0, -q.radius / 2, 0); break;
    }
    case 'PRISM': g = new THREE.CylinderGeometry(q.radius, q.radius, q.height, I(q.sides), 1); flat = true; break;
    case 'WEDGE': {
      g = extrude(shapeFrom([[-q.depth / 2, -q.height / 2], [q.depth / 2, -q.height / 2], [-q.depth / 2, q.height / 2]]), q.width, 0);
      g.rotateY(-Math.PI / 2); flat = true; break;
    }
    case 'GEM': g = new THREE.OctahedronGeometry(q.radius, Math.round(q.detail)); flat = true; break;
    case 'STAR': {
      const n = I(q.points), pts = [];
      for (let i = 0; i < n * 2; i++) { const a = Math.PI / 2 + i * Math.PI / n, r = i % 2 ? q.outer * q.inner : q.outer; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
      g = extrude(shapeFrom(pts), q.depth, q.bevel, 2); break;
    }
    case 'HEART': g = extrude(shapeFrom(heartOutline(q.size)), q.depth, q.bevel, 4); break;
    case 'GEAR': {
      const n = I(q.teeth), step = Math.PI * 2 / n, root = q.radius - q.tooth, pts = [];
      for (let i = 0; i < n; i++) for (const [f, r] of [[0, root], [0.18, root], [0.32, q.radius], [0.68, q.radius], [0.82, root]]) { const a = i * step + f * step; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
      const s = shapeFrom(pts);
      if (q.hole > 0) { const h = new THREE.Path(); h.absarc(0, 0, Math.min(q.hole, root * 0.9), 0, Math.PI * 2, true); s.holes.push(h); }
      g = extrude(s, q.depth, Math.min(q.bevel, q.tooth * 0.3), 2); break;
    }
    case 'ARROW': {
      const hw = q.width / 2, sw = q.width * 0.22, head = Math.min(q.length * 0.45, q.width * 1.1), x0 = -q.length / 2, x1 = q.length / 2 - head;
      g = extrude(shapeFrom([[x0, -sw], [x1, -sw], [x1, -hw], [q.length / 2, 0], [x1, hw], [x1, sw], [x0, sw]]), q.depth, q.bevel, 2); break;
    }
    case 'SPRING': {
      const turns = q.turns, h = q.height;
      class Helix extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const a = t * turns * Math.PI * 2; return o.set(q.radius * Math.cos(a), -h / 2 + t * h, q.radius * Math.sin(a)); } }
      g = new THREE.TubeGeometry(new Helix(), Math.max(24, turns * 48 | 0), q.wire, 12, false); break;
    }
    case 'KNOT': g = new THREE.TorusKnotGeometry(q.radius * 0.6, q.tube, 256, 16, I(q.p), I(q.q)); break;
    case 'STAIRS': {
      const n = I(q.steps), D = n * q.stepDepth, H = n * q.stepHeight, pts = [[D / 2, -H / 2]];
      for (let i = 0; i < n; i++) { const zf = D / 2 - i * q.stepDepth; pts.push([zf, -H / 2 + (i + 1) * q.stepHeight], [zf - q.stepDepth, -H / 2 + (i + 1) * q.stepHeight]); }
      pts.push([-D / 2, -H / 2]);
      g = extrude(shapeFrom(pts), q.width, 0); g.rotateY(-Math.PI / 2); flat = true; break;
    }
    case 'ARCH': {
      const a = Math.min(q.opening / 2, q.width / 2 * 0.9), spring = Math.max(0, q.height - a - q.height * 0.12), y0 = -q.height / 2;
      const s = new THREE.Shape();
      s.moveTo(-q.width / 2, y0); s.lineTo(-a, y0); s.lineTo(-a, y0 + spring);
      s.absarc(0, y0 + spring, a, Math.PI, 0, true);
      s.lineTo(a, y0); s.lineTo(q.width / 2, y0); s.lineTo(q.width / 2, q.height / 2); s.lineTo(-q.width / 2, q.height / 2); s.closePath();
      g = extrude(s, q.depth, 0); flat = true; break;
    }
    case 'TERRAIN': g = terrain(q); break;
    default: throw new Error('Unknown shape ' + type);
  }
  if (!g.index) g = indexify(g);
  normalize(g);
  g.userData.flat = false;
  if (flat) g = flatShaded(g);
  else computeNormals(g);
  return g;
}

function indexify(g) {
  const n = g.attributes.position.count, idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// lathe of a rectangle profile has hard edges: split it into flat faces
function flatSplitLathe(g) { return flatShaded(normalize(indexify(g.index ? g : g))); }

export { computeNormals };
