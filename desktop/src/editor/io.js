// Project files (GLB + editor extras, compatible with the Android app), importers and the
// export pipeline (GLB / glTF / USDZ / OBJ+MTL / STL / PLY with presets, units, origin,
// up axis, simplification and texture limits).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { normalize, computeNormals, removeUnused, fromArrays } from '../core/mesh.js';
import { makeMesh, makeLight, newMaterial, syncTextures, isMesh, isLight } from './model.js';

// =================================================================================== project
/** Serializes the document as a GLB with editor extras (same layout as the Android app). */
export async function saveProject(doc, vp) {
  const { scene, clips } = buildScene(doc, { project: true, includeHidden: true, animations: true });
  scene.userData = {
    glbandme: {
      version: 1, app: 'desktop', fps: doc.fps, frameCount: doc.frameCount, selected: doc.objects.indexOf(doc.selected),
      camera: { yaw: vp.cam.yaw, pitch: vp.cam.pitch, distance: vp.cam.distance, target: vp.cam.target.toArray() },
      render: { ...vp.render },
    },
  };
  const out = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips, onlyVisible: false });
  return out;
}

/** Loads a GLB/GLTF (project or plain model). Returns { objects, extras, fps, frameCount }. */
export async function parseGltf(data) {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const extras = gltf.scene.userData?.glbandme || gltf.userData?.glbandme || null;
  const fps = extras?.fps || 30;
  const objects = convertScene(gltf.scene, true);
  const frameCount = applyClips(gltf.animations, objects, fps, extras?.frameCount);
  return { objects: objects.map((x) => x.obj), extras, fps, frameCount };
}

export async function loadProject(doc, vp, data) {
  const r = await parseGltf(data);
  for (const o of [...doc.objects]) doc.detach(o);
  for (const o of r.objects) doc.attach(o);
  doc.fps = r.fps; doc.frameCount = Math.max(1, r.frameCount || r.extras?.frameCount || 90);
  const ex = r.extras;
  if (ex) {
    const sel = doc.objects[ex.selected]; doc.selected = sel || null;
    if (ex.camera) { vp.cam.yaw = ex.camera.yaw ?? 35; vp.cam.pitch = ex.camera.pitch ?? 20; vp.cam.distance = ex.camera.distance ?? 3.2; if (ex.camera.target) vp.cam.target.fromArray(ex.camera.target); }
    if (ex.render) {
      const rs = vp.render;
      for (const k of Object.keys(rs)) if (ex.render[k] != null && typeof ex.render[k] === typeof rs[k]) rs[k] = ex.render[k];
    }
    vp.updateCamera();
  } else vp.frame(null, false);
  vp.applyRender();
  doc.history.clear();
  return r;
}

// =================================================================================== importers
export const IMPORT_EXT = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx'];
export async function importModel(name, data) {
  const ext = name.split('.').pop().toLowerCase();
  const base = name.replace(/\.[^.]+$/, '');
  if (ext === 'glb' || ext === 'gltf') {
    const r = await parseGltf(data);
    if (!r.objects.length) throw new Error('No meshes found in this file');
    return { ...r, isProject: !!r.extras };
  }
  let root;
  if (ext === 'obj') root = new OBJLoader().parse(new TextDecoder().decode(data));
  else if (ext === 'fbx') root = new FBXLoader().parse(data, '');
  else {
    const geo = ext === 'stl' ? new STLLoader().parse(data) : new PLYLoader().parse(data);
    root = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9d9de, vertexColors: !!geo.attributes.color }));
    root.name = base;
  }
  if (ext === 'fbx') root.scale.multiplyScalar(0.01); // FBX files are usually in centimetres
  const objs = convertScene(root, false).map((x) => x.obj);
  if (objs.length === 1 && (!objs[0].name || objs[0].name === 'mesh')) objs[0].name = base;
  if (!objs.length) throw new Error('No meshes found in this file');
  // auto-fit very large/small imports to a ~1.5 m bounding size, resting on the floor
  fitImported(objs, ext);
  return { objects: objs, extras: null, isProject: false };
}
function fitImported(objs, ext) {
  const box = new THREE.Box3(); for (const o of objs) { o.updateMatrixWorld(true); box.expandByObject(o); }
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()).length();
  let s = 1;
  if (size > 50 || size < 0.05 || ext === 'stl') s = 1.5 / size;
  if (s === 1) return;
  const c = box.getCenter(new THREE.Vector3());
  for (const o of objs) { o.position.sub(c).multiplyScalar(s); o.position.y += (c.y - box.min.y) * s; o.scale.multiplyScalar(s); }
}

