// Side panels: layers list, inspector tabs (Tool / Object / Material / Mesh / Scene) and the
// floating tool strip.
import * as THREE from 'three';
import { h, icon, ibtn, btn, tool, mount, menu, slider, toggle, seg, colorSwatch, vec3Field, section, select, promptDialog, fmt } from '../ui/dom.js';
import { isMesh, isLight, syncTextures, ANIM_PRESETS, applyPreset } from './model.js';
import { SHAPES } from '../core/shapes.js';
import { BRUSHES, FALLOFFS, MaskOps } from '../core/sculpt.js';
import { UV_MODES } from '../core/mesh.js';
import { ENVS, SHADING, BACKGROUNDS } from './viewport.js';
import { MATCAPS, matcapTexture, previewCanvas, clearMaps, bumpFromColor, applyPattern } from './textures.js';
import { PALETTE } from './actions.js';
import * as S from './studios.js';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const D = THREE.MathUtils;

/** Slider binding that records one undo step per drag. */
function live(ed, label, objs, apply) {
  let tok = null;
  return {
    onInput: (v) => { if (!tok) tok = ed.doc.begin(label, objs); apply(v); ed.doc.touch(); },
    onCommit: (v) => { if (!tok) tok = ed.doc.begin(label, objs); apply(v); ed.doc.commit(tok); tok = null; },
  };
}

// =============================================================================== layers
export function renderLayers(ed) {
  const d = ed.doc, list = [];
  if (!d.objects.length) {
    mount(ed.layersEl, h('div', { class: 'muted', style: { padding: '18px 4px', textAlign: 'center' } }, icon('box', 'lg'), h('p', null, 'Nothing here yet.'), btn('Add a shape', () => S.addMenu(ed), 'tinted', 'plus')));
    return;
  }
  d.objects.forEach((o, i) => {
    const sel = o === d.selected;
    const color = isLight(o) ? '#' + o.ed.light.color.getHexString() : '#' + o.material.color.getHexString();
    const kindIcon = isLight(o) ? (o.ed.lightType === 'spot' ? 'flashlight' : o.ed.lightType === 'directional' ? 'sun' : 'lightbulb') : o.ed.text ? 'type' : o.ed.prim ? (SHAPES[o.ed.prim.type]?.icon || 'box') : o.material.userData?.maps?.kind === 'sticker' ? 'sticker' : 'shapes';
    const row = h('div', {
      class: 'layer' + (sel ? ' sel' : '') + (o.visible ? '' : ' hiddenobj'), role: 'treeitem', 'aria-selected': String(sel), tabindex: sel ? '0' : '-1', draggable: 'true',
      onclick: () => d.select(o),
      ondblclick: async () => { const n = await promptDialog('Rename', o.name); if (n) ed.actions.rename(o, n); },
      oncontextmenu: (e) => { e.preventDefault(); d.select(o); objectMenu(ed, o, e.clientX, e.clientY); },
      onkeydown: (e) => { if (e.key === 'F2') { e.preventDefault(); promptDialog('Rename', o.name).then((n) => n && ed.actions.rename(o, n)); } },
      ondragstart: (e) => { e.dataTransfer.setData('text/x-layer', String(i)); },
      ondragover: (e) => { if (e.dataTransfer.types.includes('text/x-layer')) e.preventDefault(); },
      ondrop: (e) => { const from = +e.dataTransfer.getData('text/x-layer'); if (Number.isFinite(from)) { e.preventDefault(); ed.actions.reorder(d.objects[from], i); } },
    },
    h('span', { class: 'dot', style: { background: color } }),
    icon(kindIcon),
    h('span', { class: 'nm', title: o.name }, o.name),
    o.ed.keys.size ? h('span', { class: 'icon', tip: 'Animated', style: { width: '14px', color: 'var(--warning)' } }, icon('diamond')) : null,
    h('button', { class: 'ibtn' + (o.ed.locked ? ' on' : ''), tip: o.ed.locked ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); ed.actions.setLocked(o, !o.ed.locked); } }, icon(o.ed.locked ? 'lock' : 'lock-open')),
    h('button', { class: 'ibtn' + (o.visible ? '' : ' on'), tip: [o.visible ? 'Hide' : 'Show', 'H'], onclick: (e) => { e.stopPropagation(); ed.actions.setVisible(o, !o.visible); } }, icon(o.visible ? 'eye' : 'eye-off')),
    );
    list.push(row);
  });
  mount(ed.layersEl, list);
  ed.layersEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

export function objectMenu(ed, o, x, y) {
  const a = ed.actions;
  menu([
    { label: 'Rename…', icon: 'pencil', key: 'F2', onClick: async () => { const n = await promptDialog('Rename', o.name); if (n) a.rename(o, n); } },
    { label: 'Duplicate', icon: 'copy', key: 'Ctrl+D', onClick: () => a.duplicate(o) },
    { label: 'Frame', icon: 'scan-search', key: 'F', onClick: () => ed.vp.frame([o]) },
    { label: o.visible ? 'Hide' : 'Show', icon: o.visible ? 'eye-off' : 'eye', key: 'H', onClick: () => a.setVisible(o, !o.visible) },
    { label: o.ed.locked ? 'Unlock' : 'Lock', icon: 'lock', onClick: () => a.setLocked(o, !o.ed.locked) },
    'sep',
    isMesh(o) && { label: 'Drop to floor', icon: 'arrow-down-to-line', onClick: () => a.dropToFloor(o) },
    isMesh(o) && { label: 'Apply transform', icon: 'stamp', onClick: () => a.applyTransform(o) },
    isMesh(o) && { label: 'Join visible into this', icon: 'combine', onClick: () => a.joinAll(o) },
    isMesh(o) && (o.ed.prim || o.ed.text) && { label: 'Make editable mesh', icon: 'pen-line', onClick: () => a.makeEditable(o) },
    isMesh(o) && { label: 'Export just this…', icon: 'share', onClick: () => { ed.doc.select(o); S.exportDialog(ed, { onlySelected: true }); } },
    'sep',
    { label: 'Move up', icon: 'arrow-up', onClick: () => a.move(o, -1) },
    { label: 'Move down', icon: 'arrow-down', onClick: () => a.move(o, 1) },
    'sep',
    { label: 'Delete', icon: 'trash-2', key: 'Del', danger: true, onClick: () => a.remove(o) },
  ], x, y);
}

