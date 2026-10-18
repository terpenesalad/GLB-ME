// Texture factory: procedural (TextureGen port), photos/images, matcaps and preview canvases.
import * as THREE from 'three';
import { generate, normalMap, roughnessMap, PATTERNS, defaultSpec } from '../core/texgen.js';
import { syncTextures } from './model.js';

export { PATTERNS, defaultSpec };

function canvasFrom(rgba, n) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  c.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0);
  return c;
}
function tex(canvas, srgb, name) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.name = name; t.flipY = true;
  return t;
}

const previewCache = new Map();
/** Small preview canvas for a pattern spec (cached). */
export function previewCanvas(spec, size = 96) {
  const key = JSON.stringify(spec) + size;
  if (previewCache.has(key)) { const src = previewCache.get(key); const c = document.createElement('canvas'); c.width = c.height = size; c.getContext('2d').drawImage(src, 0, 0); return c; }
  const g = generate(spec, size);
  const c = canvasFrom(g.rgba, size);
  previewCache.set(key, c);
  const out = document.createElement('canvas'); out.width = out.height = size; out.getContext('2d').drawImage(c, 0, 0);
  return out;
}

/** Applies a generated pattern (color + normal + roughness maps) to a material. */
export function applyPattern(m, spec, size = 1024, opts = {}) {
  const g = generate(spec, size);
  const color = tex(canvasFrom(g.rgba, size), true, spec.pattern);
  const nm = normalMap(g.height, size, opts.bump ?? 2);
  const normal = tex(canvasFrom(nm, size), false, spec.pattern + '_normal');
  const rough = roughnessMap(g.height, m.roughness, m.metalness);
  const rtex = tex(canvasFrom(rough, size), false, spec.pattern + '_rough');
  disposeMaps(m);
  m.map = color; m.normalMap = opts.bump === 0 ? null : normal; m.roughnessMap = opts.bump === 0 ? null : rtex;
  m.color.set(0xffffff);
  m.userData.maps = { kind: 'pattern', spec: { ...spec }, size };
  m.userData.pixel = spec.pattern === 'PIXELS' || !!m.userData.pixel && m.userData.maps.kind === 'pattern' && spec.pattern === 'PIXELS';
  if (!m.userData.tiling) m.userData.tiling = [1, 1];
  syncTextures(m);
  m.needsUpdate = true;
}

/** Loads an image file (ArrayBuffer + name) into a texture usable as color map. */
export async function imageTexture(data, name, srgb = true) {
  const blob = new Blob([data]);
  const bmp = await createImageBitmap(blob).catch(() => null) || await loadImg(blob);
  const c = document.createElement('canvas');
  const max = 4096, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const t = tex(c, srgb, name.replace(/\.[a-z0-9]+$/i, ''));
  t.userData.hasAlpha = hasAlpha(ctx, c.width, c.height);
  return t;
}
function loadImg(blob) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(blob); }); }
function hasAlpha(ctx, w, hgt) {
  const d = ctx.getImageData(0, 0, w, hgt).data; const step = Math.max(4, Math.floor(d.length / 4 / 20000) * 4);
  for (let i = 3; i < d.length; i += step) if (d[i] < 250) return true;
  return false;
}
export function applyImage(m, t, opts = {}) {
  disposeMaps(m);
  m.map = t; m.normalMap = null; m.roughnessMap = null;
  if (opts.white !== false) m.color.set(0xffffff);
  m.userData.maps = { kind: 'image', name: t.name };
  if (t.userData.hasAlpha) { m.transparent = false; m.alphaTest = 0.5; }
  syncTextures(m); m.needsUpdate = true;
}
/** Derives a normal map from the color map's luminance (photo bump). */
export function bumpFromColor(m, strength = 2) {
  const img = m.map?.image; if (!img) return;
  const n = Math.min(1024, img.width, img.height);
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, n, n);
  const d = ctx.getImageData(0, 0, n, n).data, hgt = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) hgt[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  if (m.normalMap) m.normalMap.dispose();
  m.normalMap = tex(canvasFrom(normalMap(hgt, n, strength), n), false, (m.map.name || 'photo') + '_normal');
  syncTextures(m); m.needsUpdate = true;
}
export function clearMaps(m) { disposeMaps(m); m.map = m.normalMap = m.roughnessMap = null; m.userData.maps = {}; m.alphaTest = 0; m.needsUpdate = true; }
function disposeMaps(m) { /* textures may be shared with undo snapshots, so they're not disposed here */ }