/** Flattens a loaded THREE hierarchy into editor objects (world transforms, split multi-materials). */
function convertScene(root, fromGltf) {
  root.updateMatrixWorld(true);
  const out = [];
  const nodeMap = new Map();
  root.traverse((n) => {
    if (n.isLight) {
      const type = n.isSpotLight ? 'spot' : n.isDirectionalLight ? 'directional' : 'point';
      const o = makeLight(type, n.name || undefined);
      const l = o.ed.light;
      l.color.copy(n.color); l.intensity = n.intensity; if (n.distance != null) l.distance = n.distance;
      if (n.isSpotLight) { l.angle = n.angle; l.penumbra = n.penumbra; }
      n.matrixWorld.decompose(o.position, o.quaternion, o.scale); o.scale.set(1, 1, 1);
      const ex = n.userData?.glbandme; if (ex) { o.visible = ex.visible !== false; o.ed.locked = !!ex.locked; if (ex.name) o.name = ex.name; }
      if (n.isSpotLight || n.isDirectionalLight) { const t = new THREE.Vector3(); n.target.getWorldPosition(t); if (n.parent && n.target.parent === n) { /* default orientation */ } }
      out.push({ obj: o, node: n }); nodeMap.set(n, o);
      return;
    }
    if (!n.isMesh || !n.geometry?.attributes?.position) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    let geos = [[n.geometry, mats[0]]];
    if (Array.isArray(n.material) && n.geometry.groups.length > 1) geos = n.geometry.groups.map((gr) => [subGeometry(n.geometry, gr), mats[gr.materialIndex] || mats[0]]);
    geos.forEach(([g0, m0], gi) => {
      let g = g0.clone();
      if (g.morphAttributes) g.morphAttributes = {};
      if (g.attributes._mask) { g.setAttribute('mask', g.attributes._mask); g.deleteAttribute('_mask'); }
      for (const k of Object.keys(g.attributes)) if (/^(uv1|uv2|uv3|tangent|skinIndex|skinWeight)$/.test(k)) g.deleteAttribute(k);
      normalize(g);
      const ex = n.userData?.glbandme || {};
      if (fromGltf && g.attributes.uv) { const uv = g.attributes.uv.array; for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i]; }
      g.userData.flat = !!ex.flat;
      const mat = convertMaterial(m0, fromGltf);
      const o = makeMesh(g, (ex.name || n.name || 'Mesh') + (geos.length > 1 ? ` ${gi + 1}` : ''), mat);
      o.material.vertexColors = !!g.attributes.color && (m0?.vertexColors !== false || !fromGltf);
      // world transform (bake shear/non-uniform rotation-scale into the geometry if needed)
      const m = n.matrixWorld.clone();
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(p, q, s);
      const recomposed = new THREE.Matrix4().compose(p, q, s);
      if (!matricesClose(recomposed, m)) { g.applyMatrix4(m); computeNormals(g); o.geometry = g; } else { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
      if (m.determinant() < 0 && matricesClose(recomposed, m) === false) { /* already baked */ }
      o.visible = ex.visible !== false && n.visible !== false; o.ed.locked = !!ex.locked;
      if (ex.dprimitive) o.ed.prim = ex.dprimitive;
      if (ex.dtext || ex.text) o.ed.text = { ...(ex.dtext || ex.text) };
      g.computeBoundingBox(); g.computeBoundingSphere();
      if (o.geometry.boundsTree) o.geometry.disposeBoundsTree();
      o.geometry.computeBoundsTree();
      out.push({ obj: o, node: n }); if (gi === 0) nodeMap.set(n, o);
    });
  });
  out.nodeMap = nodeMap;
  return out;
}
function matricesClose(a, b) { for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-4) return false; return true; }
function subGeometry(g, group) {
  const idx = g.index ? g.index.array.slice(group.start, group.start + group.count) : Uint32Array.from({ length: group.count }, (_, i) => group.start + i);
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  out.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  return removeUnusedGeneric(out);
}
function removeUnusedGeneric(g) {
  normalize(g);
  return removeUnused(g);
}
function convertMaterial(m, fromGltf) {
  let out;
  if (m && m.isMeshStandardMaterial) { out = m; }
  else {
    out = newMaterial();
    if (m?.color) out.color.copy(m.color);
    if (m?.map) out.map = m.map;
    if (m?.emissive) out.emissive.copy(m.emissive);
    if (m?.opacity != null && m.opacity < 1) { out.opacity = m.opacity; out.transparent = true; }
    if (m?.shininess != null) out.roughness = Math.max(0.05, Math.min(1, 1 - Math.sqrt(m.shininess / 100)));
    out.name = m?.name || 'Material';
  }
  const ex = out.userData?.glbandme;
  out.userData = { tiling: [1, 1], offset: [0, 0], rotation: 0, pixel: false, maps: {}, ...(ex || {}) };
  if (!ex && out.map) { out.userData.tiling = [out.map.repeat.x, out.map.repeat.y]; out.userData.offset = [out.map.offset.x, out.map.offset.y]; out.userData.rotation = out.map.rotation; out.userData.pixel = out.map.magFilter === THREE.NearestFilter; out.userData.maps = { kind: 'image', name: out.map.name || 'Texture' }; }
  if (fromGltf) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) if (out[k]) out[k] = toCanvasTexture(out[k]);
  if (out.metalnessMap && out.roughnessMap === out.metalnessMap) { /* keep packed */ }
  syncTextures(out);
  return out;
}
const texCache = new WeakMap();
/** glTF textures (flipY=false) → canvas textures in three's UV convention (flipY=true). */
function toCanvasTexture(t) {
  const src = t.source?.data || t.image;
  if (!src || !src.width) return t;
  if (texCache.has(src)) { const c = texCache.get(src); const n = cloneTex(c, t); return n; }
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  const n = new THREE.CanvasTexture(c);
  texCache.set(src, n);
  return cloneTex(n, t);
}
function cloneTex(base, t) {
  const n = base.clone(); n.source = base.source;
  n.flipY = true; n.colorSpace = t.colorSpace; n.wrapS = t.wrapS; n.wrapT = t.wrapT; n.magFilter = t.magFilter; n.minFilter = t.minFilter; n.name = t.name; n.anisotropy = 8; n.channel = 0;
  n.needsUpdate = true;
  return n;
}

