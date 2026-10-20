// Side panels: the layers tree, inspector tabs (Tool / Object / Material / Mesh / Scene) and the
// floating tool strip.
import * as THREE from 'three';
import { h, icon, ibtn, btn, tool, mount, menu, slider, toggle, seg, colorSwatch, vec3Field, section, select, promptDialog, fmt } from '../ui/dom.js';
import { isMesh, isLight, isCamera, isGroup, syncTextures, ANIM_PRESETS, applyPreset, EASINGS, UNITS, unitK, KIND_LABEL } from './model.js';
import { SHAPES } from '../core/shapes.js';
import { BRUSHES, FALLOFFS, MaskOps } from '../core/sculpt.js';
import { UV_MODES } from '../core/mesh.js';
import { ENVS, HDRIS, SHADING, BACKGROUNDS } from './viewport.js';
import { MATCAPS, matcapTexture, previewCanvas, clearMaps, bumpFromColor, applyPattern, imageTexture } from './textures.js';
import { PALETTE, analyzeMesh } from './actions.js';
import { colorPicker } from '../ui/color.js';
import { PAINT_SIZES } from './texpaint.js';
import { COLLISION_TYPES } from './io.js';
import { platform, IMAGE_FILTERS } from '../platform.js';
import * as S from './studios.js';
import { libraryList, textureSet, LIB } from '../templates/matlib.js';

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
const kindIcon = (o) => isLight(o) ? (o.ed.lightType === 'spot' ? 'flashlight' : o.ed.lightType === 'directional' ? 'sun' : 'lightbulb') : isCamera(o) ? 'video' : isGroup(o) ? 'folder' : o.ed.text ? 'type' : o.ed.prim ? (SHAPES[o.ed.prim.type]?.icon || 'box') : o.material.userData?.maps?.kind === 'sticker' ? 'sticker' : 'shapes';
const swatchOf = (o) => isLight(o) ? '#' + o.ed.light.color.getHexString() : isMesh(o) ? '#' + o.material.color.getHexString() : null;

