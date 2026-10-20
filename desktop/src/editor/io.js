// Project files (GLB + editor extras, compatible with the Android app), importers and the
// export pipeline (GLB / glTF / glTF+files / USDZ / OBJ+MTL / STL / PLY) with presets, units,
// origin, up axis, simplification, texture limits, named animation clips, custom properties,
// Godot import hints and the object hierarchy.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { PLYExporter } from 'three/examples/jsm/exporters/PLYExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { normalize, computeNormals, removeUnused, fromArrays } from '../core/mesh.js';
import { makeMesh, makeLight, makeCamera, makeGroup, newMaterial, toPhysical, syncTextures, isMesh, isLight, isCamera, isGroup, sampleKeys, TEX_SLOTS } from './model.js';

// =================================================================================== project
/** Serializes the document as a GLB with editor extras (same layout as the Android app). */
export async function saveProject(doc, vp) {
  exportStamp++;
  const { scene, clips } = buildScene(doc, { project: true, includeHidden: true, animations: true });
  scene.userData = {
    glbandme: {
      version: 2, app: 'desktop', fps: doc.fps, frameCount: doc.frameCount, selected: doc.objects.indexOf(doc.selected),
      selection: doc.selection.map((o) => doc.objects.indexOf(o)), clips: doc.clips, units: doc.units, link: doc.link || undefined,
      camera: { yaw: vp.cam.yaw, pitch: vp.cam.pitch, distance: vp.cam.distance, target: vp.cam.target.toArray() },
      render: { ...vp.render },
    },
  };
  const out = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips, onlyVisible: false });
  return out;
}

/** Loads a GLB/GLTF (project or plain model). Returns { objects (all, parents first), roots, extras, fps, frameCount, clips, warnings }. */
export async function parseGltf(data) {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const extras = gltf.scene.userData?.glbandme || gltf.userData?.glbandme || null;
  const fps = extras?.fps || 30;
  const conv = convertScene(gltf.scene, true, true);
  const anim = applyClips(gltf.animations, conv, fps, extras);
  return { objects: conv.map((x) => x.obj), roots: conv.filter((x) => !x.obj.ed.parent).map((x) => x.obj), extras, fps, frameCount: anim.frameCount, clips: anim.clips, warnings: [...conv.warnings] };
}

export async function loadProject(doc, vp, data) {
  const r = await parseGltf(data);
  for (const o of [...doc.objects]) doc.detach(o);
  for (const o of r.objects) doc.attach(o);
  doc.fps = r.fps; doc.frameCount = Math.max(1, r.frameCount || r.extras?.frameCount || 90);
  doc.clips = r.clips || [];
  const ex = r.extras;
  if (ex) {
    doc.units = ex.units || 'm';
    doc.link = ex.link || null;
    const sel = (ex.selection || [ex.selected]).map((i) => doc.objects[i]).filter(Boolean);
    doc.selection = sel;
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
export const IMPORT_EXT = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae', '3mf'];
export async function importModel(name, data) {
  const ext = name.split('.').pop().toLowerCase();
  const base = name.replace(/\.[^.]+$/, '');
  if (ext === 'glb' || ext === 'gltf') {
    const r = await parseGltf(data);
    if (!r.objects.length) throw new Error('No meshes found in this file');
    return { ...r, isProject: !!r.extras };
  }
  let root, container = true, animations = [];
  if (ext === 'obj') root = new OBJLoader().parse(new TextDecoder().decode(data));
  else if (ext === 'fbx') { root = new FBXLoader().parse(data, ''); root.scale.multiplyScalar(0.01); animations = root.animations || []; } // FBX files are usually in centimetres
  else if (ext === 'dae') { const c = new ColladaLoader().parse(new TextDecoder().decode(data), ''); root = c.scene; animations = c.scene.animations || []; }
  else if (ext === '3mf') { root = new ThreeMFLoader().parse(data); root.rotation.x = -Math.PI / 2; root.scale.setScalar(0.001); } // 3MF: Z up, millimetres
  else {
    const geo = ext === 'stl' ? new STLLoader().parse(data) : new PLYLoader().parse(data);
    root = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9d9de, vertexColors: !!geo.attributes.color }));
    root.name = base; container = false;
  }
  root.updateMatrixWorld(true);
  const conv = convertScene(root, false, container);
  const objs = conv.map((x) => x.obj);
  const roots = objs.filter((o) => !o.ed.parent);
  if (roots.length === 1 && (!roots[0].name || /^(mesh|object|group|scene)$/i.test(roots[0].name))) roots[0].name = base;
  if (!objs.some(isMesh)) throw new Error('No meshes found in this file');
  let anim = { frameCount: 90, clips: [] };
  if (animations.length) anim = applyClips(animations, conv, 30, null);
  // auto-fit very large/small imports to a ~1.5 m bounding size, resting on the floor
  fitImported(roots, ext);
  return { objects: objs, roots, extras: null, isProject: false, frameCount: anim.frameCount, clips: anim.clips, warnings: [...conv.warnings] };
}
function fitImported(roots, ext) {
  const box = new THREE.Box3(); for (const o of roots) { o.updateMatrixWorld(true); box.expandByObject(o); }
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3()).length();
  let s = 1;
  if (size > 50 || size < 0.05 || ext === 'stl') s = 1.5 / size;
  if (s === 1) return;
  const c = box.getCenter(new THREE.Vector3());
  for (const o of roots) {
    o.position.sub(c).multiplyScalar(s); o.position.y += (c.y - box.min.y) * s; o.scale.multiplyScalar(s);
    for (const k of o.ed.keys.values()) { k.p = new THREE.Vector3().fromArray(k.p).sub(c).multiplyScalar(s).add(new THREE.Vector3(0, (c.y - box.min.y) * s, 0)).toArray(); k.s = k.s.map((x) => x * s); }
  }
}