/** Converts glTF animation clips into per-object keyframes. Returns the frame count. */
function applyClips(clips, converted, fps, savedFrames) {
  if (!clips?.length) return savedFrames || 90;
  const byName = new Map();
  for (const { obj, node } of converted) { byName.set(node.uuid, obj); if (node.name) byName.set(THREE.PropertyBinding.sanitizeNodeName(node.name), obj); }
  let maxF = 0;
  const clip = clips[0];
  const groups = new Map();
  for (const tr of clip.tracks) {
    const pb = THREE.PropertyBinding.parseTrackName(tr.name);
    const obj = byName.get(pb.nodeName); if (!obj) continue;
    if (!['position', 'quaternion', 'scale'].includes(pb.propertyName)) continue;
    if (!groups.has(obj)) groups.set(obj, {});
    groups.get(obj)[pb.propertyName] = tr;
  }
  for (const [obj, tr] of groups) {
    const times = new Set();
    for (const t of Object.values(tr)) for (const x of t.times) times.add(Math.round(x * fps));
    const frames = [...times].sort((a, b) => a - b).slice(0, 2000);
    const evalTrack = (t, f, size, def) => { if (!t) return def; const i = t.createInterpolant(); return Array.from(i.evaluate(f / fps)).slice(0, size); };
    for (const f of frames) {
      obj.ed.keys.set(f, { p: evalTrack(tr.position, f, 3, obj.position.toArray()), q: evalTrack(tr.quaternion, f, 4, obj.quaternion.toArray()), s: evalTrack(tr.scale, f, 3, obj.scale.toArray()) });
      maxF = Math.max(maxF, f);
    }
  }
  return Math.max(savedFrames || 0, maxF || 90);
}

// =================================================================================== export scene
/**
 * Builds a clean THREE scene for export.
 * opts: project, includeHidden, onlySelected, selected, animations, lights, vertexColors,
 *       scale, origin ('keep'|'center'|'bottom'), upZ, merge, maxTris, textureMax
 */
