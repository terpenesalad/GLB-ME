// Runtime PBR material library. Texture sets are pre-baked to assets/materials/<id>_{c,n,r}.webp
// by scripts/bake-templates.mjs (fast to load, identical everywhere); when a baked file is missing
// (development builds) the set is generated on the fly from the procedural generators in pbr.js.
import * as THREE from 'three';
import { LIB, libMaps } from './pbr.js';
import { newMaterial } from '../editor/model.js';

const sets = new Map(); // id -> Promise<{ map, normalMap, roughnessMap }>
const loader = new THREE.TextureLoader();
const prep = (t, srgb, name) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.name = name; return t; };

/** Loads (or generates) the texture set of a library material. */
export function textureSet(id) {
  if (!sets.has(id)) {
    sets.set(id, (async () => {
      try {
        const [c, n, r] = await Promise.all(['c', 'n', 'r'].map((s) => loader.loadAsync(`materials/${id}_${s}.webp`)));
        return { map: prep(c, true, id), normalMap: prep(n, false, id + '_normal'), roughnessMap: prep(r, false, id + '_rough') };
      } catch {
        return libMaps(id, 512);
      }
    })());
  }
  return sets.get(id);
}

/** Plain finishes (no textures) used for metal, glass, plastic and lights. */
export const FINISH = {
  glass: { label: 'Glass', color: 0x8fa6b2, roughness: 0.03, metalness: 0, opacity: 0.32, specularIntensity: 1 },
  glass_frosted: { label: 'Frosted glass', color: 0xdfe8ec, roughness: 0.35, metalness: 0, opacity: 0.7 },
  glass_tinted: { label: 'Tinted glass', color: 0x2e3d47, roughness: 0.04, metalness: 0.2, opacity: 0.75 },
  iron: { label: 'Cast iron (painted)', color: 0x1c1e1f, roughness: 0.42, metalness: 0.35 },
  steel: { label: 'Steel', color: 0x8c9196, roughness: 0.35, metalness: 1 },
  steel_dark: { label: 'Dark steel', color: 0x3b3f44, roughness: 0.5, metalness: 0.9 },
  chrome: { label: 'Chrome', color: 0xe4e7ea, roughness: 0.08, metalness: 1 },
  brass: { label: 'Brass', color: 0xc9a24b, roughness: 0.28, metalness: 1 },
  copper: { label: 'Copper', color: 0xc77b52, roughness: 0.3, metalness: 1 },
  aluminium: { label: 'Aluminium', color: 0xc2c6ca, roughness: 0.3, metalness: 1 },
  rubber: { label: 'Rubber', color: 0x161616, roughness: 0.9, metalness: 0 },
  plastic: { label: 'Plastic', color: 0xe8e8e8, roughness: 0.35, metalness: 0 },
  matte: { label: 'Matte', color: 0xcccccc, roughness: 0.8, metalness: 0 },
  gloss: { label: 'Gloss paint', color: 0xcccccc, roughness: 0.22, metalness: 0, clearcoat: 0.4 },
  carpaint: { label: 'Car paint', color: 0x2c6e49, roughness: 0.35, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 },
  porcelain: { label: 'Porcelain', color: 0xf4f4f1, roughness: 0.08, metalness: 0, clearcoat: 0.6 },
  light: { label: 'Light', color: 0xfff1d6, roughness: 0.5, metalness: 0, emissive: 0xffe2b0, emissiveIntensity: 3 },
  eye: { label: 'Eye', color: 0x0d0b0a, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 },
  skin: { label: 'Skin', color: 0xffffff, roughness: 0.6, metalness: 0, sheen: 0.2, sheenRoughness: 0.8, sheenColor: 0x5a4a48 },
  fur: { label: 'Fur', color: 0xffffff, roughness: 0.85, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: 0x4a4a4a },
  leaf: { label: 'Leaves', color: 0xffffff, roughness: 0.65, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide },
  water: { label: 'Water', color: 0x2b5a66, roughness: 0.02, metalness: 0, opacity: 0.75 },
};

/** Builds a physical material from a library id or a finish id, with an optional colour override. */
export function createMaterial(id, { color = null, name = null, ...over } = {}) {
  const lib = LIB[id], fin = FINISH[id];
  const m = newMaterial({ name: name || lib?.label || fin?.label || id, color: color ?? lib?.color ?? fin?.color ?? 0xffffff });
  if (lib) {
    m.roughness = 1; m.metalness = lib.metal ?? 0;
    m.userData.maps = { kind: 'image', name: lib.label, lib: id };
    m.userData.libTile = lib.tile;
    const ready = textureSet(id).then((s) => {
      // clones share the image upload but keep their own repeat (so tiling stays per material)
      m.map = s.map.clone(); m.normalMap = s.normalMap.clone(); m.roughnessMap = s.roughnessMap.clone();
      for (const t of [m.map, m.normalMap, m.roughnessMap]) t.needsUpdate = true;
      const ns = lib.nscale ?? 1; m.normalScale.set(ns, ns);
      m.needsUpdate = true;
    });
    m.userData._ready = ready;
  } else if (fin) {
    m.roughness = fin.roughness; m.metalness = fin.metalness;
    if (fin.opacity != null && fin.opacity < 1) { m.transparent = true; m.opacity = fin.opacity; }
    for (const k of ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'specularIntensity', 'alphaTest', 'side', 'emissiveIntensity']) if (fin[k] != null) m[k] = fin[k];
    if (fin.sheen) m.sheenColor.set(fin.sheenColor ?? color ?? fin.color);
    if (fin.emissive != null) m.emissive.set(fin.emissive);
  }
  for (const [k, v] of Object.entries(over)) {
    if (k === 'emissive' || k === 'sheenColor') m[k].set(v);
    else if (k in m) m[k] = v;
  }
  return m;
}
/** Waits until every library material in the list has its textures. */
export async function materialsReady(mats) { await Promise.all(mats.map((m) => m.userData._ready).filter(Boolean)); for (const m of mats) delete m.userData._ready; }

/** Library entries for UI (swatch grids). */
export function libraryList() { return Object.entries(LIB).map(([id, d]) => ({ id, label: d.label, tile: d.tile })); }
export { LIB };