// =============================================================================== inspector
const TABS = [['tool', 'Tool', 'wrench'], ['object', 'Object', 'move-3d'], ['material', 'Material', 'palette'], ['mesh', 'Mesh', 'triangle'], ['scene', 'Scene', 'sun']];
export function renderInspector(ed) {
  if (ed.sheet) return;
  const m = ed.mode, o = ed.doc.selected;
  let tabs = TABS.filter(([id]) => id !== 'tool' || m !== 'object');
  if (isLight(o)) tabs = tabs.filter(([id]) => id !== 'material' && id !== 'mesh');
  if (!o) tabs = tabs.filter(([id]) => id === 'scene' || id === 'tool');
  if (!tabs.find(([id]) => id === ed.inspectorTab)) ed.inspectorTab = tabs[0][0];
  ed.rightTitle.textContent = o ? o.name : 'Scene';
  mount(ed.rightTools, o ? ibtn('ellipsis', 'Object actions', (e) => { const r = e.currentTarget.getBoundingClientRect(); objectMenu(ed, o, r.left - 160, r.bottom + 4); }) : null);
  mount(ed.tabsEl, seg(tabs.map(([id, label, ic]) => [id, label, null, label]), ed.inspectorTab, (v) => { ed.inspectorTab = v; renderInspector(ed); }, '', 'Inspector'));
  ed.refreshTransformFields = null;
  const t = ed.inspectorTab;
  const body = t === 'tool' ? toolPanel(ed) : t === 'object' ? objectPanel(ed, o) : t === 'material' ? materialPanel(ed, o) : t === 'mesh' ? meshPanel(ed, o) : scenePanel(ed);
  const scroll = ed.rightBody.scrollTop;
  mount(ed.rightBody, body);
  ed.rightBody.scrollTop = scroll;
}

// ------------------------------------------------------------------------------- object
function objectPanel(ed, o) {
  if (!o) return h('p', { class: 'muted' }, 'Select an object.');
  const d = ed.doc, a = ed.actions;
  const out = [];
  const pos = vec3Field(o.position.toArray(), (v) => { o.position.fromArray(v); d.touch(); }, null, 0.01);
  const rot = vec3Field([o.rotation.x, o.rotation.y, o.rotation.z].map((r) => D.radToDeg(r)), (v) => { o.rotation.set(...v.map(D.degToRad)); d.touch(); }, null, 1);
  const scl = vec3Field(o.scale.toArray(), (v) => { if (ed.uniformScale) { const k = v.find((x, i) => Math.abs(x - o.scale.getComponent(i)) > 1e-9); if (k != null) { const i = v.indexOf(k), r = k / (o.scale.getComponent(i) || 1); o.scale.multiplyScalar(r); scl.set(o.scale.toArray()); d.touch(); return; } } o.scale.fromArray(v); d.touch(); }, null, 0.01);
  // one undo step per field edit: snapshot on focus, commit on blur/drag end
  for (const f of [pos, rot, scl]) {
    let tok = null;
    f.addEventListener('focusin', () => { tok = tok || d.begin('Transform', [o]); });
    f.addEventListener('pointerdown', () => { tok = tok || d.begin('Transform', [o]); });
    const end = () => { if (tok) { if (ed.mode === 'animate' && ed.autoKey) d.setKey(o); d.commit(tok); tok = null; } };
    f.addEventListener('focusout', () => setTimeout(end, 0));
    f.addEventListener('pointerup', () => setTimeout(() => { if (!f.contains(document.activeElement)) end(); }, 0));
    f.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key.startsWith('Arrow')) end(); });
  }
  ed.refreshTransformFields = () => { pos.set(o.position.toArray()); rot.set([o.rotation.x, o.rotation.y, o.rotation.z].map((r) => D.radToDeg(r))); scl.set(o.scale.toArray()); };
  out.push(section('Transform'),
    h('div', { class: 'label', style: { marginBottom: '4px' } }, 'Position (m)'), pos,
    h('div', { class: 'label', style: { margin: '10px 0 4px' } }, 'Rotation (°)'), rot,
    h('div', { class: 'row', style: { margin: '10px 0 4px' } }, h('span', { class: 'label grow' }, 'Scale'), h('button', { class: 'chip' + (ed.uniformScale ? ' active' : ''), 'aria-pressed': String(!!ed.uniformScale), onclick: () => { ed.uniformScale = !ed.uniformScale; renderInspector(ed); } }, icon('link'), 'Uniform')), scl);
  if (isMesh(o)) {
    o.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3());
    const dims = vec3Field(size.toArray(), null, (v) => {
      const g = o.geometry; g.computeBoundingBox(); const ls = g.boundingBox.getSize(new THREE.Vector3());
      d.transact('Set size', () => { // scale along the local axis closest to each world axis
        const cur = new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3());
        for (let i = 0; i < 3; i++) if (Math.abs(v[i] - cur.getComponent(i)) > 1e-6 && cur.getComponent(i) > 1e-9) {
          const axis = new THREE.Vector3().setComponent(i, 1), local = axis.clone().applyQuaternion(o.quaternion.clone().invert());
          const li = [0, 1, 2].reduce((b, j) => (Math.abs(local.getComponent(j)) > Math.abs(local.getComponent(b)) ? j : b), 0);
          o.scale.setComponent(li, o.scale.getComponent(li) * v[i] / cur.getComponent(i));
        }
      }, [o]);
      void ls;
    }, 0.01);
    out.push(h('div', { class: 'label', style: { margin: '10px 0 4px' } }, 'Dimensions (m)'), dims);
  }
  out.push(h('div', { class: 'chips', style: { marginTop: '12px' } },
    isMesh(o) && h('button', { class: 'chip', onclick: () => a.dropToFloor(o) }, icon('arrow-down-to-line'), 'Drop to floor'),
    h('button', { class: 'chip', onclick: () => a.resetTransform(o) }, icon('rotate-ccw'), 'Reset'),
    h('button', { class: 'chip', onclick: (e) => menu([['x', 'X'], ['y', 'Y'], ['z', 'Z']].map(([ax, l]) => ({ label: 'Mirror ' + l, onClick: () => a.mirror(o, ax) })), 0, 0, e.currentTarget) }, icon('flip-horizontal-2'), 'Mirror'),
    isMesh(o) && h('button', { class: 'chip', onclick: (e) => menu([{ label: 'Origin to centre', onClick: () => a.setOrigin(o, 'center') }, { label: 'Origin to bottom', onClick: () => a.setOrigin(o, 'bottom') }, { label: 'Apply transform', onClick: () => a.applyTransform(o) }], 0, 0, e.currentTarget) }, icon('crosshair'), 'Origin'),
  ));
  if (isMesh(o) && o.ed.prim) {
    const p = o.ed.prim, def = SHAPES[p.type];
    out.push(section(def.label + ' shape'));
    for (const prm of def.params) {
      const cur = p.params[prm.key] ?? prm.def;
      let tok = null;
      out.push(slider({
        label: prm.label, min: prm.min, max: prm.max, step: prm.int ? 1 : (prm.max - prm.min) / 400, value: cur, int: prm.int,
        onInput: (v) => { tok = tok || d.begin('Edit shape', [o]); ed.actions.rebuildPrimitive(o, { ...o.ed.prim.params, [prm.key]: v }, true); },
        onCommit: (v) => { tok = tok || d.begin('Edit shape', [o]); ed.actions.rebuildPrimitive(o, { ...o.ed.prim.params, [prm.key]: v }, true); d.commit(tok); tok = null; },
      }));
    }
    out.push(h('p', { class: 'muted' }, 'Sculpting or editing faces turns the shape into a free-form mesh.'));
  }
  if (isMesh(o) && o.ed.text) {
    out.push(section('Text'), h('div', { class: 'card', style: { padding: '10px 14px' } }, h('div', { style: { fontSize: '15px', fontWeight: 600, whiteSpace: 'pre-wrap', marginBottom: '8px' } }, o.ed.text.text), btn('Edit text…', () => S.textStudio(ed, o), 'tinted', 'type', ['Text studio', 'T'])));
  }
  if (isLight(o)) out.push(...lightSection(ed, o));
  if (ed.mode === 'animate') out.push(...animateSection(ed, o));
  return out;
}