export function buildScene(doc, opts = {}) {
  const scene = new THREE.Scene();
  let list = doc.objects.filter((o) => opts.includeHidden || opts.project || o.visible);
  if (opts.onlySelected && doc.selected) list = list.filter((o) => o === doc.selected);
  if (opts.lights === false) list = list.filter((o) => !isLight(o));
  // current pose = rest pose saved with keys
  const map = new Map();
  const totalTris = list.filter(isMesh).reduce((a, o) => a + o.geometry.index.count / 3, 0);
  const ratio = opts.maxTris && totalTris > opts.maxTris ? opts.maxTris / totalTris : 1;
  const root = new THREE.Group(); root.name = opts.rootName || 'Root';
  for (const o of list) {
    let n;
    if (isMesh(o)) {
      let g = o.geometry;
      if (!opts.project) {
        g = g.clone();
        if (g.attributes.mask) g.deleteAttribute('mask');
        if (g.attributes.color && (opts.vertexColors === false || !o.material.vertexColors || allWhite(g.attributes.color.array))) g.deleteAttribute('color');
        if (ratio < 1) g = simplifyGeometry(g, ratio);
      }
      const mat = opts.project ? projectMaterial(o.material) : exportMaterial(o.material, !!g.attributes.color);
      if (!opts.project && mat.normalMap && g.attributes.uv && g.attributes.normal && g.index) { if (g === o.geometry) g = g.clone(); try { g.computeTangents(); } catch { /* degenerate uvs */ } }
      n = new THREE.Mesh(g, mat);
      if (opts.project) {
        const ex = { visible: o.visible, name: o.name };
        if (o.ed.locked) ex.locked = true;
        if (o.geometry.userData.flat) ex.flat = true;
        if (o.ed.prim) ex.dprimitive = o.ed.prim;
        if (o.ed.text) { ex.dtext = o.ed.text; }
        n.userData = { glbandme: ex };
      }
    } else {
      const l = o.ed.light; let L;
      if (o.ed.lightType === 'spot') { L = new THREE.SpotLight(l.color, l.intensity, l.distance, l.angle, l.penumbra, 2); }
      else if (o.ed.lightType === 'directional') L = new THREE.DirectionalLight(l.color, l.intensity);
      else L = new THREE.PointLight(l.color, l.intensity, l.distance, 2);
      if (L.target) { L.target.position.set(0, 0, -1); L.add(L.target); }
      n = L;
      if (opts.project) n.userData = { glbandme: { visible: o.visible, name: o.name, ...(o.ed.locked ? { locked: true } : {}) } };
    }
    n.name = o.name;
    n.position.copy(o.position); n.quaternion.copy(o.quaternion); n.scale.copy(o.scale);
    map.set(o, n);
    root.add(n);
  }
  // restore rest pose for animated objects: export first key as node transform
  // export transform (origin / scale / up axis)
  if (!opts.project) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(); for (const n of root.children) if (n.isMesh) box.expandByObject(n);
    if (!box.isEmpty() && opts.origin && opts.origin !== 'keep') {
      const c = box.getCenter(new THREE.Vector3()); if (opts.origin === 'bottom') c.y = box.min.y;
      for (const n of root.children) n.position.sub(c);
    }
    const s = opts.scale ?? 1;
    if (opts.upZ) root.rotation.x = Math.PI / 2;
    root.scale.setScalar(s);
  }
  let clips = [];
  if (opts.animations !== false && doc.hasAnimation()) {
    const tracks = [];
    for (const [o, n] of map) {
      if (!o.ed.keys.size) continue;
      const frames = [...o.ed.keys.keys()].sort((a, b) => a - b);
      const times = frames.map((f) => f / doc.fps);
      const P = [], Q = [], S = [];
      let prev = null;
      for (const f of frames) {
        const k = o.ed.keys.get(f); P.push(...k.p); S.push(...k.s);
        let q = [...k.q]; if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((x) => -x);
        Q.push(...q); prev = q;
      }
      if (frames.length === 1) { times.push(times[0] + 1 / doc.fps); P.push(...P); Q.push(...Q); S.push(...S); }
      tracks.push(new THREE.VectorKeyframeTrack(n.uuid + '.position', times, P), new THREE.QuaternionKeyframeTrack(n.uuid + '.quaternion', times, Q), new THREE.VectorKeyframeTrack(n.uuid + '.scale', times, S));
      const k0 = o.ed.keys.get(frames[0]); n.position.fromArray(k0.p); n.quaternion.fromArray(k0.q); n.scale.fromArray(k0.s);
    }
    if (tracks.length) clips = [new THREE.AnimationClip('Animation', -1, tracks)];
  }
  if (opts.merge && !opts.project) {
    root.updateMatrixWorld(true);
    const geos = [], mats = [];
    for (const n of root.children) if (n.isMesh) {
      const g = n.geometry.clone().applyMatrix4(n.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      geos.push(g); mats.push(n.material);
    }
    if (geos.length) {
      // all geometries need the same attribute set
      const has = (k) => geos.every((g) => g.attributes[k]);
      for (const g of geos) for (const k of ['uv', 'color']) if (!has(k) && g.attributes[k]) g.deleteAttribute(k);
      const merged = mergeGeometries(geos, true);
      const m = new THREE.Mesh(merged, mats.length === 1 ? mats[0] : mats); m.name = opts.rootName || 'Model';
      const lights = root.children.filter((n) => n.isLight);
      root.clear(); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1); root.add(m, ...lights);
      clips = [];
    }
  }
  if (opts.project) { for (const c of root.children.slice()) scene.add(c); } else scene.add(root);
  return { scene, clips, map };
}
function allWhite(c) { for (let i = 0; i < c.length; i++) if (c[i] < 0.995) return false; return true; }
const projMats = new WeakMap();
function projectMaterial(m) {
  const out = m.clone();
  const u = m.userData;
  out.userData = { glbandme: { tiling: u.tiling, offset: u.offset, rotation: u.rotation, pixel: u.pixel, maps: u.maps } };
  return out;
}
function exportMaterial(m, vc) {
  const out = m.clone();
  out.userData = {};
  out.vertexColors = vc;
  out.name = m.name || 'Material';
  return out;
}
function simplifyGeometry(g, ratio) {
  if (!MeshoptSimplifier.supported) return g;
  const idx = g.index.array, target = Math.max(12, Math.floor(idx.length * ratio / 3) * 3);
  if (target >= idx.length) return g;
  const [res] = MeshoptSimplifier.simplify(Uint32Array.from(idx), g.attributes.position.array, 3, target, 0.05, []);
  const out = g.clone(); out.setIndex(new THREE.BufferAttribute(res, 1));
  return removeUnused(out);
}
export const simplifierReady = MeshoptSimplifier.ready;