// =============================================================================== layers tree
export function renderLayers(ed) {
  const d = ed.doc;
  if (!d.objects.length) {
    mount(ed.layersEl, h('div', { class: 'muted', style: { padding: '18px 4px', textAlign: 'center' } }, icon('box', 'lg'), h('p', null, 'Nothing here yet.'), btn('Add a shape', () => S.addMenu(ed), 'tinted', 'plus')));
    return;
  }
  const q = (ed.layerFilter || '').trim().toLowerCase();
  const rows = [];
  const makeRow = (o, depth, hasKids) => {
    const sel = d.isSelected(o), active = o === d.selected;
    const caret = hasKids ? h('button', { class: 'caret', tabindex: '-1', 'aria-label': o.ed.collapsed ? 'Expand' : 'Collapse', onclick: (e) => { e.stopPropagation(); o.ed.collapsed = !o.ed.collapsed; d.dirty = true; renderLayers(ed); } }, icon(o.ed.collapsed ? 'chevron-right' : 'chevron-down')) : h('span', { class: 'caret' });
    const dot = swatchOf(o);
    const row = h('div', {
      class: 'layer' + (sel ? ' sel' : '') + (active ? ' active' : '') + (d.isShown(o) ? '' : ' hiddenobj') + (o.ed.noExport ? ' noexport' : ''),
      role: 'treeitem', 'aria-selected': String(sel), 'aria-level': String(depth + 1), 'aria-expanded': hasKids ? String(!o.ed.collapsed) : null,
      'aria-label': `${o.name}, ${KIND_LABEL[o.ed.kind]}${o.visible ? '' : ', hidden'}${o.ed.locked ? ', locked' : ''}${o.ed.noExport ? ', not exported' : ''}`,
      tabindex: active || (!d.selected && rows.length === 0) ? '0' : '-1', draggable: 'true', 'data-id': String(o.ed.id),
      style: { paddingLeft: 4 + depth * 14 + 'px' },
      onclick: (e) => layerClick(ed, o, e),
      ondblclick: async () => { const n = await promptDialog('Rename', o.name); if (n) ed.actions.rename(o, n); },
      oncontextmenu: (e) => { e.preventDefault(); if (!d.isSelected(o)) d.select(o); objectMenu(ed, o, e.clientX, e.clientY); },
      ondragstart: (e) => { const list = d.isSelected(o) ? d.topSelected() : [o]; ed.dragLayers = list; e.dataTransfer.setData('text/x-layer', '1'); e.dataTransfer.effectAllowed = 'move'; },
      ondragend: () => { ed.dragLayers = null; clearDrop(ed); },
      ondragover: (e) => { if (!ed.dragLayers) return; e.preventDefault(); e.stopPropagation(); const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; clearDrop(ed); row.classList.add(y < 0.28 ? 'drop-before' : y > 0.72 ? 'drop-after' : 'drop-inside'); },
      ondragleave: () => row.classList.remove('drop-before', 'drop-after', 'drop-inside'),
      ondrop: (e) => { if (!ed.dragLayers) return; e.preventDefault(); e.stopPropagation(); const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; const list = ed.dragLayers; ed.dragLayers = null; clearDrop(ed); ed.actions.dropOn(list, o, y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside'); },
    },
    caret,
    dot ? h('span', { class: 'dot', style: { background: dot } }) : null,
    icon(kindIcon(o)),
    h('span', { class: 'nm', title: o.name }, o.name),
    o.ed.keys.size ? h('span', { class: 'badge-i', tip: 'Animated', style: { color: 'var(--warning)' } }, icon('diamond')) : null,
    isMesh(o) && o.ed.collision !== 'none' ? h('span', { class: 'badge-i', tip: 'Collision: ' + (COLLISION_TYPES.find((c) => c[0] === o.ed.collision)?.[1] || '') }, icon('shield')) : null,
    o.ed.noExport ? h('span', { class: 'badge-i', tip: 'Not exported' }, icon('ban')) : null,
    h('button', { class: 'ibtn' + (o.ed.locked ? ' on' : ''), tabindex: '-1', tip: o.ed.locked ? 'Unlock' : 'Lock', onclick: (e) => { e.stopPropagation(); ed.actions.setLocked(o, !o.ed.locked); } }, icon(o.ed.locked ? 'lock' : 'lock-open')),
    h('button', { class: 'ibtn' + (o.visible ? '' : ' on'), tabindex: '-1', tip: [o.visible ? 'Hide' : 'Show', 'H'], onclick: (e) => { e.stopPropagation(); ed.actions.setVisible(o, !o.visible); } }, icon(o.visible ? 'eye' : 'eye-off')),
    );
    row._obj = o;
    return row;
  };
  if (q) {
    for (const o of d.treeOrder()) if (o.name.toLowerCase().includes(q)) rows.push(makeRow(o, 0, false));
    if (!rows.length) rows.push(h('p', { class: 'muted', style: { padding: '8px' } }, 'No objects match.'));
  } else {
    const walk = (list, depth) => { for (const o of list) { const kids = d.children(o); rows.push(makeRow(o, depth, kids.length > 0)); if (kids.length && !o.ed.collapsed) walk(kids, depth + 1); } };
    walk(d.roots(), 0);
  }
  const hadFocus = ed.layersEl.contains(document.activeElement);
  mount(ed.layersEl, rows);
  ed.layerRows = rows.filter((r) => r._obj);
  const act = ed.layersEl.querySelector('.layer.active') || ed.layersEl.querySelector('.layer.sel');
  act?.scrollIntoView({ block: 'nearest' });
  if (hadFocus) (act || ed.layerRows[0])?.focus({ preventScroll: true });
}
function clearDrop(ed) { for (const r of ed.layersEl.querySelectorAll('.drop-before,.drop-after,.drop-inside')) r.classList.remove('drop-before', 'drop-after', 'drop-inside'); }
function layerClick(ed, o, e) {
  const d = ed.doc;
  if (e.shiftKey && ed.layerAnchor && ed.layerRows) {
    const objs = ed.layerRows.map((r) => r._obj), a = objs.indexOf(ed.layerAnchor), b = objs.indexOf(o);
    if (a >= 0 && b >= 0) { d.setSelection(objs.slice(Math.min(a, b), Math.max(a, b) + 1), o); return; }
  }
  if (e.ctrlKey || e.metaKey) { d.select(o, 'toggle'); ed.layerAnchor = o; return; }
  d.select(o); ed.layerAnchor = o;
}
/** Keyboard navigation for the tree (↑ ↓ ← → Home End, Shift to extend, Enter/F2 rename, Space toggle). */
export function layersKey(ed, e) {
  const rows = ed.layerRows || []; if (!rows.length) return;
  const objs = rows.map((r) => r._obj), d = ed.doc, cur = d.selected, i = Math.max(0, objs.indexOf(cur));
  const go = (j) => { const o = objs[Math.max(0, Math.min(objs.length - 1, j))]; if (e.shiftKey) d.setSelection([...d.selection.filter((x) => x !== o), o], o); else { d.select(o); ed.layerAnchor = o; } };
  const k = e.key;
  let handled = true;
  if (k === 'ArrowDown') go(i + 1);
  else if (k === 'ArrowUp') go(i - 1);
  else if (k === 'Home') go(0);
  else if (k === 'End') go(objs.length - 1);
  else if (k === 'ArrowRight' && cur) { const kids = d.children(cur); if (kids.length && cur.ed.collapsed) { cur.ed.collapsed = false; renderLayers(ed); } else if (kids.length) d.select(kids[0]); }
  else if (k === 'ArrowLeft' && cur) { const kids = d.children(cur); if (kids.length && !cur.ed.collapsed) { cur.ed.collapsed = true; renderLayers(ed); } else if (d.parentOf(cur)) d.select(d.parentOf(cur)); }
  else if ((k === 'Enter' || k === 'F2') && cur) promptDialog('Rename', cur.name).then((n) => n && ed.actions.rename(cur, n));
  else if (k === ' ' && cur) d.select(cur, 'toggle');
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

export function objectMenu(ed, o, x, y) {
  const a = ed.actions, d = ed.doc, multi = d.selection.length > 1;
  const meshes = d.selection.filter(isMesh);
  menu([
    !multi && { label: 'Rename…', icon: 'pencil', key: 'F2', onClick: async () => { const n = await promptDialog('Rename', o.name); if (n) a.rename(o, n); } },
    { label: 'Duplicate', icon: 'copy', key: 'Ctrl+D', onClick: () => a.duplicate() },
    { label: 'Frame', icon: 'scan-search', key: 'F', onClick: () => ed.vp.frame() },
    { label: o.visible ? 'Hide' : 'Show', icon: o.visible ? 'eye-off' : 'eye', key: 'H', onClick: () => a.toggleVisible() },
    { label: o.ed.locked ? 'Unlock' : 'Lock', icon: 'lock', onClick: () => a.setLocked(null, !o.ed.locked) },
    'sep',
    { label: 'Group', icon: 'group', key: 'Ctrl+G', onClick: () => a.group() },
    isGroup(o) && { label: 'Ungroup', icon: 'ungroup', key: 'Ctrl+Shift+G', onClick: () => a.ungroup() },
    multi && { label: `Parent to “${d.selected.name}”`, icon: 'list-tree', key: 'Ctrl+P', onClick: () => a.setParent() },
    d.parentOf(o) && { label: 'Clear parent', icon: 'unlink', key: 'Alt+P', onClick: () => a.clearParent() },
    meshes.length > 1 && { label: 'Join into one mesh', icon: 'combine', key: 'Ctrl+J', onClick: () => a.join() },
    meshes.length > 1 && isMesh(d.selected) && { label: 'Boolean', icon: 'blend', items: [
      { label: 'Union (combine)', icon: 'merge', onClick: () => a.boolean('union') },
      { label: `Subtract from “${d.selected.name}”`, icon: 'scissors', onClick: () => a.boolean('subtract') },
      { label: 'Intersect (keep overlap)', icon: 'diff', onClick: () => a.boolean('intersect') }] },
    'sep',
    isMesh(o) && { label: 'Transform', icon: 'move-3d', items: [
      { label: 'Drop to floor', icon: 'arrow-down-to-line', onClick: () => a.dropToFloor() },
      { label: 'Apply all transforms', icon: 'stamp', onClick: () => a.applyTransform() },
      { label: 'Apply scale', onClick: () => a.applyTransform(null, 'scale') },
      { label: 'Apply rotation & scale', onClick: () => a.applyTransform(null, 'rs') },
      'sep',
      { label: 'Origin to centre', onClick: () => a.setOrigin(null, 'center') },
      { label: 'Origin to bottom', onClick: () => a.setOrigin(null, 'bottom') }] },
    isMesh(o) && (o.ed.prim || o.ed.text) && { label: 'Make editable mesh', icon: 'pen-line', onClick: () => a.makeEditable(o) },
    { label: 'Array…', icon: 'copy-plus', onClick: () => S.arrayDialog(ed) },
    { label: o.ed.noExport ? 'Include in export' : 'Exclude from export', icon: 'ban', onClick: () => a.setExport(null, o.ed.noExport) },
    { label: 'Export selection…', icon: 'share', onClick: () => S.exportDialog(ed, { onlySelected: true }) },
    'sep',
    !multi && { label: 'Move up', icon: 'arrow-up', onClick: () => a.move(o, -1) },
    !multi && { label: 'Move down', icon: 'arrow-down', onClick: () => a.move(o, 1) },
    'sep',
    { label: multi ? `Delete ${d.selection.length} objects` : 'Delete', icon: 'trash-2', key: 'Del', danger: true, onClick: () => a.remove() },
  ], x, y);
}

// =============================================================================== inspector
const TABS = [['tool', 'Tool', 'wrench'], ['object', 'Object', 'move-3d'], ['material', 'Material', 'palette'], ['mesh', 'Mesh', 'triangle'], ['scene', 'Scene', 'sun']];
export function renderInspector(ed) {
  if (ed.sheet) return;
  const m = ed.mode, o = ed.doc.selected;
  let tabs = TABS.filter(([id]) => id !== 'tool' || m !== 'object');
  if (!isMesh(o)) tabs = tabs.filter(([id]) => id !== 'material' && id !== 'mesh');
  if (!o) tabs = tabs.filter(([id]) => id === 'scene' || id === 'tool');
  const want = ed.inspectorTab, eff = tabs.find(([id]) => id === want) ? want : tabs[0][0];
  const n = ed.doc.selection.length;
  ed.rightTitle.textContent = n > 1 ? `${n} selected` : o ? o.name : 'Scene';
  mount(ed.rightTools, o ? ibtn('ellipsis', 'Object actions', (e) => { const r = e.currentTarget.getBoundingClientRect(); objectMenu(ed, o, r.left - 160, r.bottom + 4); }) : null);
  mount(ed.tabsEl, seg(tabs.map(([id, label]) => [id, label, null, label]), eff, (v) => { ed.inspectorTab = v; renderInspector(ed); }, '', 'Inspector'));
  ed.refreshTransformFields = null;
  const t = eff;
  const body = t === 'tool' ? toolPanel(ed) : t === 'object' ? objectPanel(ed, o) : t === 'material' ? materialPanel(ed, o) : t === 'mesh' ? meshPanel(ed, o) : scenePanel(ed);
  const scroll = ed.rightBody.scrollTop;
  const focusLabel = ed.rightBody.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
  mount(ed.rightBody, body);
  ed.rightBody.scrollTop = scroll;
  if (focusLabel) [...ed.rightBody.querySelectorAll('[aria-label]')].find((x) => x.getAttribute('aria-label') === focusLabel)?.focus({ preventScroll: true });
}

// ------------------------------------------------------------------------------- object
function selectionSection(ed) {
  const d = ed.doc, a = ed.actions, sel = d.selection, meshes = sel.filter(isMesh), base = d.selected;
  const out = [h('div', { class: 'summary' }, h('b', null, `${sel.length} objects`), h('div', { class: 'muted' }, `Active: ${base.name} (the last one you picked) – fields below edit the active object.`))];
  out.push(h('div', { class: 'chips', style: { marginTop: '10px' } },
    h('button', { class: 'chip', onclick: () => a.group() }, icon('group'), 'Group'),
    meshes.length > 1 && h('button', { class: 'chip', onclick: () => a.join() }, icon('combine'), 'Join'),
    h('button', { class: 'chip', onclick: () => a.duplicate() }, icon('copy'), 'Duplicate'),
    h('button', { class: 'chip', onclick: () => a.setParent() }, icon('list-tree'), 'Parent to active'),
    isMesh(base) && meshes.length > 1 && h('button', { class: 'chip', onclick: () => a.linkMaterial(base.material) }, icon('link-2'), 'Share material'),
    h('button', { class: 'chip danger', onclick: () => a.remove() }, icon('trash-2'), 'Delete')));
  if (isMesh(base) && meshes.length > 1) out.push(section('Boolean'), h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    btn('Union', () => a.boolean('union'), 'ghost', 'merge', 'Combine into one solid'), btn('Subtract', () => a.boolean('subtract'), 'ghost', 'scissors', `Cut the others out of “${base.name}”`), btn('Intersect', () => a.boolean('intersect'), 'ghost', 'diff', 'Keep only the overlap')),
  h('p', { class: 'muted' }, `The active object (${base.name}) is kept; the others are used as cutters and removed.`));
  out.push(section('Align'), h('div', { class: 'aligngrid' }, ['x', 'y', 'z'].flatMap((ax) => [h('span', { class: 'ax', style: { color: `var(--${ax})` } }, ax.toUpperCase()), ...[['min', 'Min'], ['center', 'Centre'], ['max', 'Max']].map(([w, l]) => h('button', { class: 'chip', 'aria-label': `Align ${ax.toUpperCase()} ${l}`, onclick: () => a.align(ax, w) }, l)), h('button', { class: 'chip', 'aria-label': `Distribute along ${ax.toUpperCase()}`, tip: 'Distribute evenly', onclick: () => a.distribute(ax) }, icon(ax === 'y' ? 'align-vertical-distribute-center' : 'align-horizontal-distribute-center'))])));
  return out;
}
function objectPanel(ed, o) {
  if (!o) return h('p', { class: 'muted' }, 'Select an object.');
  const d = ed.doc, a = ed.actions, u = d.units, k = unitK(u), us = UNITS[u].short;
  const out = [];
  if (d.selection.length > 1) out.push(...selectionSection(ed), section('Active object'));
  // name
  const nameIn = h('input', { class: 'field', value: o.name, 'aria-label': 'Object name', onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = o.name; e.target.blur(); } } });
  nameIn.addEventListener('change', () => { const v = nameIn.value.trim(); if (v) a.rename(o, v); else nameIn.value = o.name; });
  out.push(h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'kindchip' }, icon(kindIcon(o)), KIND_LABEL[o.ed.kind]), nameIn));
  const step = u === 'm' ? 0.01 : u === 'cm' ? 1 : u === 'mm' ? 1 : 0.1;
  const pos = vec3Field(o.position.toArray().map((x) => x * k), (v) => { o.position.fromArray(v.map((x) => x / k)); d.touch(); }, null, step);
  const rot = vec3Field([o.rotation.x, o.rotation.y, o.rotation.z].map((r) => D.radToDeg(r)), (v) => { o.rotation.set(...v.map(D.degToRad)); d.touch(); }, null, 1);
  const scl = vec3Field(o.scale.toArray(), (v) => { if (ed.uniformScale) { const kk = v.find((x, i) => Math.abs(x - o.scale.getComponent(i)) > 1e-9); if (kk != null) { const i = v.indexOf(kk), r = kk / (o.scale.getComponent(i) || 1); o.scale.multiplyScalar(r); scl.set(o.scale.toArray()); d.touch(); return; } } o.scale.fromArray(v); d.touch(); }, null, 0.01);
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
  ed.refreshTransformFields = () => { pos.set(o.position.toArray().map((x) => x * k)); rot.set([o.rotation.x, o.rotation.y, o.rotation.z].map((r) => D.radToDeg(r))); scl.set(o.scale.toArray()); };
  out.push(section('Transform'),
    h('div', { class: 'label', style: { marginBottom: '4px' } }, `Position (${us})${d.parentOf(o) ? ' – relative to ' + d.parentOf(o).name : ''}`), pos,
    h('div', { class: 'label', style: { margin: '10px 0 4px' } }, 'Rotation (°)'), rot,
    h('div', { class: 'row', style: { margin: '10px 0 4px' } }, h('span', { class: 'label grow' }, 'Scale'), h('button', { class: 'chip' + (ed.uniformScale ? ' active' : ''), 'aria-pressed': String(!!ed.uniformScale), onclick: () => { ed.uniformScale = !ed.uniformScale; renderInspector(ed); } }, icon('link'), 'Uniform')), scl);
  if (isMesh(o)) {
    o.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3());
    const dims = vec3Field(size.toArray().map((x) => x * k), null, (v) => {
      v = v.map((x) => x / k);
      d.transact('Set size', () => { // scale along the local axis closest to each world axis
        const cur = new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3());
        for (let i = 0; i < 3; i++) if (Math.abs(v[i] - cur.getComponent(i)) > 1e-6 && cur.getComponent(i) > 1e-9) {
          const axis = new THREE.Vector3().setComponent(i, 1), local = axis.clone().applyQuaternion(o.quaternion.clone().invert());
          const li = [0, 1, 2].reduce((b, j) => (Math.abs(local.getComponent(j)) > Math.abs(local.getComponent(b)) ? j : b), 0);
          o.scale.setComponent(li, o.scale.getComponent(li) * v[i] / cur.getComponent(i));
        }
      }, [o]);
    }, step);
    out.push(h('div', { class: 'label', style: { margin: '10px 0 4px' } }, `Dimensions (${us})`), dims);
  }
  out.push(h('div', { class: 'chips', style: { marginTop: '12px' } },
    (isMesh(o) || d.children(o).length > 0) && h('button', { class: 'chip', onclick: () => a.dropToFloor() }, icon('arrow-down-to-line'), 'Drop to floor'),
    h('button', { class: 'chip', onclick: () => a.resetTransform() }, icon('rotate-ccw'), 'Reset'),
    h('button', { class: 'chip', onclick: (e) => menu([['x', 'X'], ['y', 'Y'], ['z', 'Z']].map(([ax, l]) => ({ label: 'Mirror ' + l, onClick: () => a.mirror(null, ax) })), 0, 0, e.currentTarget) }, icon('flip-horizontal-2'), 'Mirror'),
    isMesh(o) && h('button', { class: 'chip', onclick: (e) => menu([{ label: 'Origin to centre', onClick: () => a.setOrigin(null, 'center') }, { label: 'Origin to bottom', onClick: () => a.setOrigin(null, 'bottom') }, { label: 'Origin to view centre', onClick: () => a.setOrigin(null, 'cursor') }, 'sep', { label: 'Apply all transforms', onClick: () => a.applyTransform() }, { label: 'Apply scale', onClick: () => a.applyTransform(null, 'scale') }, { label: 'Apply rotation & scale', onClick: () => a.applyTransform(null, 'rs') }], 0, 0, e.currentTarget) }, icon('crosshair'), 'Origin'),
  ));
  // hierarchy
  const parents = d.objects.filter((x) => x !== o && !d.isAncestor(o, x));
  out.push(section('Hierarchy'), h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Parent'),
    select([['', '— None (scene root) —'], ...parents.map((x) => [String(x.ed.id), '  '.repeat(d.depth(x)) + x.name])], d.parentOf(o) ? String(d.parentOf(o).ed.id) : '', (v) => { const p = d.objects.find((x) => String(x.ed.id) === v) || null; if (p) a.dropOn([o], p, 'inside'); else a.clearParent([o]); }, 'Parent object')));
  if (isGroup(o)) out.push(h('p', { class: 'muted' }, d.children(o).length ? `${d.children(o).length} children. Moving the group moves them all. Exports as a Node3D (Godot) / Empty (Blender).` : 'An empty: a named point you can parent things to or use as a spawn point / marker in a game engine.'),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } }, d.children(o).length ? btn('Select children', () => a.selectChildren(), 'ghost', 'list-tree') : null, d.children(o).length ? btn('Ungroup', () => a.ungroup([o]), 'ghost', 'ungroup') : null));
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
  if (isCamera(o)) out.push(...cameraSection(ed, o));
  out.push(...exportSection(ed, o));
  if (ed.mode === 'animate') out.push(...animateSection(ed, o));
  return out;
}