function lightSection(ed, o) {
  const l = o.ed.light, d = ed.doc;
  const out = [section('Light')];
  out.push(seg([['point', 'Point', 'lightbulb'], ['spot', 'Spot', 'flashlight'], ['directional', 'Sun', 'sun']], o.ed.lightType, (t) => {
    // swap the light type, keeping colour/intensity
    import('./model.js').then(({ makeLight }) => {
      const n = makeLight(t, o.name); n.position.copy(o.position); n.quaternion.copy(o.quaternion);
      n.ed.light.color.copy(l.color); n.ed.light.intensity = t === 'directional' ? Math.min(l.intensity, 5) : l.intensity; n.ed.keys = new Map([...o.ed.keys].map(([f, k]) => [f, { p: [...k.p], q: [...k.q], s: [...k.s] }]));
      d.transact('Light type', () => { const i = d.objects.indexOf(o); d.detach(o); d.attach(n, i); d.select(n); }, []);
    });
  }));
  out.push(h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'label grow' }, 'Colour'),
    ...['#ffffff', '#ffd8a8', '#ffb86b', '#a5d8ff', '#b197fc', '#ff8787'].map((c) => h('button', { class: 'swatch', style: { width: '22px', height: '22px', background: c }, 'aria-label': c, onclick: () => d.transact('Light colour', () => l.color.set(c), [o]) })),
    (() => { const L = live(ed, 'Light colour', [o], (v) => l.color.set(v)); return colorSwatch('#' + l.color.getHexString(), L.onInput, L.onCommit); })()));
  const L = live(ed, 'Light intensity', [o], (v) => { l.intensity = v; });
  out.push(slider({ label: o.ed.lightType === 'directional' ? 'Strength (lux)' : 'Power (cd)', min: 0, max: o.ed.lightType === 'directional' ? 10 : 50, step: 0.1, value: l.intensity, ...L }));
  if (o.ed.lightType !== 'directional') out.push(slider({ label: 'Range (0 = infinite)', min: 0, max: 50, step: 0.1, value: l.distance, unit: ' m', ...live(ed, 'Light range', [o], (v) => { l.distance = v; }) }));
  if (o.ed.lightType === 'spot') {
    out.push(slider({ label: 'Cone angle', min: 1, max: 89, step: 1, value: D.radToDeg(l.angle), unit: '°', ...live(ed, 'Cone angle', [o], (v) => { l.angle = D.degToRad(v); }) }));
    out.push(slider({ label: 'Softness', min: 0, max: 1, step: 0.01, value: l.penumbra, ...live(ed, 'Cone softness', [o], (v) => { l.penumbra = v; }) }));
  }
  out.push(toggle('Cast shadows', l.castShadow, (v) => d.transact('Light shadows', () => { l.castShadow = v; }, [o])));
  if (o.ed.lightType !== 'point') out.push(btn('Aim at selection centre', () => { const box = new THREE.Box3(); for (const m of d.meshes) if (m.visible) box.expandByObject(m); if (!box.isEmpty()) d.transact('Aim light', () => o.lookAt(box.getCenter(new THREE.Vector3())), [o]); }, 'ghost', 'crosshair'));
  out.push(h('p', { class: 'muted' }, 'Lights export to GLB/glTF (KHR_lights_punctual) and show in game engines and viewers that support them.'));
  return out;
}

function animateSection(ed, o) {
  const d = ed.doc;
  const out = [section('Animation presets')];
  out.push(h('div', { class: 'tile-grid' }, ANIM_PRESETS.map((p) => h('button', { class: 'tile', tip: p.desc, onclick: () => { d.transact('Animation: ' + p.label, () => applyPreset(d, o, p.id), [o]); ed.togglePlay(true); } }, icon(p.icon), p.label))));
  const keys = [...o.ed.keys.keys()].sort((a, b) => a - b);
  out.push(section(`Keyframes (${keys.length})`));
  if (!keys.length) out.push(h('p', { class: 'muted' }, 'Move to a frame on the timeline, then move/rotate/scale the object. With Auto-key on, a keyframe is recorded automatically. Press K to key manually.'));
  else out.push(h('div', { class: 'chips' }, keys.map((f) => h('button', { class: 'chip' + (f === d.frame ? ' active' : ''), onclick: () => ed.setFrame(f) }, icon('diamond'), `${f}`))));
  return out;
}

// ------------------------------------------------------------------------------- material
export const MAT_PRESETS = [
  { id: 'plastic', label: 'Plastic', r: 0.35, m: 0 }, { id: 'matte', label: 'Matte', r: 0.9, m: 0 }, { id: 'gloss', label: 'Glossy', r: 0.08, m: 0 },
  { id: 'metal', label: 'Metal', r: 0.3, m: 1, c: 0xc9cdd2 }, { id: 'chrome', label: 'Chrome', r: 0.04, m: 1, c: 0xf2f4f7 }, { id: 'gold', label: 'Gold', r: 0.22, m: 1, c: 0xffc34d },
  { id: 'copper', label: 'Copper', r: 0.28, m: 1, c: 0xd9825b }, { id: 'rubber', label: 'Rubber', r: 0.95, m: 0, c: 0x2b2b30 }, { id: 'ceramic', label: 'Ceramic', r: 0.15, m: 0, c: 0xf5f3ef },
  { id: 'glass', label: 'Glass', r: 0.05, m: 0, c: 0xbfe6ff, o: 0.35 }, { id: 'glow', label: 'Glow', r: 0.5, m: 0, e: 3 }, { id: 'clay', label: 'Clay', r: 0.75, m: 0, c: 0xc98f6b },
];
function presetPreview(p) {
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const ctx = c.getContext('2d'), col = hex(p.c ?? 0x9aa0ff);
  const g = ctx.createRadialGradient(14, 12, 1, 20, 20, 20);
  g.addColorStop(0, p.e ? '#ffffff' : `rgba(255,255,255,${0.9 - p.r * 0.7})`); g.addColorStop(0.35, col); g.addColorStop(1, p.m ? '#111' : shade(col));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(20, 20, 18, 0, Math.PI * 2); ctx.fill();
  if (p.o) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(); }
  c.style.width = c.style.height = '30px';
  return c;
}
function shade(c) { const n = parseInt(c.slice(1), 16); return `rgb(${(n >> 16 & 255) * 0.35},${(n >> 8 & 255) * 0.35},${(n & 255) * 0.35})`; }