// ---------------------------------------------------------------------------------- matcaps
export const MATCAPS = [
  { id: 0, label: 'Clay', a: '#d8cfc4', b: '#5b4f45', spec: 0.35 },
  { id: 1, label: 'Red wax', a: '#ff8a7a', b: '#5a0d0d', spec: 0.6 },
  { id: 2, label: 'Jade', a: '#9be7c4', b: '#0d3b2c', spec: 0.5 },
  { id: 3, label: 'Pearl', a: '#ffffff', b: '#7d7f96', spec: 0.9 },
  { id: 4, label: 'Chrome', a: '#f0f4ff', b: '#1d222b', spec: 1 },
  { id: 5, label: 'Skin', a: '#ffd6bf', b: '#7a3f2a', spec: 0.3 },
];
const matcapCache = new Map();
export function matcapTexture(id) {
  if (matcapCache.has(id)) return matcapCache.get(id);
  const mc = MATCAPS[id] || MATCAPS[0], n = 256;
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d');
  ctx.fillStyle = mc.b; ctx.fillRect(0, 0, n, n);
  const g = ctx.createRadialGradient(n * 0.38, n * 0.32, n * 0.02, n * 0.5, n * 0.5, n * 0.52);
  g.addColorStop(0, mc.a); g.addColorStop(0.55, mixHex(mc.a, mc.b, 0.45)); g.addColorStop(1, mc.b);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); ctx.fill();
  if (id === 4) { // chrome horizon band
    const b = ctx.createLinearGradient(0, n * 0.45, 0, n * 0.62);
    b.addColorStop(0, 'rgba(255,255,255,0)'); b.addColorStop(0.5, 'rgba(20,24,32,0.85)'); b.addColorStop(1, 'rgba(160,140,120,0.5)');
    ctx.save(); ctx.beginPath(); ctx.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = b; ctx.fillRect(0, n * 0.45, n, n * 0.17); ctx.restore();
  }
  const s = ctx.createRadialGradient(n * 0.33, n * 0.28, 0, n * 0.33, n * 0.28, n * 0.16);
  s.addColorStop(0, `rgba(255,255,255,${mc.spec})`); s.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = s; ctx.fillRect(0, 0, n, n);
  const r = ctx.createRadialGradient(n / 2, n / 2, n * 0.42, n / 2, n / 2, n * 0.5);
  r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(1, 'rgba(255,255,255,0.18)');
  ctx.fillStyle = r; ctx.beginPath(); ctx.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); ctx.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  matcapCache.set(id, t);
  return t;
}
function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Texture from an emoji/text sticker or a built-in sticker shape. */
export function stickerTexture(kind, value, color = '#ffffff') {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d');
  if (kind === 'emoji') { ctx.font = `${n * 0.78}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(value, n / 2, n * 0.54); }
  else if (kind === 'text') {
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let fs = n * 0.4; ctx.font = `700 ${fs}px InterUI, sans-serif`;
    while (ctx.measureText(value).width > n * 0.92 && fs > 20) { fs -= 4; ctx.font = `700 ${fs}px InterUI, sans-serif`; }
    ctx.fillText(value, n / 2, n / 2);
  } else if (kind === 'shape') {
    ctx.fillStyle = color; ctx.translate(n / 2, n / 2);
    const R = n * 0.45; ctx.beginPath();
    if (value === 'star') for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.45 : R; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    else if (value === 'heart') { ctx.moveTo(0, R * 0.8); ctx.bezierCurveTo(-R * 1.4, -R * 0.1, -R * 0.55, -R * 1.05, 0, -R * 0.42); ctx.bezierCurveTo(R * 0.55, -R * 1.05, R * 1.4, -R * 0.1, 0, R * 0.8); }
    else if (value === 'ring') { ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2, true); }
    else if (value === 'bolt') { [[0.15, -1], [-0.55, 0.12], [-0.05, 0.12], [-0.2, 1], [0.55, -0.15], [0.05, -0.15]].forEach(([x, y]) => ctx.lineTo(x * R, y * R)); }
    else ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.closePath(); ctx.fill('evenodd');
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = true; t.name = 'Sticker';
  return t;
}