function cameraSection(ed, o) {
  const c = o.ed.camera, d = ed.doc, out = [section('Camera')];
  const lens = (fov) => 12 / Math.tan(D.degToRad(fov) / 2); // 35 mm full frame (24 mm high)
  out.push(slider({ label: 'Field of view', min: 5, max: 120, step: 0.5, unit: '°', value: c.fov, ...live(ed, 'Field of view', [o], (v) => { c.fov = v; c.updateProjectionMatrix(); }) }));
  out.push(h('p', { class: 'muted' }, `≈ ${Math.round(lens(c.fov))} mm lens (full frame)`));
  out.push(h('div', { class: 'label', style: { margin: '8px 0 6px' } }, 'Aspect ratio'), seg([[16 / 9, '16:9'], [4 / 3, '4:3'], [1, '1:1'], [9 / 16, '9:16'], [21 / 9, '21:9']], [16 / 9, 4 / 3, 1, 9 / 16, 21 / 9].find((x) => Math.abs(x - c.aspect) < 0.01) ?? null, (v) => d.transact('Aspect ratio', () => { c.aspect = v; c.updateProjectionMatrix(); }, [o])));
  out.push(slider({ label: 'Clip start', min: 0.001, max: 10, step: 0.001, unit: ' m', value: c.near, ...live(ed, 'Clip start', [o], (v) => { c.near = v; c.updateProjectionMatrix(); }) }));
  out.push(slider({ label: 'Clip end', min: 1, max: 5000, step: 1, unit: ' m', value: c.far, ...live(ed, 'Clip end', [o], (v) => { c.far = v; c.updateProjectionMatrix(); }) }));
  out.push(h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } }, btn('Look through', () => ed.vp.lookThrough(o), 'tinted', 'eye', ['Look through camera', 'Numpad 0']), btn('Align to view', () => ed.actions.alignCameraToView(o), 'ghost', 'scan', 'Move this camera to the current view')));
  out.push(h('p', { class: 'muted' }, 'Exports as a glTF camera – a Camera3D in Godot, a Camera in Blender.'));
  return out;
}

function exportSection(ed, o) {
  const a = ed.actions, out = [section('Export & game engine')];
  out.push(toggle('Include in export', !o.ed.noExport, (v) => a.setExport(o, v), o.ed.noExport ? 'Kept in the project only (references, helpers)' : 'Exported with its children'));
  if (isMesh(o)) out.push(h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'label grow' }, 'Collision (Godot)'), select(COLLISION_TYPES.map(([id, l]) => [id, l]), o.ed.collision || 'none', (v) => a.setCollision(o, v), 'Collision type')),
    h('p', { class: 'muted' }, (COLLISION_TYPES.find((c) => c[0] === o.ed.collision) || COLLISION_TYPES[0])[2] + '. Added as a Godot import hint when the Godot preset is used.'));
  // custom properties → glTF extras (Blender custom properties, Godot metadata)
  const props = o.ed.props.map((x) => [...x]);
  const list = h('div', { class: 'col', style: { gap: '6px' } });
  const save = () => a.setProps(o, props.filter(([k]) => k.trim()));
  const renderProps = () => mount(list, props.map((p, i) => h('div', { class: 'proprow' },
    h('input', { class: 'field', value: p[0], placeholder: 'key', 'aria-label': `Property ${i + 1} name`, onchange: (e) => { p[0] = e.target.value.trim(); save(); } }),
    h('input', { class: 'field', value: p[1], placeholder: 'value', 'aria-label': `Property ${i + 1} value`, onchange: (e) => { p[1] = e.target.value; save(); } }),
    ibtn('x', 'Remove property', () => { props.splice(i, 1); save(); }))));
  renderProps();
  out.push(h('div', { class: 'row', style: { margin: '12px 0 6px' } }, h('span', { class: 'label grow' }, 'Custom properties'), btn('Add', () => { props.push(['', '']); renderProps(); list.querySelector('.proprow:last-child input')?.focus(); }, 'ghost', 'plus')), list,
    h('p', { class: 'muted' }, 'Saved as glTF “extras”: custom properties in Blender, node metadata in Godot 4.4+, userData in three.js. Numbers and true/false keep their type.'));
  return out;
}