function materialPanel(ed, o) {
  if (!isMesh(o)) return h('p', { class: 'muted' }, 'Select a mesh.');
  const m = o.material, d = ed.doc, a = ed.actions, u = m.userData;
  const out = [];
  out.push(section('Look'), h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(4, 1fr)' } }, MAT_PRESETS.map((p) => h('button', { class: 'tile', style: { height: '62px' }, onclick: () => a.material('Material: ' + p.label, (mm) => {
    mm.roughness = p.r; mm.metalness = p.m; if (p.c != null) mm.color.setHex(p.c);
    mm.opacity = p.o ?? 1; mm.transparent = !!p.o; mm.depthWrite = !p.o;
    mm.emissive.set(p.e ? mm.color : 0x000000); mm.emissiveIntensity = p.e || 1;
    mm.needsUpdate = true;
  }, o) }, presetPreview(p), p.label))));
  out.push(section('Base colour'), h('div', { class: 'swatches' },
    PALETTE.map((c) => h('button', { class: 'swatch' + (m.color.getHex() === c ? ' ring' : ''), style: { background: hex(c) }, 'aria-label': 'Colour ' + hex(c), onclick: () => a.material('Colour', (mm) => mm.color.setHex(c), o) })),
    (() => { const L = live(ed, 'Colour', [o], (v) => m.color.set(v)); return colorSwatch('#' + m.color.getHexString(), L.onInput, L.onCommit, 'Custom colour'); })()));
  if (m.map) out.push(h('p', { class: 'muted' }, 'Colour tints the texture. Pick white to show the texture as-is.'));
  out.push(slider({ label: 'Roughness', min: 0, max: 1, step: 0.01, value: m.roughness, ...live(ed, 'Roughness', [o], (v) => { m.roughness = v; }) }));
  out.push(slider({ label: 'Metallic', min: 0, max: 1, step: 0.01, value: m.metalness, ...live(ed, 'Metallic', [o], (v) => { m.metalness = v; }) }));
  out.push(slider({ label: 'Opacity', min: 0.02, max: 1, step: 0.01, value: m.opacity, ...live(ed, 'Opacity', [o], (v) => { const t = v < 0.999; if (m.transparent !== t) { m.transparent = t; m.depthWrite = !t; m.needsUpdate = true; } m.opacity = v; }) }));
  out.push(section('Glow'), h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Emission colour'), (() => { const L = live(ed, 'Glow colour', [o], (v) => { m.emissive.set(v); if (m.emissiveIntensity === 0) m.emissiveIntensity = 1; }); return colorSwatch('#' + m.emissive.getHexString(), L.onInput, L.onCommit); })()));
  out.push(slider({ label: 'Glow strength', min: 0, max: 20, step: 0.05, value: m.emissive.getHex() ? m.emissiveIntensity : 0, ...live(ed, 'Glow', [o], (v) => { if (!m.emissive.getHex() && v > 0) m.emissive.copy(m.color); m.emissiveIntensity = v; if (v === 0) m.emissive.set(0); }) }));
  out.push(toggle('Double-sided', m.side === THREE.DoubleSide, (v) => a.material('Double-sided', (mm) => { mm.side = v ? THREE.DoubleSide : THREE.FrontSide; mm.needsUpdate = true; }, o), 'Show back faces (planes, leaves, cloth)'));
  if (o.geometry.attributes.color) out.push(toggle('Show vertex paint', !!m.vertexColors, (v) => a.material('Vertex paint', (mm) => { mm.vertexColors = v; mm.needsUpdate = true; }, o)));

  // textures
  out.push(section('Texture'));
  const maps = u.maps || {};
  if (m.map) {
    const thumb = h('canvas', { class: 'thumb-img', width: 92, height: 92 });
    try { const img = m.map.image; const ctx = thumb.getContext('2d'); ctx.drawImage(img, 0, 0, 92, 92); } catch { /* ignore */ }
    out.push(h('div', { class: 'texrow' }, thumb, h('div', { class: 't' }, h('b', null, maps.kind === 'pattern' ? (maps.spec?.pattern || 'Pattern').toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace('_', ' ') : maps.name || m.map.name || 'Texture'), h('span', null, `${m.map.image?.width || '?'}×${m.map.image?.height || '?'} px`)),
      ibtn('replace', 'Change texture', () => S.textureLibrary(ed)), ibtn('x', 'Remove texture', () => a.material('Remove texture', (mm) => { clearMaps(mm); }, o))));
    if (maps.kind === 'pattern') {
      const sp = maps.spec;
      out.push(h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Pattern colours'),
        colorSwatch(hex(sp.colorA), null, (v) => a.material('Pattern colour', (mm) => applyPattern(mm, { ...sp, colorA: parseInt(v.slice(1), 16) }, maps.size || 1024), o)),
        colorSwatch(hex(sp.colorB), null, (v) => a.material('Pattern colour', (mm) => applyPattern(mm, { ...sp, colorB: parseInt(v.slice(1), 16) }, maps.size || 1024), o))));
      out.push(slider({ label: 'Pattern detail', min: 1, max: 32, step: 1, int: true, value: sp.scale, onCommit: (v) => a.material('Pattern scale', (mm) => applyPattern(mm, { ...sp, scale: v }, maps.size || 1024), o) }));
      out.push(slider({ label: 'Variation', min: 1, max: 99, step: 1, int: true, value: sp.seed, onCommit: (v) => a.material('Pattern variation', (mm) => applyPattern(mm, { ...sp, seed: v }, maps.size || 1024), o) }));
    }
    const lockK = ed.tileLock !== false;
    const tile = (axis) => live(ed, 'Tiling', [o], (v) => { if (lockK) u.tiling = [v, v]; else u.tiling[axis] = v; syncTextures(m); });
    out.push(h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'label grow' }, 'Tiling'), h('button', { class: 'chip' + (lockK ? ' active' : ''), onclick: () => { ed.tileLock = !lockK; renderInspector(ed); } }, icon('link'), 'Linked')));
    out.push(slider({ label: lockK ? 'Repeat' : 'Repeat U', min: 0.1, max: 32, step: 0.05, value: u.tiling[0], ...tile(0) }));
    if (!lockK) out.push(slider({ label: 'Repeat V', min: 0.1, max: 32, step: 0.05, value: u.tiling[1], ...tile(1) }));
    out.push(slider({ label: 'Offset U', min: -1, max: 1, step: 0.005, value: u.offset[0], ...live(ed, 'Texture offset', [o], (v) => { u.offset = [v, u.offset[1]]; syncTextures(m); }) }));
    out.push(slider({ label: 'Offset V', min: -1, max: 1, step: 0.005, value: u.offset[1], ...live(ed, 'Texture offset', [o], (v) => { u.offset = [u.offset[0], v]; syncTextures(m); }) }));
    out.push(slider({ label: 'Rotation', min: -180, max: 180, step: 1, unit: '°', value: D.radToDeg(u.rotation), ...live(ed, 'Texture rotation', [o], (v) => { u.rotation = D.degToRad(v); syncTextures(m); }) }));
    out.push(toggle('Pixel-art (sharp pixels)', !!u.pixel, (v) => a.material('Pixel filter', (mm) => { mm.userData.pixel = v; syncTextures(mm); }, o)));
    if (m.normalMap) out.push(slider({ label: 'Bump strength', min: 0, max: 3, step: 0.01, value: m.normalScale.x, ...live(ed, 'Bump', [o], (v) => { m.normalScale.set(v, v); }) }));
    else out.push(btn('Add bump from texture', () => a.material('Bump map', (mm) => bumpFromColor(mm, 2), o), 'ghost', 'mountain'));
  } else {
    out.push(h('p', { class: 'muted' }, 'Wrap the whole object in a pattern or a photo. To texture just part of it, use Faces mode to select an area first.'));
  }
  out.push(h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } },
    btn(m.map ? 'Library' : 'Add texture', () => S.textureLibrary(ed), 'tinted', 'image'),
    btn('Photo…', () => S.pickPhoto(ed, o), 'ghost', 'image-plus'),
    btn('Sticker…', () => S.stickerDialog(ed), 'ghost', 'sticker')));
  if (o.geometry.attributes.uv) out.push(h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'label grow' }, 'UV projection'), select([['', 'Keep'], ...UV_MODES], '', (v) => v && a.projectUvs(o, v), 'UV projection')));
  else out.push(btn('Generate UVs (box)', () => a.projectUvs(o, 'BOX'), 'ghost', 'grid-3x3'));
  out.push(section('Share'), h('div', { class: 'row' }, btn('Apply to all objects', () => a.materialToAll(o), 'ghost', 'copy-check'), btn('Rename', async () => { const n = await promptDialog('Material name', m.name); if (n) a.material('Rename material', (mm) => { mm.name = n; }, o); }, 'ghost', 'pencil')));
  return out;
}

