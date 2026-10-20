// Every editor command in one place: the menu bar (File · Edit · Add · Object · Mesh · Animate ·
// View · Help) and the searchable command palette (Ctrl+K / F3) are both built from it, so
// everything is reachable from the keyboard with its shortcut shown.
import { h, icon, menu, modal, closeMenu, toast } from '../ui/dom.js';
import { isMesh, isGroup, isCamera, EASINGS } from './model.js';
import { SHAPES, BASIC, MORE } from '../core/shapes.js';
import { SHADING } from './viewport.js';
import { COLLISION_TYPES } from './io.js';
import { SNAP_MOVE, SNAP_ROT } from './panels.js';
import * as S from './studios.js';
import * as PL from './pipeline.js';

/** Menu tree. Leaves: { label, icon, key, run, enabled?, checked?, keywords? }; submenus: { label, icon, items }. */
export function menus(ed) {
  const d = ed.doc, a = ed.actions, vp = ed.vp, sel = () => d.selected, n = () => d.selection.length;
  const obj = ed.mode === 'object' || ed.mode === 'animate';
  const meshSel = () => isMesh(d.selected);
  const multiMesh = () => d.selection.filter(isMesh).length > 1 && meshSel();
  const shapeItems = (list) => list.map((t) => ({ label: SHAPES[t].label, icon: SHAPES[t].icon, run: () => a.addShape(t), keywords: 'shape primitive add' }));
  return [
    { label: 'File', items: [
      { label: 'Save', icon: 'save', key: 'Ctrl+S', run: () => ed.save() },
      { label: 'Save a copy as GLB project…', icon: 'file-down', run: () => ed.saveCopy() },
      'sep',
      { label: 'Import…', icon: 'download', key: 'Ctrl+I', run: () => ed.importFiles(), keywords: 'open glb gltf obj fbx stl ply dae 3mf' },
      { label: 'Export…', icon: 'share', key: 'Ctrl+E', run: () => S.exportDialog(ed) },
      { label: 'Export selection…', icon: 'share', run: () => S.exportDialog(ed, { onlySelected: true }), enabled: () => n() > 0 },
      { label: 'Repeat last export', icon: 'repeat', key: 'Ctrl+Shift+E', run: () => S.quickExport(ed), enabled: () => !!ed.lastExport },
      { label: 'Render image…', icon: 'camera', key: 'F12', run: () => S.exportDialog(ed, { format: 'png', preset: null }), keywords: 'screenshot png picture' },
      'sep',
      { label: 'Send to Godot…', icon: 'gamepad-2', run: () => PL.sendToGodot(ed), keywords: 'game engine godot project live link' },
      { label: 'Send to Blender', icon: 'send', run: () => PL.sendToBlender(ed), keywords: 'blender open' },
      { label: 'Live link', icon: 'refresh-cw', items: [
        { label: 'Sync now', icon: 'refresh-cw', run: () => PL.syncLink(ed, true), enabled: () => !!d.link },
        { label: 'Show exported file', icon: 'folder-open', run: () => PL.revealLink(ed), enabled: () => !!d.link },
        { label: 'Open project in Godot', icon: 'gamepad-2', run: () => PL.openGodot(ed), enabled: () => d.link?.kind === 'godot' },
        { label: 'Stop syncing', icon: 'unlink', run: () => PL.unlink(ed), enabled: () => !!d.link }] },
      'sep',
      { label: 'Back to projects', icon: 'house', key: 'Ctrl+W', run: () => ed.app.closeEditor(), keywords: 'close home' },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', icon: 'undo-2', key: 'Ctrl+Z', run: () => d.undo(), enabled: () => d.history.canUndo },
      { label: 'Redo', icon: 'redo-2', key: 'Ctrl+Shift+Z', run: () => d.redo(), enabled: () => d.history.canRedo },
      'sep',
      { label: 'Copy', icon: 'copy', key: 'Ctrl+C', run: () => ed.copy(), enabled: () => n() > 0 },
      { label: 'Paste', icon: 'clipboard-paste', key: 'Ctrl+V', run: () => ed.paste(), enabled: () => !!ed.clipboard?.length },
      { label: 'Duplicate', icon: 'copy-plus', key: 'Ctrl+D', run: () => a.duplicate(), enabled: () => n() > 0 },
      { label: 'Delete', icon: 'trash-2', key: 'Del', run: () => a.remove(), enabled: () => n() > 0 },
      'sep',
      { label: 'Select all', icon: 'square-dashed-mouse-pointer', key: 'Ctrl+A', run: () => a.selectAll() },
      { label: 'Select none', icon: 'square-dashed', key: 'Alt+A', run: () => a.selectNone() },
      { label: 'Invert selection', icon: 'contrast', key: 'Ctrl+Shift+I', run: () => a.selectInvert() },
      { label: 'Select', icon: 'mouse-pointer-2', items: [
        { label: 'Children', run: () => a.selectChildren(), enabled: () => n() > 0 },
        { label: 'Parent', run: () => a.selectParent(), enabled: () => n() > 0 },
        { label: 'Whole hierarchy', run: () => a.selectHierarchy(), enabled: () => n() > 0 },
        { label: 'Similar (same kind & material)', run: () => a.selectSimilar(), enabled: () => n() > 0 },
        { label: 'Previous object', key: '[', run: () => a.cycle(-1) },
        { label: 'Next object', key: ']', run: () => a.cycle(1) }] },
      'sep',
      { label: 'Command palette…', icon: 'command', key: 'Ctrl+K', run: () => palette(ed) },
      { label: 'Settings…', icon: 'settings', key: 'Ctrl+,', run: () => ed.app.settingsDialog() },
    ] },
    { label: 'Add', items: [
      { label: 'Add menu…', icon: 'plus', key: 'Shift+A', run: () => S.addMenu(ed) },
      'sep',
      { label: 'Shape', icon: 'box', items: shapeItems(BASIC) },
      { label: 'More shapes', icon: 'shapes', items: shapeItems(MORE) },
      { label: '3D text', icon: 'type', key: 'T', run: () => S.textStudio(ed) },
      { label: 'Draw to 3D…', icon: 'pen-tool', run: () => S.drawStudio(ed) },
      { label: 'Image plane…', icon: 'image', run: () => S.imagePlane(ed) },
      { label: 'Sticker…', icon: 'sticker', run: () => S.stickerDialog(ed) },
      { label: 'Template…', icon: 'layout-template', run: () => S.templatePicker(ed) },
      'sep',
      { label: 'Empty', icon: 'move-3d', run: () => a.addEmpty(), keywords: 'null marker spawn point node3d' },
      { label: 'Camera (from view)', icon: 'video', run: () => a.addCamera() },
      { label: 'Light', icon: 'lightbulb', items: [
        { label: 'Point light', icon: 'lightbulb', run: () => a.addLight('point') },
        { label: 'Spot light', icon: 'flashlight', run: () => a.addLight('spot') },
        { label: 'Sun light', icon: 'sun', run: () => a.addLight('directional') }] },
    ] },
    { label: 'Object', items: [
      { label: 'Group', icon: 'group', key: 'Ctrl+G', run: () => a.group(), enabled: () => n() > 0 },
      { label: 'Ungroup', icon: 'ungroup', key: 'Ctrl+Shift+G', run: () => a.ungroup(), enabled: () => d.selection.some(isGroup) },
      { label: 'Parent to active', icon: 'list-tree', key: 'Ctrl+P', run: () => a.setParent(), enabled: () => n() > 1 },
      { label: 'Clear parent', icon: 'unlink', key: 'Alt+P', run: () => a.clearParent(), enabled: () => d.selection.some((o) => d.parentOf(o)) },
      'sep',
      { label: 'Join meshes', icon: 'combine', key: 'Ctrl+J', run: () => a.join(), enabled: () => meshSel() },
      { label: 'Boolean', icon: 'blend', items: [
        { label: 'Union', icon: 'merge', run: () => a.boolean('union'), enabled: multiMesh, keywords: 'csg combine add' },
        { label: 'Subtract (active minus others)', icon: 'scissors', run: () => a.boolean('subtract'), enabled: multiMesh, keywords: 'csg hole cut difference' },
        { label: 'Intersect', icon: 'diff', run: () => a.boolean('intersect'), enabled: multiMesh, keywords: 'csg overlap' }] },
      { label: 'Array…', icon: 'copy-plus', run: () => S.arrayDialog(ed), enabled: () => n() > 0, keywords: 'repeat copies radial linear' },
      'sep',
      { label: 'Align', icon: 'align-center-horizontal', items: ['x', 'y', 'z'].flatMap((ax) => [{ header: ax.toUpperCase() + ' axis' }, ...[['min', 'Min'], ['center', 'Centre'], ['max', 'Max']].map(([w, l]) => ({ label: `${l} ${ax.toUpperCase()}`, run: () => a.align(ax, w), enabled: () => n() > 1 }))]) },
      { label: 'Distribute', icon: 'align-horizontal-distribute-center', items: ['x', 'y', 'z'].map((ax) => ({ label: 'Along ' + ax.toUpperCase(), run: () => a.distribute(ax), enabled: () => n() > 2 })) },
      { label: 'Transform', icon: 'move-3d', items: [
        { label: 'Drop to floor', icon: 'arrow-down-to-line', run: () => a.dropToFloor(), enabled: () => n() > 0 },
        { label: 'Reset transform', icon: 'rotate-ccw', run: () => a.resetTransform(), enabled: () => n() > 0 },
        { label: 'Mirror X', run: () => a.mirror(null, 'x'), enabled: () => n() > 0 }, { label: 'Mirror Y', run: () => a.mirror(null, 'y'), enabled: () => n() > 0 }, { label: 'Mirror Z', run: () => a.mirror(null, 'z'), enabled: () => n() > 0 },
        'sep',
        { label: 'Apply all transforms', run: () => a.applyTransform(), enabled: meshSel },
        { label: 'Apply scale', run: () => a.applyTransform(null, 'scale'), enabled: meshSel, keywords: 'freeze godot physics' },
        { label: 'Apply rotation & scale', run: () => a.applyTransform(null, 'rs'), enabled: meshSel },
        'sep',
        { label: 'Origin to centre', run: () => a.setOrigin(null, 'center'), enabled: meshSel, keywords: 'pivot' },
        { label: 'Origin to bottom', run: () => a.setOrigin(null, 'bottom'), enabled: meshSel, keywords: 'pivot' },
        { label: 'Origin to view centre', run: () => a.setOrigin(null, 'cursor'), enabled: meshSel, keywords: 'pivot' }] },
      'sep',
      { label: 'Hide / show', icon: 'eye-off', key: 'H', run: () => a.toggleVisible(), enabled: () => n() > 0 },
      { label: 'Hide others', icon: 'eye-off', key: 'Shift+H', run: () => a.hideUnselected(), enabled: () => n() > 0 },
      { label: 'Show all', icon: 'eye', key: 'Alt+H', run: () => a.showAll() },
      { label: 'Lock', icon: 'lock', run: () => a.setLocked(null, !sel()?.ed.locked), enabled: () => n() > 0, checked: () => !!sel()?.ed.locked },
      'sep',
      { label: 'Include in export', icon: 'ban', run: () => a.setExport(null, !!sel()?.ed.noExport), enabled: () => n() > 0, checked: () => !!sel() && !sel().ed.noExport },
      { label: 'Godot collision', icon: 'shield', items: COLLISION_TYPES.map(([id, l]) => ({ label: l, run: () => a.setCollision(null, id), enabled: meshSel, checked: () => (sel()?.ed.collision || 'none') === id })) },
      { label: 'Rename…', icon: 'pencil', key: 'F2', run: () => ed.renameSelected(), enabled: () => n() === 1 },
    ] },
    { label: 'Mesh', items: [
      { label: 'Faces mode (push / pull)', icon: 'scan', key: '4', run: () => ed.setMode('edit') },
      'sep',
      { label: 'Subdivide (smooth)', icon: 'grid-2x2-plus', run: () => a.subdivide(sel(), true), enabled: meshSel },
      { label: 'Subdivide (keep shape)', icon: 'grid-2x2', run: () => a.subdivide(sel(), false), enabled: meshSel },
      { label: 'Decimate 50%', icon: 'minimize-2', run: () => a.decimate(sel(), 0.5), enabled: meshSel, keywords: 'reduce polygons simplify lod' },
      { label: 'Smooth', icon: 'waves', run: () => a.smooth(sel(), 3), enabled: meshSel },
      { label: 'Flat shading', icon: 'hexagon', run: () => a.setFlat(sel(), true), enabled: meshSel },
      { label: 'Smooth shading', icon: 'circle', run: () => a.setFlat(sel(), false), enabled: meshSel },
      'sep',
      { label: 'Merge by distance', icon: 'merge', run: () => a.mergeByDistance(sel()), enabled: meshSel, keywords: 'weld remove doubles vertices' },
      { label: 'Recalculate normals', icon: 'compass', run: () => a.recalcNormals(sel()), enabled: meshSel, keywords: 'flip inside out fix' },
      { label: 'Flip normals', icon: 'flip-vertical-2', run: () => a.flipNormals(sel()), enabled: meshSel },
      { label: 'Remove degenerate faces', icon: 'eraser', run: () => a.removeDegenerate(sel()), enabled: meshSel },
      { label: 'Separate loose parts', icon: 'split', run: () => a.separateLoose(), enabled: meshSel },
      { label: 'Unwrap UVs (smart)', icon: 'scissors', run: () => ed.unwrapForPainting(), enabled: meshSel, keywords: 'uv unwrap smart project texture paint bake' },
      { label: 'Check mesh', icon: 'stethoscope', run: () => { ed.inspectorTab = 'mesh'; ed.refresh(); }, enabled: meshSel, keywords: 'watertight manifold print' },
      { label: 'Make editable mesh', icon: 'pen-line', run: () => a.makeEditable(sel()), enabled: () => meshSel() && !!(sel().ed.prim || sel().ed.text) },
    ] },
    { label: 'Animate', items: [
      { label: 'Animate mode', icon: 'clapperboard', key: '5', run: () => ed.setMode('animate') },
      { label: ed.playing ? 'Pause' : 'Play', icon: ed.playing ? 'pause' : 'play', key: 'Space', run: () => { if (ed.mode !== 'animate') ed.setMode('animate'); ed.togglePlay(); } },
      { label: 'Insert keyframe', icon: 'diamond', key: 'K', run: () => ed.insertKey(), enabled: () => n() > 0 },
      { label: 'Key easing', icon: 'spline', items: EASINGS.map(([id, l]) => ({ label: l, run: () => ed.setKeyEasing(id), enabled: () => !!sel()?.ed.keys.has(d.frame) })) },
      { label: 'Animation clips…', icon: 'film', run: () => S.clipsDialog(ed), keywords: 'idle walk run actions godot' },
    ] },
    { label: 'View', items: [
      { label: 'Frame selection', icon: 'scan-search', key: 'F', run: () => vp.frame() },
      { label: 'Frame all', icon: 'maximize', key: 'Home', run: () => vp.frame(d.objects) },
      { label: 'Camera view', icon: 'view', items: [['front', 'Front', 'Numpad 1'], ['back', 'Back', 'Ctrl+Numpad 1'], ['right', 'Right', 'Numpad 3'], ['left', 'Left', 'Ctrl+Numpad 3'], ['top', 'Top', 'Numpad 7'], ['bottom', 'Bottom', 'Ctrl+Numpad 7'], ['iso', 'Three-quarter']].map(([v, l, k]) => ({ label: l, key: k, run: () => vp.view(v) })) },
      { label: 'Orthographic', icon: 'box', key: 'Numpad 5', run: () => { vp.render.ortho = !vp.render.ortho; vp.applyRender(); ed.refresh(); }, checked: () => vp.render.ortho },
      { label: 'Look through camera', icon: 'video', key: 'Numpad 0', run: () => ed.lookThroughCamera(), enabled: () => d.objects.some(isCamera) },
      { label: 'Align camera to view', icon: 'scan', key: 'Ctrl+Alt+Numpad 0', run: () => a.alignCameraToView(), enabled: () => isCamera(sel()) },
      'sep',
      { label: 'Shading', icon: 'sun', items: SHADING.map(([id, l, ic]) => ({ label: l, icon: ic, run: () => { vp.render.shading = id; vp.applyRender(); ed.refresh(); }, checked: () => vp.render.shading === id })) },
      { label: 'X-ray', icon: 'scan-eye', key: 'Alt+Z', run: () => ed.toggleRender('xray'), checked: () => !!vp.render.xray },
      { label: 'Wireframe', icon: 'grid-3x3', key: 'Shift+Z', run: () => ed.toggleRender('wireframe'), checked: () => !!vp.render.wireframe },
      { label: 'Floor grid', icon: 'grid-2x2', run: () => ed.toggleRender('grid'), checked: () => !!vp.render.grid },
      'sep',
      { label: 'Measure', icon: 'ruler', key: 'M', run: () => ed.toggleMeasure(), checked: () => !!vp.measure, enabled: () => obj || ed.mode === 'object' },
      { label: 'Snapping', icon: 'magnet', key: 'Shift+Tab', run: () => ed.setSnap({ on: !ed.snap }), checked: () => !!ed.snap },
      { label: 'Snap increment', icon: 'magnet', items: [...SNAP_MOVE.map(([v, l]) => ({ label: 'Move ' + l, run: () => ed.setSnap({ move: v, on: true }), checked: () => ed.snapMove === v })), 'sep', ...SNAP_ROT.map((v) => ({ label: `Rotate ${v}°`, run: () => ed.setSnap({ rotate: v, on: true }), checked: () => ed.snapRotate === v }))] },
      'sep',
      { label: 'Hide interface', icon: 'eye-off', key: 'Ctrl+\\', run: () => ed.toggleUi(), checked: () => ed.el.classList.contains('ui-hidden') },
    ] },
    { label: 'Help', items: [
      { label: 'Keyboard shortcuts', icon: 'keyboard', key: '?', run: () => S.shortcutsDialog(ed) },
      { label: 'Using your model in Godot & Blender', icon: 'gamepad-2', run: () => PL.pipelineHelp(ed) },
      { label: 'Show tips again', icon: 'lightbulb', run: () => { ed.settings.seenEditorHint = false; ed.settings.tips = true; ed.saveSettings(); toast('Tips will show again'); } },
      { label: 'Releases & source on GitHub', icon: 'github', run: () => import('../platform.js').then(({ platform }) => platform.app.openExternal('https://github.com/terpenesalad/GLB-ME/releases')) },
    ] },
  ];
}

