// Texture painting: paints soft round dabs straight into the material's base-colour texture
// (a canvas), using the UV coordinates under the brush. Each stroke is one undo step (only the
// changed rectangle is stored). Tiling/offset/rotation and texture wrapping are respected.
import * as THREE from 'three';
import { syncTextures } from './model.js';

export const PAINT_SIZES = [[1024, '1K'], [2048, '2K'], [4096, '4K']];
const isCanvas = (img) => !!img && typeof img.getContext === 'function';

/** True when the material's colour texture can be painted on directly (canvas, not shared with another material). */
export function isPaintable(m, doc) {
  const t = m.map;
  if (!t || !isCanvas(t.image)) return false;
  for (const o of doc.meshes) if (o.material !== m && o.material.map && o.material.map.image === t.image) return false;
  return true;
}
/**
 * Gives the material a paintable canvas texture: copies an existing texture (so copies of the
 * model aren't painted too), or creates a new one filled with the current base colour.
 */
export function ensurePaintTexture(m, size = 2048) {
  const old = m.map;
  let c;
  if (old?.image?.width) {
    c = document.createElement('canvas'); c.width = old.image.width; c.height = old.image.height;
    c.getContext('2d').drawImage(old.image, 0, 0);
  } else {
    c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#' + m.color.getHexString(); ctx.fillRect(0, 0, size, size);
    m.userData.maps = { kind: 'paint', name: 'Painted', bg: '#' + m.color.getHexString() };
    m.color.set(0xffffff);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = true; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.name = old?.name ? old.name + ' (painted)' : 'Painted';
  if (old) { t.flipY = old.flipY; t.magFilter = old.magFilter; t.minFilter = old.minFilter; }
  m.map = t;
  if (!m.userData.maps?.kind) m.userData.maps = { kind: 'paint', name: t.name };
  syncTextures(m); m.needsUpdate = true;
  return t;
}

/** Texels per world unit at a hit (from the triangle's UV area vs. its world area). */
export function texelDensity(hit, obj, tex) {
  const g = obj.geometry, uv = g.attributes.uv, p = g.attributes.position, f = hit.face;
  if (!uv || !f) return 512;
  const A = new THREE.Vector3().fromBufferAttribute(p, f.a).applyMatrix4(obj.matrixWorld);
  const B = new THREE.Vector3().fromBufferAttribute(p, f.b).applyMatrix4(obj.matrixWorld);
  const C = new THREE.Vector3().fromBufferAttribute(p, f.c).applyMatrix4(obj.matrixWorld);
  const wa = B.sub(A).cross(C.sub(A)).length() / 2;
  const W = tex.image.width * tex.repeat.x, H = tex.image.height * tex.repeat.y;
  const ua = [uv.getX(f.a), uv.getY(f.a)], ub = [uv.getX(f.b), uv.getY(f.b)], uc = [uv.getX(f.c), uv.getY(f.c)];
  const ta = Math.abs((ub[0] - ua[0]) * (uc[1] - ua[1]) - (uc[0] - ua[0]) * (ub[1] - ua[1])) / 2 * W * H;
  if (wa < 1e-12 || ta < 1e-9) return 512;
  return Math.sqrt(ta / wa);
}

const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

export class TexStroke {
  constructor(tex, opts = {}) {
    this.t = tex; this.c = tex.image; this.ctx = this.c.getContext('2d', { willReadFrequently: false });
    this.before = document.createElement('canvas'); this.before.width = this.c.width; this.before.height = this.c.height;
    this.before.getContext('2d').drawImage(this.c, 0, 0);
    // eraser target: what the texture looked like when painting on it first began this session
    if (!tex.userData.paintBase) { const b = document.createElement('canvas'); b.width = this.c.width; b.height = this.c.height; b.getContext('2d').drawImage(this.c, 0, 0); tex.userData.paintBase = b; }
    this.bg = opts.bg || null;
    this.dirty = null; this.lastUpload = 0;
    tex.updateMatrix();
  }
  /** Canvas pixel position for a mesh UV (applies tiling and wrapping). */
  toPixel(uv) { const u = uv.clone(); this.t.transformUv(u); return [u.x * this.c.width, u.y * this.c.height]; }
  dab(uv, radius, hex, opacity, hardness = 0.5, erase = false) {
    const [x0, y0] = this.toPixel(uv), W = this.c.width, H = this.c.height, ctx = this.ctx;
    const r = Math.max(0.6, radius);
    // draw wrapped copies near the edges so strokes continue across tiling seams
    const xs = [x0], ys = [y0];
    if (x0 - r < 0) xs.push(x0 + W); if (x0 + r > W) xs.push(x0 - W);
    if (y0 - r < 0) ys.push(y0 + H); if (y0 + r > H) ys.push(y0 - H);
    for (const x of xs) for (const y of ys) {
      ctx.save();
      if (erase && this.t.userData.paintBase) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
        ctx.globalAlpha = opacity; ctx.drawImage(this.t.userData.paintBase, 0, 0);
      } else {
        const col = erase ? (this.bg || '#ffffff') : hex;
        const g = ctx.createRadialGradient(x, y, r * Math.min(0.98, hardness), x, y, r);
        g.addColorStop(0, rgba(col, opacity)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      const d = [Math.floor(x - r - 1), Math.floor(y - r - 1), Math.ceil(x + r + 1), Math.ceil(y + r + 1)];
      this.dirty = this.dirty ? [Math.min(this.dirty[0], d[0]), Math.min(this.dirty[1], d[1]), Math.max(this.dirty[2], d[2]), Math.max(this.dirty[3], d[3])] : d;
    }
    const now = performance.now();
    if (now - this.lastUpload > 32) { this.t.needsUpdate = true; this.lastUpload = now; } else this.pending = true;
  }
  flush() { if (this.pending) { this.t.needsUpdate = true; this.pending = false; } }
  /** Finishes the stroke; returns an undo record (or null if nothing changed). */
  end(label = 'Texture paint') {
    this.t.needsUpdate = true;
    const d = this.dirty; if (!d) { this.before = null; return null; }
    const x = Math.max(0, d[0]), y = Math.max(0, d[1]), w = Math.min(this.c.width, d[2]) - x, hgt = Math.min(this.c.height, d[3]) - y;
    if (w <= 0 || hgt <= 0) return null;
    const before = this.before.getContext('2d').getImageData(x, y, w, hgt), after = this.ctx.getImageData(x, y, w, hgt);
    this.before = null;
    const t = this.t, ctx = this.ctx;
    return { label, bytes: w * hgt * 8, undo: () => { ctx.putImageData(before, x, y); t.needsUpdate = true; }, redo: () => { ctx.putImageData(after, x, y); t.needsUpdate = true; } };
  }
}

/** Colour under a ray hit: texture × base colour, vertex paint, or the base colour. Returns '#rrggbb'. */
export function sampleColor(hit) {
  const o = hit.object?.userData?.helperOf || hit.obj || hit.object, m = o.material;
  const base = m.color.clone();
  if (m.map?.image?.width && hit.uv) {
    const t = m.map; t.updateMatrix();
    const u = hit.uv.clone(); t.transformUv(u);
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(t.image, Math.floor(u.x * t.image.width), Math.floor(u.y * t.image.height), 1, 1, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const tc = new THREE.Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
    return '#' + tc.multiply(base).getHexString();
  }
  const col = o.geometry.attributes.color;
  if (col && m.vertexColors && hit.face) {
    const f = hit.face, b = hit.barycoord || new THREE.Vector3(1 / 3, 1 / 3, 1 / 3);
    const c = new THREE.Color(
      col.getX(f.a) * b.x + col.getX(f.b) * b.y + col.getX(f.c) * b.z,
      col.getY(f.a) * b.x + col.getY(f.b) * b.y + col.getY(f.c) * b.z,
      col.getZ(f.a) * b.x + col.getZ(f.b) * b.y + col.getZ(f.c) * b.z);
    return '#' + c.multiply(base).getHexString();
  }
  return '#' + base.getHexString();
}

/**
 * Re-renders a material's textures (and vertex paint) into a new UV layout on the GPU, so an
 * unwrap keeps the model looking the same. Returns { slot: CanvasTexture }.
 * geo: the unwrapped geometry; oldUv: the previous UV of each new vertex (or null).
 */
export function bakeToNewUv(renderer, m, geo, oldUv, size = 2048, withVertexColors = false) {
  const out = {};
  const slots = [['map', true], ['roughnessMap', false], ['metalnessMap', false], ['aoMap', false], ['emissiveMap', true]];
  const uv = geo.attributes.uv.array, n = uv.length / 2;
  const pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[i * 3] = uv[i * 2] * 2 - 1; pos[i * 3 + 1] = uv[i * 2 + 1] * 2 - 1; }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bg.setAttribute('ouv', new THREE.BufferAttribute(oldUv || new Float32Array(n * 2), 2));
  const vc = withVertexColors && geo.attributes.color ? geo.attributes.color.array : null;
  bg.setAttribute('vcol', new THREE.BufferAttribute(vc ? Float32Array.from(vc) : new Float32Array(n * 4).fill(1), 4));
  bg.setIndex(geo.index.clone());
  const prevTarget = renderer.getRenderTarget(), prevColor = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  for (const [slot, srgb] of slots) {
    const tex = m[slot];
    const useV = slot === 'map' && !!vc;
    if (!tex && !useV) continue;
    if (tex && !oldUv) continue;
    tex?.updateMatrix();
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex || null }, hasMap: { value: !!tex }, uvT: { value: tex ? tex.matrix.clone() : new THREE.Matrix3() }, useV: { value: useV } },
      vertexShader: 'attribute vec2 ouv; attribute vec4 vcol; uniform mat3 uvT; varying vec2 vUv; varying vec4 vC; void main(){ vUv = (uvT * vec3(ouv, 1.0)).xy; vC = vcol; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D map; uniform bool hasMap; uniform bool useV; varying vec2 vUv; varying vec4 vC; void main(){ vec4 c = hasMap ? texture2D(map, vUv) : vec4(1.0); if (useV) c.rgb *= vC.rgb; gl_FragColor = c; gl_FragColor.a = 1.0;\n#include <colorspace_fragment>\n}',
      side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    });
    const rt = new THREE.WebGLRenderTarget(size, size, { colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace });
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(bg, mat); mesh.frustumCulled = false; scene.add(mesh);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, new THREE.Camera());
    const px = new Uint8Array(size * size * 4); renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    rt.dispose(); mat.dispose();
    // flip to canvas rows and grow the charts into the gaps so seams don't show
    const img = new ImageData(size, size), d = img.data;
    for (let r = 0; r < size; r++) d.set(px.subarray((size - 1 - r) * size * 4, (size - r) * size * 4), r * size * 4);
    dilate(d, size, 6);
    const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.flipY = true; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.name = (tex?.name || 'Painted') ; out[slot] = t;
  }
  renderer.setRenderTarget(prevTarget); renderer.setClearColor(prevColor, prevAlpha);
  bg.dispose();
  return out;
}
function dilate(d, size, passes) {
  let filled = 0, sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { filled++; sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
  for (let p = 0; p < passes; p++) {
    const src = Uint8ClampedArray.from(d);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4; if (src[i + 3]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
        const j = (Y * size + X) * 4; if (src[j + 3]) { d[i] = src[j]; d[i + 1] = src[j + 1]; d[i + 2] = src[j + 2]; d[i + 3] = 255; break; }
      }
    }
  }
  const avg = filled ? [sr / filled, sg / filled, sb / filled] : [255, 255, 255];
  for (let i = 0; i < d.length; i += 4) if (!d[i + 3]) { d[i] = avg[0]; d[i + 1] = avg[1]; d[i + 2] = avg[2]; d[i + 3] = 255; }
}