// ------------------------------------------------------------------------------- mesh
function meshPanel(ed, o) {
  if (!isMesh(o)) return h('p', { class: 'muted' }, 'Select a mesh.');
  const g = o.geometry, a = ed.actions, tris = g.index.count / 3;
  const out = [h('div', { class: 'summary' }, h('b', null, tris.toLocaleString()), ' triangles · ', g.attributes.position.count.toLocaleString(), ' vertices', h('div', { class: 'muted' }, [g.attributes.uv ? 'UVs' : 'No UVs', g.attributes.color ? 'vertex paint' : null, g.attributes.mask ? 'mask' : null, g.userData.flat ? 'flat shaded' : 'smooth shaded'].filter(Boolean).join(' · ')))];
  if (o.ed.prim || o.ed.text) out.push(h('div', { class: 'warn' }, icon('info'), h('span', null, 'This is an editable ', o.ed.text ? 'text' : 'shape', '. Mesh tools turn it into a free-form mesh.')), btn('Make editable now', () => a.makeEditable(o), 'ghost', 'pen-line'));
  out.push(section('Resolution'), h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    btn('Subdivide', () => a.subdivide(o, true), 'tinted', 'grid-2x2-plus', 'Smooth subdivision ×4 triangles'),
    btn('Subdivide (keep shape)', () => a.subdivide(o, false), 'ghost', 'grid-2x2')));
  let ratio = 0.5;
  out.push(slider({ label: 'Decimate to', min: 0.05, max: 0.95, step: 0.01, value: ratio, format: (v) => `${Math.round(v * 100)}% (${Math.round(tris * v).toLocaleString()} tris)`, onInput: (v) => { ratio = v; } }),
    btn('Decimate', () => a.decimate(o, ratio), 'ghost', 'minimize-2'));
  out.push(section('Shape'), h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    btn('Smooth', () => a.smooth(o, 3), 'ghost', 'waves'), btn('Flip normals', () => a.flipNormals(o), 'ghost', 'flip-vertical-2')));
  out.push(section('Shading'), seg([['smooth', 'Smooth', 'circle'], ['flat', 'Flat', 'hexagon']], g.userData.flat ? 'flat' : 'smooth', (v) => a.setFlat(o, v === 'flat')));
  out.push(section('Combine'), btn('Join visible objects into this', () => a.joinAll(o), 'ghost', 'combine'));
  return out;
}