/**
 * Converts a loaded THREE hierarchy into editor objects, keeping parents and local transforms.
 * Plain transform nodes become groups (only when they lead to something visible); meshes with
 * several materials become a group with one mesh per material.
 */
function convertScene(root, fromGltf, container) {
  root.updateMatrixWorld(true);
  const out = [], warnings = new Set(), matCache = new Map();
  out.nodeMap = new Map(); out.warnings = warnings;
  const relevant = (n) => { let r = false; n.traverse((x) => { if (x !== n && ((x.isMesh && x.geometry?.attributes?.position) || x.isLight || x.isCamera || x.userData?.glbandme)) r = true; }); return r; };
  const nameOf = (n, ex, def) => ex?.name || n.userData?.name || n.name || def;
  const setTRS = (o, m) => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
    o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s);
    return matricesClose(new THREE.Matrix4().compose(p, q, s), m);
  };
  const common = (o, n, ex) => {
    o.visible = ex?.visible ?? n.visible !== false;
    if (ex) { o.ed.locked = !!ex.locked; if (Array.isArray(ex.props)) o.ed.props = ex.props.map((x) => [String(x[0]), String(x[1])]); o.ed.noExport = !!ex.noExport; o.ed.collision = ex.collision || 'none'; o.ed.collapsed = !!ex.collapsed; if (ex.interp) o.ed.interp = ex.interp; }
    else if (n.userData && !fromGltf) { /* nothing */ }
    else if (n.userData) { const props = Object.entries(n.userData).filter(([k, v]) => k !== 'name' && k !== 'glbandme' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')); if (props.length) o.ed.props = props.map(([k, v]) => [k, String(v)]); }
  };
  const add = (o, n, parent) => { o.ed.parent = parent; if (parent) parent.add(o); out.push({ obj: o, node: n }); if (!out.nodeMap.has(n)) out.nodeMap.set(n, o); return o; };
  const visit = (n, parent, pre) => {
    const ex = n.userData?.glbandme || null;
    n.updateMatrix();
    const local = n.matrix.clone(); if (pre) local.premultiply(pre);
    let o;
    if (n.isLight) {
      const type = n.isSpotLight ? 'spot' : n.isDirectionalLight ? 'directional' : 'point';
      o = makeLight(type, nameOf(n, ex, undefined));
      const l = o.ed.light;
      l.color.copy(n.color); l.intensity = n.intensity; if (n.distance != null) l.distance = n.distance;
      if (n.isSpotLight) { l.angle = n.angle; l.penumbra = n.penumbra; }
      setTRS(o, local); o.scale.set(1, 1, 1);
      common(o, n, ex); add(o, n, parent);
    } else if (n.isCamera) {
      o = makeCamera(nameOf(n, ex, 'Camera'), n.isPerspectiveCamera ? { fov: n.fov, aspect: n.aspect, near: n.near, far: n.far } : {});
      setTRS(o, local); o.scale.set(1, 1, 1);
      common(o, n, ex); add(o, n, parent);
    } else if (n.isMesh && n.geometry?.attributes?.position) {
      if (n.isSkinnedMesh) warnings.add('Rigs (skeletons) aren’t editable in GLB&ME – skinned meshes were imported in their rest pose.');
      if (n.geometry.morphAttributes && Object.keys(n.geometry.morphAttributes).length) warnings.add('Shape keys (morph targets) were removed.');
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      let pieces = [[n.geometry, mats[0]]];
      if (Array.isArray(n.material) && n.geometry.groups.length > 1) pieces = n.geometry.groups.map((gr) => [subGeometry(n.geometry, gr), mats[gr.materialIndex] || mats[0]]);
      const meshFrom = (g0, m0, name) => {
        let g = g0.clone();
        if (g.morphAttributes) g.morphAttributes = {};
        if (g.attributes._mask) { g.setAttribute('mask', g.attributes._mask); g.deleteAttribute('_mask'); }
        for (const k of Object.keys(g.attributes)) if (/^(uv1|uv2|uv3|tangent|skinIndex|skinWeight)$/.test(k)) g.deleteAttribute(k);
        normalize(g);
        if (fromGltf && g.attributes.uv) { const uv = g.attributes.uv.array; for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i]; }
        g.userData.flat = !!ex?.flat;
        const m = makeMesh(g, name, convertMaterial(m0, fromGltf, matCache));
        m.material.vertexColors = !!g.attributes.color && (m0?.vertexColors !== false || !fromGltf);
        if (ex?.dprimitive) m.ed.prim = ex.dprimitive;
        if (ex?.dtext || ex?.text) m.ed.text = { ...(ex.dtext || ex.text) };
        return m;
      };
      const name = nameOf(n, ex, 'Mesh');
      if (pieces.length === 1) {
        o = meshFrom(pieces[0][0], pieces[0][1], name);
        if (!setTRS(o, local) && !n.children.length) { // shear: bake into the vertices
          const g = o.geometry; g.applyMatrix4(local); if (local.determinant() < 0) flipIdx(g); computeNormals(g);
          o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
          g.disposeBoundsTree?.(); g.computeBoundingBox(); g.computeBoundingSphere(); g.computeBoundsTree();
        }
        common(o, n, ex); add(o, n, parent);
      } else {
        o = makeGroup(name); setTRS(o, local); common(o, n, ex); add(o, n, parent);
        pieces.forEach(([g, m], i) => { const piece = meshFrom(g, m, `${name} ${i + 1}`); add(piece, n, o); });
      }
    } else {
      if (!ex && !relevant(n)) return; // bones, light targets, empty helpers
      o = makeGroup(nameOf(n, ex, 'Group'));
      setTRS(o, local);
      common(o, n, ex); add(o, n, parent);
    }
    for (const c of n.children) visit(c, o, null);
  };
  if (container) {
    root.updateMatrix();
    const pre = matricesClose(root.matrix, new THREE.Matrix4()) ? null : root.matrix.clone();
    for (const c of root.children) visit(c, null, pre);
  } else visit(root, null, null);
  return out;
}
function matricesClose(a, b) { for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-4) return false; return true; }
function flipIdx(g) { const i = g.index.array; for (let t = 0; t < i.length; t += 3) { const x = i[t + 1]; i[t + 1] = i[t + 2]; i[t + 2] = x; } g.index.needsUpdate = true; }
function subGeometry(g, group) {
  const idx = g.index ? g.index.array.slice(group.start, group.start + group.count) : Uint32Array.from({ length: group.count }, (_, i) => group.start + i);
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  out.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  normalize(out);
  return removeUnused(out);
}
function convertMaterial(m, fromGltf, cache) {
  if (m && cache?.has(m)) return cache.get(m);
  let out;
  if (m && m.isMeshStandardMaterial) { out = toPhysical(m); }
  else {
    out = newMaterial();
    if (m?.color) out.color.copy(m.color);
    if (m?.map) out.map = m.map;
    if (m?.normalMap) out.normalMap = m.normalMap;
    if (m?.emissive) out.emissive.copy(m.emissive);
    if (m?.opacity != null && m.opacity < 1) { out.opacity = m.opacity; out.transparent = true; }
    if (m?.shininess != null) out.roughness = Math.max(0.05, Math.min(1, 1 - Math.sqrt(m.shininess / 100)));
    if (m?.side != null) out.side = m.side;
    out.name = m?.name || 'Material';
  }
  const ex = out.userData?.glbandme;
  out.userData = { tiling: [1, 1], offset: [0, 0], rotation: 0, pixel: false, maps: {}, ...(ex || {}) };
  if (!ex && out.map) { out.userData.tiling = [out.map.repeat.x, out.map.repeat.y]; out.userData.offset = [out.map.offset.x, out.map.offset.y]; out.userData.rotation = out.map.rotation; out.userData.pixel = out.map.magFilter === THREE.NearestFilter; out.userData.maps = { kind: 'image', name: out.map.name || 'Texture' }; }
  if (ex?.decal || out.userData.maps?.kind === 'sticker') { out.polygonOffset = true; out.polygonOffsetFactor = -4; out.polygonOffsetUnits = -4; out.depthWrite = false; out.transparent = true; }
  if (fromGltf) for (const k of TEX_SLOTS) if (out[k]) out[k] = toCanvasTexture(out[k]);
  syncTextures(out);
  if (m) cache?.set(m, out);
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

/**
 * Converts animation clips into per-object keyframes on one timeline. GLB&ME projects keep their
 * single timeline (+ clip ranges in extras); other files get their clips laid out one after another.
 */
function applyClips(clips, converted, fps, extras) {
  const result = { frameCount: extras?.frameCount || 90, clips: Array.isArray(extras?.clips) ? extras.clips.map((c) => ({ ...c })) : [] };
  // per-key easing saved in project extras
  for (const { obj } of converted) if (obj.ed.interp) { obj.ed.pendingInterp = obj.ed.interp; delete obj.ed.interp; }
  if (!clips?.length) return result;
  const byName = new Map();
  for (const { obj, node } of converted) { if (obj.ed.parent && converted.nodeMap.get(node) !== obj) continue; byName.set(node.uuid, obj); if (node.name) byName.set(THREE.PropertyBinding.sanitizeNodeName(node.name), obj); if (node.name) byName.set(node.name, obj); }
  const list = extras ? clips.slice(0, 1) : clips;
  let offset = 0, maxF = 0;
  for (const clip of list) {
    const groups = new Map();
    for (const tr of clip.tracks) {
      const pb = THREE.PropertyBinding.parseTrackName(tr.name);
      const obj = byName.get(pb.nodeName); if (!obj) continue;
      if (!['position', 'quaternion', 'scale'].includes(pb.propertyName)) continue;
      if (!groups.has(obj)) groups.set(obj, {});
      groups.get(obj)[pb.propertyName] = tr;
    }
    let clipEnd = offset;
    for (const [obj, tr] of groups) {
      const times = new Set();
      for (const t of Object.values(tr)) for (const x of t.times) times.add(Math.round(x * fps));
      const frames = [...times].sort((a, b) => a - b).slice(0, 2000);
      const evalTrack = (t, f, size, def) => { if (!t) return def; const i = t.createInterpolant(); return Array.from(i.evaluate(f / fps)).slice(0, size); };
      for (const f of frames) {
        const key = { p: evalTrack(tr.position, f, 3, obj.position.toArray()), q: evalTrack(tr.quaternion, f, 4, obj.quaternion.toArray()), s: evalTrack(tr.scale, f, 3, obj.scale.toArray()) };
        const mode = obj.ed.pendingInterp?.[f]; if (mode && mode !== 'linear') key.i = mode;
        obj.ed.keys.set(f + offset, key);
        clipEnd = Math.max(clipEnd, f + offset);
      }
    }
    if (!extras && list.length > 1) result.clips.push({ name: clip.name || 'Clip ' + (result.clips.length + 1), start: offset, end: Math.max(offset + 1, clipEnd), loop: true });
    maxF = Math.max(maxF, clipEnd);
    offset = clipEnd + 1;
  }
  for (const { obj } of converted) delete obj.ed.pendingInterp;
  result.frameCount = Math.max(extras?.frameCount || 0, maxF || 90);
  return result;
}

// =================================================================================== export scene
const GODOT_SUFFIX = { col: '-col', convcol: '-convcol', colonly: '-colonly', convcolonly: '-convcolonly', rigid: '-rigid', navmesh: '-navmesh', occ: '-occ', noimp: '-noimp' };
export const COLLISION_TYPES = [['none', 'None', 'No collision'], ['col', 'Static (exact)', 'StaticBody with a trimesh shape – floors, walls, terrain'], ['convcol', 'Static (convex)', 'StaticBody with a convex shape – faster, for simple props'], ['colonly', 'Collision only', 'Invisible trimesh collider (the mesh itself is removed)'], ['convcolonly', 'Convex collision only', 'Invisible convex collider'], ['rigid', 'Rigid body', 'Physics object that falls and collides'], ['navmesh', 'Navigation mesh', 'Walkable area for AI pathfinding'], ['occ', 'Occluder', 'Hides objects behind it (occlusion culling)']];
const propValue = (v) => { const s = String(v).trim(); if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) return Number(s); if (s === 'true' || s === 'false') return s === 'true'; return String(v); };

