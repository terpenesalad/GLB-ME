// The editor screen: menu bar, viewport, layers tree, inspector, tool strip and timeline;
// selection rules, keyboard & mouse shortcuts, snapping, painting hooks, autosave, the live link
// to a Godot project and the project lifecycle.
import * as THREE from 'three';
import { h, icon, ibtn, btn, tool, mount, toast, menu, busy, confirmDialog, anyModalOpen, hideTip, closeMenu, announce, promptDialog } from '../ui/dom.js';
import { closeColorPopover } from '../ui/color.js';
import { syncTextures as syncTex } from './model.js';
import { Doc, isMesh, isLight, isCamera, isGroup, ANIM_PRESETS, applyPreset, EASINGS, UNITS, unitK, KIND_LABEL } from './model.js';
import { Viewport } from './viewport.js';
import { Actions } from './actions.js';
import { saveProject, loadProject, importModel, IMPORT_EXT } from './io.js';
import { BRUSHES, defaultBrush } from '../core/sculpt.js';
import { platform, MODEL_FILTERS } from '../platform.js';
import { TexStroke, isPaintable, ensurePaintTexture, bakeToNewUv } from './texpaint.js';
import { uvOverlap, smartUnwrap } from '../core/uvunwrap.js';
import { prepareGeometry } from './model.js';
import { bumpTopo } from '../core/mesh.js';
import * as P from './panels.js';
import * as S from './studios.js';
import * as PL from './pipeline.js';
import { menubar, palette } from './commands.js';

export const MODES = [
  ['object', 'Object', 'mouse-pointer-2', '1'], ['sculpt', 'Sculpt', 'brush', '2'], ['paint', 'Paint', 'paintbrush', '3'],
  ['edit', 'Faces', 'scan', '4'], ['animate', 'Animate', 'clapperboard', '5'],
];