// ------------------------------------------------------------------------------- scene / view
function scenePanel(ed) {
  const vp = ed.vp, rs = vp.render;
  const set = (k, v, re = true) => { rs[k] = v; ed.doc.dirty = true; if (re) vp.applyRender(); else vp.requestRender(); };
  const out = [section('Viewport shading'), h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(5,1fr)' } }, SHADING.map(([id, label, ic]) => h('button', { class: 'tile' + (rs.shading === id ? ' sel' : ''), style: { height: '58px', ...(rs.shading === id ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : {}) }, 'aria-pressed': String(rs.shading === id), onclick: () => { set('shading', id); renderInspector(ed); } }, icon(ic), label)))];
  if (rs.shading === 'MATCAP') out.push(h('div', { class: 'row', style: { marginTop: '10px', gap: '10px' } }, MATCAPS.map((mc) => { const t = matcapTexture(mc.id); const c = h('canvas', { width: 36, height: 36, class: 'swatch' + (rs.matcap === mc.id ? ' ring' : ''), tip: mc.label, role: 'button', tabindex: '0', style: { width: '36px', height: '36px' }, onclick: () => { set('matcap', mc.id); vp.clearShadingCache(); renderInspector(ed); } }); c.getContext('2d').drawImage(t.image, 0, 0, 36, 36); return c; })));
  out.push(h('p', { class: 'muted' }, 'Shading only changes how you see the model while editing. Exports always use the real materials.'));
  out.push(section('Environment lighting'), h('div', { class: 'chips' }, ENVS.map(([id, label]) => h('button', { class: 'chip' + (rs.env === id ? ' active' : ''), 'aria-pressed': String(rs.env === id), onclick: () => { set('env', id); renderInspector(ed); } }, label))));
  out.push(slider({ label: 'Exposure', min: 0.2, max: 3, step: 0.01, value: rs.exposure, onInput: (v) => set('exposure', v, false) || (vp.renderer.toneMappingExposure = v) }));
  out.push(slider({ label: 'Environment rotation', min: -180, max: 180, step: 1, unit: '°', value: rs.envRotation || 0, onInput: (v) => { rs.envRotation = v; vp.scene.environmentRotation.y = D.degToRad(v); vp.scene.backgroundRotation.y = D.degToRad(v); vp.requestRender(); } }));
  out.push(slider({ label: 'Environment strength', min: 0, max: 3, step: 0.01, value: rs.envIntensity ?? 1, onInput: (v) => { rs.envIntensity = v; vp.scene.environmentIntensity = v; vp.requestRender(); } }));
  out.push(section('Key light'), slider({ label: 'Direction', min: -180, max: 180, step: 1, unit: '°', value: rs.lightAngle, onInput: (v) => { rs.lightAngle = v; vp.updateKeyLight(); vp.requestRender(); } }),
    slider({ label: 'Height', min: 5, max: 90, step: 1, unit: '°', value: rs.lightHeight, onInput: (v) => { rs.lightHeight = v; vp.updateKeyLight(); vp.requestRender(); } }),
    toggle('Shadows', rs.shadows, (v) => set('shadows', v)));
  out.push(section('Background'), h('div', { class: 'swatches' }, BACKGROUNDS.map(([t, b]) => h('button', { class: 'swatch' + (rs.bgTop === t && rs.bgBottom === b ? ' ring' : ''), style: { background: `linear-gradient(${hex(t)}, ${hex(b)})` }, 'aria-label': 'Background', onclick: () => { rs.bgTop = t; rs.bgBottom = b; vp.applyRender(); renderInspector(ed); } })),
  colorSwatch(hex(rs.bgTop), (v) => { rs.bgTop = parseInt(v.slice(1), 16); rs.bgBottom = darken(rs.bgTop); vp.updateBackground(); vp.requestRender(); }, null, 'Custom background')));
  out.push(section('Guides'), toggle('Floor grid', rs.grid, (v) => set('grid', v)), toggle('Wireframe overlay', rs.wireframe, (v) => set('wireframe', v)));
  out.push(section('Camera'), seg([['p', 'Perspective'], ['o', 'Orthographic']], rs.ortho ? 'o' : 'p', (v) => set('ortho', v === 'o')),
    slider({ label: 'Field of view', min: 15, max: 100, step: 1, unit: '°', value: rs.fov, onInput: (v) => { rs.fov = v; vp.persp.fov = v; vp.persp.updateProjectionMatrix(); vp.updateCamera(); vp.requestRender(); } }),
    h('div', { class: 'chips' }, ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'].map((v) => h('button', { class: 'chip', onclick: () => vp.view(v) }, v[0].toUpperCase() + v.slice(1)))));
  return out;
}
function darken(c) { return ((c >> 16 & 255) * 0.4 << 16) | ((c >> 8 & 255) * 0.4 << 8) | ((c & 255) * 0.4); }

// ------------------------------------------------------------------------------- tool panels
function toolPanel(ed) {
  const m = ed.mode;
  if (m === 'sculpt') return sculptPanel(ed);
  if (m === 'paint') return paintPanel(ed);
  if (m === 'edit') return facesPanel(ed);
  if (m === 'animate') return ed.doc.selected ? animateSection(ed, ed.doc.selected) : h('p', { class: 'muted' }, 'Select an object to animate.');
  return [];
}
function brushSliders(ed, b, color = false) {
  return [
    slider({ label: 'Radius', min: 4, max: 400, step: 1, int: true, value: b.radiusPx, unit: ' px', onInput: (v) => { b.radiusPx = v; } }),
    slider({ label: 'Strength', min: 0.01, max: 1, step: 0.01, value: b.intensity, onInput: (v) => { b.intensity = v; } }),
    h('div', { class: 'label', style: { margin: '8px 0 6px' } }, 'Falloff'),
    seg(FALLOFFS.map((f, i) => [i, f]), b.falloff, (v) => { b.falloff = v; }),
    toggle('Pen pressure', b.usePressure, (v) => { b.usePressure = v; }, 'Strength follows stylus pressure'),
    !color && slider({ label: 'Spacing', min: 0.03, max: 0.6, step: 0.01, value: b.spacing, onInput: (v) => { b.spacing = v; } }),
  ];
}
function sculptPanel(ed) {
  const o = ed.doc.selected, b = ed.vp.brush, a = ed.actions;
  const out = [section('Brush'), h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(4, 1fr)' } }, BRUSHES.filter((x) => x.id !== 'PAINT').map((x) => h('button', { class: 'tile', style: { height: '60px', ...(ed.vp.brushType === x.id ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'white' } : {}) }, 'aria-pressed': String(ed.vp.brushType === x.id), onclick: () => ed.setBrush(x.id) }, icon(x.icon), x.label)))];
  out.push(...brushSliders(ed, b));
  out.push(toggle(ed.vp.brushType === 'MASK' ? 'Erase mask' : 'Invert (dig in)', b.negative, (v) => { b.negative = v; }, 'Hold Ctrl to invert temporarily'));
  out.push(section('Symmetry'), h('div', { class: 'chips' }, ['X', 'Y', 'Z'].map((ax, i) => h('button', { class: 'chip' + (ed.sym[i] ? ' active' : ''), 'aria-pressed': String(ed.sym[i]), onclick: () => { ed.sym[i] = !ed.sym[i]; renderInspector(ed); ed.refreshStrip(); } }, 'Mirror ' + ax))));
  out.push(section('Mask'), h('div', { class: 'chips' },
    h('button', { class: 'chip', onclick: () => maskOp(ed, 'clear') }, icon('eraser'), 'Clear'), h('button', { class: 'chip', onclick: () => maskOp(ed, 'invert') }, icon('contrast'), 'Invert'),
    h('button', { class: 'chip', onclick: () => maskOp(ed, 'blur') }, icon('droplet'), 'Blur'), h('button', { class: 'chip', onclick: () => maskOp(ed, 'sharpen') }, icon('focus'), 'Sharpen')),
  h('p', { class: 'muted' }, 'Masked areas (dark) are protected from brushes.'));
  if (isMesh(o)) out.push(section('Mesh'), h('div', { class: 'summary' }, h('b', null, (o.geometry.index.count / 3).toLocaleString()), ' triangles'), h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } }, btn('Subdivide', () => a.subdivide(o, true), 'tinted', 'grid-2x2-plus'), btn('Smooth all', () => a.smooth(o, 2), 'ghost', 'waves'), btn('Decimate 50%', () => a.decimate(o, 0.5), 'ghost', 'minimize-2')));
  out.push(section('Tips'), h('div', { class: 'kbdlist muted' }, 'Smooth while held', h('kbd', null, 'Shift'), 'Invert while held', h('kbd', null, 'Ctrl'), 'Brush size', h('kbd', null, '[  ]'), 'Orbit', h('kbd', null, 'Right drag / drag off model')));
  return out;
}
function maskOp(ed, op) {
  const o = ed.doc.selected; if (!isMesh(o)) return;
  const g = o.geometry, before = g.attributes.mask ? Float32Array.from(g.attributes.mask.array) : null;
  MaskOps[op](g);
  const after = g.attributes.mask ? Float32Array.from(g.attributes.mask.array) : null;
  const put = (arr) => { if (!g.attributes.mask) return; if (arr) g.attributes.mask.array.set(arr); else g.attributes.mask.array.fill(0); g.attributes.mask.needsUpdate = true; ed.vp.syncMask(); };
  ed.doc.pushRecord({ label: 'Mask ' + op, bytes: (after?.byteLength || 0) * 2, undo: () => put(before), redo: () => put(after) });
  ed.vp.syncMask();
}
function paintPanel(ed) {
  const b = ed.paintBrush, o = ed.doc.selected, a = ed.actions;
  const setColor = (hx) => { b.hex = hx; const c = new THREE.Color(hx); b.color = [c.r, c.g, c.b, 1]; };
  const out = [section('Colour'), h('div', { class: 'swatches' },
    PALETTE.concat([0xffffff, 0x000000]).map((c) => h('button', { class: 'swatch' + (b.hex === hex(c) ? ' ring' : ''), style: { background: hex(c) }, 'aria-label': hex(c), onclick: () => { setColor(hex(c)); renderInspector(ed); ed.refreshStrip(); } })),
    colorSwatch(b.hex, (v) => setColor(v), () => ed.refreshStrip(), 'Custom paint colour'))];
  out.push(section('Brush'), ...brushSliders(ed, b, true), toggle('Erase paint (to white)', b.negative, (v) => { b.negative = v; }));
  out.push(section('Whole object'), h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    btn('Fill with colour', () => fillPaint(ed, o, b.color), 'tinted', 'paint-bucket'),
    btn('Clear paint', () => fillPaint(ed, o, null), 'ghost', 'eraser')));
  if (isMesh(o) && o.geometry.index.count / 3 < 20000) out.push(h('div', { class: 'warn' }, icon('info'), h('span', null, 'Paint is stored per vertex: more triangles = finer detail. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); a.subdivide(o, false); } }, 'Subdivide (keep shape)'))));
  out.push(h('p', { class: 'muted' }, 'Vertex paint exports as COLOR_0 in GLB/glTF, PLY and OBJ.'));
  return out;
}
function fillPaint(ed, o, color) {
  if (!isMesh(o)) return;
  ed.actions.geoOp(color ? 'Fill paint' : 'Clear paint', (g) => {
    const c = g.clone(); c.userData = { ...g.userData };
    if (!color) { c.deleteAttribute('color'); return c; }
    const n = c.attributes.position.count, arr = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) arr.set(color, i * 4);
    c.setAttribute('color', new THREE.BufferAttribute(arr, 4));
    return c;
  }, o);
  if (color && !o.material.vertexColors) ed.actions.material('Vertex paint', (mm) => { mm.vertexColors = true; mm.needsUpdate = true; }, o);
  if (!color && o.material.vertexColors) ed.actions.material('Vertex paint off', (mm) => { mm.vertexColors = false; mm.needsUpdate = true; }, o);
}
function facesPanel(ed) {
  const f = ed.vp.faces, ft = ed.vp.faceTool, a = ed.actions;
  const n = f.geo ? f.count() : 0;
  const out = [h('div', { class: 'summary' }, h('b', null, n.toLocaleString()), ' faces selected')];
  out.push(section('Selection brush'), seg([[1, 'Select', 'plus'], [0, 'Deselect', 'minus']], ft.value, (v) => { ft.value = v; ed.refreshStrip(); }),
    slider({ label: 'Radius', min: 2, max: 300, step: 1, int: true, unit: ' px', value: ft.radiusPx, onInput: (v) => { ft.radiusPx = v; } }));
  const selOp = (fn, label) => h('button', { class: 'chip', onclick: () => { const before = Uint8Array.from(f.sel); fn(); const after = Uint8Array.from(f.sel); const geo = f.geo; ed.doc.pushRecord({ label, bytes: after.length * 2, undo: () => { if (f.geo === geo) { f.sel.set(before); ed.vp.syncFaceOverlay(); } }, redo: () => { if (f.geo === geo) { f.sel.set(after); ed.vp.syncFaceOverlay(); } } }); ed.vp.syncFaceOverlay(); } }, label);
  out.push(h('div', { class: 'chips', style: { marginTop: '8px' } }, selOp(() => f.selectAll(), 'All'), selOp(() => f.clear(), 'None'), selOp(() => f.invert(), 'Invert'), selOp(() => f.grow(), 'Grow'), selOp(() => f.selectLinked(), 'Linked')));
  out.push(section('Part material'), h('p', { class: 'muted' }, 'Give the selected area its own colour, material or texture. It becomes a separate part you can style.'),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      btn('Colour / material', () => { if (a.separate()) { ed.setMode('object'); ed.inspectorTab = 'material'; ed.refresh(); } }, 'tinted', 'palette'),
      btn('Texture', () => { if (a.separate()) { ed.setMode('object'); ed.inspectorTab = 'material'; ed.refresh(); S.textureLibrary(ed); } }, 'ghost', 'image')));
  let dist = 0.1, inset = 0.25;
  out.push(section('Modify'),
    slider({ label: 'Extrude distance', min: -1, max: 1, step: 0.005, value: dist, unit: ' m', onInput: (v) => { dist = v; } }),
    btn('Extrude', () => a.extrude(dist), 'ghost', 'arrow-up-from-line'),
    slider({ label: 'Inset amount', min: 0.02, max: 0.95, step: 0.01, value: inset, onInput: (v) => { inset = v; } }),
    btn('Inset', () => a.inset(inset), 'ghost', 'square-dot'),
    h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } }, btn('Flip', () => a.flipFaces(), 'ghost', 'flip-vertical-2'), btn('Separate', () => a.separate(), 'ghost', 'split'), btn('Delete', () => a.deleteFaces(), 'danger', 'trash-2')));
  out.push(section('Tips'), h('div', { class: 'kbdlist muted' }, 'Deselect while held', h('kbd', null, 'Ctrl'), 'Select all', h('kbd', null, 'Ctrl+A'), 'Brush size', h('kbd', null, '[  ]')));
  return out;
}