/**
 * Builds a clean THREE scene for export.
 * opts: project, includeHidden, onlySelected, animations, lights, cameras, vertexColors, scale,
 *       origin ('keep'|'center'|'bottom'), upZ, merge, maxTris, godot, applyScale, props
 */
export function buildScene(doc, opts = {}) {
  const scene = new THREE.Scene();
  const project = !!opts.project;
  const included = (o) => {
    if (project) return true;
    for (let x = o; x; x = doc.parentOf(x)) { if (x.ed.noExport) return false; if (!opts.includeHidden && !x.visible) return false; }
    return true;
  };
  let list = doc.objects.filter(included);
  if (opts.onlySelected && doc.selection.length) { const tops = doc.topSelected(); list = list.filter((o) => tops.some((t) => t === o || doc.isAncestor(t, o))); }
  if (opts.lights === false) list = list.filter((o) => !isLight(o));
  if (opts.cameras === false) list = list.filter((o) => !isCamera(o));
  const map = new Map();
  const totalTris = list.filter(isMesh).reduce((a, o) => a + o.geometry.index.count / 3, 0);
  const ratio = opts.maxTris && totalTris > opts.maxTris ? opts.maxTris / totalTris : 1;
  const root = new THREE.Group(); root.name = opts.rootName || 'Root';
  for (const o of list) {
    let n;
    if (isMesh(o)) {
      let g = o.geometry;
      if (!project) {
        g = g.clone();
        if (g.attributes.mask) g.deleteAttribute('mask');
        if (g.attributes.color && (opts.vertexColors === false || !o.material.vertexColors || allWhite(g.attributes.color.array))) g.deleteAttribute('color');
        if (ratio < 1) g = simplifyGeometry(g, ratio);
      }
      const mat = project ? projectMaterial(o.material) : exportMaterial(o.material, !!g.attributes.color);
      if (!project && mat.normalMap && g.attributes.uv && g.attributes.normal && g.index) { if (g === o.geometry) g = g.clone(); try { g.computeTangents(); } catch { /* degenerate uvs */ } }
      n = new THREE.Mesh(g, mat);
    } else if (isLight(o)) {
      const l = o.ed.light; let L;
      if (o.ed.lightType === 'spot') { L = new THREE.SpotLight(l.color, l.intensity, l.distance, l.angle, l.penumbra, 2); }
      else if (o.ed.lightType === 'directional') L = new THREE.DirectionalLight(l.color, l.intensity);
      else L = new THREE.PointLight(l.color, l.intensity, l.distance, 2);
      // glTF lights shine down their node's -Z axis, which is how GLB&ME orients them; the THREE
      // target isn't added as a child so it doesn't turn into a stray empty node in Godot/Blender.
      n = L;
    } else if (isCamera(o)) {
      const c = o.ed.camera; n = new THREE.PerspectiveCamera(c.fov, c.aspect, c.near, c.far);
    } else n = new THREE.Group();
    n.name = o.name;
    if (project) {
      const ex = { kind: o.ed.kind, visible: o.visible, name: o.name };
      if (o.ed.locked) ex.locked = true;
      if (isMesh(o) && o.geometry.userData.flat) ex.flat = true;
      if (o.ed.prim) ex.dprimitive = o.ed.prim;
      if (o.ed.text) ex.dtext = o.ed.text;
      if (o.ed.props.length) ex.props = o.ed.props;
      if (o.ed.noExport) ex.noExport = true;
      if (o.ed.collision && o.ed.collision !== 'none') ex.collision = o.ed.collision;
      if (o.ed.collapsed) ex.collapsed = true;
      const interp = {}; for (const [f, k] of o.ed.keys) if (k.i && k.i !== 'linear') interp[f] = k.i;
      if (Object.keys(interp).length) ex.interp = interp;
      n.userData = { glbandme: ex };
    } else {
      if (opts.props !== false && o.ed.props.length) n.userData = Object.fromEntries(o.ed.props.filter(([k]) => k).map(([k, v]) => [k, propValue(v)]));
      if (opts.godot && isMesh(o) && GODOT_SUFFIX[o.ed.collision]) n.name = o.name + GODOT_SUFFIX[o.ed.collision];
    }
    n.position.copy(o.position); n.quaternion.copy(o.quaternion); n.scale.copy(o.scale);
    map.set(o, n);
  }
  // hierarchy (objects whose parent isn't exported keep their world placement)
  for (const o of list) {
    const n = map.get(o), p = doc.parentOf(o);
    if (p && map.has(p)) map.get(p).add(n);
    else { root.add(n); if (p) { o.updateWorldMatrix(true, false); o.matrixWorld.decompose(n.position, n.quaternion, n.scale); } }
  }
  // animation: one clip for the whole timeline, or one per named clip
  let clips = [];
  const animated = [...map.keys()].filter((o) => o.ed.keys.size);
  if (opts.animations !== false && animated.length) {
    const fps = doc.fps;
    const ranges = project || !doc.clips.length ? [{ name: opts.animName || 'Animation', start: null, end: null, loop: true }] : doc.clips.filter((c) => c.end > c.start);
    for (const r of ranges) {
      const tracks = [];
      for (const o of animated) {
        const n = map.get(o), keys = o.ed.keys, frames = [...keys.keys()].sort((a, b) => a - b);
        const eased = [...keys.values()].some((k) => k.i && k.i !== 'linear');
        let sample;
        if (project) sample = frames;
        else {
          const s = r.start ?? frames[0], e = r.end ?? frames[frames.length - 1];
          if (eased) { sample = []; for (let f = s; f <= e; f++) sample.push(f); }
          else sample = [...new Set([s, ...frames.filter((f) => f > s && f < e), e])].sort((a, b) => a - b);
          if (r.start == null) sample = sample.filter((f) => f >= frames[0]);
        }
        if (!sample.length) continue;
        const t0 = r.start ?? 0;
        const times = sample.map((f) => (f - t0) / fps);
        const P = [], Q = [], S = [];
        let prev = null;
        for (const f of sample) {
          const k = project ? keys.get(f) : sampleKeys(keys, f);
          P.push(...k.p); S.push(...k.s);
          let q = [...k.q]; if (prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0) q = q.map((x) => -x);
          Q.push(...q); prev = q;
        }
        tracks.push(new THREE.VectorKeyframeTrack(n.uuid + '.position', times, P), new THREE.QuaternionKeyframeTrack(n.uuid + '.quaternion', times, Q), new THREE.VectorKeyframeTrack(n.uuid + '.scale', times, S));
      }
      if (tracks.length) clips.push(new THREE.AnimationClip(r.name + (opts.godot && r.loop && !project ? '-loop' : ''), -1, tracks));
    }
    // rest pose = the start of the first clip (or the first key)
    const restFrame = !project && doc.clips.length ? doc.clips[0].start : null;
    for (const o of animated) {
      const n = map.get(o), keys = o.ed.keys, first = Math.min(...keys.keys());
      const k = restFrame != null ? sampleKeys(keys, restFrame) : keys.get(first);
      n.position.fromArray(k.p); n.quaternion.fromArray(k.q); n.scale.fromArray(k.s);
    }
  }
  // bake scale into static meshes (physics engines prefer unit scale)
  if (!project && opts.applyScale) {
    for (const [o, n] of map) {
      if (!n.isMesh || o.ed.keys.size || n.children.length) continue;
      const s = n.scale; if (Math.abs(s.x - 1) < 1e-6 && Math.abs(s.y - 1) < 1e-6 && Math.abs(s.z - 1) < 1e-6) continue;
      const g = n.geometry === o.geometry ? n.geometry.clone() : n.geometry;
      g.applyMatrix4(new THREE.Matrix4().makeScale(s.x, s.y, s.z));
      if (s.x * s.y * s.z < 0) flipIndex(g);
      if (g.attributes.tangent) { try { g.computeTangents(); } catch { /* ignore */ } }
      n.geometry = g; n.scale.set(1, 1, 1);
    }
  }
  // export transform (origin / scale / up axis) lives on wrapper groups so animation tracks stay valid
  if (!project) {
    const inner = new THREE.Group(); inner.name = 'Model';
    for (const n of root.children.slice()) inner.add(n);
    root.add(inner);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(); inner.traverse((n) => { if (n.isMesh) box.expandByObject(n, false); });
    if (!box.isEmpty() && opts.origin && opts.origin !== 'keep') {
      const c = box.getCenter(new THREE.Vector3()); if (opts.origin === 'bottom') c.y = box.min.y;
      inner.position.copy(c).negate();
    }
    if (opts.upZ) root.rotation.x = Math.PI / 2;
    root.scale.setScalar(opts.scale ?? 1);
    root.updateMatrixWorld(true);
    if (opts.merge) {
      const geos = [], mats = [];
      inner.traverse((n) => {
        if (!n.isMesh) return;
        const g = n.geometry.clone().applyMatrix4(n.matrixWorld);
        if (n.matrixWorld.determinant() < 0) flipIndex(g);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
        geos.push(g); mats.push(n.material);
      });
      if (geos.length) {
        const has = (k) => geos.every((g) => g.attributes[k]);
        for (const g of geos) for (const k of ['uv', 'color']) if (!has(k) && g.attributes[k]) g.deleteAttribute(k);
        const merged = mergeGeometries(geos, true);
        const m = new THREE.Mesh(merged, mats.length === 1 ? mats[0] : mats); m.name = opts.rootName || 'Model';
        const lights = [];
        inner.traverse((n) => { if (n.isLight) { n.matrixWorld.decompose(n.position, n.quaternion, n.scale); lights.push(n); } });
        root.clear(); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1); root.add(m, ...lights);
        clips = [];
      }
    } else {
      // drop wrapper groups that do nothing, so engines get a clean node tree
      if (inner.position.lengthSq() === 0) { for (const c of inner.children.slice()) root.add(c); root.remove(inner); }
    }
    root.updateMatrixWorld(true);
  }
  // no needless "Root" node when the export transform is identity: engines get the objects as top-level nodes
  const identity = root.position.lengthSq() === 0 && root.quaternion.equals(new THREE.Quaternion()) && root.scale.equals(new THREE.Vector3(1, 1, 1));
  if (project || (identity && !opts.keepRoot)) { for (const c of root.children.slice()) scene.add(c); } else scene.add(root);
  scene.updateMatrixWorld(true);
  return { scene, clips, map };
}
function flipIndex(g) { const i = g.index.array; for (let t = 0; t < i.length; t += 3) { const x = i[t + 1]; i[t + 1] = i[t + 2]; i[t + 2] = x; } }
function allWhite(c) { for (let i = 0; i < c.length; i++) if (c[i] < 0.995) return false; return true; }
const projMats = new WeakMap();
function projectMaterial(m) {
  const c = projMats.get(m); if (c && c.stamp === exportStamp) return c.mat; // shared materials stay one glTF material
  const out = m.clone();
  projMats.set(m, { stamp: exportStamp, mat: out });
  const u = m.userData;
  out.userData = { glbandme: { tiling: u.tiling, offset: u.offset, rotation: u.rotation, pixel: u.pixel, maps: u.maps, ...(m.polygonOffset ? { decal: true } : {}) } };
  return out;
}
/** Shares one exported material per editor material (keeps "linked" materials as one glTF material). */
const exportMats = new WeakMap();
function exportMaterial(m, vc) {
  const key = vc ? 'vc' : 'novc';
  let byKey = exportMats.get(m);
  if (byKey?.version === m.version && byKey[key] && byKey.stamp === exportStamp) return byKey[key];
  if (!byKey || byKey.stamp !== exportStamp) { byKey = { stamp: exportStamp, version: m.version }; exportMats.set(m, byKey); }
  const out = m.clone();
  out.userData = {};
  out.vertexColors = vc;
  out.name = m.name || 'Material';
  byKey[key] = out;
  return out;
}
let exportStamp = 0;
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
  { id: 'glb', label: 'GLB', ext: 'glb', desc: 'Binary glTF – Godot, Blender, Unity, Unreal, web, AR' },
  { id: 'gltf', label: 'glTF', ext: 'gltf', desc: 'Text glTF with everything embedded' },
  { id: 'gltfsep', label: 'glTF + files', ext: 'gltf', desc: '.gltf + .bin + PNG textures – great for version control' },
  { id: 'usdz', label: 'USDZ', ext: 'usdz', desc: 'Apple AR Quick Look' },
  { id: 'obj', label: 'OBJ', ext: 'zip', desc: 'OBJ + MTL + textures (.zip)' },
  { id: 'stl', label: 'STL', ext: 'stl', desc: '3D printing (binary)' },
  { id: 'ply', label: 'PLY', ext: 'ply', desc: 'Points & vertex colours' },
  { id: 'png', label: 'Image', ext: 'png', desc: 'PNG render of the current view' },
];