const resolve = (it) => ({ ...it, onClick: it.run, disabled: it.enabled ? !it.enabled() : false, checked: it.checked ? it.checked() : undefined, items: it.items ? it.items.map((x) => (typeof x === 'string' || x.header ? x : resolve(x))) : undefined });

/** The menu bar shown in the title bar. Alt or F10 focuses it; ←/→ move between menus. */
export function menubar(ed) {
  const bar = h('div', { class: 'menubar', role: 'menubar', 'aria-label': 'Main menu' });
  let open = -1;
  const buttons = [];
  const openAt = (i, focusFirst = true) => {
    const list = menus(ed); i = (i + list.length) % list.length; open = i;
    buttons.forEach((b, j) => b.setAttribute('aria-expanded', String(j === i)));
    menu(list[i].items.map((x) => (typeof x === 'string' || x.header ? x : resolve(x))), 0, 0, buttons[i], { label: list[i].label, focus: focusFirst, onNav: (dir) => openAt(open + dir), onClose: () => { buttons.forEach((b) => b.setAttribute('aria-expanded', 'false')); open = -1; } });
  };
  menus(ed).forEach((m, i) => {
    const b = h('button', { class: 'mb', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', tabindex: i === 0 ? '0' : '-1',
      onclick: () => (open === i ? closeMenu() : openAt(i)),
      onpointerenter: () => { if (open >= 0 && open !== i) openAt(i, false); },
      onkeydown: (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons.forEach((x, k) => x.setAttribute('tabindex', k === j ? '0' : '-1')); buttons[j].focus(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); openAt(i); } // Enter / Space arrive as a click
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ed.canvas.focus(); }
      } }, m.label);
    buttons.push(b); bar.appendChild(b);
  });
  // narrow windows: one button with every menu as a submenu
  const burger = h('button', { class: 'mb mb-burger', 'aria-haspopup': 'menu', 'aria-label': 'Menu', onclick: (e) => menu(menus(ed).map((m) => ({ label: m.label, items: m.items.map((x) => (typeof x === 'string' || x.header ? x : resolve(x))) })), 0, 0, e.currentTarget, { label: 'Menu' }) }, icon('menu'));
  bar.appendChild(burger);
  bar.focusFirst = () => (getComputedStyle(burger).display !== 'none' ? burger : buttons[0]).focus();
  bar.openMenu = (label) => { const i = menus(ed).findIndex((m) => m.label === label); if (i >= 0) openAt(i); };
  return bar;
}