// =============================================================================== strip
export function renderStrip(ed) {
  const m = ed.mode, vp = ed.vp, items = [];
  if (m === 'object' || m === 'animate') {
    for (const [id, label, ic, key] of [['none', 'Select', 'mouse-pointer-2', 'Q'], ['translate', 'Move', 'move', 'W'], ['rotate', 'Rotate', 'rotate-3d', 'E'], ['scale', 'Scale', 'scaling', 'R']]) {
      items.push(tool(ic, label, () => { vp.gizmoMode = id; vp.syncGizmo(); renderStrip(ed); }, vp.gizmoMode === id, [label, key]));
    }
    items.push(h('div', { class: 'div' }));
    items.push(tool('magnet', 'Snap', () => { ed.snap = !ed.snap; vp.gizmo.setTranslationSnap(ed.snap ? 0.1 : null); vp.gizmo.setRotationSnap(ed.snap ? D.degToRad(15) : null); vp.gizmo.setScaleSnap(ed.snap ? 0.1 : null); renderStrip(ed); }, !!ed.snap, 'Snap to 10 cm / 15°'));
    items.push(tool(vp.gizmo.space === 'local' ? 'box' : 'globe', vp.gizmo.space === 'local' ? 'Local' : 'World', () => { vp.gizmo.setSpace(vp.gizmo.space === 'local' ? 'world' : 'local'); renderStrip(ed); }, false, 'Gizmo orientation'));
    items.push(h('div', { class: 'div' }));
    items.push(tool('scan-search', 'Frame', () => vp.frame(), false, ['Frame selection', 'F']));
    items.push(tool('view', 'View', (e) => menu([['front', 'Front', 'Numpad 1'], ['back', 'Back'], ['left', 'Left'], ['right', 'Right', 'Numpad 3'], ['top', 'Top', 'Numpad 7'], ['bottom', 'Bottom'], ['iso', 'Three-quarter']].map(([v, l, k]) => ({ label: l, key: k, onClick: () => vp.view(v) })).concat(['sep', { label: vp.render.ortho ? 'Perspective' : 'Orthographic', key: 'Numpad 5', onClick: () => { vp.render.ortho = !vp.render.ortho; vp.applyRender(); } }]), 0, 0, e.currentTarget), false, 'Camera views'));
    if (m === 'animate') { items.push(h('div', { class: 'div' })); items.push(tool(ed.playing ? 'pause' : 'play', ed.playing ? 'Pause' : 'Play', () => { ed.togglePlay(); renderStrip(ed); }, ed.playing, ['Play', 'Space'])); }
  } else if (m === 'sculpt') {
    for (const id of ['CLAY', 'DRAW', 'SMOOTH', 'INFLATE', 'FLATTEN', 'PINCH', 'CREASE', 'MOVE', 'MASK']) {
      const b = BRUSHES.find((x) => x.id === id);
      items.push(tool(b.icon, b.label, () => ed.setBrush(id), vp.brushType === id, b.label));
    }
    items.push(h('div', { class: 'div' }));
    items.push(miniSlider('Size', vp.brush.radiusPx, 4, 400, (v) => { vp.brush.radiusPx = v; }, (v) => Math.round(v) + 'px'));
    items.push(miniSlider('Strength', vp.brush.intensity, 0.01, 1, (v) => { vp.brush.intensity = v; }, (v) => Math.round(v * 100) + '%'));
    items.push(tool('flip-horizontal-2', 'Sym X', () => { ed.sym[0] = !ed.sym[0]; renderStrip(ed); }, ed.sym[0], ['Mirror X', 'X']));
  } else if (m === 'paint') {
    items.push(h('div', { class: 'swatch', style: { width: '30px', height: '30px', background: ed.paintBrush.hex, margin: '0 8px' } }));
    items.push(miniSlider('Size', vp.brush.radiusPx, 4, 400, (v) => { vp.brush.radiusPx = v; }, (v) => Math.round(v) + 'px'));
    items.push(miniSlider('Strength', vp.brush.intensity, 0.01, 1, (v) => { vp.brush.intensity = v; }, (v) => Math.round(v * 100) + '%'));
    items.push(tool('eraser', 'Erase', () => { vp.brush.negative = !vp.brush.negative; renderStrip(ed); }, vp.brush.negative, 'Erase paint'));
  } else if (m === 'edit') {
    items.push(tool('plus', 'Select', () => { vp.faceTool.value = 1; renderStrip(ed); }, vp.faceTool.value === 1, 'Paint selection'));
    items.push(tool('minus', 'Deselect', () => { vp.faceTool.value = 0; renderStrip(ed); }, vp.faceTool.value === 0, 'Erase selection'));
    items.push(miniSlider('Size', vp.faceTool.radiusPx, 2, 300, (v) => { vp.faceTool.radiusPx = v; }, (v) => Math.round(v) + 'px'));
    items.push(h('div', { class: 'div' }));
    items.push(tool('arrow-up-from-line', 'Extrude', () => ed.actions.extrude(0.1), false, 'Extrude 10 cm'));
    items.push(tool('square-dot', 'Inset', () => ed.actions.inset(0.25), false, 'Inset'));
    items.push(tool('palette', 'Part', () => { if (ed.actions.separate()) { ed.setMode('object'); ed.inspectorTab = 'material'; ed.refresh(); } }, false, 'Make the selection its own part with its own material'));
    items.push(tool('trash-2', 'Delete', () => ed.actions.deleteFaces(), false, ['Delete faces', 'Del']));
  }
  mount(ed.strip, items);
}
function miniSlider(label, value, min, max, onInput, fmtv) {
  const val = h('b', null, fmtv(value));
  const inp = h('input', { type: 'range', min, max, step: (max - min) / 200, value, 'aria-label': label });
  inp.style.setProperty('--p', ((value - min) / (max - min)) * 100 + '%');
  inp.addEventListener('input', () => { const v = +inp.value; val.textContent = fmtv(v); inp.style.setProperty('--p', ((v - min) / (max - min)) * 100 + '%'); onInput(v); });
  return h('div', { class: 'mini' }, h('span', null, label, val), inp);
}
export { fmt, previewCanvas };