/** Returns { data, files?, warnings }. `files` (name → bytes) is set for multi-file formats. */
export async function exportModel(doc, opts) {
  exportStamp++;
  const f = opts.format;
  const meshOnly = f === 'stl' || f === 'ply' || f === 'obj';
  const units = { m: 1, cm: 100, mm: 1000, in: 39.3701, ft: 3.28084 }[opts.units || 'm'];
  const { scene, clips } = buildScene(doc, {
    ...opts, lights: meshOnly ? false : opts.lights, cameras: meshOnly || f === 'usdz' ? false : opts.cameras, animations: meshOnly || f === 'usdz' ? false : opts.animations,
    scale: (opts.scale || 1) * (meshOnly ? units : 1), upZ: meshOnly && opts.upZ, merge: opts.merge || f === 'stl',
  });
  const warnings = [];
  let data, files = null;
  if (f === 'glb' || f === 'gltf' || f === 'gltfsep') {
    const r = await new GLTFExporter().parseAsync(scene, { binary: f === 'glb', animations: clips, onlyVisible: false, maxTextureSize: opts.textureMax || Infinity });
    if (f === 'glb') data = r;
    else if (f === 'gltf') data = new TextEncoder().encode(JSON.stringify(r, null, 1)).buffer;
    else { files = splitGltf(r, opts.name || 'model'); data = files[0][1].buffer; }
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
  return { data, files, warnings };
}

/** glTF JSON with data: URIs → [name, bytes] files: .gltf, .bin and one image file per texture. */
function splitGltf(json, name) {
  const files = [], used = new Set();
  const unique = (n) => { let x = n, i = 2; while (used.has(x.toLowerCase())) { const dot = n.lastIndexOf('.'); x = `${n.slice(0, dot)}_${i++}${n.slice(dot)}`; } used.add(x.toLowerCase()); return x; };
  const decode = (uri) => { const b64 = uri.slice(uri.indexOf(',') + 1), bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  used.add((name + '.gltf').toLowerCase());
  (json.buffers || []).forEach((b, i) => { if (b.uri?.startsWith('data:')) { const fn = unique(`${name}${i ? '_' + i : ''}.bin`); files.push([fn, decode(b.uri)]); b.uri = fn; } });
  (json.images || []).forEach((im, i) => {
    if (!im.uri?.startsWith('data:')) return;
    const mime = im.mimeType || im.uri.slice(5, im.uri.indexOf(';'));
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    const base = (im.name || `texture_${i}`).replace(/[^\w.-]+/g, '_').replace(/\.(png|jpe?g|webp)$/i, '') || `texture_${i}`;
    const fn = unique(`${name}_${base}.${ext}`);
    files.push([fn, decode(im.uri)]); im.uri = fn;
  });
  files.unshift([name + '.gltf', new TextEncoder().encode(JSON.stringify(json, null, 1))]);
  return files;
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
    const flip = mesh.matrixWorld.determinant() < 0;
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0];
      let mn = matNames.get(m);
      if (!mn) {
        mn = (m.name || 'material').replace(/\s+/g, '_') + '_' + matNames.size; matNames.set(m, mn);
        const col = m.color || new THREE.Color(1, 1, 1);
        mtl += `\nnewmtl ${mn}\nKd ${col.r.toFixed(4)} ${col.g.toFixed(4)} ${col.b.toFixed(4)}\nKs 0.04 0.04 0.04\nNs ${Math.round((1 - (m.roughness ?? 0.5)) * 200)}\nd ${(m.opacity ?? 1).toFixed(3)}\nillum 2\n`;
        mtl += `Pr ${(m.roughness ?? 0.5).toFixed(3)}\nPm ${(m.metalness ?? 0).toFixed(3)}\n`;
        if (m.emissive && m.emissive.getHex()) mtl += `Ke ${(m.emissive.r * (m.emissiveIntensity ?? 1)).toFixed(4)} ${(m.emissive.g * (m.emissiveIntensity ?? 1)).toFixed(4)} ${(m.emissive.b * (m.emissiveIntensity ?? 1)).toFixed(4)}\n`;
        if (m.map?.image) { const fn = `${mn}_color.png`; files.push([fn, await texPng(m.map, texMax)]); mtl += `map_Kd ${fn}\n`; }
        if (m.normalMap?.image) { const fn = `${mn}_normal.png`; files.push([fn, await texPng(m.normalMap, texMax)]); mtl += `norm ${fn}\nmap_Bump ${fn}\n`; }
        if (m.roughnessMap?.image) { const fn = `${mn}_roughness.png`; files.push([fn, await texPng(m.roughnessMap, texMax)]); mtl += `map_Pr ${fn}\n`; }
        if (m.metalnessMap?.image && m.metalnessMap !== m.roughnessMap) { const fn = `${mn}_metallic.png`; files.push([fn, await texPng(m.metalnessMap, texMax)]); mtl += `map_Pm ${fn}\n`; }
        if (m.emissiveMap?.image) { const fn = `${mn}_emission.png`; files.push([fn, await texPng(m.emissiveMap, texMax)]); mtl += `map_Ke ${fn}\n`; }
      }
      obj += `usemtl ${mn}\n`;
      const idx = g.index.array;
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        const order = flip ? [0, 2, 1] : [0, 1, 2];
        const f = order.map((k) => { const a = idx[i + k]; return `${a + vOff}/${uv ? a + tOff : ''}/${n ? a + nOff : ''}`; });
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
export { isGroup };