function lightSection(ed, o) {
  const l = o.ed.light, d = ed.doc;
  const out = [section('Light')];
  out.push(seg([['point', 'Point', 'lightbulb'], ['spot', 'Spot', 'flashlight'], ['directional', 'Sun', 'sun']], o.ed.lightType, (t) => {
    // swap the light type, keeping colour/intensity
    import('./model.js').then(({ makeLight, copyKeys }) => {
      const n = makeLight(t, o.name); n.position.copy(o.position); n.quaternion.copy(o.quaternion); n.ed.parent = o.ed.parent;
      n.ed.light.color.copy(l.color); n.ed.light.intensity = t === 'directional' ? Math.min(l.intensity, 5) : l.intensity; n.ed.keys = copyKeys(o.ed.keys);
      const kids = d.children(o);
      d.transact('Light type', () => { const i = d.objects.indexOf(o); for (const c of kids) c.ed.parent = n; d.detach(o); d.attach(n, i); d.select(n); }, kids);
    });
  }));
  out.push(h('div', { class: 'row', style: { marginTop: '12px' } }, h('span', { class: 'label grow' }, 'Colour'),
    ...['#ffffff', '#ffd8a8', '#ffb86b', '#a5d8ff', '#b197fc', '#ff8787'].map((c) => h('button', { class: 'swatch', style: { width: '22px', height: '22px', background: c }, 'aria-label': 'Light colour ' + c, onclick: () => d.transact('Light colour', () => l.color.set(c), [o]) })),
    (() => { const L = live(ed, 'Light colour', [o], (v) => l.color.set(v)); return colorSwatch('#' + l.color.getHexString(), L.onInput, L.onCommit, 'Custom light colour'); })()));
  const L = live(ed, 'Light intensity', [o], (v) => { l.intensity = v; });
  out.push(slider({ label: o.ed.lightType === 'directional' ? 'Strength (lux)' : 'Power (cd)', min: 0, max: o.ed.lightType === 'directional' ? 10 : 50, step: 0.1, value: l.intensity, ...L }));
  if (o.ed.lightType !== 'directional') out.push(slider({ label: 'Range (0 = infinite)', min: 0, max: 50, step: 0.1, value: l.distance, unit: ' m', ...live(ed, 'Light range', [o], (v) => { l.distance = v; }) }));
  if (o.ed.lightType === 'spot') {
    out.push(slider({ label: 'Cone angle', min: 1, max: 89, step: 1, value: D.radToDeg(l.angle), unit: '°', ...live(ed, 'Cone angle', [o], (v) => { l.angle = D.degToRad(v); }) }));
    out.push(slider({ label: 'Softness', min: 0, max: 1, step: 0.01, value: l.penumbra, ...live(ed, 'Cone softness', [o], (v) => { l.penumbra = v; }) }));
  }
  out.push(toggle('Cast shadows', l.castShadow, (v) => d.transact('Light shadows', () => { l.castShadow = v; }, [o])));
  if (o.ed.lightType !== 'point') out.push(btn('Aim at the models', () => { const box = new THREE.Box3(); for (const m of d.meshes) if (d.isShown(m)) box.expandByObject(m); if (!box.isEmpty()) d.transact('Aim light', () => o.lookAt(box.getCenter(new THREE.Vector3())), [o]); }, 'ghost', 'crosshair'));
  out.push(h('p', { class: 'muted' }, 'Lights export to GLB/glTF (KHR_lights_punctual): OmniLight3D / SpotLight3D / DirectionalLight3D in Godot, lights in Blender.'));
  return out;
}

function animateSection(ed, o) {
  const d = ed.doc;
  const out = [section('Animation presets')];
  out.push(h('div', { class: 'tile-grid' }, ANIM_PRESETS.map((p) => h('button', { class: 'tile', tip: p.desc, onclick: () => { d.transact('Animation: ' + p.label, () => applyPreset(d, o, p.id), [o]); ed.togglePlay(true); } }, icon(p.icon), p.label))));
  const keys = [...o.ed.keys.keys()].sort((a, b) => a - b);
  out.push(section(`Keyframes (${keys.length})`));
  if (!keys.length) out.push(h('p', { class: 'muted' }, 'Move to a frame on the timeline, then move/rotate/scale the object. With Auto-key on, a keyframe is recorded automatically. Press K to key manually.'));
  else {
    out.push(h('div', { class: 'chips' }, keys.map((f) => h('button', { class: 'chip' + (f === d.frame ? ' active' : ''), onclick: () => ed.setFrame(f) }, icon('diamond'), `${f}`))));
    const k = o.ed.keys.get(d.frame);
    if (k) out.push(h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'label grow' }, `Easing from frame ${d.frame}`), select(EASINGS, k.i || 'linear', (v) => d.transact('Key easing', () => { const kk = o.ed.keys.get(d.frame); if (v === 'linear') delete kk.i; else kk.i = v; }, [o]), 'Key easing')));
    else out.push(h('p', { class: 'muted' }, 'Go to a keyframe to change its easing (or right-click a key on the timeline).'));
  }
  out.push(section('Clips'), h('p', { class: 'muted' }, d.clips.length ? d.clips.map((c) => `${c.name} (${c.start}–${c.end})`).join(' · ') : 'One animation for the whole timeline. Split it into named clips (Idle, Walk…) for game engines.'), btn('Animation clips…', () => S.clipsDialog(ed), 'ghost', 'film'));
  return out;
}

// ------------------------------------------------------------------------------- material
export const MAT_PRESETS = [
  { id: 'plastic', label: 'Plastic', r: 0.35, m: 0 }, { id: 'matte', label: 'Matte', r: 0.9, m: 0 }, { id: 'gloss', label: 'Glossy', r: 0.08, m: 0 },
  { id: 'metal', label: 'Metal', r: 0.3, m: 1, c: 0xc9cdd2 }, { id: 'chrome', label: 'Chrome', r: 0.04, m: 1, c: 0xf2f4f7 }, { id: 'gold', label: 'Gold', r: 0.22, m: 1, c: 0xffc34d },
  { id: 'copper', label: 'Copper', r: 0.28, m: 1, c: 0xd9825b }, { id: 'rubber', label: 'Rubber', r: 0.95, m: 0, c: 0x2b2b30 }, { id: 'ceramic', label: 'Ceramic', r: 0.15, m: 0, c: 0xf5f3ef, cc: 0.6 },
  { id: 'glass', label: 'Glass', r: 0.03, m: 0, c: 0xffffff, t: 1, ior: 1.5, th: 0.1 }, { id: 'frosted', label: 'Frosted', r: 0.4, m: 0, c: 0xf4f8ff, t: 1, ior: 1.5, th: 0.2 }, { id: 'carpaint', label: 'Car paint', r: 0.45, m: 0.5, c: 0xc0182c, cc: 1, ccr: 0.05 },
  { id: 'velvet', label: 'Velvet', r: 0.8, m: 0, c: 0x5b2a86, sh: 1, shc: 0xd6b4ff }, { id: 'pearl', label: 'Pearl', r: 0.25, m: 0, c: 0xf6f0ea, ir: 1, cc: 0.5 }, { id: 'glow', label: 'Glow', r: 0.5, m: 0, e: 3 }, { id: 'clay', label: 'Clay', r: 0.75, m: 0, c: 0xc98f6b },
];
function presetPreview(p) {
  const c = document.createElement('canvas'); c.width = c.height = 40;
  const ctx = c.getContext('2d'), col = hex(p.c ?? 0x9aa0ff);
  const g = ctx.createRadialGradient(14, 12, 1, 20, 20, 20);
  g.addColorStop(0, p.e ? '#ffffff' : `rgba(255,255,255,${0.9 - p.r * 0.7})`); g.addColorStop(0.35, p.t ? '#cfe6ff' : col); g.addColorStop(1, p.m ? '#111' : shade(col));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(20, 20, 18, 0, Math.PI * 2); ctx.fill();
  if (p.t) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill(); }
  if (p.ir) { ctx.globalCompositeOperation = 'source-atop'; const g2 = ctx.createLinearGradient(0, 0, 40, 40); g2.addColorStop(0, 'rgba(255,150,220,0.35)'); g2.addColorStop(0.5, 'rgba(150,255,230,0.3)'); g2.addColorStop(1, 'rgba(160,170,255,0.35)'); ctx.fillStyle = g2; ctx.fillRect(0, 0, 40, 40); }
  c.style.width = c.style.height = '30px';
  return c;
}
function shade(c) { const n = parseInt(c.slice(1), 16); return `rgb(${(n >> 16 & 255) * 0.35},${(n >> 8 & 255) * 0.35},${(n & 255) * 0.35})`; }
function applyMatPreset(mm, p) {
  mm.roughness = p.r; mm.metalness = p.m; if (p.c != null) mm.color.setHex(p.c);
  mm.opacity = 1; mm.transparent = false; mm.depthWrite = true;
  mm.transmission = p.t || 0; mm.ior = p.ior || 1.5; mm.thickness = p.th || 0;
  mm.clearcoat = p.cc || 0; mm.clearcoatRoughness = p.ccr ?? 0.1;
  mm.sheen = p.sh || 0; if (p.shc != null) mm.sheenColor.setHex(p.shc); mm.sheenRoughness = 0.6;
  mm.iridescence = p.ir || 0;
  mm.emissive.set(p.e ? mm.color : 0x000000); mm.emissiveIntensity = p.e || 1;
  mm.needsUpdate = true;
}

/** Texture slots beyond the base colour (normal, roughness, metallic, occlusion, emission). */
const MAP_SLOTS = [['normalMap', 'Normal', false, 'Surface detail (OpenGL / glTF convention: green = up)'], ['roughnessMap', 'Roughness', false, 'White = rough, black = shiny'], ['metalnessMap', 'Metallic', false, 'White = metal'], ['aoMap', 'Ambient occlusion', false, 'Baked contact shadows'], ['emissiveMap', 'Emission', true, 'Glowing areas (uses the glow colour)']];

