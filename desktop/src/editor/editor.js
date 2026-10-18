// The editor screen: viewport + layers + inspector + mode toolbar + timeline, keyboard & mouse
// shortcuts, autosave and the project lifecycle.
import * as THREE from 'three';
import { h, icon, ibtn, btn, tool, mount, toast, menu, busy, confirmDialog, anyModalOpen, hideTip, closeMenu } from '../ui/dom.js';
import { Doc, isMesh, isLight, ANIM_PRESETS, applyPreset } from './model.js';
import { Viewport } from './viewport.js';
import { Actions } from './actions.js';
import { saveProject, loadProject, importModel, IMPORT_EXT } from './io.js';
import { BRUSHES, defaultBrush } from '../core/sculpt.js';
import { platform, MODEL_FILTERS } from '../platform.js';
import * as P from './panels.js';
import * as S from './studios.js';

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
    this.paintBrush = { ...defaultBrush('PAINT'), color: [0.8, 0.2, 0.2, 1], hex: '#d13a3a' };
    this.sym = [true, false, false];
    this.inspectorTab = 'object';
    this.playing = false; this.autoKey = true;
    this.build();
    this.vp = new Viewport(this.canvas, this.doc, this.viewportHost());
    this.vp.gizmoMode = 'translate';
    this.vp.renderer.setPixelRatio(Math.min(this.settings.pixelRatio || 2, devicePixelRatio)); this.vp.resize();
    this.vp.brush = this.brushes.CLAY; this.vp.brushType = 'CLAY';
    this.actions = new Actions(this);
    this.doc.addEventListener('change', (e) => { if (e.detail !== 'noop') this.refresh(); });
    this.doc.addEventListener('history', (e) => this.toast(e.detail));
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    this.autosaveTimer = setInterval(() => { if (this.doc.dirty && !this.saving && this.project) this.save(true); }, 45000);
  }

  // =========================================================================== layout
  build() {
    this.canvas = h('canvas', { class: 'viewport', 'aria-label': '3D viewport. Left-drag to orbit, right-drag to orbit, middle-drag or Shift-drag to pan, wheel to zoom.' });
    this.cursor = h('div', { class: 'brushcursor', style: { display: 'none' } });
    this.titleEl = h('span', null, 'Untitled');
    this.undoBtn = ibtn('undo-2', ['Undo', 'Ctrl+Z'], () => { if (!this.vp.drag) this.doc.undo(); });
    this.redoBtn = ibtn('redo-2', ['Redo', 'Ctrl+Shift+Z'], () => { if (!this.vp.drag) this.doc.redo(); });
    this.modeSeg = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Editing mode' });
    for (const [id, label, ic, key] of MODES) {
      this.modeSeg.appendChild(h('button', { role: 'radio', 'aria-checked': String(id === 'object'), 'data-mode': id, tip: [label + ' mode', key], onclick: () => this.setMode(id) }, icon(ic), label));
    }
    const plat = platform.platform || '';
    this.titlebar = h('div', { class: 'titlebar solid' + (plat === 'darwin' ? ' mac' : plat ? ' win' : '') },
      ibtn('house', ['Projects', 'Ctrl+W'], () => this.app.closeEditor()),
      h('button', { class: 'ptitle btn ghost', tip: 'Rename project', onclick: () => this.renameProject() }, this.titleEl, icon('pencil', 'sm')),
      this.undoBtn, this.redoBtn,
      h('div', { class: 'spacer' }),
      this.modeSeg,
      h('div', { class: 'spacer' }),
      btn('Add', () => S.addMenu(this), 'tinted', 'plus', ['Add shape, text, light…', 'Shift+A']),
      btn('Import', () => this.importFiles(), 'ghost', 'download', ['Import model or image', 'Ctrl+I']),
      btn('Export', () => S.exportDialog(this), 'primary', 'share', ['Export', 'Ctrl+E']),
      ibtn('ellipsis', 'More', (e) => this.moreMenu(e.currentTarget)),
    );
    this.layersEl = h('div', { class: 'pbody', role: 'tree', 'aria-label': 'Objects' });
    this.left = h('aside', { class: 'panel left', 'aria-label': 'Layers' },
      h('div', { class: 'phead' }, h('h3', null, 'Layers'), ibtn('plus', ['Add', 'Shift+A'], () => S.addMenu(this)), ibtn('eye', ['Show all', 'Alt+H'], () => this.actions.showAll())),
      this.layersEl,
      h('div', { style: { padding: '6px 8px', borderTop: '1px solid var(--stroke)', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px' } },
        tool('shapes', 'Shapes', () => S.shapesDialog(this)), tool('type', 'Text', () => S.textStudio(this), false, ['3D text', 'T']), tool('pen-tool', 'Draw', () => S.drawStudio(this), false, 'Draw to 3D'), tool('lightbulb', 'Light', (e) => menu([{ label: 'Point light', icon: 'lightbulb', onClick: () => this.actions.addLight('point') }, { label: 'Spot light', icon: 'flashlight', onClick: () => this.actions.addLight('spot') }, { label: 'Sun light', icon: 'sun', onClick: () => this.actions.addLight('directional') }], 0, 0, e.currentTarget), false, 'Add a light')),
    );
    this.rightBody = h('div', { class: 'pbody' });
    this.tabsEl = h('div', { class: 'tabs' });
    this.right = h('aside', { class: 'panel right', 'aria-label': 'Inspector' }, h('div', { class: 'phead' }, this.rightTitle = h('h3', null, 'Inspector'), this.rightTools = h('div', { class: 'row' })), this.tabsEl, this.rightBody);
    let busyPanel = false;
    this.right.addEventListener('pointerdown', () => { busyPanel = true; });
    this.upHandler = () => { if (busyPanel) { busyPanel = false; if (this.pendingRefresh) setTimeout(() => this.refresh(), 0); } };
    window.addEventListener('pointerup', this.upHandler);
    this.panelBusy = () => busyPanel || (this.right.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== 'range');
    this.strip = h('div', { class: 'strip', role: 'toolbar', 'aria-label': 'Tools' });
    this.timeline = h('div', { class: 'timeline', style: { display: 'none' }, role: 'region', 'aria-label': 'Timeline' });
    this.stats = h('div', { class: 'stats', 'aria-live': 'off' });
    this.hintHost = h('div');
    this.el = h('div', { class: 'editor' }, this.canvas, this.cursor, this.titlebar, this.left, this.right, this.strip, this.timeline, this.stats, this.hintHost);
    mount(this.root, this.el);
    // drag & drop files
    this.el.addEventListener('dragover', (e) => { e.preventDefault(); this.app.showDrop(true); });
    this.el.addEventListener('dragleave', (e) => { if (e.target === this.el || e.target === this.canvas) this.app.showDrop(false); });
    this.el.addEventListener('drop', async (e) => {
      e.preventDefault(); this.app.showDrop(false);
      const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, path: f.path, data: await f.arrayBuffer() })));
      this.handleFiles(files);
    });
  }

  viewportHost() {
    return {
      onPickObject: (o) => { this.doc.select(o); },
      onGizmoStart: () => { this.gizmoTok = this.doc.begin(this.vp.gizmoMode === 'rotate' ? 'Rotate' : this.vp.gizmoMode === 'scale' ? 'Scale' : 'Move'); },
      onGizmoEnd: () => {
        if (!this.gizmoTok) return;
        const o = this.doc.selected;
        if (this.mode === 'animate' && this.autoKey && o) this.doc.setKey(o);
        this.doc.commit(this.gizmoTok); this.gizmoTok = null;
      },
      onGizmoChange: () => { this.refreshTransformFields?.(); this.updateStats(); },
      onBrushCursor: (c) => this.showCursor(c),
      onBrushResize: (k) => this.resizeBrush(k),
      onFacesChanged: () => this.refresh(),
      onFrame: (now) => this.tick(now),
      onCamera: () => {},
      symmetry: () => this.sym,
    };
  }
  showCursor(c) {
    if (!c) { this.cursor.style.display = 'none'; return; }
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.cursor.style, { display: 'block', left: c.x - r.left + 'px', top: c.y - r.top + 'px', width: c.r * 2 + 'px', height: c.r * 2 + 'px' });
    this.cursor.classList.toggle('neg', !!c.neg);
  }
  resizeBrush(k) {
    if (this.mode === 'edit') { this.vp.faceTool.radiusPx = Math.max(4, Math.min(400, this.vp.faceTool.radiusPx * k)); }
    else { const b = this.vp.brush; b.radiusPx = Math.max(4, Math.min(500, b.radiusPx * k)); }
    const p = this.vp.pointer; this.vp.hover({ clientX: p.x, clientY: p.y, ctrlKey: false });
    this.refreshStrip();
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
      this.doc.dirty = false; this.doc.changeCount = 0;
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
    this.refresh();
    if (!this.settings.seenEditorHint) setTimeout(() => this.hint('Drag to orbit • Right-drag or Shift-drag to pan • Scroll to zoom • F to frame. Press ? for all shortcuts.', () => { this.settings.seenEditorHint = true; this.saveSettings(); }), 700);
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
      if (!silent) this.toast('Saved');
    } catch (e) { console.error(e); this.toast('Save failed: ' + e.message); }
    finally { this.saving = null; done(); }
  }
  async close() {
    clearInterval(this.autosaveTimer);
    while (this.saving) await this.saving;
    if (this.doc.dirty) await this.save(true);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('pointerup', this.upHandler);
    this.vp.dispose(); this.vp.disposed = true;
    hideTip(); closeMenu();
  }
  async renameProject() {
    const { promptDialog } = await import('../ui/dom.js');
    const n = await promptDialog('Rename project', this.doc.name);
    if (!n) return;
    this.doc.name = n; this.titleEl.textContent = n; this.project.name = n;
    await platform.projects.rename(this.project.id, n);
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
          else this.actions.addObjects(r.objects, 'Import ' + f.name);
          this.vp.frame(this.doc.objects, true);
          this.toast(`Imported ${r.objects.length} object${r.objects.length === 1 ? '' : 's'}`);
        } catch (e) { console.error(e); this.toast(`Couldn't import ${f.name}: ${e.message}`, 4000); }
        finally { b.close(); }
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
        S.imageChoice(this, f);
      } else if (['ttf', 'otf', 'woff'].includes(ext)) {
        try { const { importFontFiles } = await import('./fonts.js'); await importFontFiles([f]); this.toast(`Font “${f.name}” added — find it in Text`); } catch (e) { this.toast(e.message, 4000); }
      } else this.toast(`${f.name}: unsupported file type`);
    }
  }

  // =========================================================================== modes
  setMode(m) {
    const o = this.doc.selected;
    if ((m === 'sculpt' || m === 'paint' || m === 'edit') && !isMesh(o)) {
      const first = this.doc.meshes.find((x) => x.visible);
      if (!first) { this.toast('Add a shape first — sculpting needs a mesh'); return; }
      this.doc.select(first);
    }
    if (m !== 'animate' && this.playing) this.togglePlay(false);
    this.mode = m; this.vp.mode = m;
    for (const b of this.modeSeg.children) b.setAttribute('aria-checked', String(b.dataset.mode === m));
    const sel = this.doc.selected;
    if ((m === 'sculpt' || m === 'paint' || m === 'edit') && isMesh(sel) && (sel.ed.prim || sel.ed.text)) this.actions.makeEditable(sel, true);
    if (m === 'sculpt') { this.vp.brushType = this.vp.brushType === 'PAINT' ? 'CLAY' : this.vp.brushType; this.vp.brush = this.brushes[this.vp.brushType]; }
    if (m === 'paint') { this.vp.brush = this.paintBrush; }
    if (m === 'edit') this.vp.bindFaces();
    if (m === 'sculpt' && isMesh(sel) && sel.geometry.index.count / 3 < 5000) this.hint(`This mesh only has ${Math.round(sel.geometry.index.count / 3)} triangles. Subdivide it (Tool tab) for smoother sculpting.`);
    this.inspectorTab = m === 'object' || m === 'animate' ? (this.inspectorTab === 'tool' ? 'object' : this.inspectorTab) : 'tool';
    this.timeline.style.display = m === 'animate' ? 'flex' : 'none';
    this.el.classList.toggle('animating', m === 'animate');
    this.vp.syncGizmo(); this.vp.syncHelpers(); this.vp.syncFaceOverlay(); this.vp.syncMask();
    this.showCursor(null);
    this.refresh();
  }

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
    const s = this.doc.stats(), o = this.doc.selected;
    this.stats.textContent = `${s.objects} object${s.objects === 1 ? '' : 's'} · ${s.tris.toLocaleString()} triangles` + (isMesh(o) ? ` · ${o.name}: ${(o.geometry.index.count / 3).toLocaleString()} tris` : '');
  }

  // =========================================================================== animation
  togglePlay(on = !this.playing) {
    this.playing = on;
    if (on && !this.doc.hasAnimation()) { this.toast('Add keyframes or a preset first'); this.playing = false; }
    if (on) { this.playStart = performance.now(); this.playFrom = this.doc.frame >= this.doc.frameCount ? 0 : this.doc.frame; this.vp.gizmo.enabled = false; }
    else { this.vp.gizmo.enabled = true; this.doc.frame = Math.round(this.doc.frame); this.doc.pose(this.doc.frame); this.vp.requestRender(); }
    this.renderTimeline(); this.refreshStrip();
  }
  tick(now) {
    if (!this.playing) return;
    const f = this.playFrom + (now - this.playStart) / 1000 * this.doc.fps;
    this.doc.frame = f % (this.doc.frameCount + 1);
    this.doc.pose(this.doc.frame);
    this.vp.requestRender();
    this.drawTimeline();
  }
  setFrame(f) {
    this.doc.frame = Math.max(0, Math.min(this.doc.frameCount, Math.round(f)));
    this.doc.pose(this.doc.frame);
    this.vp.requestRender(); this.drawTimeline(); this.refreshTransformFields?.();
  }
  renderTimeline() {
    const d = this.doc, o = d.selected;
    this.frameLabel = h('span', { class: 'frame' });
    this.tlCanvas = h('canvas', { 'aria-label': 'Timeline scrubber', tabindex: '0' });
    const keyBtn = btn('Key', () => { if (!o) return; d.transact('Set key', () => d.setKey(o), [o]); }, 'tinted', 'diamond', ['Set keyframe for selection', 'K']);
    const delKey = ibtn('trash-2', 'Delete keyframe at this frame', () => { if (!o || !o.ed.keys.has(d.frame)) return; d.transact('Delete key', () => o.ed.keys.delete(d.frame), [o]); });
    const prevKey = ibtn('skip-back', 'Previous keyframe', () => { const ks = this.allKeyFrames().filter((f) => f < d.frame); this.setFrame(ks.length ? ks[ks.length - 1] : 0); });
    const nextKey = ibtn('skip-forward', 'Next keyframe', () => { const ks = this.allKeyFrames().filter((f) => f > d.frame); this.setFrame(ks.length ? ks[0] : d.frameCount); });
    const play = ibtn(this.playing ? 'pause' : 'play', [this.playing ? 'Pause' : 'Play', 'Space'], () => this.togglePlay(), this.playing ? 'active' : '');
    const presets = btn('Presets', (e) => menu(ANIM_PRESETS.map((p) => ({ label: p.label, icon: p.icon, onClick: () => { if (!o) { this.toast('Select an object'); return; } d.transact('Animation: ' + p.label, () => applyPreset(d, o, p.id), [o]); this.togglePlay(true); } })), 0, 0, e.currentTarget), 'ghost', 'sparkles');
    const auto = h('button', { class: 'chip' + (this.autoKey ? ' active' : ''), 'aria-pressed': String(this.autoKey), tip: 'Auto-key: moving an object records a keyframe', onclick: () => { this.autoKey = !this.autoKey; this.renderTimeline(); } }, icon('circle-dot'), 'Auto-key');
    const len = h('button', { class: 'chip', tip: 'Animation length & speed', onclick: (e) => menu([{ header: 'Length' }, ...[[30, '1 s'], [60, '2 s'], [90, '3 s'], [120, '4 s'], [180, '6 s'], [300, '10 s']].map(([n, l]) => ({ label: `${l} (${n} frames)`, onClick: () => { d.frameCount = n; this.setFrame(Math.min(d.frame, n)); this.renderTimeline(); d.dirty = true; } })), 'sep', { header: 'Frame rate' }, ...[24, 30, 60].map((fps) => ({ label: fps + ' fps', onClick: () => { d.fps = fps; this.renderTimeline(); d.dirty = true; } }))], 0, 0, e.currentTarget) }, icon('timer'), `${(d.frameCount / d.fps).toFixed(1)} s · ${d.fps} fps`);
    const clearAll = ibtn('eraser', 'Clear selection animation', () => { if (o?.ed.keys.size) d.transact('Clear animation', () => { o.ed.keys = new Map(); }, [o]); });
    mount(this.timeline, h('div', { class: 'bar' }, play, prevKey, nextKey, this.frameLabel, keyBtn, delKey, presets, h('div', { class: 'grow' }), auto, len, clearAll), this.tlCanvas);
    this.tlCanvas.addEventListener('pointerdown', (e) => {
      this.tlCanvas.setPointerCapture(e.pointerId); if (this.playing) this.togglePlay(false);
      const set = (ev) => { const r = this.tlCanvas.getBoundingClientRect(); this.setFrame(((ev.clientX - r.left - 10) / (r.width - 20)) * d.frameCount); };
      set(e);
      const mv = (ev) => set(ev), up = () => { this.tlCanvas.removeEventListener('pointermove', mv); this.tlCanvas.removeEventListener('pointerup', up); };
      this.tlCanvas.addEventListener('pointermove', mv); this.tlCanvas.addEventListener('pointerup', up);
    });
    this.tlCanvas.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); this.setFrame(d.frame - 1); } if (e.key === 'ArrowRight') { e.preventDefault(); this.setFrame(d.frame + 1); } });
    requestAnimationFrame(() => this.drawTimeline());
  }
  allKeyFrames() { const s = new Set(); for (const o of this.doc.objects) for (const f of o.ed.keys.keys()) s.add(f); return [...s].sort((a, b) => a - b); }
  drawTimeline() {
    const c = this.tlCanvas; if (!c || !c.isConnected) return;
    const d = this.doc, dpr = devicePixelRatio, w = c.clientWidth, hh = c.clientHeight;
    if (c.width !== w * dpr || c.height !== hh * dpr) { c.width = w * dpr; c.height = hh * dpr; }
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hh);
    const x = (f) => 10 + (f / d.frameCount) * (w - 20);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(10, hh / 2 - 9, w - 20, 18);
    ctx.font = '10px InterUI, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
    const step = d.frameCount > 150 ? 30 : d.frameCount > 60 ? 10 : 5;
    for (let f = 0; f <= d.frameCount; f += step) { ctx.fillRect(x(f), hh / 2 + 10, 1, 4); if (f % (step * 2) === 0) ctx.fillText(String(f), x(f) - 4, hh - 1); }
    const sel = d.selected;
    for (const o of d.objects) for (const f of o.ed.keys.keys()) {
      const mine = o === sel;
      ctx.fillStyle = mine ? '#ffc53d' : 'rgba(255,255,255,0.35)';
      ctx.save(); ctx.translate(x(f), hh / 2); ctx.rotate(Math.PI / 4); const s = mine ? 5 : 3.5; ctx.fillRect(-s, -s, s * 2, s * 2); ctx.restore();
    }
    ctx.fillStyle = '#8b78ff'; ctx.fillRect(x(d.frame) - 1, 2, 2, hh - 6);
    ctx.beginPath(); ctx.arc(x(d.frame), 5, 5, 0, Math.PI * 2); ctx.fill();
    if (this.frameLabel) this.frameLabel.textContent = `${Math.round(d.frame)} / ${d.frameCount}  ·  ${(d.frame / d.fps).toFixed(2)} s`;
  }

  // =========================================================================== keyboard
  onKey(e) {
    if (!this.el.isConnected) return;
    const t = e.target;
    if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) && t.type !== 'range') return;
    if (anyModalOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), d = this.doc, o = d.selected, a = this.actions;
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    if (ctrl && (k === 'z' || k === 'y') && (this.vp.drag || this.vp.stroke)) { done(); return; } // not mid-stroke
    if (ctrl && k === 'z') { done(); e.shiftKey ? d.redo() : d.undo(); return; }
    if (ctrl && k === 'y') { done(); d.redo(); return; }
    if (ctrl && k === 's') { done(); this.save(); return; }
    if (ctrl && k === 'e') { done(); S.exportDialog(this); return; }
    if (ctrl && k === 'i') { done(); this.importFiles(); return; }
    if (ctrl && k === 'd') { done(); a.duplicate(); return; }
    if (ctrl && k === 'w') { done(); this.app.closeEditor(); return; }
    if (ctrl && k === 'a' && this.mode === 'edit') { done(); this.vp.faces.selectAll(); this.vp.syncFaceOverlay(); this.refresh(); return; }
    if (ctrl) return;
    if (e.key === 'Escape') { if (this.placement) { this.endPlacement(); return; } if (this.mode !== 'object') this.setMode('object'); else d.select(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { done(); if (this.mode === 'edit') a.deleteFaces(); else a.remove(); return; }
    if (e.key === 'Tab') { done(); this.el.classList.toggle('ui-hidden'); return; }
    if (e.key === '?' || (e.shiftKey && k === '/')) { done(); S.shortcutsDialog(this); return; }
    if (e.shiftKey && k === 'a') { done(); S.addMenu(this); return; }
    if (e.altKey && k === 'h') { done(); a.showAll(); return; }
    const modeKeys = { '1': 'object', '2': 'sculpt', '3': 'paint', '4': 'edit', '5': 'animate' };
    if (modeKeys[e.key] && !e.altKey && e.code.startsWith('Digit')) { done(); this.setMode(modeKeys[e.key]); return; }
    if (e.code === 'Numpad1') { done(); this.vp.view(e.ctrlKey ? 'back' : 'front'); return; }
    if (e.code === 'Numpad3') { done(); this.vp.view('right'); return; }
    if (e.code === 'Numpad7') { done(); this.vp.view('top'); return; }
    if (e.code === 'Numpad5') { done(); this.vp.render.ortho = !this.vp.render.ortho; this.vp.applyRender(); this.refresh(); return; }
    if (k === 'f') { done(); this.vp.frame(); return; }
    if (e.key === 'Home') { done(); this.vp.frame(this.doc.objects); return; }
    if (k === 'h' && o) { done(); a.setVisible(o, !o.visible); return; }
    if (k === 't' && !e.shiftKey) { done(); S.textStudio(this); return; }
    if (this.mode === 'object' || this.mode === 'animate') {
      const g = { w: 'translate', e: 'rotate', r: 'scale', q: 'none' }[k];
      if (g) { done(); this.vp.gizmoMode = g; this.vp.syncGizmo(); this.refreshStrip(); return; }
    }
    if (this.mode === 'animate') {
      if (e.key === ' ') { done(); this.togglePlay(); return; }
      if (k === 'k' && o) { done(); d.transact('Set key', () => d.setKey(o), [o]); return; }
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
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (this.mode === 'object' && d.objects.length) { done(); const i = d.objects.indexOf(o); const n = d.objects[Math.max(0, Math.min(d.objects.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; d.select(n); }
    }
  }
  setBrush(id) { this.vp.brushType = id; this.vp.brush = this.brushes[id]; this.refresh(); }

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
    setTimeout(() => { if (el.isConnected) { el.remove(); onDismiss?.(); } }, onDismiss ? 20000 : 9000);
  }
  toast(t, ms) { toast(t, ms); }
  busy(t) { return busy(t); }
  moreMenu(anchor) {
    menu([
      { label: 'Save', icon: 'save', key: 'Ctrl+S', onClick: () => this.save() },
      { label: 'Save a copy as GLB project…', icon: 'file-down', onClick: async () => { const glb = await saveProject(this.doc, this.vp); const p = await platform.files.save(this.doc.name + '.glb', glb, [{ name: 'GLB&ME project', extensions: ['glb'] }]); if (p) this.toast('Project saved — open it in GLB&ME on your phone or PC'); } },
      'sep',
      { label: 'Textures & stickers', icon: 'image', onClick: () => S.textureLibrary(this) },
      { label: 'Keyboard shortcuts', icon: 'keyboard', key: '?', onClick: () => S.shortcutsDialog(this) },
      { label: 'Settings', icon: 'settings', onClick: () => this.app.settingsDialog() },
      { label: this.el.classList.contains('ui-hidden') ? 'Show interface' : 'Hide interface', icon: 'eye-off', key: 'Tab', onClick: () => this.el.classList.toggle('ui-hidden') },
      'sep',
      { label: 'Close project', icon: 'x', key: 'Ctrl+W', onClick: () => this.app.closeEditor() },
    ], 0, 0, anchor);
  }
  async confirm(title, text, ok, danger) { return confirmDialog(title, text, ok, danger); }
}
export { THREE, isLight };
import { exportModel as _exportModel, buildScene as _buildScene } from './io.js';
window.glbmeDebug = { exportModel: _exportModel, buildScene: _buildScene, saveProject };