/** Simplifies one object's geometry in the editor (returns new geometry). */
export function decimate(g, ratio) {
  const out = simplifyGeometry(g, ratio);
  if (out === g) return g;
  out.userData = { ...g.userData, topo: (g.userData.topo || 0) + 1 };
  computeNormals(out);
  return out;
}

// =================================================================================== exporters
export const FORMATS = [
  { id: 'glb', label: 'GLB', ext: 'glb', desc: 'Binary glTF – games, web, AR' },
  { id: 'gltf', label: 'glTF', ext: 'gltf', desc: 'Text glTF with embedded data' },
  { id: 'usdz', label: 'USDZ', ext: 'usdz', desc: 'Apple AR Quick Look' },
  { id: 'obj', label: 'OBJ', ext: 'zip', desc: 'OBJ + MTL + textures (.zip)' },
  { id: 'stl', label: 'STL', ext: 'stl', desc: '3D printing (binary)' },
  { id: 'ply', label: 'PLY', ext: 'ply', desc: 'Points & vertex colours' },
];

export async function exportModel(doc, opts) {
  const f = opts.format;
  const meshOnly = f === 'stl' || f === 'ply' || f === 'obj';
  const units = { m: 1, cm: 100, mm: 1000, in: 39.3701 }[opts.units || 'm'];
  const { scene, clips } = buildScene(doc, {
    ...opts, lights: meshOnly ? false : opts.lights, animations: meshOnly || f === 'usdz' ? false : opts.animations,
    scale: (opts.scale || 1) * (meshOnly ? units : 1), upZ: meshOnly && opts.upZ, merge: opts.merge || f === 'stl',
  });
  const warnings = [];
  let data;
  if (f === 'glb' || f === 'gltf') {
    const r = await new GLTFExporter().parseAsync(scene, { binary: f === 'glb', animations: clips, onlyVisible: false, maxTextureSize: opts.textureMax || Infinity });
    data = f === 'glb' ? r : new TextEncoder().encode(JSON.stringify(r, null, 1)).buffer;
  } else if (f === 'usdz') {
    if (doc.meshes.some((o) => o.material.vertexColors && o.geometry.attributes.color)) warnings.push('USDZ ignores vertex paint – bake colours into a texture for AR.');
    const r = await new USDZExporter().parseAsync(scene, { maxTextureSize: Math.min(opts.textureMax || 2048, 4096), quickLookCompatible: true });
    data = r.buffer.slice(r.byteOffset, r.byteOffset + r.byteLength);
  } else if (f === 'stl') {
    const r = new STLExporter().parse(scene, { binary: true });
    data = r.buffer;
  } else if (f === 'ply') {
    data = await new Promise((res) => new PLYExporter().parse(scene, (r) => res(r), { binary: true, excludeAttributes: [] }));
  } else if (f === 'obj') {
    data = await objBundle(scene, opts.name || 'model', opts.textureMax || 2048);
  }
  return { data, warnings };
}