function materialPanel(ed, o) {
  if (!isMesh(o)) return h('p', { class: 'muted' }, 'Select a mesh.');
  const m = o.material, d = ed.doc, a = ed.actions, u = m.userData;
  const out = [];
  // which material (shared materials export as one glTF material)
  const mats = d.materials(), users = mats.get(m)?.length || 1;
  const matList = [...mats.keys()];
  out.push(h('div', { class: 'row' }, h('span', { class: 'swatch', style: { width: '26px', height: '26px', background: '#' + m.color.getHexString() } }),
    select(matList.map((x, i) => [String(i), `${x.name || 'Material'}${mats.get(x).length > 1 ? ` (${mats.get(x).length} users)` : ''}`]), String(matList.indexOf(m)), (v) => a.linkMaterial(matList[+v], [o]), 'Material'),
    ibtn('pencil', 'Rename material', async () => { const n = await promptDialog('Material name', m.name); if (n) a.material('Rename material', (mm) => { mm.name = n; }, o); }),
    users > 1 ? ibtn('copy-plus', 'Make unique (stop sharing)', () => a.makeUnique(o)) : null));
  if (users > 1) out.push(h('p', { class: 'muted' }, `Shared by ${users} objects – changes apply to all of them, and it exports as one material.`));
  out.push(section('Look'), h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(4, 1fr)' } }, MAT_PRESETS.map((p) => h('button', { class: 'tile', style: { height: '62px' }, onclick: () => a.material('Material: ' + p.label, (mm) => applyMatPreset(mm, p), o) }, presetPreview(p), p.label))));
  out.push(section('Material library'), h('div', { class: 'libgrid', role: 'list', 'aria-label': 'PBR material library' }, libraryList().map((L) => h('button', { class: 'libsw' + (u.maps?.lib === L.id ? ' ring' : ''), role: 'listitem', tip: L.label, 'aria-label': 'Apply ' + L.label, onclick: async () => {
    const set = await textureSet(L.id); o.geometry.computeBoundingBox(); const sz = o.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(o.getWorldScale(new THREE.Vector3()));
    const span = Math.max(0.05, Math.max(sz.x, sz.y, sz.z));
    a.material('Material: ' + L.label, (mm) => applyLibrary(mm, L.id, set, span), o); renderInspector(ed);
  } }, h('img', { src: `materials/${L.id}_c.webp`, alt: '', loading: 'lazy', onerror: (e) => { e.target.style.display = 'none'; } })))));
  out.push(section('Base colour'), h('div', { class: 'swatches' },
    PALETTE.map((c) => h('button', { class: 'swatch' + (m.color.getHex() === c ? ' ring' : ''), style: { background: hex(c) }, 'aria-label': 'Colour ' + hex(c), onclick: () => a.material('Colour', (mm) => mm.color.setHex(c), o) })),
    (() => { const L = live(ed, 'Colour', [o], (v) => m.color.set(v)); return colorSwatch('#' + m.color.getHexString(), L.onInput, L.onCommit, 'Custom colour'); })()));
  if (m.map) out.push(h('p', { class: 'muted' }, 'Colour tints the texture. Pick white to show the texture as-is.'));
  out.push(slider({ label: 'Roughness', min: 0, max: 1, step: 0.01, value: m.roughness, ...live(ed, 'Roughness', [o], (v) => { m.roughness = v; }) }));
  out.push(slider({ label: 'Metallic', min: 0, max: 1, step: 0.01, value: m.metalness, ...live(ed, 'Metallic', [o], (v) => { m.metalness = v; }) }));
  out.push(slider({ label: 'Opacity', min: 0.02, max: 1, step: 0.01, value: m.opacity, ...live(ed, 'Opacity', [o], (v) => { const t = v < 0.999; if (m.transparent !== t) { m.transparent = t; m.depthWrite = !t; m.needsUpdate = true; } m.opacity = v; }) }));
  out.push(section('Glow'), h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Emission colour'), (() => { const L = live(ed, 'Glow colour', [o], (v) => { m.emissive.set(v); if (m.emissiveIntensity === 0) m.emissiveIntensity = 1; }); return colorSwatch('#' + m.emissive.getHexString(), L.onInput, L.onCommit, 'Emission colour'); })()));
  out.push(slider({ label: 'Glow strength', min: 0, max: 20, step: 0.05, value: m.emissive.getHex() ? m.emissiveIntensity : 0, ...live(ed, 'Glow', [o], (v) => { if (!m.emissive.getHex() && v > 0) m.emissive.copy(m.color); m.emissiveIntensity = v; if (v === 0) m.emissive.set(0); }) }));
  out.push(toggle('Double-sided', m.side === THREE.DoubleSide, (v) => a.material('Double-sided', (mm) => { mm.side = v ? THREE.DoubleSide : THREE.FrontSide; mm.needsUpdate = true; }, o), 'Show back faces (planes, leaves, cloth)'));
  if (o.geometry.attributes.color) out.push(toggle('Show vertex paint', !!m.vertexColors, (v) => a.material('Vertex paint', (mm) => { mm.vertexColors = v; mm.needsUpdate = true; }, o)));

  // advanced physically based layers
  const adv = h('details', { class: 'adv', open: ed.matAdvOpen || m.clearcoat > 0 || m.transmission > 0 || m.sheen > 0 || m.iridescence > 0 || undefined, ontoggle: (e) => { ed.matAdvOpen = e.target.open; } },
    h('summary', null, 'Advanced surface', h('span', { class: 'muted' }, ' – clearcoat, glass, sheen, iridescence')),
    h('div', { class: 'label', style: { margin: '10px 0 2px' } }, 'Clearcoat (car paint, varnish)'),
    slider({ label: 'Clearcoat', min: 0, max: 1, step: 0.01, value: m.clearcoat, ...live(ed, 'Clearcoat', [o], (v) => { m.clearcoat = v; }) }),
    slider({ label: 'Clearcoat roughness', min: 0, max: 1, step: 0.01, value: m.clearcoatRoughness, ...live(ed, 'Clearcoat roughness', [o], (v) => { m.clearcoatRoughness = v; }) }),
    h('div', { class: 'label', style: { margin: '10px 0 2px' } }, 'Transmission (real glass, water)'),
    slider({ label: 'Transmission', min: 0, max: 1, step: 0.01, value: m.transmission, ...live(ed, 'Transmission', [o], (v) => { m.transmission = v; }) }),
    slider({ label: 'Index of refraction', min: 1, max: 2.333, step: 0.001, value: m.ior, ...live(ed, 'IOR', [o], (v) => { m.ior = v; }) }),
    slider({ label: 'Thickness', min: 0, max: 2, step: 0.005, unit: ' m', value: m.thickness, ...live(ed, 'Thickness', [o], (v) => { m.thickness = v; }) }),
    h('div', { class: 'label', style: { margin: '10px 0 2px' } }, 'Sheen (fabric, velvet)'),
    slider({ label: 'Sheen', min: 0, max: 1, step: 0.01, value: m.sheen, ...live(ed, 'Sheen', [o], (v) => { m.sheen = v; }) }),
    h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Sheen colour'), (() => { const L = live(ed, 'Sheen colour', [o], (v) => { m.sheenColor.set(v); }); return colorSwatch('#' + m.sheenColor.getHexString(), L.onInput, L.onCommit, 'Sheen colour'); })()),
    slider({ label: 'Specular', min: 0, max: 1, step: 0.01, value: m.specularIntensity, ...live(ed, 'Specular', [o], (v) => { m.specularIntensity = v; }) }),
    slider({ label: 'Iridescence (soap bubble)', min: 0, max: 1, step: 0.01, value: m.iridescence, ...live(ed, 'Iridescence', [o], (v) => { m.iridescence = v; }) }),
    h('p', { class: 'muted' }, 'Exported as glTF extensions (KHR_materials_clearcoat, transmission, ior, sheen, specular, iridescence). Blender reads them all; game engines support some.'));
  out.push(adv);

  // base colour texture
  out.push(section('Base colour texture'));
  const maps = u.maps || {};
  if (m.map) {
    const thumb = h('canvas', { class: 'thumb-img', width: 92, height: 92, 'aria-hidden': 'true' });
    try { const img = m.map.image; const ctx = thumb.getContext('2d'); ctx.drawImage(img, 0, 0, 92, 92); } catch { /* ignore */ }
    out.push(h('div', { class: 'texrow' }, thumb, h('div', { class: 't' }, h('b', null, maps.kind === 'pattern' ? (maps.spec?.pattern || 'Pattern').toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace('_', ' ') : maps.name || m.map.name || 'Texture'), h('span', null, `${m.map.image?.width || '?'}×${m.map.image?.height || '?'} px`)),
      ibtn('replace', 'Change texture', () => S.textureLibrary(ed)), ibtn('x', 'Remove texture', () => a.material('Remove texture', (mm) => { clearMaps(mm); }, o))));
    if (maps.kind === 'pattern') {
      const sp = maps.spec;
      out.push(h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Pattern colours'),
        colorSwatch(hex(sp.colorA), null, (v) => a.material('Pattern colour', (mm) => applyPattern(mm, { ...sp, colorA: parseInt(v.slice(1), 16) }, maps.size || 1024), o), 'Pattern colour 1'),
        colorSwatch(hex(sp.colorB), null, (v) => a.material('Pattern colour', (mm) => applyPattern(mm, { ...sp, colorB: parseInt(v.slice(1), 16) }, maps.size || 1024), o), 'Pattern colour 2')));
      out.push(slider({ label: 'Pattern detail', min: 1, max: 32, step: 1, int: true, value: sp.scale, onCommit: (v) => a.material('Pattern scale', (mm) => applyPattern(mm, { ...sp, scale: v }, maps.size || 1024), o) }));
      out.push(slider({ label: 'Variation', min: 1, max: 99, step: 1, int: true, value: sp.seed, onCommit: (v) => a.material('Pattern variation', (mm) => applyPattern(mm, { ...sp, seed: v }, maps.size || 1024), o) }));
    }
  } else {
    out.push(h('p', { class: 'muted' }, 'Wrap the whole object in a pattern or a photo. To texture just part of it, use Faces mode to select an area first.'));
  }
  out.push(h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } },
    btn(m.map ? 'Library' : 'Add texture', () => S.textureLibrary(ed), 'tinted', 'image'),
    btn('Image…', () => S.pickPhoto(ed, o), 'ghost', 'image-plus'),
    btn('Sticker…', () => S.stickerDialog(ed), 'ghost', 'sticker')));
  // other PBR maps
  out.push(section('Texture maps'));
  for (const [slot, label, srgb, desc] of MAP_SLOTS) {
    const t = m[slot];
    const thumb = h('canvas', { class: 'thumb-img sm', width: 40, height: 40, 'aria-hidden': 'true' });
    if (t?.image) try { thumb.getContext('2d').drawImage(t.image, 0, 0, 40, 40); } catch { /* ignore */ }
    out.push(h('div', { class: 'texrow' }, thumb, h('div', { class: 't' }, h('b', null, label), h('span', null, t ? `${t.name || 'Image'} · ${t.image?.width}×${t.image?.height}` : desc)),
      ibtn('folder-open', `Load ${label.toLowerCase()} map`, async () => {
        const f = await platform.files.open({ filters: IMAGE_FILTERS }); if (!f?.length) return;
        const tx = await imageTexture(f[0].data, f[0].name, srgb);
        a.material(label + ' map', (mm) => { mm[slot] = tx; if (slot === 'emissiveMap' && !mm.emissive.getHex()) { mm.emissive.set(0xffffff); mm.emissiveIntensity = 1; } if (slot === 'metalnessMap' && mm.metalness === 0) mm.metalness = 1; syncTextures(mm); mm.needsUpdate = true; }, o);
        if (!o.geometry.attributes.uv) a.projectUvs(o, 'BOX');
      }),
      t ? ibtn('x', `Remove ${label.toLowerCase()} map`, () => a.material('Remove ' + label.toLowerCase() + ' map', (mm) => { mm[slot] = null; mm.needsUpdate = true; }, o)) : null));
    if (slot === 'normalMap') {
      if (t) out.push(slider({ label: 'Bump strength', min: 0, max: 3, step: 0.01, value: m.normalScale.x, ...live(ed, 'Bump', [o], (v) => { m.normalScale.set(v, v); }) }));
      else if (m.map) out.push(btn('Generate bump from colour', () => a.material('Bump map', (mm) => bumpFromColor(mm, 2), o), 'ghost', 'mountain'));
    }
    if (slot === 'aoMap' && t) out.push(slider({ label: 'Occlusion strength', min: 0, max: 1, step: 0.01, value: m.aoMapIntensity, ...live(ed, 'Occlusion', [o], (v) => { m.aoMapIntensity = v; }) }));
  }
  if (m.map || TEX_ANY(m)) {
    out.push(section('Tiling'));
    const lockK = ed.tileLock !== false;
    const tile = (axis) => live(ed, 'Tiling', [o], (v) => { if (lockK) u.tiling = [v, v]; else u.tiling[axis] = v; syncTextures(m); });
    out.push(h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'label grow' }, 'Repeat'), h('button', { class: 'chip' + (lockK ? ' active' : ''), 'aria-pressed': String(lockK), onclick: () => { ed.tileLock = !lockK; renderInspector(ed); } }, icon('link'), 'Linked')));
    out.push(slider({ label: lockK ? 'Repeat' : 'Repeat U', min: 0.1, max: 32, step: 0.05, value: u.tiling[0], ...tile(0) }));
    if (!lockK) out.push(slider({ label: 'Repeat V', min: 0.1, max: 32, step: 0.05, value: u.tiling[1], ...tile(1) }));
    out.push(slider({ label: 'Offset U', min: -1, max: 1, step: 0.005, value: u.offset[0], ...live(ed, 'Texture offset', [o], (v) => { u.offset = [v, u.offset[1]]; syncTextures(m); }) }));
    out.push(slider({ label: 'Offset V', min: -1, max: 1, step: 0.005, value: u.offset[1], ...live(ed, 'Texture offset', [o], (v) => { u.offset = [u.offset[0], v]; syncTextures(m); }) }));
    out.push(slider({ label: 'Rotation', min: -180, max: 180, step: 1, unit: '°', value: D.radToDeg(u.rotation), ...live(ed, 'Texture rotation', [o], (v) => { u.rotation = D.degToRad(v); syncTextures(m); }) }));
    out.push(toggle('Pixel-art (sharp pixels)', !!u.pixel, (v) => a.material('Pixel filter', (mm) => { mm.userData.pixel = v; syncTextures(mm); }, o)));
  }
  if (o.geometry.attributes.uv) out.push(h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'label grow' }, 'UV projection'), select([['', 'Keep'], ['SMART', 'Smart unwrap (painting, baking)'], ...UV_MODES], '', (v) => { if (v === 'SMART') ed.unwrapForPainting(o); else if (v) a.projectUvs(o, v); }, 'UV projection')));
  else out.push(btn('Generate UVs (box)', () => a.projectUvs(o, 'BOX'), 'ghost', 'grid-3x3'));
  out.push(section('Share'), h('div', { class: 'row', style: { flexWrap: 'wrap' } },
    d.selection.filter(isMesh).length > 1 ? btn('Use on selection', () => a.linkMaterial(m), 'tinted', 'link-2', 'All selected objects share this material') : null,
    btn('Copy to all objects', () => a.materialToAll(o), 'ghost', 'copy-check')));
  return out;
}
const TEX_ANY = (m) => MAP_SLOTS.some(([k]) => m[k]);

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
  // mesh check (3D printing / game engines)
  const check = h('div');
  const runCheck = () => {
    const r = analyzeMesh(o.geometry);
    const line = (ok, text) => h('div', { class: 'checkline' + (ok ? ' ok' : '') }, icon(ok ? 'circle-check' : 'triangle-alert'), h('span', null, text));
    mount(check,
      line(r.watertight, r.watertight ? 'Watertight (closed solid) – ready for 3D printing and booleans' : `Not watertight: ${r.open.toLocaleString()} open edges, ${r.nonManifold.toLocaleString()} non-manifold edges`),
      line(r.inconsistent === 0, r.inconsistent === 0 ? 'Faces point consistently' : `${r.inconsistent.toLocaleString()} edges where neighbouring faces point opposite ways`),
      line(r.degenerate === 0, r.degenerate === 0 ? 'No zero-area triangles' : `${r.degenerate.toLocaleString()} zero-area triangles`),
      line(true, `${r.pieces.toLocaleString()} connected piece${r.pieces === 1 ? '' : 's'}`),
      h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } },
        btn('Merge by distance', () => a.mergeByDistance(o, 0.0001), 'ghost', 'merge', 'Weld vertices closer than 0.1 mm'),
        btn('Recalculate normals', () => a.recalcNormals(o), 'ghost', 'compass', 'Make all faces point outwards'),
        r.degenerate ? btn('Remove degenerate', () => a.removeDegenerate(o), 'ghost', 'eraser') : null,
        r.pieces > 1 ? btn('Separate pieces', () => a.separateLoose(o), 'ghost', 'split') : null));
  };
  out.push(section('Check & clean up'), check, btn('Check mesh', runCheck, 'tinted', 'stethoscope', 'Find holes, flipped faces and loose pieces'));
  if (tris < 300000) runCheck();
  out.push(section('Combine'), h('div', { class: 'row', style: { flexWrap: 'wrap' } }, btn(ed.doc.selection.length > 1 ? 'Join selected' : 'Join all visible', () => a.join(o), 'ghost', 'combine'), btn('Array…', () => S.arrayDialog(ed), 'ghost', 'copy-plus')));
  return out;
}