export class Editor {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.settings = app.settings; this.saveSettings = () => app.saveSettings();
    this.doc = new Doc();
    this.brushes = Object.fromEntries(BRUSHES.map((b) => [b.id, defaultBrush(b.id)]));
    const pb = this.settings.paintBrush || {};
    this.paintBrush = { ...defaultBrush('PAINT'), color: [0.8, 0.2, 0.2, 1], hex: '#d13a3a', hardness: 0.5, spacing: 0.12, line: false, ...pb };
    this.setPaintColor(this.paintBrush.hex);
    this.paintTarget = this.settings.paintTarget || 'texture';
    this.paintTexSize = this.settings.paintTexSize || 2048;
    this.sym = [true, false, false];
    this.inspectorTab = 'object';
    this.playing = false; this.autoKey = true;
    this.snap = !!this.settings.snap; this.snapMove = this.settings.snapMove || 0.1; this.snapRotate = this.settings.snapRotate || 15;
    this.build();
    this.vp = new Viewport(this.canvas, this.doc, this.viewportHost());
    this.vp.gizmoMode = 'translate'; this.vp.gizmoSpace = 'world';
    this.vp.renderer.setPixelRatio(Math.min(this.settings.pixelRatio || 2, devicePixelRatio)); this.vp.resize();
    this.vp.brush = this.brushes.CLAY; this.vp.brushType = 'CLAY';
    this.vp.setAxisColors(this.settings.axisColors || 'standard');
    this.applySnap();
    this.actions = new Actions(this);
    this.doc.addEventListener('change', (e) => { if (e.detail !== 'noop') this.refresh(); });
    this.doc.addEventListener('history', (e) => this.toast(e.detail));
    this.doc.addEventListener('select', () => this.announceSelection());
    this.keyHandler = (e) => this.onKey(e);
    this.keyUpHandler = (e) => this.onKeyUp(e);
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    this.autosaveTimer = setInterval(() => { if (this.doc.dirty && !this.saving && this.project) this.save(true); }, 45000);
  }

  // =========================================================================== layout
  build() {
    this.canvas = h('canvas', { class: 'viewport', 'aria-label': '3D viewport', 'aria-describedby': 'vp-help' });
    this.vpHelp = h('p', { id: 'vp-help', class: 'sr-only' }, 'Drag to orbit, right-drag or middle-drag to pan, scroll to zoom. Click to select, Shift or Ctrl click to add. Arrow keys move the selection; Alt plus arrows orbit; plus and minus zoom. Press Control K for all commands.');
    this.cursor = h('div', { class: 'brushcursor', style: { display: 'none' } });
    this.titleEl = h('span', null, 'Untitled');
    this.undoBtn = ibtn('undo-2', ['Undo', 'Ctrl+Z'], () => { if (!this.vp.drag) this.doc.undo(); });
    this.redoBtn = ibtn('redo-2', ['Redo', 'Ctrl+Shift+Z'], () => { if (!this.vp.drag) this.doc.redo(); });
    this.modeSeg = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Editing mode' });
    for (const [id, label, ic, key] of MODES) {
      this.modeSeg.appendChild(h('button', { role: 'radio', 'aria-checked': String(id === 'object'), 'data-mode': id, tip: [label + ' mode', key], onclick: () => this.setMode(id) }, icon(ic), h('span', { class: 'ml' }, label)));
    }
    this.menubar = menubar(this);
    this.linkChip = h('button', { class: 'linkchip', style: { display: 'none' }, onclick: (e) => this.linkMenu(e.currentTarget) });
    const plat = platform.platform || '';
    this.titlebar = h('div', { class: 'titlebar solid' + (plat === 'darwin' ? ' mac' : plat ? ' win' : '') },
      ibtn('house', ['Projects', 'Ctrl+W'], () => this.app.closeEditor()),
      this.menubar,
      h('button', { class: 'ptitle btn ghost', tip: 'Rename project', onclick: () => this.renameProject() }, this.titleEl, icon('pencil', 'sm')),
      this.linkChip,
      h('div', { class: 'spacer' }),
      this.modeSeg,
      h('div', { class: 'spacer' }),
      this.undoBtn, this.redoBtn,
      btn('Add', () => S.addMenu(this), 'tinted', 'plus', ['Add shape, text, light…', 'Shift+A']),
      btn('Export', () => S.exportDialog(this), 'primary', 'share', ['Export', 'Ctrl+E']),
      ibtn('command', ['Command palette', 'Ctrl+K'], () => palette(this)),
    );
    this.layerSearch = h('input', { class: 'field layer-filter', placeholder: 'Filter objects', 'aria-label': 'Filter objects by name', oninput: (e) => { this.layerFilter = e.target.value; P.renderLayers(this); }, onkeydown: (e) => { if (e.key === 'Escape') { e.target.value = ''; this.layerFilter = ''; P.renderLayers(this); } } });
    this.layersEl = h('div', { class: 'pbody tree', role: 'tree', 'aria-label': 'Objects', 'aria-multiselectable': 'true', onkeydown: (e) => P.layersKey(this, e),
      ondragover: (e) => { if (this.dragLayers) e.preventDefault(); },
      ondrop: (e) => { if (!this.dragLayers) return; e.preventDefault(); const l = this.dragLayers; this.dragLayers = null; this.actions.dropOn(l, null, 'end'); } });
    this.left = h('aside', { class: 'panel left', 'aria-label': 'Layers' },
      h('div', { class: 'phead' }, h('h3', null, 'Layers'), ibtn('folder-plus', ['Group selection', 'Ctrl+G'], () => this.actions.group()), ibtn('plus', ['Add', 'Shift+A'], () => S.addMenu(this)), ibtn('eye', ['Show all', 'Alt+H'], () => this.actions.showAll())),
      h('div', { style: { padding: '0 10px 6px' } }, this.layerSearch),
      this.layersEl,
      h('div', { class: 'pfoot' },
        tool('shapes', 'Shapes', () => S.shapesDialog(this)), tool('type', 'Text', () => S.textStudio(this), false, ['3D text', 'T']), tool('pen-tool', 'Draw', () => S.drawStudio(this), false, 'Draw to 3D'), tool('lightbulb', 'Light', (e) => menu([{ label: 'Point light', icon: 'lightbulb', onClick: () => this.actions.addLight('point') }, { label: 'Spot light', icon: 'flashlight', onClick: () => this.actions.addLight('spot') }, { label: 'Sun light', icon: 'sun', onClick: () => this.actions.addLight('directional') }, 'sep', { label: 'Camera', icon: 'video', onClick: () => this.actions.addCamera() }, { label: 'Empty', icon: 'move-3d', onClick: () => this.actions.addEmpty() }], 0, 0, e.currentTarget), false, 'Add a light, camera or empty')),
    );
    this.rightBody = h('div', { class: 'pbody' });
    this.tabsEl = h('div', { class: 'tabs' });
    this.right = h('aside', { class: 'panel right', 'aria-label': 'Inspector' }, h('div', { class: 'phead' }, this.rightTitle = h('h3', { 'aria-live': 'polite' }, 'Inspector'), this.rightTools = h('div', { class: 'row' })), this.tabsEl, this.rightBody);
    let busyPanel = false;
    this.right.addEventListener('pointerdown', () => { busyPanel = true; });
    this.upHandler = () => { if (busyPanel) { busyPanel = false; if (this.pendingRefresh) setTimeout(() => this.refresh(), 0); } };
    window.addEventListener('pointerup', this.upHandler);
    this.panelBusy = () => busyPanel || (this.right.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== 'range');
    this.strip = h('div', { class: 'strip', role: 'toolbar', 'aria-label': 'Tools' });
    this.timeline = h('div', { class: 'timeline', style: { display: 'none' }, role: 'region', 'aria-label': 'Timeline' });
    this.stats = h('div', { class: 'stats', 'aria-live': 'off' });
    this.ppLabel = h('div', { class: 'pplabel', role: 'status', style: { display: 'none' } });
    this.hintHost = h('div');
    this.el = h('div', { class: 'editor' }, this.canvas, this.vpHelp, this.cursor, this.titlebar, this.left, this.right, this.strip, this.timeline, this.stats, this.ppLabel, this.hintHost);
    mount(this.root, this.el);
    this.el.addEventListener('pointerdown', () => { this.altAlone = false; }, true);
    // drag & drop files
    this.el.addEventListener('dragover', (e) => { if (this.dragLayers) return; e.preventDefault(); this.app.showDrop(true); });
    this.el.addEventListener('dragleave', (e) => { if (e.target === this.el || e.target === this.canvas) this.app.showDrop(false); });
    this.el.addEventListener('drop', async (e) => {
      if (this.dragLayers) return;
      e.preventDefault(); this.app.showDrop(false);
      const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, path: f.path, data: await f.arrayBuffer() })));
      this.handleFiles(files);
    });
  }

  viewportHost() {
    return {
      onPickObject: (o, e) => this.pickObject(o, e),
      onDeepPick: (o) => this.deepPick(o),
      onBoxSelect: (list, e) => {
        const d = this.doc, tops = [...new Set(list.map((o) => { const a = d.ancestors(o); return a.length ? a[a.length - 1] : o; }))];
        if (e.shiftKey) d.setSelection([...d.selection, ...tops]); else d.setSelection(tops);
      },
      onFacePick: (hit, e) => this.facePick(hit, e),
      onPushPull: (phase, dist) => this.actions.pushPull(phase, dist),
      onGizmoStart: () => { this.gizmoTok = this.doc.begin(this.vp.gizmoMode === 'rotate' ? 'Rotate' : this.vp.gizmoMode === 'scale' ? 'Scale' : 'Move', this.doc.topSelected()); },
      onGizmoEnd: () => {
        if (!this.gizmoTok) return;
        if (this.mode === 'animate' && this.autoKey) for (const o of this.doc.topSelected()) this.doc.setKey(o);
        this.doc.commit(this.gizmoTok); this.gizmoTok = null;
      },
      onGizmoChange: () => { this.refreshTransformFields?.(); this.updateStats(); },
      onBrushCursor: (c) => this.showCursor(c),
      onBrushResize: (k) => this.resizeBrush(k),
      onFacesChanged: () => this.refresh(),
      onFrame: (now) => this.tick(now),
      onCamera: () => {},
      symmetry: () => this.sym,
      formatLength: (m) => this.formatLength(m),
      paintTarget: () => this.paintTarget,
      onTexPaintBegin: (o) => this.texPaintBegin(o),
      onPaintMiss: () => this.toast('The line doesn’t cross the model'),
    };
  }
  showCursor(c) {
    if (!c) { this.cursor.style.display = 'none'; return; }
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.cursor.style, { display: 'block', left: c.x - r.left + 'px', top: c.y - r.top + 'px', width: c.r * 2 + 'px', height: c.r * 2 + 'px' });
    this.cursor.classList.toggle('neg', !!c.neg);
    this.cursor.classList.toggle('line', this.mode === 'paint' && !!this.paintBrush.line);
  }
  resizeBrush(k) {
    if (this.mode === 'edit') { this.vp.faceTool.radiusPx = Math.max(4, Math.min(400, this.vp.faceTool.radiusPx * k)); }
    else { const b = this.vp.brush; b.radiusPx = Math.max(1, Math.min(500, b.radiusPx * k)); }
    const p = this.vp.pointer; this.vp.hover({ clientX: p.x, clientY: p.y, ctrlKey: false });
    this.refreshStrip();
  }

  // =========================================================================== selection rules
  /** Click: picks the top-level group first (like Spline/Figma); Alt+click picks the exact object; Shift/Ctrl toggle. */
  pickObject(o, e) {
    const d = this.doc, add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!o) { if (!add) d.select(null); return; }
    const chain = [o, ...d.ancestors(o)];
    let target = o;
    if (!e.altKey) { const i = chain.findIndex((x) => d.isSelected(x)); target = i >= 0 ? chain[i] : chain[chain.length - 1]; }
    if (add) d.select(target, 'toggle'); else d.select(target);
  }
  /** Double-click: step into a group (select the child under the cursor); on a plain object, frame it. */
  deepPick(o) {
    const d = this.doc, chain = [o, ...d.ancestors(o)], i = chain.findIndex((x) => d.isSelected(x));
    if (i > 0) d.select(chain[i - 1]); else this.vp.frame([o]);
  }
  announceSelection() {
    const d = this.doc, n = d.selection.length;
    if (!n) announce('Nothing selected');
    else if (n === 1) { const o = d.selected; announce(`${o.name} selected, ${KIND_LABEL[o.ed.kind]}${isMesh(o) ? `, ${(o.geometry.index.count / 3).toLocaleString()} triangles` : ''}`); }
    else announce(`${n} objects selected, active ${d.selected.name}`);
  }
  facePick(hit, e) {
    const f = this.vp.faces; this.vp.bindFaces();
    const before = Uint8Array.from(f.sel);
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) f.clear();
    const n = f.selectCoplanar(hit.faceIndex, e.ctrlKey || e.metaKey ? 0 : 1, this.vp.faceTool.angle ?? 2);
    this.vp.pushFaceRecord('Select face', before);
    this.vp.syncFaceOverlay(); this.vp.syncGizmo();
    announce(`${f.count()} faces selected`);
    void n;
  }
  showPushPull(dist) {
    if (dist == null) { this.ppLabel.style.display = 'none'; return; }
    this.ppLabel.textContent = (dist >= 0 ? 'Pull ' : 'Push ') + this.formatLength(Math.abs(dist));
    this.ppLabel.style.display = 'block';
  }
  formatLength(m) {
    const u = this.doc.units, k = unitK(u), v = m * k;
    return `${Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(u === 'm' ? 3 : 2)} ${UNITS[u].short}`;
  }

  // =========================================================================== painting
  setPaintColor(hex) {
    const c = new THREE.Color(hex); this.paintBrush.hex = hex; this.paintBrush.color = [c.r, c.g, c.b, 1];
    this.savePaintSettings();
  }
  savePaintSettings() { const b = this.paintBrush; this.settings.paintBrush = { hex: b.hex, radiusPx: b.radiusPx, intensity: b.intensity, hardness: b.hardness, spacing: b.spacing, usePressure: b.usePressure }; this.settings.paintTarget = this.paintTarget; this.settings.paintTexSize = this.paintTexSize; clearTimeout(this.paintSaveT); this.paintSaveT = setTimeout(() => this.saveSettings(), 400); }
  /** Prepares the model's texture for painting (one undo step) and returns a stroke. */
  texPaintBegin(o) {
    const g = o.geometry;
    if (!g.attributes.uv || (uvOverlap(g) > 0.02 && !g.userData.paintDeclined)) { this.preparePainting(o); return null; }
    if (!isPaintable(o.material, this.doc)) this.actions.material('Start painting', (mm) => ensurePaintTexture(mm, this.paintTexSize), o);
    return new TexStroke(o.material.map, { bg: o.material.userData.maps?.bg });
  }
  fillTexture(hex) {
    const o = this.doc.selected; if (!isMesh(o)) return;
    const st = this.texPaintBegin(o); if (!st) return;
    st.ctx.save(); st.ctx.fillStyle = hex; st.ctx.globalAlpha = 1; st.ctx.fillRect(0, 0, st.c.width, st.c.height); st.ctx.restore();
    st.dirty = [0, 0, st.c.width, st.c.height];
    this.doc.pushRecord(st.end('Fill texture'));
  }
  async saveTexture() {
    const t = this.doc.selected?.material?.map; if (!t?.image) return;
    const c = document.createElement('canvas'); c.width = t.image.width; c.height = t.image.height; c.getContext('2d').drawImage(t.image, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const p = await platform.files.save(PL.safeName(this.doc.selected.name) + '_color.png', await blob.arrayBuffer(), [{ name: 'PNG image', extensions: ['png'] }]);
    if (p) this.toast('Texture saved');
  }
  /** Texture painting needs every part of the model to have its own spot on the texture. */
  async preparePainting(o) {
    const g = o.geometry; if (this.preparing) return;
    const none = !g.attributes.uv, ov = none ? 1 : uvOverlap(g);
    if (!none && ov <= 0.02) return true;
    if (!none && g.userData.paintDeclined) return true;
    const m = o.material, carry = !!(m.map || m.roughnessMap || m.metalnessMap || m.aoMap || m.emissiveMap || (m.vertexColors && g.attributes.color));
    this.preparing = true;
    const ok = await confirmDialog(`Prepare “${o.name}” for painting?`,
      `${none ? 'This model has no UV layout' : 'Several faces of this model share the same part of the texture'}, so paint would ${none ? 'have nowhere to go' : 'show up in more than one place'}. GLB&ME can unwrap it automatically (like Blender’s Smart UV Project)${carry ? ' and carry its current texture and paint over to the new layout' : ''}. You can undo this.`,
      'Unwrap for painting');
    this.preparing = false;
    if (!ok) { if (!none) { g.userData.paintDeclined = true; this.toast('OK – painting on the current UVs'); } else { this.actions.projectUvs(o, 'BOX'); } return false; }
    this.unwrapForPainting(o);
    return true;
  }
  unwrapForPainting(o = this.doc.selected) {
    if (!isMesh(o)) return;
    const b = busy('Unwrapping UVs…');
    try {
      const g = o.geometry, m = o.material;
      const r = smartUnwrap(g);
      const vcol = !!(m.vertexColors && g.attributes.color);
      const size = Math.max(this.paintTexSize, m.map?.image?.width || 0) > 2048 ? 4096 : this.paintTexSize;
      const baked = bakeToNewUv(this.vp.renderer, m, r.geo, r.oldUv, size, vcol);
      const shared = this.doc.meshes.some((x) => x !== o && x.material === m);
      bumpTopo(r.geo);
      this.doc.transact('Unwrap UVs for painting', () => {
        if (shared) { const c = m.clone(); c.userData = JSON.parse(JSON.stringify(m.userData)); c.name = m.name + ' (painted)'; o.material = c; }
        const mm = o.material;
        o.geometry = prepareGeometry(r.geo); o.ed.prim = null; o.ed.text = null;
        for (const [slot, t] of Object.entries(baked)) mm[slot] = t;
        if (mm.normalMap) mm.normalMap = null;
        if (baked.map) { if (vcol) mm.vertexColors = false; mm.userData.maps = { kind: 'paint', name: 'Painted', bg: '#ffffff' }; }
        mm.userData.tiling = [1, 1]; mm.userData.offset = [0, 0]; mm.userData.rotation = 0;
        syncTex(mm); mm.needsUpdate = true;
      }, [o]);
      this.vp.bindFaces?.();
      this.toast(`Unwrapped into ${r.charts} UV islands${Object.keys(baked).length ? ' – texture carried over' : ''}. Paint away!`, 3500);
    } catch (e) { console.error(e); this.toast('Unwrap failed: ' + e.message, 5000); }
    finally { b.close(); }
  }
  eyedropper() {
    if (!this.doc.meshes.length) return;
    this.vp.setEyedrop((hex) => { this.setPaintColor(hex); this.toast('Picked ' + hex); announce('Picked colour ' + hex); this.refresh(); });
    this.toast('Click the model to pick a colour (Esc to cancel)');
  }

  // =========================================================================== lifecycle
  async open(project, data = null, importFiles = null) {
    this.project = project;
    this.doc.name = project.name; this.titleEl.textContent = project.name;
    const b = busy('Opening…');
    try {
      if (data) await loadProject(this.doc, this.vp, data);
      else { this.vp.frame(null, false); }
      if (importFiles) await this.handleFiles(importFiles, true);
      if (!data && !importFiles && project.start) await this.startWith(project.start);
      this.doc.dirty = !data; this.doc.changeCount = 0; // brand-new projects are saved even if untouched
      this.doc.history.clear();
    } catch (e) {
      console.error(e); b.close();
      this.loadFailed = true; // never overwrite the original project with an empty scene
      this.toast('Could not open: ' + e.message, 5000);
      setTimeout(() => this.app.closeEditor(), 50);
      return;
    } finally { b.close(); }
    if (!this.mode || (this.mode !== 'sculpt')) this.setMode('object');
    this.vp.frame(this.doc.objects, false);
    this.setLinkStatus(this.doc.link ? 'ok' : null);
    this.refresh();
    if (!this.settings.seenEditorHint) setTimeout(() => this.hint('Drag to orbit • Right-drag to pan • Scroll to zoom • F to frame. Ctrl+K finds any command, ? lists shortcuts.', () => { this.settings.seenEditorHint = true; this.saveSettings(); }), 700);
  }
  async startWith(kind) {
    if (kind === 'sculpt') { this.actions.addShape('SCULPT_SPHERE', { res: 64 }); this.doc.history.clear(); this.setMode('sculpt'); }
    else if (kind === 'text') { await this.actions.addText(); this.doc.history.clear(); setTimeout(() => S.textStudio(this, this.doc.selected), 200); }
    else if (kind?.startsWith('shape:')) { this.actions.addShape(kind.slice(6)); this.doc.history.clear(); }
  }
  async save(silent = false) {
    if (this.loadFailed || !this.project) return;
    while (this.saving) await this.saving;
    let done; this.saving = new Promise((r) => { done = r; });
    const changeAtStart = this.doc.changeCount;
    try {
      const glb = await saveProject(this.doc, this.vp);
      const thumb = await this.vp.thumbnail(384);
      const st = this.doc.stats();
      this.project = await platform.projects.save(this.project.id, { name: this.doc.name, triangles: st.tris, objects: st.objects, animated: this.doc.hasAnimation() }, glb, thumb);
      if (this.doc.changeCount === changeAtStart) this.doc.dirty = false;
      if (!silent) this.toast('Saved' + (this.doc.link?.live ? ' · updating ' + (this.doc.link.project || 'linked folder') : ''));
    } catch (e) { console.error(e); this.toast('Save failed: ' + e.message); }
    finally { this.saving = null; done(); }
    if (this.doc.link?.live) PL.syncLink(this, false);
  }
  async saveCopy() { const glb = await saveProject(this.doc, this.vp); const p = await platform.files.save(this.doc.name + '.glb', glb, [{ name: 'GLB&ME project', extensions: ['glb'] }]); if (p) this.toast('Project saved — open it in GLB&ME on your phone or PC'); }
  async close() {
    clearInterval(this.autosaveTimer);
    while (this.saving) await this.saving;
    if (this.doc.dirty) await this.save(true);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    window.removeEventListener('pointerup', this.upHandler);
    this.vp.dispose(); this.vp.disposed = true;
    hideTip(); closeMenu(); closeColorPopover();
  }
  async renameProject() {
    const n = await promptDialog('Rename project', this.doc.name);
    if (!n) return;
    this.doc.name = n; this.titleEl.textContent = n; this.project.name = n;
    await platform.projects.rename(this.project.id, n);
  }
  async renameSelected() { const o = this.doc.selected; if (!o) return; const n = await promptDialog('Rename', o.name); if (n) this.actions.rename(o, n); }

  // =========================================================================== live link
  setLinkStatus(state, msg) {
    const l = this.doc.link;
    if (!l) { this.linkChip.style.display = 'none'; return; }
    this.linkChip.style.display = '';
    const label = l.kind === 'godot' ? (l.project || 'Godot') : 'Linked folder';
    mount(this.linkChip, icon(state === 'syncing' ? 'refresh-cw' : l.kind === 'godot' ? 'gamepad-2' : 'folder-sync'), h('span', null, label), h('span', { class: 'ldot ' + (state || 'ok') }));
    this.linkChip.classList.toggle('spin', state === 'syncing');
    this.linkChip.setAttribute('aria-label', `Live link to ${label}: ${state === 'error' ? 'failed – ' + msg : state === 'syncing' ? 'updating' : l.live ? 'updates on save' : 'manual'}`);
    this.linkChip.title = `res://${l.sub ? l.sub + '/' : ''}${l.file} – ${l.live ? 'updates every time you save' : 'sync manually'}`;
  }
  linkMenu(anchor) {
    const l = this.doc.link; if (!l) return;
    menu([{ header: `res://${l.sub ? l.sub + '/' : ''}${l.file}` },
      { label: 'Sync now', icon: 'refresh-cw', onClick: () => PL.syncLink(this, true) },
      { label: 'Update on every save', checked: !!l.live, onClick: () => { l.live = !l.live; this.doc.dirty = true; this.setLinkStatus('ok'); } },
      { label: 'Show exported file', icon: 'folder-open', onClick: () => PL.revealLink(this) },
      l.kind === 'godot' && { label: 'Open project in Godot', icon: 'gamepad-2', onClick: () => PL.openGodot(this) },
      { label: 'Link settings…', icon: 'settings', onClick: () => PL.sendToGodot(this) },
      'sep', { label: 'Stop syncing', icon: 'unlink', danger: true, onClick: () => PL.unlink(this) }], 0, 0, anchor);
  }
  linkHint() {
    const l = this.doc.link; if (!l) return;
    const t = h('div', { class: 'hint', role: 'status' }, icon('circle-check'), h('p', null, `In Godot: res://${l.sub ? l.sub + '/' : ''}${l.file}.${l.opts.format === 'glb' ? 'glb' : 'gltf'}${l.live ? ' – it updates every time you save (Ctrl+S).' : '.'}`),
      btn('Show file', () => { PL.revealLink(this); t.remove(); }, 'ghost'), l.kind === 'godot' ? btn('Open Godot', () => { PL.openGodot(this); t.remove(); }, 'tinted') : null, ibtn('x', 'Dismiss', () => t.remove()));
    mount(this.hintHost, t); setTimeout(() => t.remove(), 14000);
  }

  // =========================================================================== import
  async importFiles() {
    const files = await platform.files.open({ multi: true, filters: [...MODEL_FILTERS, { name: 'Images (as texture or sticker)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }, { name: 'Fonts', extensions: ['ttf', 'otf', 'woff'] }] });
    if (files?.length) this.handleFiles(files);
  }
  async handleFiles(files, initial = false) {
    for (const f of files) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (IMPORT_EXT.includes(ext)) {
        const b = busy('Importing ' + f.name + '…');
        try {
          const r = await importModel(f.name, f.data);
          if (r.isProject && initial && !this.doc.objects.length) { await loadProject(this.doc, this.vp, f.data); }
          else {
            this.actions.addObjects(r.objects, 'Import ' + f.name);
            if (r.clips?.length && !this.doc.clips.length && !this.doc.hasAnimation()) { this.doc.clips = r.clips; this.doc.frameCount = Math.max(this.doc.frameCount, r.frameCount); }
            else if (r.frameCount && r.objects.some((o) => o.ed.keys.size)) this.doc.frameCount = Math.max(this.doc.frameCount, r.frameCount);
          }
          this.vp.frame(this.doc.objects, true);
          const meshes = r.objects.filter(isMesh).length;
          this.toast(`Imported ${meshes} mesh${meshes === 1 ? '' : 'es'}${r.objects.length > meshes ? ` + ${r.objects.length - meshes} other` : ''}`);
          for (const w of r.warnings || []) this.toast(w, 5000);
        } catch (e) { console.error(e); this.toast(`Couldn't import ${f.name}: ${e.message}`, 4000); }
        finally { b.close(); }
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
        S.imageChoice(this, f);
      } else if (['ttf', 'otf', 'woff'].includes(ext)) {
        try { const { importFontFiles } = await import('./fonts.js'); await importFontFiles([f]); this.toast(`Font “${f.name}” added — find it in Text`); } catch (e) { this.toast(e.message, 4000); }
      } else this.toast(`${f.name}: unsupported file type`);
    }
  }

  // =========================================================================== modes & tools
  setMode(m) {
    const o = this.doc.selected;
    if ((m === 'sculpt' || m === 'paint' || m === 'edit') && !isMesh(o)) {
      const first = this.doc.meshes.find((x) => this.doc.isShown(x));
      if (!first) { this.toast('Add a shape first — this mode needs a mesh'); return; }
      this.doc.select(first);
    }
    if ((m === 'sculpt' || m === 'paint' || m === 'edit') && this.doc.selection.length > 1) this.doc.select(this.doc.selected);
    if (m !== 'animate' && this.playing) this.togglePlay(false);
    if (m !== 'object' && m !== 'animate' && this.vp.measure) this.vp.setMeasure(false);
    if (this.vp.eyedrop) this.vp.setEyedrop(null);
    const changed = this.mode !== m;
    this.mode = m; this.vp.mode = m;
    for (const b of this.modeSeg.children) b.setAttribute('aria-checked', String(b.dataset.mode === m));
    const sel = this.doc.selected;
    if ((m === 'sculpt' || m === 'edit') && isMesh(sel) && (sel.ed.prim || sel.ed.text)) this.actions.makeEditable(sel, true);
    if (m === 'sculpt') { this.vp.brushType = this.vp.brushType === 'PAINT' ? 'CLAY' : this.vp.brushType; this.vp.brush = this.brushes[this.vp.brushType]; }
    if (m === 'paint') { this.vp.brush = this.paintBrush; if (isMesh(sel) && this.paintTarget === 'texture') setTimeout(() => this.preparePainting(sel), 50); }
    if (m === 'edit') this.vp.bindFaces();
    if (m === 'sculpt' && isMesh(sel) && sel.geometry.index.count / 3 < 5000) this.hint(`This mesh only has ${Math.round(sel.geometry.index.count / 3)} triangles. Subdivide it (Tool tab) for smoother sculpting.`);
    if (m === 'paint' && changed && !this.settings.seenPaintHint) { this.settings.seenPaintHint = true; this.saveSettings(); this.hint('Paint straight onto the texture. L = line tool (or Shift+click to draw a line from the last point), I = eyedropper, [ ] = brush size, E = eraser.'); }
    if (m === 'edit' && changed && !this.settings.seenFaceHint) { this.settings.seenFaceHint = true; this.saveSettings(); this.hint('Click a face to select it, then drag the arrow to push or pull it – like Shapr3D or SketchUp.'); }
    this.inspectorTab = m === 'object' || m === 'animate' ? (this.inspectorTab === 'tool' ? 'object' : this.inspectorTab) : 'tool';
    this.timeline.style.display = m === 'animate' ? 'flex' : 'none';
    this.el.classList.toggle('animating', m === 'animate');
    this.el.dataset.mode = m;
    this.vp.syncGizmo(); this.vp.syncHelpers(); this.vp.syncFaceOverlay(); this.vp.syncMask();
    this.showCursor(null);
    if (changed) announce(MODES.find((x) => x[0] === m)[1] + ' mode');
    this.refresh();
  }
  setGizmo(id) { if (this.vp.measure) this.vp.setMeasure(false); this.vp.gizmoMode = id; this.vp.syncGizmo(); this.refreshStrip(); announce({ none: 'Select tool – drag for box select', translate: 'Move tool', rotate: 'Rotate tool', scale: 'Scale tool' }[id]); }
  toggleMeasure() {
    if (this.mode !== 'object' && this.mode !== 'animate') this.setMode('object');
    this.vp.setMeasure(!this.vp.measure); this.refreshStrip();
    if (this.vp.measure) { this.toast('Click two points to measure (Esc to finish)'); announce('Measure tool'); }
  }
  setSnap({ on, move, rotate } = {}) {
    if (on != null) this.snap = on; if (move != null) this.snapMove = move; if (rotate != null) this.snapRotate = rotate;
    this.settings.snap = this.snap; this.settings.snapMove = this.snapMove; this.settings.snapRotate = this.snapRotate; this.saveSettings();
    this.applySnap(); this.refresh();
    announce(`Snapping ${this.snap ? 'on, ' + this.snapLabel() + ' and ' + this.snapRotate + ' degrees' : 'off'}`);
  }
  applySnap(invert = false) {
    const on = this.snap !== invert, g = this.vp.gizmo;
    g.setTranslationSnap(on ? this.snapMove : null); g.setRotationSnap(on ? THREE.MathUtils.degToRad(this.snapRotate) : null); g.setScaleSnap(on ? 0.1 : null);
    this.vp.gridMat.uniforms.uStep.value = this.vp.gridMat.uniforms.uStep.value;
  }
  snapLabel() { return P.SNAP_MOVE.find(([v]) => v === this.snapMove)?.[1] || this.formatLength(this.snapMove); }
  snapMenu(anchor) {
    menu([{ label: 'Snapping', checked: this.snap, key: 'Shift+Tab', onClick: () => this.setSnap({ on: !this.snap }) }, 'sep', { header: 'Move' }, ...P.SNAP_MOVE.map(([v, l]) => ({ label: l, checked: this.snapMove === v, onClick: () => this.setSnap({ move: v, on: true }) })), { header: 'Rotate' }, ...P.SNAP_ROT.map((v) => ({ label: v + '°', checked: this.snapRotate === v, onClick: () => this.setSnap({ rotate: v, on: true }) }))], 0, 0, anchor);
  }
  toggleRender(key) { const rs = this.vp.render; rs[key] = !rs[key]; this.doc.dirty = true; this.vp.applyRender(); this.refresh(); announce(`${key === 'xray' ? 'X-ray' : key[0].toUpperCase() + key.slice(1)} ${rs[key] ? 'on' : 'off'}`); }
  toggleUi() { this.el.classList.toggle('ui-hidden'); announce(this.el.classList.contains('ui-hidden') ? 'Interface hidden. Press Control backslash to show it.' : 'Interface shown'); }
  lookThroughCamera() {
    const cams = this.doc.objects.filter(isCamera); if (!cams.length) { this.toast('Add a camera first (Add → Camera)'); return; }
    const c = isCamera(this.doc.selected) ? this.doc.selected : cams[0];
    this.vp.lookThrough(c); this.toast('Viewing through ' + c.name);
  }
  copy() { this.clipboard = this.doc.topSelected(); if (this.clipboard.length) this.toast(`Copied ${this.clipboard.length} object${this.clipboard.length > 1 ? 's' : ''}`); }
  paste() {
    const list = (this.clipboard || []).filter(Boolean); if (!list.length) return;
    const live = list.filter((o) => this.doc.objects.includes(o)), gone = list.filter((o) => !this.doc.objects.includes(o));
    let out = [];
    this.doc.transact('Paste', () => {
      if (live.length) out = this.actions._duplicate(live, true);
      for (const o of gone) { const c = this.actions.cloneObject(o); c.name = this.doc.uniqueName(o.name); c.ed.parent = null; this.doc.attach(c); out.push(c); }
      this.doc.setSelection(out);
    }, []);
  }
  insertKey() { const list = this.doc.topSelected(); if (!list.length) return; this.doc.transact('Set key', () => list.forEach((o) => this.doc.setKey(o)), list); announce(`Keyframe at frame ${this.doc.frame}`); }
  setKeyEasing(mode) { const o = this.doc.selected, f = this.doc.frame; if (!o?.ed.keys.has(f)) { this.toast('Go to a keyframe first'); return; } this.doc.transact('Key easing', () => { const k = o.ed.keys.get(f); if (mode === 'linear') delete k.i; else k.i = mode; }, [o]); }

  // =========================================================================== refresh
  refresh() {
    if (this.panelBusy?.()) { this.pendingRefresh = true; return; }
    this.pendingRefresh = false;
    cancelAnimationFrame(this.refreshRaf);
    this.refreshRaf = requestAnimationFrame(() => {
      this.undoBtn.disabled = !this.doc.history.canUndo; this.redoBtn.disabled = !this.doc.history.canRedo;
      if (this.mode === 'edit' && isMesh(this.doc.selected)) this.vp.bindFaces();
      P.renderLayers(this);
      P.renderInspector(this);
      this.refreshStrip();
      if (this.mode === 'animate') this.renderTimeline();
      this.updateStats();
    });
  }
  refreshStrip() { P.renderStrip(this); }
  refreshLayers() { P.renderLayers(this); }
  updateStats() {
    const s = this.doc.stats(), o = this.doc.selected, n = this.doc.selection.length;
    this.stats.textContent = `${s.objects} object${s.objects === 1 ? '' : 's'} · ${s.tris.toLocaleString()} triangles` + (n > 1 ? ` · ${n} selected` : isMesh(o) ? ` · ${o.name}: ${(o.geometry.index.count / 3).toLocaleString()} tris` : o ? ` · ${o.name}` : '');
  }

  // =========================================================================== animation
  togglePlay(on = !this.playing) {
    this.playing = on;
    if (on && !this.doc.hasAnimation()) { this.toast('Add keyframes or a preset first'); this.playing = false; }
    if (on) { this.playStart = performance.now(); this.playFrom = this.doc.frame >= this.doc.frameCount ? 0 : this.doc.frame; this.vp.gizmo.enabled = false; }
    else { this.vp.gizmo.enabled = true; this.doc.frame = Math.round(this.doc.frame); this.doc.pose(this.doc.frame); this.vp.requestRender(); }
    if (this.mode === 'animate') this.renderTimeline();
    this.refreshStrip();
  }
  tick(now) {
    if (!this.playing) return;
    const range = this.playClip ? [this.playClip.start, this.playClip.end] : [0, this.doc.frameCount];
    const len = range[1] - range[0] + 1;
    const f = (this.playFrom - range[0]) + (now - this.playStart) / 1000 * this.doc.fps;
    this.doc.frame = range[0] + (f % len + len) % len;
    this.doc.pose(this.doc.frame);
    this.vp.requestRender();
    this.drawTimeline();
  }
  setFrame(f) {
    this.doc.frame = Math.max(0, Math.min(this.doc.frameCount, Math.round(f)));
    this.doc.pose(this.doc.frame);
    this.vp.requestRender(); this.drawTimeline(); this.refreshTransformFields?.();
    if (this.mode === 'animate' && this.inspectorTab === 'tool') { clearTimeout(this.frameRefreshT); this.frameRefreshT = setTimeout(() => P.renderInspector(this), 150); }
  }
  renderTimeline() {
    const d = this.doc, o = d.selected;
    this.frameLabel = h('span', { class: 'frame', 'aria-live': 'off' });
    this.tlCanvas = h('canvas', { 'aria-label': 'Timeline. Left and right arrows change frame, Home and End jump to start and end, K adds a keyframe.', role: 'slider', tabindex: '0', 'aria-valuemin': '0', 'aria-valuemax': String(d.frameCount), 'aria-valuenow': String(Math.round(d.frame)) });
    const keyBtn = btn('Key', () => this.insertKey(), 'tinted', 'diamond', ['Set keyframe for selection', 'K']);
    const delKey = ibtn('trash-2', 'Delete keyframe at this frame', () => { const list = d.selection.filter((x) => x.ed.keys.has(d.frame)); if (list.length) d.transact('Delete key', () => list.forEach((x) => x.ed.keys.delete(d.frame)), list); });
    const prevKey = ibtn('skip-back', 'Previous keyframe', () => { const ks = this.allKeyFrames().filter((f) => f < d.frame); this.setFrame(ks.length ? ks[ks.length - 1] : 0); });
    const nextKey = ibtn('skip-forward', 'Next keyframe', () => { const ks = this.allKeyFrames().filter((f) => f > d.frame); this.setFrame(ks.length ? ks[0] : d.frameCount); });
    const play = ibtn(this.playing ? 'pause' : 'play', [this.playing ? 'Pause' : 'Play', 'Space'], () => this.togglePlay(), this.playing ? 'active' : '');
    const presets = btn('Presets', (e) => menu(ANIM_PRESETS.map((p) => ({ label: p.label, icon: p.icon, onClick: () => { if (!o) { this.toast('Select an object'); return; } d.transact('Animation: ' + p.label, () => applyPreset(d, o, p.id), [o]); this.togglePlay(true); } })), 0, 0, e.currentTarget), 'ghost', 'sparkles');
    const easing = btn('Easing', (e) => menu(EASINGS.map(([id, l]) => ({ label: l, checked: (o?.ed.keys.get(d.frame)?.i || 'linear') === id, disabled: !o?.ed.keys.has(d.frame), onClick: () => this.setKeyEasing(id) })), 0, 0, e.currentTarget), 'ghost', 'spline', 'Easing from the key at this frame');
    const clipSel = h('button', { class: 'chip', tip: 'Animation clips (play one, or edit)', onclick: (e) => menu([{ label: 'Whole timeline', checked: !this.playClip, onClick: () => { this.playClip = null; this.renderTimeline(); } }, ...d.clips.map((c) => ({ label: `${c.name} (${c.start}–${c.end})`, checked: this.playClip === c, onClick: () => { this.playClip = c; this.setFrame(c.start); this.renderTimeline(); } })), 'sep', { label: 'Edit clips…', icon: 'film', onClick: () => S.clipsDialog(this) }], 0, 0, e.currentTarget) }, icon('film'), this.playClip ? this.playClip.name : d.clips.length ? `${d.clips.length} clips` : 'Clips');
    const auto = h('button', { class: 'chip' + (this.autoKey ? ' active' : ''), 'aria-pressed': String(this.autoKey), tip: 'Auto-key: moving an object records a keyframe', onclick: () => { this.autoKey = !this.autoKey; this.renderTimeline(); } }, icon('circle-dot'), 'Auto-key');
    const len = h('button', { class: 'chip', tip: 'Animation length & speed', onclick: (e) => menu([{ header: 'Length' }, ...[[30, '1 s'], [60, '2 s'], [90, '3 s'], [120, '4 s'], [180, '6 s'], [300, '10 s'], [600, '20 s']].map(([n, l]) => ({ label: `${l} (${n} frames)`, checked: d.frameCount === n, onClick: () => d.transact('Animation length', () => { d.frameCount = n; }, []) || this.setFrame(Math.min(d.frame, n)) })), { label: 'Custom…', onClick: async () => { const v = await promptDialog('Length in frames', String(d.frameCount)); const n = Math.round(+v); if (n > 0 && n <= 20000) d.transact('Animation length', () => { d.frameCount = n; }, []); } }, 'sep', { header: 'Frame rate' }, ...[24, 25, 30, 60].map((fps) => ({ label: fps + ' fps', checked: d.fps === fps, onClick: () => d.transact('Frame rate', () => { d.fps = fps; }, []) }))], 0, 0, e.currentTarget) }, icon('timer'), `${(d.frameCount / d.fps).toFixed(1)} s · ${d.fps} fps`);
    const clearAll = ibtn('eraser', 'Clear selection animation', () => { const list = d.selection.filter((x) => x.ed.keys.size); if (list.length) d.transact('Clear animation', () => list.forEach((x) => { x.ed.keys = new Map(); }), list); });
    mount(this.timeline, h('div', { class: 'bar' }, play, prevKey, nextKey, this.frameLabel, keyBtn, delKey, easing, presets, clipSel, h('div', { class: 'grow' }), auto, len, clearAll), this.tlCanvas);
    const c = this.tlCanvas;
    const frameAt = (ev) => { const r = c.getBoundingClientRect(); return ((ev.clientX - r.left - 10) / (r.width - 20)) * d.frameCount; };
    const keyAt = (ev) => { const r = c.getBoundingClientRect(), f = frameAt(ev), tol = 6 / ((r.width - 20) / d.frameCount); let best = null; for (const x of d.selection) for (const k of x.ed.keys.keys()) if (Math.abs(k - f) <= tol && (best == null || Math.abs(k - f) < Math.abs(best - f))) best = k; return best; };
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault(); const k = keyAt(e); if (k == null) return; this.setFrame(k);
      menu([{ header: `Key at frame ${k}` }, ...EASINGS.map(([id, l]) => ({ label: l, checked: (o?.ed.keys.get(k)?.i || 'linear') === id, onClick: () => this.setKeyEasing(id) })), 'sep', { label: 'Delete key', icon: 'trash-2', danger: true, onClick: () => { const list = d.selection.filter((x) => x.ed.keys.has(k)); d.transact('Delete key', () => list.forEach((x) => x.ed.keys.delete(k)), list); } }], e.clientX, e.clientY);
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId); if (this.playing) this.togglePlay(false);
      const key = keyAt(e);
      if (key != null) { // drag keys of the selection to a new frame
        const list = d.selection.filter((x) => x.ed.keys.has(key)); let to = key;
        this.keyDrag = { from: key, to };
        const mv = (ev) => { to = Math.max(0, Math.min(d.frameCount, Math.round(frameAt(ev)))); this.keyDrag.to = to; this.drawTimeline(); };
        const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); this.keyDrag = null; if (to !== key) d.transact('Move key', () => list.forEach((x) => { const k = x.ed.keys.get(key); x.ed.keys.delete(key); x.ed.keys.set(to, k); }), list); this.setFrame(to); };
        c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up);
        return;
      }
      const set = (ev) => this.setFrame(frameAt(ev));
      set(e);
      const mv = (ev) => set(ev), up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); };
      c.addEventListener('pointermove', mv); c.addEventListener('pointerup', up);
    });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); this.setFrame(d.frame - (e.shiftKey ? 10 : 1)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); this.setFrame(d.frame + (e.shiftKey ? 10 : 1)); }
      if (e.key === 'Home') { e.preventDefault(); this.setFrame(0); }
      if (e.key === 'End') { e.preventDefault(); this.setFrame(d.frameCount); }
    });
    requestAnimationFrame(() => this.drawTimeline());
  }
  allKeyFrames() { const s = new Set(); for (const o of this.doc.objects) for (const f of o.ed.keys.keys()) s.add(f); return [...s].sort((a, b) => a - b); }
  drawTimeline() {
    const c = this.tlCanvas; if (!c || !c.isConnected) return;
    const d = this.doc, dpr = devicePixelRatio, w = c.clientWidth, hh = c.clientHeight;
    if (c.width !== w * dpr || c.height !== hh * dpr) { c.width = w * dpr; c.height = hh * dpr; }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hh);
    const cs = getComputedStyle(this.el), fg = cs.getPropertyValue('--text').trim() || '#fff', accent = cs.getPropertyValue('--accent-2').trim() || '#8b78ff';
    const x = (f) => 10 + (f / d.frameCount) * (w - 20);
    // clip ranges
    const pal = ['#5b95ff', '#34d399', '#ffb020', '#ff6b9a', '#a78bfa', '#22d3ee'];
    ctx.font = '600 9.5px InterUI, sans-serif';
    d.clips.forEach((cl, i) => { ctx.globalAlpha = this.playClip && this.playClip !== cl ? 0.35 : 0.85; ctx.fillStyle = pal[i % pal.length]; ctx.fillRect(x(cl.start), 1, Math.max(2, x(cl.end) - x(cl.start)), 9); ctx.fillStyle = '#111'; ctx.fillText(cl.name.slice(0, 24), x(cl.start) + 3, 9); });
    ctx.globalAlpha = 1;
    const mid = hh / 2 + 3;
    ctx.fillStyle = 'rgba(128,128,140,0.18)'; ctx.fillRect(10, mid - 9, w - 20, 18);
    ctx.font = '10px InterUI, sans-serif'; ctx.fillStyle = fg; ctx.globalAlpha = 0.45;
    const step = d.frameCount > 300 ? 60 : d.frameCount > 150 ? 30 : d.frameCount > 60 ? 10 : 5;
    for (let f = 0; f <= d.frameCount; f += step) { ctx.fillRect(x(f), mid + 10, 1, 4); if (f % (step * 2) === 0) ctx.fillText(String(f), x(f) - 4, hh - 1); }
    ctx.globalAlpha = 1;
    for (const o of d.objects) for (const [f, k] of o.ed.keys) {
      const mine = d.isSelected(o), drawF = this.keyDrag && mine && f === this.keyDrag.from ? this.keyDrag.to : f;
      ctx.fillStyle = mine ? '#ffc53d' : 'rgba(160,160,170,0.55)';
      ctx.save(); ctx.translate(x(drawF), mid);
      if (k.i === 'step') { const s = mine ? 5 : 3.5; ctx.fillRect(-s, -s, s * 2, s * 2); }
      else if (k.i && k.i !== 'linear') { ctx.beginPath(); ctx.arc(0, 0, mine ? 5.5 : 4, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.rotate(Math.PI / 4); const s = mine ? 5 : 3.5; ctx.fillRect(-s, -s, s * 2, s * 2); }
      ctx.restore();
    }
    ctx.fillStyle = accent; ctx.fillRect(x(d.frame) - 1, 12, 2, hh - 16);
    ctx.beginPath(); ctx.arc(x(d.frame), 15, 5, 0, Math.PI * 2); ctx.fill();
    if (this.frameLabel) this.frameLabel.textContent = `${Math.round(d.frame)} / ${d.frameCount}  ·  ${(d.frame / d.fps).toFixed(2)} s`;
    c.setAttribute('aria-valuenow', String(Math.round(d.frame))); c.setAttribute('aria-valuetext', `Frame ${Math.round(d.frame)} of ${d.frameCount}`);
  }

  // =========================================================================== keyboard
  onKeyUp(e) {
    if (e.key === 'Control' && this.vp.gizmo.dragging) this.applySnap(false);
    if (e.key === 'Alt' && this.altAlone && !anyModalOpen()) { e.preventDefault(); this.menubar.focusFirst(); }
    this.altAlone = false;
  }
  onKey(e) {
    if (!this.el.isConnected) return;
    this.altAlone = e.key === 'Alt' && !e.repeat;
    const t = e.target;
    if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) && t.type !== 'range') return;
    if (anyModalOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), d = this.doc, o = d.selected, a = this.actions;
    // arrow keys, Space, Enter and PageUp/Down belong to whatever control has focus (buttons, sliders, lists);
    // they only drive the scene when the viewport (or nothing in particular) is focused
    const free = t === document.body || t === this.canvas || t === this.el || t === this.tlCanvas;
    if (!free && /^(Arrow|Page|Home|End| |Enter)/.test(e.key === ' ' ? ' ' : e.key) && !ctrl) return;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    const objMode = this.mode === 'object' || this.mode === 'animate';
    if (e.key === 'Control' && this.vp.gizmo.dragging) { this.applySnap(true); return; }
    if (ctrl && (k === 'z' || k === 'y') && (this.vp.drag || this.vp.stroke)) { done(); return; } // not mid-stroke
    if (ctrl) {
      if (k === 'z') { done(); e.shiftKey ? d.redo() : d.undo(); return; }
      if (k === 'y') { done(); d.redo(); return; }
      if (k === 's') { done(); this.save(); return; }
      if (k === 'e') { done(); e.shiftKey ? S.quickExport(this) : S.exportDialog(this); return; }
      if (k === 'i' && e.shiftKey) { done(); a.selectInvert(); return; }
      if (k === 'i') { done(); this.importFiles(); return; }
      if (k === 'd') { done(); a.duplicate(); return; }
      if (k === 'w') { done(); this.app.closeEditor(); return; }
      if (k === 'k') { done(); palette(this); return; }
      if (k === ',') { done(); this.app.settingsDialog(); return; }
      if (e.key === '\\') { done(); this.toggleUi(); return; }
      if (k === 'a') { done(); if (this.mode === 'edit') { const before = Uint8Array.from(this.vp.faces.sel); this.vp.faces.selectAll(); this.vp.pushFaceRecord('Select all faces', before); this.vp.syncFaceOverlay(); this.vp.syncGizmo(); this.refresh(); } else a.selectAll(); return; }
      if (k === 'g') { done(); e.shiftKey ? a.ungroup() : a.group(); return; }
      if (k === 'p') { done(); a.setParent(); return; }
      if (k === 'j') { done(); a.join(); return; }
      if (k === 'c') { done(); this.copy(); return; }
      if (k === 'v') { done(); this.paste(); return; }
      if (e.code === 'Numpad0' && e.altKey) { done(); a.alignCameraToView(); return; }
      if (e.code === 'Numpad1') { done(); this.vp.view('back'); return; }
      if (e.code === 'Numpad3') { done(); this.vp.view('left'); return; }
      if (e.code === 'Numpad7') { done(); this.vp.view('bottom'); return; }
      return;
    }
    if (e.key === 'F3') { done(); palette(this); return; }
    if (e.key === 'F10') { done(); this.menubar.focusFirst(); return; }
    if (e.key === 'F12') { done(); S.exportDialog(this, { format: 'png', preset: null }); return; }
    if (e.key === 'F2') { done(); this.renameSelected(); return; }
    if (e.key === 'Escape') {
      if (this.placement) { this.endPlacement(); return; }
      if (this.vp.eyedrop) { this.vp.setEyedrop(null); return; }
      if (this.vp.measure) { this.vp.setMeasure(false); this.refreshStrip(); return; }
      if (this.mode !== 'object') this.setMode('object'); else d.select(null);
      return;
    }
    if (e.altKey) {
      if (k === 'a') { done(); a.selectNone(); return; }
      if (k === 'h') { done(); a.showAll(); return; }
      if (k === 'p') { done(); a.clearParent(); return; }
      if (k === 'z') { done(); this.toggleRender('xray'); return; }
      const orbit = { ArrowLeft: [15, 0], ArrowRight: [-15, 0], ArrowUp: [0, 15], ArrowDown: [0, -15] }[e.key];
      if (orbit) { done(); this.vp.orbitBy(...orbit); return; }
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) { done(); this.setSnap({ on: !this.snap }); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { done(); if (this.mode === 'edit') a.deleteFaces(); else a.remove(); return; }
    if (e.key === '?' || (e.shiftKey && k === '/')) { done(); S.shortcutsDialog(this); return; }
    if (e.shiftKey && k === 'a') { done(); S.addMenu(this); return; }
    if (e.shiftKey && k === 'h') { done(); a.hideUnselected(); return; }
    if (e.shiftKey && k === 'z') { done(); this.toggleRender('wireframe'); return; }
    const modeKeys = { '1': 'object', '2': 'sculpt', '3': 'paint', '4': 'edit', '5': 'animate' };
    if (modeKeys[e.key] && e.code.startsWith('Digit')) { done(); this.setMode(modeKeys[e.key]); return; }
    // camera from the keyboard (numpad like Blender, plus = / - zoom)
    const views = { Numpad1: 'front', Numpad3: 'right', Numpad7: 'top' };
    if (views[e.code]) { done(); this.vp.view(views[e.code]); return; }
    if (e.code === 'Numpad5') { done(); this.vp.render.ortho = !this.vp.render.ortho; this.vp.applyRender(); this.refresh(); return; }
    if (e.code === 'Numpad0') { done(); this.lookThroughCamera(); return; }
    const orbit = { Numpad4: [15, 0], Numpad6: [-15, 0], Numpad8: [0, 15], Numpad2: [0, -15] }[e.code];
    if (orbit) { done(); this.vp.orbitBy(...orbit); return; }
    if (e.code === 'NumpadAdd' || e.key === '=' || e.key === '+') { done(); this.vp.zoomBy(1 / 1.2); return; }
    if (e.code === 'NumpadSubtract' || (e.key === '-' && !e.shiftKey)) { done(); this.vp.zoomBy(1.2); return; }
    if (k === 'f') { done(); this.vp.frame(); return; }
    if (e.key === 'Home') { done(); this.vp.frame(this.doc.objects); return; }
    if (k === 'h' && o) { done(); a.toggleVisible(); return; }
    if (k === 't' && !e.shiftKey && this.mode !== 'paint') { done(); S.textStudio(this); return; }
    if (objMode) {
      const g = { q: 'none', w: 'translate', e: 'rotate', r: 'scale' }[k];
      if (g) { done(); this.setGizmo(g); return; }
      if (k === 'm') { done(); this.toggleMeasure(); return; }
      if (e.key === '[' || e.key === ']') { done(); a.cycle(e.key === '[' ? -1 : 1); return; }
      // nudge the selection with the arrow keys (camera-relative left/right, world up/down; PageUp/Down = depth)
      const arrows = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', PageUp: 'f', PageDown: 'b' };
      if (arrows[e.key] && d.selection.length && this.mode !== 'animate') {
        done();
        const step = (this.snapMove || 0.1) * (e.shiftKey ? 10 : 1);
        const cam = this.vp.camera, right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
        const snapAxis = (v) => { v.y = 0; const ax = Math.abs(v.x) > Math.abs(v.z) ? new THREE.Vector3(Math.sign(v.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(v.z) || 1); return ax; };
        const dir = { l: snapAxis(right).negate(), r: snapAxis(right), u: new THREE.Vector3(0, 1, 0), d: new THREE.Vector3(0, -1, 0), f: snapAxis(fwd), b: snapAxis(fwd).negate() }[arrows[e.key]];
        a.nudge(dir.multiplyScalar(step));
        announce(`Moved ${this.formatLength(step)}`);
        return;
      }
    }
    if (this.mode === 'animate') {
      if (e.key === ' ') { done(); this.togglePlay(); return; }
      if (k === 'k') { done(); this.insertKey(); return; }
      if (e.key === 'ArrowLeft') { done(); this.setFrame(d.frame - (e.shiftKey ? 10 : 1)); return; }
      if (e.key === 'ArrowRight') { done(); this.setFrame(d.frame + (e.shiftKey ? 10 : 1)); return; }
    }
    if (this.mode === 'sculpt' || this.mode === 'paint' || this.mode === 'edit') {
      if (e.key === '[') { done(); this.resizeBrush(1 / 1.15); return; }
      if (e.key === ']') { done(); this.resizeBrush(1.15); return; }
      if (this.mode === 'sculpt') {
        const map = { c: 'CLAY', d: 'DRAW', s: 'SMOOTH', i: 'INFLATE', p: 'PINCH', g: 'MOVE', m: 'MASK', l: 'LAYER' };
        if (map[k]) { done(); this.setBrush(map[k]); return; }
        if (k === 'x') { done(); this.sym[0] = !this.sym[0]; this.toast('Symmetry X ' + (this.sym[0] ? 'on' : 'off')); this.refresh(); return; }
      }
      if (this.mode === 'paint') {
        if (k === 'i') { done(); this.eyedropper(); return; }
        if (k === 'l') { done(); this.paintBrush.line = !this.paintBrush.line; announce(this.paintBrush.line ? 'Line tool' : 'Brush tool'); this.refresh(); return; }
        if (k === 'b') { done(); this.paintBrush.line = false; announce('Brush tool'); this.refresh(); return; }
        if (k === 'e') { done(); this.paintBrush.negative = !this.paintBrush.negative; announce(this.paintBrush.negative ? 'Eraser' : 'Paint'); this.refresh(); return; }
        if (k === 'x') { done(); this.sym[0] = !this.sym[0]; this.toast('Mirror X ' + (this.sym[0] ? 'on' : 'off') + (this.paintTarget === 'texture' ? ' (vertex paint only)' : '')); this.refresh(); return; }
      }
    }
  }
  setBrush(id) { this.vp.brushType = id; this.vp.brush = this.brushes[id]; announce(BRUSHES.find((b) => b.id === id)?.label + ' brush'); this.refresh(); }

  // =========================================================================== placement / hints / misc
  startPlacement(text, onPick) {
    this.endPlacement();
    const bar = h('div', { class: 'placement', role: 'status' }, icon('crosshair'), text, btn('Cancel', () => this.endPlacement(), 'ghost'));
    this.el.appendChild(bar);
    this.placement = bar;
    this.vp.placement = { onPick: (hit, e) => { const ok = onPick(hit, e); if (ok !== false && !e.shiftKey) this.endPlacement(); } };
    this.vp.syncGizmo();
    this.canvas.style.cursor = 'crosshair';
  }
  endPlacement() { if (this.placement) { this.placement.remove(); this.placement = null; } this.vp.placement = null; this.canvas.style.cursor = ''; this.vp.syncGizmo(); }
  hint(text, onDismiss) {
    if (this.settings.tips === false) return;
    const el = h('div', { class: 'hint', role: 'status' }, icon('lightbulb'), h('p', null, text), btn('Got it', () => { el.remove(); onDismiss?.(); }, 'tinted'));
    mount(this.hintHost, el);
    setTimeout(() => { if (el.isConnected) { el.remove(); onDismiss?.(); } }, onDismiss ? 20000 : 12000);
  }
  toast(t, ms) { toast(t, ms); }
  busy(t) { return busy(t); }
  async confirm(title, text, ok, danger) { return confirmDialog(title, text, ok, danger); }
}
export { THREE, isLight, isGroup };
import { exportModel as _exportModel, buildScene as _buildScene, parseGltf as _parseGltf, importModel as _importModel, zip as _zip } from './io.js';
import { applyPattern as _ap, defaultSpec as _ds } from './textures.js';
window.glbmeDebug = { exportModel: _exportModel, buildScene: _buildScene, saveProject, applyPattern: _ap, defaultSpec: _ds, uvOverlap, pipeline: PL, platform, parseGltf: _parseGltf, importModel: _importModel, zip: _zip, studios: S, THREE };