// ---------------------------------------------------------------------------------- OBJ + MTL zip
async function objBundle(scene, name, texMax) {
  scene.updateMatrixWorld(true);
  let obj = `# GLB&ME export\nmtllib ${name}.mtl\n`, mtl = '# GLB&ME materials\n';
  let vOff = 1, tOff = 1, nOff = 1;
  const files = [], matNames = new Map();
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const mesh of scene.getObjectsByProperty('isMesh', true)) {
    const g = mesh.geometry, p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, c = g.attributes.color;
    nm.getNormalMatrix(mesh.matrixWorld);
    obj += `o ${mesh.name.replace(/\s+/g, '_') || 'mesh'}\n`;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      obj += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}${c ? ` ${c.getX(i).toFixed(4)} ${c.getY(i).toFixed(4)} ${c.getZ(i).toFixed(4)}` : ''}\n`;
    }
    if (uv) for (let i = 0; i < uv.count; i++) obj += `vt ${uv.getX(i).toFixed(6)} ${uv.getY(i).toFixed(6)}\n`;
    if (n) for (let i = 0; i < n.count; i++) { v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); obj += `vn ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}\n`; }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0];
      let mn = matNames.get(m);
      if (!mn) {
        mn = (m.name || 'material').replace(/\s+/g, '_') + '_' + matNames.size; matNames.set(m, mn);
        const col = m.color || new THREE.Color(1, 1, 1);
        mtl += `\nnewmtl ${mn}\nKd ${col.r.toFixed(4)} ${col.g.toFixed(4)} ${col.b.toFixed(4)}\nKs 0.04 0.04 0.04\nNs ${Math.round((1 - (m.roughness ?? 0.5)) * 200)}\nd ${(m.opacity ?? 1).toFixed(3)}\nillum 2\n`;
        if (m.emissive && m.emissive.getHex()) mtl += `Ke ${m.emissive.r.toFixed(4)} ${m.emissive.g.toFixed(4)} ${m.emissive.b.toFixed(4)}\n`;
        if (m.map?.image) {
          const fn = `${mn}_color.png`; files.push([fn, await texPng(m.map, texMax)]); mtl += `map_Kd ${fn}\n`;
        }
        if (m.normalMap?.image) { const fn = `${mn}_normal.png`; files.push([fn, await texPng(m.normalMap, texMax)]); mtl += `norm ${fn}\nmap_Bump ${fn}\n`; }
      }
      obj += `usemtl ${mn}\n`;
      const idx = g.index.array;
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        const f = [0, 1, 2].map((k) => { const a = idx[i + k]; return `${a + vOff}/${uv ? a + tOff : ''}/${n ? a + nOff : ''}`; });
        obj += `f ${f.join(' ')}\n`;
      }
    }
    vOff += p.count; if (uv) tOff += uv.count; if (n) nOff += n.count;
  }
  const enc = new TextEncoder();
  return zip([[`${name}.obj`, enc.encode(obj)], [`${name}.mtl`, enc.encode(mtl)], ...files]);
}
async function texPng(t, max) {
  const img = t.image, s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const ctx = c.getContext('2d');
  if (!t.flipY) { ctx.translate(0, c.height); ctx.scale(1, -1); } // OBJ uses bottom-left UV origin like three
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await b.arrayBuffer());
}

// ---------------------------------------------------------------------------------- zip (store)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zip(entries) {
  const enc = new TextEncoder(), parts = [], central = [];
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  let off = 0;
  for (const [name, data] of entries) {
    const nb = enc.encode(name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nb);
    off += 30 + nb.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out.buffer;
}

export const fromArraysGeo = fromArrays;