// ------------------------------------------------------------------------------- scene / view
function scenePanel(ed) {
  const vp = ed.vp, rs = vp.render, d = ed.doc;
  const set = (k, v, re = true) => { rs[k] = v; d.dirty = true; if (re) vp.applyRender(); else vp.requestRender(); };
  const out = [section('Viewport shading'), h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(5,1fr)' } }, SHADING.map(([id, label, ic]) => h('button', { class: 'tile' + (rs.shading === id ? ' sel' : ''), style: { height: '58px' }, 'aria-pressed': String(rs.shading === id), onclick: () => { set('shading', id); renderInspector(ed); } }, icon(ic), label)))];
  if (rs.shading === 'MATCAP') out.push(h('div', { class: 'row', style: { marginTop: '10px', gap: '10px' } }, MATCAPS.map((mc) => { const t = matcapTexture(mc.id); const c = h('canvas', { width: 36, height: 36, class: 'swatch' + (rs.matcap === mc.id ? ' ring' : ''), tip: mc.label, role: 'button', 'aria-label': 'Matcap ' + mc.label, tabindex: '0', style: { width: '36px', height: '36px' }, onclick: () => { set('matcap', mc.id); vp.clearShadingCache(); renderInspector(ed); }, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.click(); } } }); c.getContext('2d').drawImage(t.image, 0, 0, 36, 36); return c; })));
  out.push(h('p', { class: 'muted' }, 'Shading only changes how you see the model while editing. Exports always use the real materials.'));
  out.push(toggle('X-ray', !!rs.xray, (v) => set('xray', v, false), 'See through models (Alt+Z)'), toggle('Wireframe overlay', rs.wireframe, (v) => set('wireframe', v)));
  out.push(section('Environment lighting'), h('div', { class: 'chips' }, ENVS.map(([id, label]) => h('button', { class: 'chip' + (rs.env === id ? ' active' : ''), 'aria-pressed': String(rs.env === id), onclick: () => { set('env', id); renderInspector(ed); } }, label))));
  out.push(slider({ label: 'Exposure', min: 0.2, max: 3, step: 0.01, value: rs.exposure, onInput: (v) => set('exposure', v, false) || (vp.renderer.toneMappingExposure = v) }));
  out.push(slider({ label: 'Environment rotation', min: -180, max: 180, step: 1, unit: '°', value: rs.envRotation || 0, onInput: (v) => { rs.envRotation = v; vp.scene.environmentRotation.y = D.degToRad(v); vp.scene.backgroundRotation.y = D.degToRad(v); vp.requestRender(); } }));
  out.push(slider({ label: 'Environment strength', min: 0, max: 3, step: 0.01, value: rs.envIntensity ?? 1, onInput: (v) => { rs.envIntensity = v; vp.scene.environmentIntensity = v; if (rs.envBg) vp.scene.backgroundIntensity = v; vp.requestRender(); } }));
  if (HDRIS[rs.env]) {
    out.push(toggle('Show panorama as background', !!rs.envBg, (v) => { rs.envBg = v; d.dirty = true; vp.applyEnvBackground(); vp.requestRender(); renderInspector(ed); }, 'Real photo backdrop – handy for judging materials in context'));
    if (rs.envBg) out.push(slider({ label: 'Background blur', min: 0, max: 1, step: 0.01, value: rs.envBlur ?? 0.04, onInput: (v) => { rs.envBlur = v; vp.scene.backgroundBlurriness = v; vp.requestRender(); } }));
  }
  out.push(toggle('Ambient occlusion', rs.ao !== false, (v) => set('ao', v, false), 'Soft contact shadows in corners and creases (realistic shading)'));
  out.push(section('Key light'), slider({ label: 'Direction', min: -180, max: 180, step: 1, unit: '°', value: rs.lightAngle, onInput: (v) => { rs.lightAngle = v; vp.updateKeyLight(); vp.requestRender(); } }),
    slider({ label: 'Height', min: 5, max: 90, step: 1, unit: '°', value: rs.lightHeight, onInput: (v) => { rs.lightHeight = v; vp.updateKeyLight(); vp.requestRender(); } }),
    toggle('Shadows', rs.shadows, (v) => set('shadows', v)));
  out.push(section('Background'), h('div', { class: 'swatches' }, BACKGROUNDS.map(([t, b]) => h('button', { class: 'swatch' + (rs.bgTop === t && rs.bgBottom === b ? ' ring' : ''), style: { background: `linear-gradient(${hex(t)}, ${hex(b)})` }, 'aria-label': 'Background ' + hex(t), onclick: () => { rs.bgTop = t; rs.bgBottom = b; vp.applyRender(); renderInspector(ed); } })),
  colorSwatch(hex(rs.bgTop), (v) => { rs.bgTop = parseInt(v.slice(1), 16); rs.bgBottom = darken(rs.bgTop); vp.updateBackground(); vp.requestRender(); }, null, 'Custom background')));
  out.push(section('Units & snapping'), h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Display units'),
    seg(Object.entries(UNITS).map(([id, x]) => [id, x.short, null, x.label]), d.units, (v) => { d.units = v; d.dirty = true; ed.refresh(); }, '', 'Units'),
    h('p', { class: 'muted' }, 'Models are always stored and exported in metres (1 unit = 1 m in Godot, Blender, Unity and Unreal). Units only change the numbers you see.'),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'label grow' }, 'Move snap'), select(SNAP_MOVE.map(([v, l]) => [String(v), l]), String(ed.snapMove), (v) => { ed.setSnap({ move: +v }); }, 'Move snap increment')),
    h('div', { class: 'row', style: { marginTop: '6px' } }, h('span', { class: 'label grow' }, 'Rotate snap'), select(SNAP_ROT.map((v) => [String(v), v + '°']), String(ed.snapRotate), (v) => { ed.setSnap({ rotate: +v }); }, 'Rotate snap increment')),
    toggle('Snapping on', !!ed.snap, (v) => ed.setSnap({ on: v }), 'Hold Ctrl while dragging the gizmo for the opposite'),
    toggle('Floor grid', rs.grid, (v) => set('grid', v)));
  out.push(section('Camera'), seg([['p', 'Perspective'], ['o', 'Orthographic']], rs.ortho ? 'o' : 'p', (v) => set('ortho', v === 'o')),
    slider({ label: 'Field of view', min: 15, max: 100, step: 1, unit: '°', value: rs.fov, onInput: (v) => { rs.fov = v; vp.persp.fov = v; vp.persp.updateProjectionMatrix(); vp.updateCamera(); vp.requestRender(); } }),
    h('div', { class: 'chips' }, ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'].map((v) => h('button', { class: 'chip', onclick: () => vp.view(v) }, v[0].toUpperCase() + v.slice(1)))));
  return out;
}
export const SNAP_MOVE = [[0.001, '1 mm'], [0.01, '1 cm'], [0.05, '5 cm'], [0.1, '10 cm'], [0.25, '25 cm'], [0.5, '50 cm'], [1, '1 m'], [0.0254, '1 in'], [0.3048, '1 ft']];
export const SNAP_ROT = [1, 5, 10, 15, 30, 45, 90];
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
    seg(FALLOFFS.map((f, i) => [i, f]), b.falloff, (v) => { b.falloff = v; }, '', 'Falloff'),
    toggle('Pen pressure', b.usePressure, (v) => { b.usePressure = v; }, 'Strength follows stylus pressure'),
    !color && slider({ label: 'Spacing', min: 0.03, max: 0.6, step: 0.01, value: b.spacing, onInput: (v) => { b.spacing = v; } }),
  ];
}
function sculptPanel(ed) {
  const o = ed.doc.selected, b = ed.vp.brush, a = ed.actions;
  const out = [section('Brush'), h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(4, 1fr)' } }, BRUSHES.filter((x) => x.id !== 'PAINT').map((x) => h('button', { class: 'tile' + (ed.vp.brushType === x.id ? ' sel' : ''), style: { height: '60px' }, 'aria-pressed': String(ed.vp.brushType === x.id), onclick: () => ed.setBrush(x.id) }, icon(x.icon), x.label)))];
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
  const b = ed.paintBrush, o = ed.doc.selected, a = ed.actions, tex = ed.paintTarget === 'texture';
  const out = [];
  out.push(seg([['texture', 'Texture', 'image'], ['vertex', 'Vertex colours', 'droplets']], ed.paintTarget, (v) => { ed.paintTarget = v; ed.savePaintSettings(); if (v === 'texture' && isMesh(o)) ed.preparePainting(o); ed.refresh(); }, 'accent', 'Paint onto'));
  out.push(h('p', { class: 'muted' }, tex ? 'Paints into the model’s colour texture – sharp detail on any mesh, exported as a PNG inside the GLB.' : 'Paints the mesh vertices – needs dense meshes (subdivide) and supports symmetry.'));
  out.push(section('Tool'), h('div', { class: 'toolrow', role: 'toolbar', 'aria-label': 'Paint tool' },
    tool('brush', 'Brush', () => { b.line = false; b.negative = false; ed.refresh(); }, !b.line && !b.negative, ['Freehand brush', 'B']),
    tool('slash', 'Line', () => { b.line = !b.line; ed.refresh(); }, !!b.line, ['Straight line: drag from start to end (or Shift+click)', 'L']),
    tool('eraser', 'Eraser', () => { b.negative = !b.negative; ed.refresh(); }, !!b.negative, ['Eraser', 'E']),
    tool('pipette', 'Pick', () => ed.eyedropper(), !!ed.vp.eyedrop, ['Pick a colour from the model', 'I'])));
  out.push(section('Colour'), colorPicker({ value: b.hex, label: 'Paint colour', onInput: (x) => { ed.setPaintColor(x); ed.refreshStrip(); }, onCommit: (x) => ed.setPaintColor(x), onEyedrop: () => ed.eyedropper() }));
  out.push(section('Brush'),
    slider({ label: 'Size', min: 1, max: 400, step: 1, int: true, value: b.radiusPx, unit: ' px', onInput: (v) => { b.radiusPx = v; ed.savePaintSettings(); ed.refreshStrip(); } }),
    slider({ label: 'Strength', min: 0.01, max: 1, step: 0.01, value: b.intensity, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { b.intensity = v; ed.savePaintSettings(); } }),
    tex && slider({ label: 'Hardness', min: 0, max: 1, step: 0.01, value: b.hardness ?? 0.5, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { b.hardness = v; ed.savePaintSettings(); } }),
    slider({ label: 'Spacing', min: 0.02, max: 1, step: 0.01, value: b.spacing ?? 0.12, format: (v) => Math.round(v * 100) + '%', onInput: (v) => { b.spacing = v; ed.savePaintSettings(); } }),
    !tex && h('div', null, h('div', { class: 'label', style: { margin: '8px 0 6px' } }, 'Falloff'), seg(FALLOFFS.map((f, i) => [i, f]), b.falloff, (v) => { b.falloff = v; }, '', 'Falloff')),
    toggle('Pen pressure', !!b.usePressure, (v) => { b.usePressure = v; ed.savePaintSettings(); }, 'Size and strength follow stylus pressure'),
    !tex && h('div', { class: 'chips', style: { marginTop: '6px' } }, ['X', 'Y', 'Z'].map((ax, i) => h('button', { class: 'chip' + (ed.sym[i] ? ' active' : ''), 'aria-pressed': String(ed.sym[i]), onclick: () => { ed.sym[i] = !ed.sym[i]; renderInspector(ed); } }, 'Mirror ' + ax))));
  if (tex) {
    const t = isMesh(o) ? o.material.map : null;
    out.push(section('Texture'));
    if (t?.image?.width) out.push(h('div', { class: 'summary' }, h('b', null, `${t.image.width} × ${t.image.height}`), ' px', h('div', { class: 'muted' }, t.name || 'Texture')));
    else out.push(h('div', { class: 'label', style: { marginBottom: '6px' } }, 'New texture size'), seg(PAINT_SIZES, ed.paintTexSize, (v) => { ed.paintTexSize = v; ed.savePaintSettings(); }, '', 'New texture size'), h('p', { class: 'muted' }, 'A texture is created (filled with the current colour) the first time you paint.'));
    out.push(h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } },
      btn('Fill with colour', () => ed.fillTexture(b.hex), 'tinted', 'paint-bucket'),
      t?.image?.width ? btn('Save texture as PNG…', () => ed.saveTexture(), 'ghost', 'file-down') : null));
    out.push(btn('Unwrap UVs for painting', () => ed.unwrapForPainting(o), 'ghost', 'scissors', 'Give every face its own area of the texture (keeps the current look)'));
  } else {
    out.push(section('Whole object'), h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      btn('Fill with colour', () => fillPaint(ed, o, b.color), 'tinted', 'paint-bucket'),
      btn('Clear paint', () => fillPaint(ed, o, null), 'ghost', 'eraser')));
    if (isMesh(o) && o.geometry.index.count / 3 < 20000) out.push(h('div', { class: 'warn' }, icon('info'), h('span', null, 'Vertex paint is stored per vertex: more triangles = finer detail. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); a.subdivide(o, false); } }, 'Subdivide (keep shape)'))));
  }
  out.push(section('Tips'), h('div', { class: 'kbdlist muted' }, 'Straight line', h('kbd', null, 'L or Shift+click'), 'Eyedropper', h('kbd', null, 'I'), 'Eraser', h('kbd', null, 'E'), 'Brush size', h('kbd', null, '[  ]'), 'Orbit', h('kbd', null, 'Right drag')));
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
  out.push(section('Select'), seg([['pick', 'Click faces', 'mouse-pointer-click'], ['brush', 'Paint', 'brush']], ft.mode, (v) => { ft.mode = v; ed.vp.syncGizmo(); ed.refresh(); }, 'accent', 'Face selection tool'));
  if (ft.mode === 'pick') out.push(h('p', { class: 'muted' }, 'Click a face to select it (flat areas are picked whole). Shift+click adds, Ctrl+click removes. Then drag the arrow to push or pull.'),
    slider({ label: 'Flat-area angle', min: 0.5, max: 45, step: 0.5, unit: '°', value: ft.angle ?? 2, onInput: (v) => { ft.angle = v; } }));
  else out.push(seg([[1, 'Select', 'plus'], [0, 'Deselect', 'minus']], ft.value, (v) => { ft.value = v; ed.refreshStrip(); }, '', 'Brush adds or removes'),
    slider({ label: 'Radius', min: 2, max: 300, step: 1, int: true, unit: ' px', value: ft.radiusPx, onInput: (v) => { ft.radiusPx = v; } }));
  const selOp = (fn, label) => h('button', { class: 'chip', onclick: () => { const before = Uint8Array.from(f.sel); fn(); ed.vp.pushFaceRecord(label, before); ed.vp.syncFaceOverlay(); ed.vp.syncGizmo(); } }, label);
  out.push(h('div', { class: 'chips', style: { marginTop: '8px' } }, selOp(() => f.selectAll(), 'All'), selOp(() => f.clear(), 'None'), selOp(() => f.invert(), 'Invert'), selOp(() => f.grow(), 'Grow'), selOp(() => f.selectLinked(), 'Linked')));
  out.push(section('Part material'), h('p', { class: 'muted' }, 'Give the selected area its own colour, material or texture. It becomes a separate part you can style.'),
    h('div', { class: 'row', style: { flexWrap: 'wrap' } },
      btn('Colour / material', () => { if (a.separate()) { ed.setMode('object'); ed.inspectorTab = 'material'; ed.refresh(); } }, 'tinted', 'palette'),
      btn('Texture', () => { if (a.separate()) { ed.setMode('object'); ed.inspectorTab = 'material'; ed.refresh(); S.textureLibrary(ed); } }, 'ghost', 'image')));
  let dist = 0.1, inset = 0.25;
  const k = unitK(ed.doc.units), us = UNITS[ed.doc.units].short;
  out.push(section('Modify'),
    slider({ label: 'Extrude distance', min: -1 * k, max: 1 * k, step: 0.005 * k, value: dist * k, unit: ' ' + us, onInput: (v) => { dist = v / k; } }),
    btn('Extrude', () => a.extrude(dist), 'ghost', 'arrow-up-from-line'),
    slider({ label: 'Inset amount', min: 0.02, max: 0.95, step: 0.01, value: inset, onInput: (v) => { inset = v; } }),
    btn('Inset', () => a.inset(inset), 'ghost', 'square-dot'),
    h('div', { class: 'row', style: { marginTop: '8px', flexWrap: 'wrap' } }, btn('Flip', () => a.flipFaces(), 'ghost', 'flip-vertical-2'), btn('Separate', () => a.separate(false), 'ghost', 'split'), btn('Delete', () => a.deleteFaces(), 'danger', 'trash-2')));
  out.push(section('Tips'), h('div', { class: 'kbdlist muted' }, 'Add to selection', h('kbd', null, 'Shift+click'), 'Remove from selection', h('kbd', null, 'Ctrl+click'), 'Select all', h('kbd', null, 'Ctrl+A'), 'Brush size', h('kbd', null, '[  ]')));
  return out;
}

// =============================================================================== strip
export function renderStrip(ed) {
  const m = ed.mode, vp = ed.vp, items = [];
  if (m === 'object' || m === 'animate') {
    const measuring = !!vp.measure;
    for (const [id, label, ic, key] of [['none', 'Select', 'mouse-pointer-2', 'Q'], ['translate', 'Move', 'move', 'W'], ['rotate', 'Rotate', 'rotate-3d', 'E'], ['scale', 'Scale', 'scaling', 'R']]) {
      items.push(tool(ic, label, () => { ed.setGizmo(id); }, !measuring && vp.gizmoMode === id, [label + (id === 'none' ? ' (drag for box select)' : ''), key]));
    }
    items.push(tool('ruler', 'Measure', () => ed.toggleMeasure(), measuring, ['Measure distance', 'M']));
    items.push(h('div', { class: 'div' }));
    const snapBtn = tool('magnet', 'Snap', () => ed.setSnap({ on: !ed.snap }), !!ed.snap, [`Snap to ${ed.snapLabel()} / ${ed.snapRotate}°`, 'Shift+Tab']);
    snapBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); ed.snapMenu(snapBtn); });
    items.push(h('div', { class: 'splitbtn' }, snapBtn, h('button', { class: 'caretbtn', 'aria-label': 'Snap increments', onclick: (e) => ed.snapMenu(e.currentTarget) }, icon('chevron-down'))));
    items.push(tool(vp.gizmoSpace === 'local' ? 'box' : 'globe', vp.gizmoSpace === 'local' ? 'Local' : 'World', () => { vp.gizmoSpace = vp.gizmoSpace === 'local' ? 'world' : 'local'; vp.syncGizmo(); renderStrip(ed); }, false, 'Gizmo orientation (world / local axes)'));
    items.push(h('div', { class: 'div' }));
    items.push(tool('scan-search', 'Frame', () => vp.frame(), false, ['Frame selection', 'F']));
    items.push(tool('view', 'View', (e) => menu([['front', 'Front', 'Numpad 1'], ['back', 'Back', 'Ctrl+Numpad 1'], ['left', 'Left', 'Ctrl+Numpad 3'], ['right', 'Right', 'Numpad 3'], ['top', 'Top', 'Numpad 7'], ['bottom', 'Bottom', 'Ctrl+Numpad 7'], ['iso', 'Three-quarter']].map(([v, l, k]) => ({ label: l, key: k, onClick: () => vp.view(v) })).concat(['sep', { label: vp.render.ortho ? 'Perspective' : 'Orthographic', key: 'Numpad 5', onClick: () => { vp.render.ortho = !vp.render.ortho; vp.applyRender(); } }]), 0, 0, e.currentTarget), false, 'Camera views'));
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
    const b = ed.paintBrush;
    items.push(tool('brush', 'Brush', () => { b.line = false; b.negative = false; ed.refresh(); }, !b.line && !b.negative, ['Freehand brush', 'B']));
    items.push(tool('slash', 'Line', () => { b.line = !b.line; ed.refresh(); }, !!b.line, ['Straight line', 'L']));
    items.push(tool('eraser', 'Eraser', () => { b.negative = !b.negative; ed.refresh(); }, !!b.negative, ['Eraser', 'E']));
    items.push(tool('pipette', 'Pick', () => ed.eyedropper(), false, ['Eyedropper', 'I']));
    items.push(h('div', { class: 'div' }));
    const sw = colorSwatch(b.hex, (x) => ed.setPaintColor(x), (x) => { ed.setPaintColor(x); renderInspector(ed); }, 'Paint colour', { onEyedrop: () => ed.eyedropper() });
    sw.classList.add('big'); items.push(sw);
    items.push(miniSlider('Size', b.radiusPx, 1, 400, (v) => { b.radiusPx = v; ed.savePaintSettings(); }, (v) => Math.round(v) + 'px'));
    items.push(miniSlider('Strength', b.intensity, 0.01, 1, (v) => { b.intensity = v; ed.savePaintSettings(); }, (v) => Math.round(v * 100) + '%'));
    items.push(tool(ed.paintTarget === 'texture' ? 'image' : 'droplets', ed.paintTarget === 'texture' ? 'Texture' : 'Vertex', () => { ed.paintTarget = ed.paintTarget === 'texture' ? 'vertex' : 'texture'; ed.savePaintSettings(); ed.refresh(); }, false, 'Paint onto the texture or the vertex colours'));
  } else if (m === 'edit') {
    items.push(tool('mouse-pointer-click', 'Click', () => { vp.faceTool.mode = 'pick'; vp.syncGizmo(); ed.refresh(); }, vp.faceTool.mode === 'pick', 'Click faces (flat areas as a whole)'));
    items.push(tool('brush', 'Paint', () => { vp.faceTool.mode = 'brush'; vp.syncGizmo(); ed.refresh(); }, vp.faceTool.mode === 'brush', 'Paint a selection'));
    if (vp.faceTool.mode === 'brush') {
      items.push(tool('minus', 'Erase', () => { vp.faceTool.value = vp.faceTool.value ? 0 : 1; renderStrip(ed); }, vp.faceTool.value === 0, 'Brush removes from the selection'));
      items.push(miniSlider('Size', vp.faceTool.radiusPx, 2, 300, (v) => { vp.faceTool.radiusPx = v; }, (v) => Math.round(v) + 'px'));
    }
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

/** Applies a library PBR material (colour/normal/roughness maps, real-world tiling across the object). */
function applyLibrary(m, id, set, span) {
  const L = LIB[id];
  for (const k of ['map', 'normalMap', 'roughnessMap']) { m[k] = set[k].clone(); m[k].needsUpdate = true; }
  m.color.set(L.color ?? 0xffffff); m.roughness = 1; m.metalness = L.metal ?? 0;
  const t = Math.max(1, Math.round(span / L.tile[0] * 10) / 10);
  m.userData.tiling = [t, t]; m.userData.maps = { kind: 'image', name: L.label, lib: id };
  syncTextures(m); m.needsUpdate = true;
}