/** All runnable commands, flattened with their menu path. */
export function allCommands(ed) {
  const out = [];
  const walk = (items, path) => { for (const it of items) { if (!it || typeof it === 'string' || it.header) continue; if (it.items) walk(it.items, [...path, it.label]); else out.push({ ...it, path: path.join(' › ') }); } };
  for (const m of menus(ed)) walk(m.items, [m.label]);
  return out;
}

/** Ctrl+K: search every command by name, menu or keyword; ↑ ↓ Enter. */
export function palette(ed) {
  const cmds = allCommands(ed);
  const recent = ed.settings.recentCommands || [];
  const input = h('input', { class: 'field palette-in', placeholder: 'Type a command… (e.g. subtract, godot, origin, x-ray)', 'aria-label': 'Search commands', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list', 'aria-autocomplete': 'list' });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox', 'aria-label': 'Commands' });
  let items = [], idx = 0;
  const score = (c, q) => {
    if (!q) return recent.indexOf(c.label + c.path) >= 0 ? 100 - recent.indexOf(c.label + c.path) : 1;
    const hay = (c.label + ' ' + c.path + ' ' + (c.keywords || '')).toLowerCase(), lab = c.label.toLowerCase();
    let s = 0;
    for (const w of q.split(/\s+/)) { if (!w) continue; if (lab.startsWith(w)) s += 10; else if (lab.includes(w)) s += 6; else if (hay.includes(w)) s += 3; else return 0; }
    return s;
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = cmds.map((c) => [c, score(c, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([c]) => c);
    idx = Math.min(idx, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((c, i) => {
      const dis = c.enabled && !c.enabled();
      return h('div', { class: 'palette-item' + (i === idx ? ' on' : '') + (dis ? ' dis' : ''), role: 'option', id: 'pal-' + i, 'aria-selected': String(i === idx), 'aria-disabled': dis ? 'true' : null, onpointerenter: () => { idx = i; mark(); }, onclick: () => run(i) },
        c.icon ? icon(c.icon) : h('span', { class: 'icon' }), h('span', { class: 'grow' }, c.label, h('small', null, c.path)), c.key ? h('kbd', null, c.key) : null);
    }));
    if (!items.length) list.replaceChildren(h('p', { class: 'muted', style: { padding: '10px' } }, 'No matching command.'));
    input.setAttribute('aria-activedescendant', items.length ? 'pal-' + idx : '');
  };
  const mark = () => { [...list.children].forEach((x, i) => { x.classList.toggle('on', i === idx); x.setAttribute('aria-selected', String(i === idx)); }); input.setAttribute('aria-activedescendant', 'pal-' + idx); list.children[idx]?.scrollIntoView({ block: 'nearest' }); };
  const run = (i) => {
    const c = items[i]; if (!c || (c.enabled && !c.enabled())) return;
    m.close();
    ed.settings.recentCommands = [c.label + c.path, ...recent.filter((x) => x !== c.label + c.path)].slice(0, 8); ed.saveSettings();
    setTimeout(() => c.run(), 0);
  };
  input.addEventListener('input', () => { idx = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(idx); }
  });
  const m = modal({ title: 'Command palette', icon: 'command', body: h('div', null, input, list) });
  m.el.classList.add('palette');
  render();
  setTimeout(() => input.focus(), 40);
}
