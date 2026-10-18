// GLB&ME desktop – app shell: home library, editor routing, settings, welcome, file opening.
import { h, icon, ibtn, btn, mount, modal, menu, toast, seg, toggle, section, promptDialog, confirmDialog, busy } from './ui/dom.js';
import { platform, isDesktop, MODEL_FILTERS } from './platform.js';
import { Editor } from './editor/editor.js';
import { templateList } from './editor/studios.js';
import { bytes } from './editor/studios.js';

const SETTINGS_KEY = 'glbandme.settings';
const VERSION = '1.1.0';

class App {
  constructor() {
    this.root = document.getElementById('app');
    try { this.settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { this.settings = {}; }
    this.applySettings();
    this.query = ''; this.sort = this.settings.sort || 'recent';
    this.drop = h('div', { class: 'dropzone', style: { display: 'none' } }, icon('download'), ' Drop to import');
    document.body.appendChild(this.drop);
    this.showHome();
    if (!this.settings.welcomed) setTimeout(() => this.welcome(), 400);
    platform.app.onOpenFile?.((p) => this.openPath(p));
    platform.app.pending?.().then((list) => list?.forEach((p) => this.openPath(p)));
    window.addEventListener('beforeunload', () => { if (this.editor?.doc.dirty) this.editor.save(true); });
    platform.app.onClosing?.(async () => {
      try { if (this.editor) { while (this.editor.saving) await this.editor.saving; if (this.editor.doc.dirty) await this.editor.save(true); } } catch (e) { console.error(e); }
      platform.app.closeReady();
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
  }
  saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* private mode */ } this.applySettings(); }
  applySettings() {
    const c = document.documentElement.classList, s = this.settings;
    c.toggle('reduce-motion', s.reduceMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches);
    c.toggle('large-ui', s.uiSize === 'large'); c.toggle('xlarge-ui', s.uiSize === 'xlarge');
  }
  showDrop(on) { this.drop.style.display = on ? 'flex' : 'none'; }

  // ===================================================================== home
  async showHome() {
    this.editor = null;
    const plat = platform.platform || '';
    const search = h('div', { class: 'search' }, icon('search'), h('input', { class: 'field', placeholder: 'Search projects', value: this.query, 'aria-label': 'Search projects', oninput: (e) => { this.query = e.target.value; this.renderProjects(); } }));
    this.gridEl = h('div', { class: 'grid', role: 'list', 'aria-label': 'Projects' });
    const create = (cls, ic, title, sub, fn, grad) => h('button', { class: 'create ' + cls, style: { background: grad }, onclick: fn }, icon(ic), h('div', null, h('b', null, title), h('br'), h('span', null, sub)));
    const home = h('div', { class: 'home' },
      h('div', { class: 'titlebar' + (plat === 'darwin' ? ' mac' : plat ? ' win' : '') }, h('div', { class: 'brand' }, h('div', { class: 'logo' }), 'GLB&ME'), h('div', { class: 'spacer' }),
        ibtn('keyboard', 'Shortcuts', () => import('./editor/studios.js').then((s) => s.shortcutsDialog())), ibtn('settings', 'Settings', () => this.settingsDialog())),
      h('div', { class: 'content' },
        h('h1', null, 'Create in 3D'),
        h('p', { class: 'lead' }, 'Sculpt, paint, texture, animate and export GLB models – on your PC.'),
        h('div', { class: 'create-row' },
          create('', 'plus', 'New project', 'Start from an empty scene', () => this.newProject(), 'linear-gradient(135deg,#6e56f7,#9b5cf6)'),
          create('', 'brush', 'Sculpt', 'Clay ball, ready for brushes', () => this.newProject('Sculpt', 'sculpt'), 'linear-gradient(135deg,#0ea5a4,#22c55e)'),
          create('', 'layout-template', 'Templates', '20 ready-made models', () => this.templates(), 'linear-gradient(135deg,#f97316,#f43f5e)'),
          create('', 'download', 'Import', 'GLB, glTF, OBJ, STL, PLY, FBX', () => this.importNew(), 'linear-gradient(135deg,#3b82f6,#06b6d4)')),
        h('div', { class: 'quick', style: { marginTop: '14px' } }, h('span', { class: 'muted', style: { alignSelf: 'center', marginRight: '4px' } }, 'Quick start:'),
          ...[['type', '3D text', 'text'], ['box', 'Cube', 'shape:CUBE'], ['square', 'Rounded box', 'shape:ROUNDED_BOX'], ['circle', 'Sphere', 'shape:SPHERE'], ['torus', 'Torus', 'shape:TORUS'], ['mountain', 'Terrain', 'shape:TERRAIN'], ['star', 'Star', 'shape:STAR']].map(([ic, l, k]) => h('button', { class: 'chip', onclick: () => this.newProject(l, k) }, icon(ic), l))),
        h('div', { class: 'proj-head' }, h('h2', null, 'Your projects'), search,
          seg([['recent', 'Recent'], ['name', 'Name']], this.sort, (v) => { this.sort = v; this.settings.sort = v; this.saveSettings(); this.renderProjects(); }, '', 'Sort')),
        this.gridEl,
      ));
    home.addEventListener('dragover', (e) => { e.preventDefault(); this.showDrop(true); });
    home.addEventListener('dragleave', (e) => { if (!home.contains(e.relatedTarget)) this.showDrop(false); });
    home.addEventListener('drop', async (e) => {
      e.preventDefault(); this.showDrop(false);
      const files = await Promise.all([...e.dataTransfer.files].map(async (f) => ({ name: f.name, path: f.path, data: await f.arrayBuffer() })));
      if (files.length) this.importNew(files);
    });
    mount(this.root, home);
    await this.loadProjects();
  }
  async loadProjects() { this.projects = await platform.projects.list(); this.renderProjects(); }
  renderProjects() {
    if (!this.gridEl) return;
    let list = [...(this.projects || [])];
    if (this.query) list = list.filter((p) => p.name.toLowerCase().includes(this.query.toLowerCase()));
    list.sort(this.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.modified - a.modified);
    if (!list.length) {
      mount(this.gridEl, h('div', { class: 'empty', style: { gridColumn: '1 / -1' } }, this.query ? 'No projects match your search.' : [h('div', { style: { fontSize: '17px', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' } }, 'No projects yet'), 'Start with a template or create something new. Projects are saved automatically.', h('div', { style: { marginTop: '16px', display: 'flex', gap: '10px', justifyContent: 'center' } }, btn('New project', () => this.newProject(), 'primary', 'plus'), btn('Browse templates', () => this.templates(), 'ghost', 'layout-template'))]));
      return;
    }
    mount(this.gridEl, list.map((p) => {
      const img = h('img', { alt: '', draggable: 'false' });
      platform.projects.thumb(p.id).then((b) => { if (b) img.src = URL.createObjectURL(new Blob([b], { type: 'image/png' })); else img.replaceWith(icon('box')); }).catch(() => {});
      const card = h('div', { class: 'pcard', role: 'listitem', tabindex: '0', 'aria-label': `${p.name}, ${ago(p.modified)}`, onclick: () => this.openProject(p), onkeydown: (e) => { if (e.key === 'Enter') this.openProject(p); if (e.key === 'Delete') this.deleteProject(p); }, oncontextmenu: (e) => { e.preventDefault(); this.projectMenu(p, e.clientX, e.clientY); } },
        h('div', { class: 'thumb' }, img),
        p.animated ? h('span', { class: 'badge' }, 'Animated') : null,
        h('button', { class: 'ibtn more', 'aria-label': 'Project actions', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); this.projectMenu(p, r.left, r.bottom + 4); } }, icon('ellipsis')),
        h('div', { class: 'meta' }, h('b', null, p.name), h('span', null, `${ago(p.modified)} · ${(p.triangles || 0).toLocaleString()} tris`)));
      return card;
    }));
  }
  projectMenu(p, x, y) {
    menu([
      { label: 'Open', icon: 'folder-open', onClick: () => this.openProject(p) },
      { label: 'Rename…', icon: 'pencil', onClick: async () => { const n = await promptDialog('Rename project', p.name); if (n) { await platform.projects.rename(p.id, n); this.loadProjects(); } } },
      { label: 'Duplicate', icon: 'copy', onClick: async () => { await platform.projects.duplicate(p.id, p.name + ' copy'); this.loadProjects(); } },
      { label: 'Save as GLB…', icon: 'file-down', onClick: async () => { const data = await platform.projects.load(p.id); const r = await platform.files.save(p.name + '.glb', data, [{ name: 'GLB', extensions: ['glb'] }]); if (r) toast('Saved — this GLB opens in any 3D app, and in GLB&ME with full editing'); } },
      isDesktop && { label: 'Show in folder', icon: 'folder', onClick: () => platform.projects.reveal(p.id) },
      'sep',
      { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => this.deleteProject(p) },
    ], x, y);
  }
  async deleteProject(p) {
    if (!(await confirmDialog('Delete project?', `“${p.name}” will be permanently deleted.`, 'Delete', true))) return;
    await platform.projects.remove(p.id); this.loadProjects();
  }

  // ===================================================================== project lifecycle
  async newProject(name = 'Untitled', start = null) {
    const p = await platform.projects.create({ name: this.uniqueProjectName(name) });
    p.start = start;
    this.openEditor(p);
  }
  uniqueProjectName(base) {
    const names = new Set((this.projects || []).map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }
  async openProject(p) {
    const b = busy('Opening ' + p.name + '…');
    try { const data = await platform.projects.load(p.id); b.close(); this.openEditor(p, data); }
    catch (e) { b.close(); toast('Could not open project: ' + e.message, 4000); }
  }
  async importNew(files = null) {
    if (!files) files = await platform.files.open({ multi: true, filters: MODEL_FILTERS });
    if (!files?.length) return;
    const models = files.filter((f) => /\.(glb|gltf|obj|stl|ply|fbx)$/i.test(f.name));
    if (!models.length) { toast('Drop a 3D model (GLB, glTF, OBJ, STL, PLY or FBX)'); return; }
    const name = models[0].name.replace(/\.[^.]+$/, '');
    const p = await platform.projects.create({ name: this.uniqueProjectName(name) });
    this.openEditor(p, null, models);
  }
  async openPath(path) {
    try { const f = await platform.files.read(path); if (this.editor) this.editor.handleFiles([f]); else this.importNew([f]); } catch (e) { toast('Could not open ' + path); }
  }
  openEditor(p, data = null, files = null) {
    mount(this.root);
    this.editor = new Editor(this, this.root);
    this.editor.open(p, data, files);
  }
  async closeEditor() {
    const ed = this.editor; if (!ed) return;
    const b = busy('Saving…');
    try { await ed.close(); } finally { b.close(); }
    this.showHome();
  }

  // ===================================================================== templates
  async templates() {
    const list = await templateList();
    const cats = ['All', ...new Set(list.map((t) => t.category))];
    let cat = 'All';
    const grid = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' } });
    const fill = () => mount(grid, list.filter((t) => cat === 'All' || t.category === cat).map((t) => h('button', { class: 'pcard', style: { textAlign: 'left', padding: 0, color: 'var(--text)' }, onclick: () => this.fromTemplate(t, m) },
      h('div', { class: 'thumb' }, h('img', { src: `templates/${t.id}.png`, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(icon('box')) })),
      t.animated ? h('span', { class: 'badge' }, 'Animated') : null,
      h('div', { class: 'meta' }, h('b', null, t.name), h('span', null, t.description)))));
    const chips = h('div', { class: 'chips', style: { marginBottom: '16px' } }, cats.map((c) => h('button', { class: 'chip' + (c === cat ? ' active' : ''), onclick: (e) => { cat = c; [...chips.children].forEach((x) => x.classList.remove('active')); e.currentTarget.classList.add('active'); fill(); } }, c)));
    fill();
    const m = modal({ title: 'Templates', icon: 'layout-template', body: h('div', null, chips, grid), wide: true });
  }
  async fromTemplate(t, m) {
    m.close();
    const data = await (await fetch(`templates/${t.id}.glb`)).arrayBuffer();
    const p = await platform.projects.create({ name: this.uniqueProjectName(t.name) });
    this.openEditor(p, data);
  }

  // ===================================================================== settings / welcome
  settingsDialog() {
    const s = this.settings;
    const body = h('div', null,
      section('Accessibility'),
      h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Interface size'),
      seg([['default', 'Default'], ['large', 'Large'], ['xlarge', 'Extra large']], s.uiSize || 'default', (v) => { s.uiSize = v; this.saveSettings(); }),
      toggle('Reduce motion', !!(s.reduceMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches), (v) => { s.reduceMotion = v; this.saveSettings(); }, 'No camera fly-throughs or animated panels'),
      toggle('Show tips', s.tips !== false, (v) => { s.tips = v; this.saveSettings(); }, 'Helpful hints while you work'),
      section('Performance'),
      h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Viewport sharpness'),
      seg([['1', 'Fast'], ['1.5', 'Balanced'], ['2', 'Sharpest']], String(s.pixelRatio || 2), (v) => { s.pixelRatio = +v; this.saveSettings(); if (this.editor) { this.editor.vp.renderer.setPixelRatio(Math.min(+v, devicePixelRatio)); this.editor.vp.resize(); } }),
      section('About'),
      h('div', { class: 'card' }, h('div', { class: 'navrow' }, h('b', null, 'GLB&ME'), h('span', { class: 'v' }, 'Version ' + VERSION)),
        h('div', { class: 'navrow', role: 'button', tabindex: '0', onclick: () => platform.app.openExternal('https://github.com/terpenesalad/GLB-ME') }, icon('github'), 'Source & releases', h('span', { class: 'v' }, icon('external-link'))),
        h('div', { class: 'navrow', role: 'button', tabindex: '0', onclick: () => { s.seenEditorHint = false; s.welcomed = false; this.saveSettings(); toast('Tips will show again'); } }, icon('rotate-ccw'), 'Show tips & welcome again')),
      h('p', { class: 'muted' }, 'Projects are stored on this PC and saved automatically. Every project is a standard .glb file, so you can move it to the Android app and back.'),
    );
    modal({ title: 'Settings', icon: 'settings', body });
  }
  welcome() {
    const f = (ic, t, d) => h('div', { class: 'welcome-feature' }, icon(ic), h('div', null, h('b', null, t), h('span', null, d)));
    const m = modal({
      title: 'Welcome to GLB&ME', icon: 'sparkles',
      body: h('div', null,
        f('shapes', 'Make anything', '25 shapes, 3D text with any font, draw-to-3D, templates and imports.'),
        f('brush', 'Sculpt & paint', 'Nomad-style clay brushes with symmetry and masking, plus vertex paint.'),
        f('image', 'Materials & textures', 'Metals, glass and glow, 18 seamless patterns, photos, stickers – per part or the whole model.'),
        f('clapperboard', 'Animate & light', 'Keyframes, one-click presets and real lights.'),
        f('share', 'Export like a pro', 'GLB, glTF, USDZ, OBJ, STL, PLY with presets for games, web, AR and 3D printing.')),
      footer: [btn('Get started', () => m.close(), 'primary lg')],
      onClose: () => { this.settings.welcomed = true; this.saveSettings(); },
    });
  }
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return new Date(t).toLocaleDateString();
}
void bytes;
window.app = new App();
