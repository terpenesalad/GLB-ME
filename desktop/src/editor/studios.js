// Creation & export studios: Add gallery, Text studio, Draw-to-3D, Texture library, stickers,
// image planes, the Export dialog and the shortcuts sheet.
import * as THREE from 'three';
import { h, icon, ibtn, btn, mount, modal, menu, slider, toggle, seg, select, section, colorSwatch, busy, toast } from '../ui/dom.js';
import { SHAPES, BASIC, MORE } from '../core/shapes.js';
import { contoursToShapes, area, defaultTextSpec } from '../core/text.js';
import { normalize, computeNormals } from '../core/mesh.js';
import { isMesh, prepareGeometry, makeMesh, newMaterial, syncTextures } from './model.js';
import { PATTERNS, defaultSpec, previewCanvas, applyPattern, imageTexture, applyImage, stickerTexture } from './textures.js';
import { BUILTIN, cssFamily, importedFonts, systemFonts, importFontFiles, fontName } from './fonts.js';
import { FORMATS, exportModel, parseGltf, zip } from './io.js';
import { CATALOG, CATEGORY_ORDER, buildTemplate, findTemplate } from '../templates/index.js';
import * as PL from './pipeline.js';
import { platform, IMAGE_FILTERS, FONT_FILTERS, isDesktop } from '../platform.js';

// =============================================================================== Add gallery
export function addMenu(ed) {
  const close = () => m.close();
  const tile = (ic, label, fn, tipText) => h('button', { class: 'tile', tip: tipText, onclick: () => { close(); fn(); } }, icon(ic), label);
  const shapeTiles = (list) => h('div', { class: 'tile-grid' }, list.map((t) => tile(SHAPES[t].icon, SHAPES[t].label, () => ed.actions.addShape(t))));
  const body = h('div', null,
    section('Create'), h('div', { class: 'tile-grid' },
      tile('type', '3D Text', () => textStudio(ed), 'Text with any font'),
      tile('pen-tool', 'Draw shape', () => drawStudio(ed), 'Draw an outline and extrude or spin it'),
      tile('sticker', 'Sticker', () => stickerDialog(ed), 'Emoji, shapes or images on a surface'),
      tile('image', 'Image plane', () => imagePlane(ed), 'A picture as a flat 3D card'),
      tile('layout-template', 'Template', () => templatePicker(ed), 'Insert a ready-made model'),
      tile('download', 'Import', () => ed.importFiles(), 'GLB, glTF, OBJ, FBX, DAE, 3MF, STL, PLY')),
    section('Basic shapes'), shapeTiles(BASIC),
    section('More shapes'), shapeTiles(MORE),
    section('Lights, cameras & helpers'), h('div', { class: 'tile-grid' },
      tile('lightbulb', 'Point', () => ed.actions.addLight('point'), 'Bulb that shines in all directions'),
      tile('flashlight', 'Spot', () => ed.actions.addLight('spot'), 'Cone of light'),
      tile('sun', 'Sun', () => ed.actions.addLight('directional'), 'Parallel light like the sun'),
      tile('video', 'Camera', () => ed.actions.addCamera(), 'A camera placed at the current view'),
      tile('move-3d', 'Empty', () => ed.actions.addEmpty(), 'A named point: parent things to it, or use it as a spawn point'),
      tile('group', 'Group', () => ed.actions.group(), 'Group the selected objects')),
  );
  const m = modal({ title: 'Add to scene', body, wide: true, icon: 'plus' });
}
export const shapesDialog = addMenu;

// =============================================================================== side sheet
export function openSheet(ed, title, content, onDone) {
  closeSheet(ed, false);
  ed.sheet = { onDone };
  ed.rightTitle.textContent = title;
  mount(ed.rightTools, btn('Done', () => closeSheet(ed, true), 'primary'));
  mount(ed.tabsEl);
  mount(ed.rightBody, content);
  ed.right.classList.add('sheet');
}
export function closeSheet(ed, done = true) {
  if (!ed.sheet) return;
  const s = ed.sheet; ed.sheet = null;
  ed.right.classList.remove('sheet');
  s.onDone?.(done);
  ed.refresh();
}

// =============================================================================== Text studio
export async function textStudio(ed, target = null) {
  let o = target && isMesh(target) && target.ed.text ? target : null;
  if (!o) { const sel = ed.doc.selected; if (!target && isMesh(sel) && sel.ed.text) o = sel; }
  if (!o) { o = await ed.actions.addText({ ...defaultTextSpec(), text: ed.lastText || 'Title', font: ed.lastFont || 'builtin:michroma' }); if (!o) return; ed.vp.frame([o]); }
  if (ed.mode !== 'object') ed.setMode('object');
  const doc = ed.doc, spec = { ...o.ed.text };
  let tok = doc.begin('Edit text', [o]);
  let timer = 0, gen = 0;
  const update = (now = false) => {
    clearTimeout(timer);
    const g = ++gen;
    timer = setTimeout(async () => { if (g !== gen) return; await ed.actions.rebuildText(o, { ...spec }, true); if (!o.ed.renamed) { o.name = spec.text.split('\n')[0].slice(0, 24) || 'Text'; ed.refreshLayers(); } }, now ? 0 : 90);
  };
  const ta = h('textarea', { class: 'field', rows: 3, 'aria-label': 'Text', value: spec.text, style: { fontSize: '16px' } });
  ta.value = spec.text;
  ta.addEventListener('input', () => { spec.text = ta.value; update(); });
  const fontsHost = h('div');
  const fontLabel = h('b', null, '…'); fontName(spec.font).then((n) => { fontLabel.textContent = n; });
  let fontTab = spec.font.startsWith('sys:') ? 'pc' : spec.font.startsWith('file:') ? 'mine' : 'builtin';
  const card = (id, name) => {
    const fam = cssFamily(id);
    return h('button', { class: 'fontcard' + (spec.font === id ? ' on' : ''), tip: name, 'aria-pressed': String(spec.font === id), onclick: () => { spec.font = id; ed.lastFont = id; fontLabel.textContent = name; update(true); renderFonts(); } },
      h('span', { class: 'aa', style: { fontFamily: `'${fam}', sans-serif` } }, 'Aa'), h('small', null, name));
  };
  async function renderFonts() {
    const tabs = seg([['builtin', 'Built-in'], ['mine', 'My fonts'], ...(isDesktop ? [['pc', 'PC fonts']] : [])], fontTab, (v) => { fontTab = v; renderFonts(); }, '', 'Font source');
    let content;
    if (fontTab === 'builtin') content = h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(3,1fr)' } }, BUILTIN.map((f) => card(f.id, f.name)));
    else if (fontTab === 'mine') {
      const list = await importedFonts();
      content = h('div', null,
        list.length ? h('div', { class: 'tile-grid', style: { gridTemplateColumns: 'repeat(3,1fr)' } }, list.map((f) => card(f.id, f.name))) : h('p', { class: 'muted' }, 'Import .ttf, .otf or .woff files — e.g. a font you bought or downloaded (Horizon, etc.). They are stored in your GLB&ME library.'),
        btn('Import font file…', async () => {
          const files = await platform.files.open({ multi: true, filters: FONT_FILTERS });
          if (!files?.length) return;
          try { const ids = await importFontFiles(files); spec.font = ids[0]; fontLabel.textContent = await fontName(ids[0]); update(true); renderFonts(); toast('Font imported'); } catch (e) { toast(e.message, 4000); }
        }, 'tinted', 'file-plus'));
    } else {
      const all = await systemFonts();
      const search = h('input', { class: 'field', placeholder: `Search ${all.length} installed fonts`, 'aria-label': 'Search fonts' });
      const list = h('div', { class: 'col', style: { maxHeight: '300px', overflow: 'auto', gap: '2px' } });
      const fill = () => {
        const q = search.value.toLowerCase();
        const items = all.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 120);
        mount(list, items.map((f) => h('button', { class: 'btn ghost', style: { justifyContent: 'flex-start', height: '36px', ...(spec.font === f.id ? { background: 'var(--accent-soft)' } : {}) }, onclick: () => { spec.font = f.id; fontLabel.textContent = f.name; update(true); fill(); } }, h('span', { style: { fontFamily: `'${cssFamily(f.id)}', sans-serif`, fontSize: '16px' } }, f.name))));
        if (!items.length) mount(list, h('p', { class: 'muted' }, 'No fonts match.'));
      };
      search.addEventListener('input', fill); fill();
      content = h('div', { class: 'col' }, search, list, h('p', { class: 'muted' }, 'Fonts installed on this PC. Only use fonts you are licensed to use in your models.'));
    }
    mount(fontsHost, tabs, h('div', { style: { marginTop: '10px' } }, content));
  }
  renderFonts();
  const body = h('div', null,
    section('Text'), ta,
    section('Font'), h('div', { class: 'row muted', style: { marginBottom: '8px' } }, 'Current: ', fontLabel), fontsHost,
    section('Size'),
    slider({ label: 'Letter height', min: 0.02, max: 3, step: 0.01, value: 0.7 * o.scale.y, unit: ' m', onInput: (v) => { o.scale.setScalar(v / 0.7); doc.touch(); } }),
    section('Style'),
    seg([[0, '', 'align-left', 'Left'], [1, '', 'align-center', 'Centre'], [2, '', 'align-right', 'Right']], spec.align, (v) => { spec.align = v; update(true); }, '', 'Alignment'),
    toggle('Italic (slant)', spec.italic, (v) => { spec.italic = v; update(true); }),
    slider({ label: 'Depth', min: 0.005, max: 2, step: 0.005, value: spec.depth, unit: ' m', onInput: (v) => { spec.depth = v; update(); } }),
    slider({ label: 'Bevel', min: 0, max: 0.1, step: 0.001, value: spec.bevel, unit: ' m', onInput: (v) => { spec.bevel = v; update(); } }),
    slider({ label: 'Bevel smoothness', min: 1, max: 8, int: true, value: spec.bevelSegments, onInput: (v) => { spec.bevelSegments = v; update(); } }),
    slider({ label: 'Letter spacing', min: -0.2, max: 1, step: 0.005, value: spec.letterSpacing, onInput: (v) => { spec.letterSpacing = v; update(); } }),
    slider({ label: 'Line spacing', min: 0.5, max: 3, step: 0.01, value: spec.lineSpacing, onInput: (v) => { spec.lineSpacing = v; update(); } }),
    slider({ label: 'Curve quality', min: 2, max: 16, int: true, value: spec.quality, onInput: (v) => { spec.quality = v; update(); } }),
    h('p', { class: 'muted' }, 'Move it with the gizmo. Colour, metal, glow & textures: Material tab after Done.'),
  );
  openSheet(ed, '3D Text', body, async () => {
    clearTimeout(timer); gen++;
    await ed.actions.rebuildText(o, { ...spec }, true);
    ed.lastText = spec.text; ed.lastFont = spec.font;
    doc.commit(tok); tok = null;
  });
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
}

// =============================================================================== Draw to 3D
export function drawStudio(ed) {
  const st = { mode: 'extrude', depth: 0.2, bevel: 0.02, smooth: 0.5, mirror: false, strokes: [] };
  const pad = h('canvas', { class: 'drawpad', 'aria-label': 'Drawing pad. Draw closed outlines with the mouse or a pen.' });
  let cur = null;
  const W = 2; // pad width in metres
  const toPad = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); cur = [toPad(e)]; st.strokes.push(cur); draw(); });
  pad.addEventListener('pointermove', (e) => { if (!cur) return; const p = toPad(e), l = cur[cur.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.004) { cur.push(p); draw(); } });
  pad.addEventListener('pointerup', () => { if (cur && cur.length < 4) st.strokes.pop(); cur = null; draw(); });
  function draw() {
    const dpr = devicePixelRatio, w = pad.clientWidth, hh = pad.clientHeight;
    pad.width = w * dpr; pad.height = hh * dpr;
    const ctx = pad.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let i = 1; i < 16; i++) { ctx.beginPath(); ctx.moveTo((i / 16) * w, 0); ctx.lineTo((i / 16) * w, hh); ctx.stroke(); }
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(0, (i / 10) * hh); ctx.lineTo(w, (i / 10) * hh); ctx.stroke(); }
    if (st.mode === 'lathe' || st.mirror) { ctx.strokeStyle = 'rgba(139,120,255,0.8)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, hh); ctx.stroke(); ctx.setLineDash([]); }
    for (const s of st.strokes) {
      const pts = st.mirror && st.mode === 'extrude' ? mirrorStroke(s) : s;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * hh) : ctx.moveTo(x * w, y * hh)));
      if (st.mode === 'extrude') { ctx.closePath(); ctx.fillStyle = 'rgba(110,86,247,0.25)'; ctx.fill('evenodd'); }
      ctx.strokeStyle = '#c9c0ff'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    }
    if (!st.strokes.length) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '15px InterUI, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(st.mode === 'extrude' ? 'Draw closed outlines – shapes inside shapes become holes' : 'Draw half a profile to the right of the dashed axis – it spins into a vase, bottle, pawn…', w / 2, hh / 2); }
  }
  function mirrorStroke(s) { // mirror the stroke across the centre line and join both halves
    const right = s.map(([x, y]) => [Math.max(0.5, x), y]);
    return [...right, ...[...right].reverse().map(([x, y]) => [1 - x, y])];
  }
  const aspect = 1.6;
  function build() {
    const toM = ([x, y]) => [(x - 0.5) * W, (0.5 - y) * W / aspect];
    if (st.mode === 'extrude') {
      const contours = st.strokes.map((s) => rdp((st.mirror ? mirrorStroke(s) : s).map(toM), 0.002 + st.smooth * 0.01)).map((c) => chaikin(c, st.smooth > 0.2 ? 2 : 0)).filter((c) => c.length >= 3 && Math.abs(area(c)) > 1e-4);
      if (!contours.length) return null;
      const shapes = contoursToShapes(contours);
      const bevel = Math.min(st.bevel, st.depth * 0.45);
      const g = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(0.002, st.depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4, curveSegments: 4 });
      g.center();
      normalize(g); computeNormals(g);
      return g;
    }
    const s = st.strokes[st.strokes.length - 1];
    if (!s) return null;
    let pts = rdp(s.map(toM), 0.002 + st.smooth * 0.008).map(([x, y]) => new THREE.Vector2(Math.max(0, x), y));
    if (pts.length < 2) return null;
    if (pts[0].y > pts[pts.length - 1].y) pts.reverse(); // bottom to top → outward normals
    const g = new THREE.LatheGeometry(pts, 64);
    normalize(g);
    computeNormals(g);
    return g;
  }
  const body = h('div', null,
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      seg([['extrude', 'Extrude outline', 'square-stack'], ['lathe', 'Spin profile', 'rotate-3d']], st.mode, (v) => { st.mode = v; draw(); }, 'accent', 'Draw mode'),
      h('div', { class: 'grow' }),
      btn('Undo stroke', () => { st.strokes.pop(); draw(); }, 'ghost', 'undo-2'), btn('Clear', () => { st.strokes = []; draw(); }, 'ghost', 'eraser')),
    pad,
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginTop: '12px' } },
      slider({ label: 'Thickness', min: 0.01, max: 1, step: 0.01, value: st.depth, unit: ' m', onInput: (v) => { st.depth = v; } }),
      slider({ label: 'Bevel', min: 0, max: 0.1, step: 0.002, value: st.bevel, unit: ' m', onInput: (v) => { st.bevel = v; } }),
      slider({ label: 'Smoothing', min: 0, max: 1, step: 0.01, value: st.smooth, onInput: (v) => { st.smooth = v; } })),
    toggle('Mirror left ↔ right', st.mirror, (v) => { st.mirror = v; draw(); }, 'Draw the right half of a symmetric outline'),
  );
  const m = modal({ title: 'Draw to 3D', icon: 'pen-tool', body, wide: true, footer: [btn('Cancel', () => m.close(), 'ghost'), btn('Create', () => {
    const g = build();
    if (!g) { toast(st.mode === 'extrude' ? 'Draw at least one closed outline' : 'Draw a profile on the right of the axis'); return; }
    m.close();
    const o = ed.actions.addGeometry(g, st.mode === 'extrude' ? 'Drawn shape' : 'Spun shape', { color: 0xd9d9de });
    if (st.mode === 'lathe') o.material.side = THREE.DoubleSide;
    ed.vp.frame([o]);
  }, 'primary', 'sparkles')] });
  requestAnimationFrame(draw);
  new ResizeObserver(draw).observe(pad);
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let md = 0, mi = 0;
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i; } }
  if (md > eps) return [...rdp(pts.slice(0, mi + 1), eps).slice(0, -1), ...rdp(pts.slice(mi), eps)];
  return [pts[0], pts[pts.length - 1]];
}
function chaikin(c, it) {
  for (let k = 0; k < it; k++) {
    const o = [];
    for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; o.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]); }
    c = o;
  }
  return c;
}

// =============================================================================== textures
const recentImages = [];
export function textureLibrary(ed) {
  const o = ed.doc.selected;
  if (!isMesh(o)) { toast('Select a model first'); return; }
  let size = 1024, bump = true, tab = 'patterns';
  const host = h('div');
  const render = () => {
    let content;
    if (tab === 'patterns') {
      content = h('div', null,
        h('div', { class: 'row', style: { marginBottom: '14px' } }, h('span', { class: 'label' }, 'Resolution'), seg([[512, '512'], [1024, '1K'], [2048, '2K']], size, (v) => { size = v; }), h('div', { class: 'grow' }), toggle('Surface bump', bump, (v) => { bump = v; })),
        h('div', { class: 'texgrid' }, PATTERNS.map((p) => h('button', { onclick: () => { const b = busy('Generating ' + p.label + '…'); setTimeout(() => { try { ed.actions.material('Texture: ' + p.label, (mm) => applyPattern(mm, defaultSpec(p.id), size, { bump: bump ? 2 : 0 }), o); } finally { b.close(); } m.close(); }, 30); } }, previewCanvas(defaultSpec(p.id), 96), p.label))),
        h('p', { class: 'muted' }, 'Seamless, tileable patterns. Fine-tune colours, scale and tiling in the Material tab afterwards.'));
    } else {
      content = h('div', null,
        h('div', { class: 'row' }, btn('Choose image…', () => { m.close(); pickPhoto(ed, o); }, 'tinted', 'image-plus'), h('span', { class: 'muted' }, 'PNG, JPG or WebP. Transparent PNGs keep their cut-outs.')),
        recentImages.length ? section('Recent') : null,
        h('div', { class: 'texgrid' }, recentImages.map((t) => { const c = h('canvas', { width: 96, height: 96 }); c.getContext('2d').drawImage(t.image, 0, 0, 96, 96); return h('button', { onclick: () => { ed.actions.material('Photo texture', (mm) => applyImage(mm, t), o); m.close(); } }, c, t.name); })));
    }
    mount(host, h('div', { style: { marginBottom: '14px' } }, seg([['patterns', 'Patterns', 'grid-3x3'], ['photos', 'Photos', 'image']], tab, (v) => { tab = v; render(); }, 'accent')), content);
  };
  render();
  const m = modal({ title: `Texture for “${o.name}”`, icon: 'image', body: host, wide: true, footer: [btn('Sticker instead…', () => { m.close(); stickerDialog(ed); }, 'ghost', 'sticker'), btn('Close', () => m.close(), 'primary')] });
}
export async function pickPhoto(ed, o = ed.doc.selected) {
  if (!isMesh(o)) { toast('Select a model first'); return; }
  const files = await platform.files.open({ filters: IMAGE_FILTERS });
  if (!files?.length) return;
  const t = await imageTexture(files[0].data, files[0].name);
  recentImages.unshift(t); if (recentImages.length > 8) recentImages.pop();
  ed.actions.material('Photo texture', (mm) => applyImage(mm, t), o);
  if (!o.geometry.attributes.uv) ed.actions.projectUvs(o, 'BOX');
  toast('Texture applied — adjust tiling in the Material tab');
}
export function imageChoice(ed, file) {
  const o = ed.doc.selected;
  const m = modal({ title: file.name, icon: 'image', body: h('div', { class: 'tile-grid' },
    isMesh(o) && h('button', { class: 'tile', onclick: async () => { m.close(); const t = await imageTexture(file.data, file.name); recentImages.unshift(t); ed.actions.material('Photo texture', (mm) => applyImage(mm, t), o); } }, icon('image'), `Texture “${o.name}”`),
    h('button', { class: 'tile', onclick: async () => { m.close(); const t = await imageTexture(file.data, file.name); ed.actions.placeSticker({ texture: t, label: file.name.replace(/\.[^.]+$/, ''), size: 0.3 }); } }, icon('sticker'), 'Place as sticker'),
    h('button', { class: 'tile', onclick: async () => { m.close(); imagePlane(ed, file); } }, icon('rectangle-horizontal'), 'Image plane')) });
}
export async function imagePlane(ed, file = null) {
  if (!file) { const f = await platform.files.open({ filters: IMAGE_FILTERS }); if (!f?.length) return; file = f[0]; }
  const t = await imageTexture(file.data, file.name);
  const w = t.image.width, hh = t.image.height, k = 1 / Math.max(w, hh);
  const g = normalize(new THREE.PlaneGeometry(w * k * 1.2, hh * k * 1.2, 1, 1));
  prepareGeometry(g);
  const o = makeMesh(g, ed.doc.uniqueName(file.name.replace(/\.[^.]+$/, '')), newMaterial({ color: 0xffffff, roughness: 0.9 }));
  applyImage(o.material, t); o.material.side = THREE.DoubleSide;
  ed.actions.addObject(o, 'Add image plane', ed.actions.dropPoint(g));
  ed.vp.frame([o]);
}

// =============================================================================== stickers
const EMOJI = ['⭐', '❤️', '🔥', '⚡', '😀', '😎', '👾', '🎮', '🏆', '💎', '🌈', '🍀', '🚀', '🎯', '💀', '👑', '🐱', '🌸', '☀️', '🌙', '✅', '❌', '💥', '🎵'];
export function stickerDialog(ed) {
  if (!ed.doc.meshes.length) { toast('Add a model first'); return; }
  const st = { size: 0.25, rotation: 0, color: '#ffffff' };
  let text = 'GLB&ME';
  const place = (spec) => { m.close(); ed.setMode('object'); ed.actions.placeSticker({ ...st, ...spec }); };
  const body = h('div', null,
    section('Emoji'), h('div', { class: 'chips' }, EMOJI.map((e) => h('button', { class: 'chip', style: { fontSize: '20px', height: '40px', width: '44px', justifyContent: 'center' }, onclick: () => place({ kind: 'emoji', value: e, label: 'Sticker ' + e }) }, e))),
    section('Shapes'), h('div', { class: 'row' }, h('div', { class: 'chips grow' }, [['star', 'star'], ['heart', 'heart'], ['circle', 'circle'], ['ring', 'circle-dot'], ['bolt', 'zap']].map(([v, ic]) => h('button', { class: 'chip', onclick: () => place({ kind: 'shape', value: v, color: st.color, label: v[0].toUpperCase() + v.slice(1) + ' sticker' }) }, icon(ic), v))),
      colorSwatch(st.color, (v) => { st.color = v; }, null, 'Sticker colour')),
    section('Text label'), h('div', { class: 'row' }, h('input', { class: 'field grow', value: text, oninput: (e) => { text = e.target.value; }, 'aria-label': 'Sticker text' }), btn('Place', () => text.trim() && place({ kind: 'text', value: text.trim(), color: st.color, label: text.trim().slice(0, 20) }), 'tinted')),
    section('Image'), btn('Choose image…', async () => { const f = await platform.files.open({ filters: IMAGE_FILTERS }); if (!f?.length) return; const t = await imageTexture(f[0].data, f[0].name); place({ texture: t, label: f[0].name.replace(/\.[^.]+$/, '') }); }, 'ghost', 'image-plus'),
    section('Placement'),
    slider({ label: 'Size (relative to model)', min: 0.03, max: 1, step: 0.01, value: st.size, onInput: (v) => { st.size = v; } }),
    slider({ label: 'Rotation', min: -180, max: 180, step: 1, unit: '°', value: st.rotation, onInput: (v) => { st.rotation = v; } }),
    h('p', { class: 'muted' }, 'After choosing, click the surface where the sticker should go. Hold Shift to place several.'));
  const m = modal({ title: 'Stickers & decals', icon: 'sticker', body });
}

// =============================================================================== templates
/** All templates: the procedural asset library (PBR, editable parts) plus the classic GLB starters. */
export async function templateList() {
  let glb = [];
  try { glb = await (await fetch('templates/templates.json')).json(); } catch { /* none */ }
  return [
    ...CATALOG.map((t) => ({ ...t, kind: 'code', description: t.desc, thumb: `templates/thumbs/${t.id}.webp` })),
    ...glb.map((t) => ({ ...t, kind: 'glb', category: t.category === 'Nature' ? 'Nature' : t.category, thumb: `templates/${t.id}.png`, tags: [] })),
  ];
}
/** Objects of a template, ready to attach: { objects, clips, frameCount, env }. */
export async function templateObjects(t) {
  if (t.kind === 'glb') { const r = await parseGltf(await (await fetch(`templates/${t.id}.glb`)).arrayBuffer()); return { objects: r.objects, clips: r.clips, frameCount: r.frameCount }; }
  const k = await buildTemplate(t.id);
  return { objects: k.objects, clips: k.clips, frameCount: k.frameCount, env: t.env };
}
/** Adds a template to the scene (fresh = the project was just created from it). */
export async function insertTemplate(ed, t, fresh = false) {
  const b = busy((t.kind === 'glb' ? 'Loading ' : 'Building ') + t.name + '…');
  try {
    const r = await templateObjects(t);
    const hadAnim = ed.doc.hasAnimation();
    ed.actions.addObjects(r.objects, 'Insert ' + t.name);
    if (!hadAnim && r.frameCount) ed.doc.frameCount = r.frameCount;
    if (!hadAnim && r.clips?.length) ed.doc.clips = r.clips;
    if (fresh && r.env) { ed.vp.render.env = r.env; ed.vp.applyRender(); }
    ed.vp.updateKeyLight?.();
    ed.vp.frame(r.objects.filter((o) => !r.objects.includes(o.ed.parent)));
    ed.refresh?.();
  } finally { b.close(); }
}
/** Searchable, categorised template browser. onPick(t) is called with the chosen entry. */
export async function templateBrowser({ title = 'Templates', onPick }) {
  const list = await templateList();
  const counts = new Map(); for (const t of list) counts.set(t.category, (counts.get(t.category) || 0) + 1);
  const cats = ['All', ...CATEGORY_ORDER.filter((c) => counts.has(c)), ...[...counts.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
  let cat = 'All', q = '';
  const grid = h('div', { class: 'grid tgrid', role: 'list' });
  const empty = h('p', { class: 'muted', style: { display: 'none', padding: '24px 4px' } }, 'No templates match your search.');
  const card = (t) => h('button', { class: 'pcard tcard', role: 'listitem', 'aria-label': `${t.name} – ${t.category}. ${t.description}`, onclick: () => { m.close(); onPick(t); } },
    h('div', { class: 'thumb' }, h('img', { src: t.thumb, alt: '', loading: 'lazy', onerror: (e) => { e.target.replaceWith(icon(t.kind === 'code' ? 'building-2' : 'box')); } })),
    t.animated ? h('span', { class: 'badge' }, 'Animated') : null,
    h('div', { class: 'meta' }, h('b', null, t.name), h('span', null, t.description)));
  const fill = () => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = list.filter((t) => (cat === 'All' || t.category === cat) && words.every((w) => [t.name, t.description, t.category, ...(t.tags || [])].join(' ').toLowerCase().includes(w)));
    mount(grid, shown.map(card)); empty.style.display = shown.length ? 'none' : '';
  };
  const chips = h('div', { class: 'chips tchips', role: 'tablist', 'aria-label': 'Template categories' }, cats.map((c) => h('button', { class: 'chip' + (c === cat ? ' active' : ''), role: 'tab', 'aria-selected': String(c === cat), onclick: (e) => { cat = c; [...chips.children].forEach((x) => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); }); e.currentTarget.classList.add('active'); e.currentTarget.setAttribute('aria-selected', 'true'); fill(); } }, c, c !== 'All' ? h('span', { class: 'count' }, String(counts.get(c))) : null)));
  const search = h('input', { class: 'field tsearch', type: 'search', placeholder: `Search ${list.length} templates – try “tram”, “terrace”, “kangaroo”…`, 'aria-label': 'Search templates', oninput: (e) => { q = e.target.value; fill(); }, onkeydown: (e) => { if (e.key === 'Enter') grid.querySelector('button')?.click(); } });
  fill();
  const m = modal({ title, icon: 'layout-template', body: h('div', { class: 'tbrowser' }, search, chips, grid, empty), wide: true });
  setTimeout(() => search.focus(), 30);
  return m;
}
export function templatePicker(ed) { return templateBrowser({ title: 'Insert template', onPick: (t) => insertTemplate(ed, t) }); }

// =============================================================================== export
export const EXPORT_PRESETS = [
  { id: 'original', label: 'Original', icon: 'gem', desc: 'Everything as it is: full detail, textures, hierarchy, animation.', opts: { format: 'glb' } },
  { id: 'godot', label: 'Godot 4', icon: 'gamepad-2', desc: 'GLB with collision & loop hints, scale applied, 2K textures.', opts: { format: 'glb', godot: true, applyScale: true, textureMax: 2048 } },
  { id: 'blender', label: 'Blender', icon: 'send', desc: 'Full-detail GLB: hierarchy, cameras, lights, custom properties.', opts: { format: 'glb' } },
  { id: 'unity', label: 'Unity', icon: 'boxes', desc: 'GLB for glTFast: scale applied, 2K textures.', opts: { format: 'glb', applyScale: true, textureMax: 2048 } },
  { id: 'unreal', label: 'Unreal', icon: 'box', desc: 'GLB for Unreal 5’s glTF import, 2K textures.', opts: { format: 'glb', applyScale: true, textureMax: 2048 } },
  { id: 'web', label: 'Web & AR', icon: 'globe', desc: 'Light for websites and Android AR: ≤ 100k tris, 2K textures.', opts: { format: 'glb', maxTris: 100000, textureMax: 2048, origin: 'bottom', cameras: false } },
  { id: 'apple', label: 'iPhone AR', icon: 'smartphone', desc: 'USDZ for AR Quick Look on iPhone and iPad.', opts: { format: 'usdz', maxTris: 150000, textureMax: 2048, origin: 'bottom' } },
  { id: 'print', label: '3D print', icon: 'printer', desc: 'STL in millimetres, Z-up, one solid piece.', opts: { format: 'stl', units: 'mm', upZ: true, origin: 'bottom', merge: true } },
  { id: 'obj', label: 'Other apps', icon: 'package', desc: 'OBJ + MTL + textures in a zip for any 3D software.', opts: { format: 'obj', textureMax: 2048 } },
];
const DEFAULT_EXPORT = { units: 'm', upZ: false, merge: false, maxTris: 0, textureMax: 0, origin: 'keep', godot: false, applyScale: false, cameras: true, lights: true, props: true, animations: true, vertexColors: true };
const IMAGE_SIZES = [['1920x1080', 'Full HD'], ['3840x2160', '4K'], ['2048x2048', 'Square 2K'], ['1080x1920', 'Portrait'], ['1024x1024', 'Icon 1K']];
export function exportDialog(ed, extra = {}) {
  const d = ed.doc;
  if (!d.objects.length) { toast('Nothing to export yet'); return; }
  const last = ed.settings.lastExportOpts || {};
  const o = { preset: 'original', name: safeName(d.name), includeHidden: false, onlySelected: false, scale: 1, ...DEFAULT_EXPORT, format: 'glb', imgSize: '1920x1080', transparent: true, ...(extra.format ? {} : last), ...extra };
  o.name = safeName(d.name); if (extra.onlySelected) o.onlySelected = true;
  const summary = h('div', { class: 'summary', 'aria-live': 'polite' });
  const optsHost = h('div');
  let estTimer = 0, estGen = 0;
  const totalTris = () => (o.onlySelected && d.selection.length ? d.selection.flatMap((x) => [x, ...d.descendants(x)]) : d.objects).filter((x) => isMesh(x) && !x.ed.noExport && (o.includeHidden || d.isShown(x))).reduce((a, x) => a + x.geometry.index.count / 3, 0);
  const sizeEl = h('b', { style: { fontSize: '15px' } });
  const updateSummary = () => {
    const f = FORMATS.find((x) => x.id === o.format);
    if (o.format === 'png') {
      mount(summary, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', null, `${o.name}.png`), h('div', { class: 'muted' }, `${o.imgSize.replace('x', ' × ')} px · ${o.transparent ? 'transparent background' : 'with background'} · current view`))));
      return;
    }
    const tris = totalTris(), out = o.maxTris && tris > o.maxTris ? o.maxTris : tris;
    const warns = [];
    if (o.format === 'stl') warns.push('STL stores shape only – no colours, textures or animation.');
    if (o.format === 'obj' && d.hasAnimation()) warns.push('OBJ can’t store animation or hierarchy.');
    if (o.format === 'usdz' && d.hasAnimation()) warns.push('Animation isn’t included in USDZ.');
    if (o.format === 'usdz' && d.meshes.some((x) => x.material.vertexColors && x.geometry.attributes.color)) warns.push('USDZ ignores vertex paint – paint on the texture instead for AR.');
    if ((o.format === 'ply' || o.format === 'stl') && d.meshes.some((x) => x.material.map)) warns.push('Textures are not included in ' + f.label + '.');
    if (out > 500000) warns.push('Over 500k triangles – consider a triangle budget for games, web or AR.');
    if (o.maxTris && tris > o.maxTris) warns.push(`Simplifying ${Math.round(tris).toLocaleString()} → ${o.maxTris.toLocaleString()} triangles (your project is not changed).`);
    const excluded = d.objects.filter((x) => x.ed.noExport).length; if (excluded) warns.push(`${excluded} object${excluded > 1 ? 's are' : ' is'} set to “not exported”.`);
    if (o.godot) { const cols = d.meshes.filter((x) => x.ed.collision && x.ed.collision !== 'none').length; warns.push(cols ? `${cols} object${cols > 1 ? 's' : ''} get Godot collision.` : 'Tip: set Collision on objects (Object tab) to get physics bodies in Godot.'); }
    mount(summary, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('b', null, `${o.name}.${f.ext}`), h('div', { class: 'muted' }, `${Math.round(out).toLocaleString()} triangles · ${f.desc}`)), sizeEl),
      warns.map((w) => h('div', { class: 'warn' }, icon(w.startsWith('Tip') || /get Godot/.test(w) ? 'info' : 'triangle-alert'), h('span', null, w))));
    clearTimeout(estTimer);
    const g = ++estGen;
    sizeEl.textContent = 'Estimating…';
    estTimer = setTimeout(async () => {
      try { const r = await exportModel(d, { ...o }); if (g === estGen) sizeEl.textContent = '≈ ' + bytes(r.files ? r.files.reduce((a, x) => a + x[1].byteLength, 0) : r.data.byteLength) + (r.files ? ` · ${r.files.length} files` : ''); } catch (e) { if (g === estGen) sizeEl.textContent = ''; console.warn(e); }
    }, 450);
  };
  const renderOpts = () => {
    const mesh = ['stl', 'ply', 'obj'].includes(o.format), gltf = ['glb', 'gltf', 'gltfsep'].includes(o.format);
    if (o.format === 'png') {
      mount(optsHost,
        section('Format'), seg(FORMATS.map((f) => [f.id, f.label, null, f.desc]), o.format, (v) => { o.format = v; o.preset = null; renderAll(); }, 'accent', 'Format'),
        section('File name'), h('input', { class: 'field', value: o.name, 'aria-label': 'File name', oninput: (e) => { o.name = safeName(e.target.value) || 'render'; updateSummary(); } }),
        section('Image size'), seg(IMAGE_SIZES.map(([v, l]) => [v, l, null, v.replace('x', ' × ')]), o.imgSize, (v) => { o.imgSize = v; updateSummary(); }, '', 'Image size'),
        toggle('Transparent background', o.transparent, (v) => { o.transparent = v; updateSummary(); }, 'Keeps the soft floor shadow'),
        h('p', { class: 'muted' }, 'Renders exactly what the viewport camera sees, with your materials and lighting but without the grid, gizmos or outlines.'));
      return;
    }
    mount(optsHost,
      section('Format'), seg(FORMATS.map((f) => [f.id, f.label, null, f.desc]), o.format, (v) => { o.format = v; o.preset = null; renderAll(); }, 'accent', 'Format'),
      section('File name'), h('input', { class: 'field', value: o.name, 'aria-label': 'File name', oninput: (e) => { o.name = safeName(e.target.value) || 'model'; updateSummary(); } }),
      section('What to include'),
      toggle('Only the selection', o.onlySelected, (v) => { o.onlySelected = v; updateSummary(); }, d.selection.length ? `${d.selection.length} selected (with children)` : 'Nothing selected'),
      toggle('Hidden objects', o.includeHidden, (v) => { o.includeHidden = v; updateSummary(); }),
      !mesh && o.format !== 'usdz' && toggle('Animation', o.animations, (v) => { o.animations = v; updateSummary(); }, d.hasAnimation() ? (d.clips.length ? `${d.clips.length} named clips` : 'One clip for the whole timeline') : 'No animation in this project'),
      !mesh && toggle('Lights', o.lights, (v) => { o.lights = v; updateSummary(); }),
      gltf && toggle('Cameras', o.cameras, (v) => { o.cameras = v; updateSummary(); }),
      gltf && toggle('Custom properties', o.props, (v) => { o.props = v; updateSummary(); }, 'As glTF extras (Blender custom properties, Godot metadata)'),
      o.format !== 'stl' && toggle('Vertex paint', o.vertexColors, (v) => { o.vertexColors = v; updateSummary(); }),
      o.format !== 'stl' && toggle('Merge into one mesh', o.merge, (v) => { o.merge = v; updateSummary(); }, 'Single object (removes animation and hierarchy)'),
      gltf && section('Game engine'),
      gltf && toggle('Godot import hints', o.godot, (v) => { o.godot = v; o.preset = null; renderPresets(); updateSummary(); }, 'Collision (-col, -convcol, -rigid…) and -loop on looping clips'),
      gltf && toggle('Apply scale to static meshes', o.applyScale, (v) => { o.applyScale = v; updateSummary(); }, 'Unit scale for physics and collision shapes'),
      section('Placement & size'),
      h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Pivot / origin'),
      seg([['keep', 'As in scene'], ['center', 'Centre'], ['bottom', 'Bottom centre']], o.origin, (v) => { o.origin = v; updateSummary(); }),
      mesh ? h('div', null, h('div', { class: 'label', style: { margin: '10px 0 6px' } }, 'Units'), seg([['m', 'Metres'], ['cm', 'Centimetres'], ['mm', 'Millimetres'], ['in', 'Inches']], o.units, (v) => { o.units = v; updateSummary(); }), toggle('Z axis up', o.upZ, (v) => { o.upZ = v; updateSummary(); }, 'For slicers, CAD and Z-up apps'))
        : slider({ label: 'Scale', min: 0.01, max: 10, step: 0.01, value: o.scale, format: (v) => '×' + v.toFixed(2), onCommit: (v) => { o.scale = v; updateSummary(); } }),
      section('Optimise'),
      h('div', { class: 'label', style: { marginBottom: '6px' } }, 'Triangle budget'),
      seg([[0, 'Full'], [200000, '200k'], [100000, '100k'], [50000, '50k'], [20000, '20k'], [5000, '5k']], o.maxTris, (v) => { o.maxTris = v; updateSummary(); }),
      o.format !== 'stl' && o.format !== 'ply' && h('div', null, h('div', { class: 'label', style: { margin: '10px 0 6px' } }, 'Max texture size'), seg([[0, 'Original'], [4096, '4K'], [2048, '2K'], [1024, '1K'], [512, '512']], o.textureMax, (v) => { o.textureMax = v; updateSummary(); })),
    );
  };
  const presetRow = h('div', { class: 'hscroll', role: 'radiogroup', 'aria-label': 'Export presets' });
  const renderPresets = () => mount(presetRow, EXPORT_PRESETS.map((p) => h('button', { class: 'presetcard' + (o.preset === p.id ? ' on' : ''), role: 'radio', 'aria-checked': String(o.preset === p.id), onclick: () => { Object.assign(o, DEFAULT_EXPORT, p.opts, { preset: p.id }); renderAll(); } }, icon(p.icon), h('b', null, p.label), h('span', null, p.desc))));
  const renderAll = () => { renderPresets(); renderOpts(); updateSummary(); };
  const pipeRow = isDesktop ? h('div', { class: 'row', style: { marginTop: '12px', flexWrap: 'wrap' } }, h('span', { class: 'label' }, 'Straight into:'), btn(d.link?.kind === 'godot' ? `Godot (${d.link.project || 'linked'})` : 'Godot project…', () => { m.close(); PL.sendToGodot(ed); }, 'tinted', 'gamepad-2'), btn('Blender', () => { m.close(); PL.sendToBlender(ed); }, 'tinted', 'send')) : null;
  const body = h('div', null, section('Presets'), presetRow, pipeRow, h('div', { style: { margin: '14px 0 0' } }, summary), optsHost);
  const doExport = async () => {
    ed.settings.lastExportOpts = { ...o, name: undefined, onlySelected: undefined }; ed.saveSettings();
    m.close();
    await runExport(ed, { ...o });
  };
  const m = modal({ title: 'Export', icon: 'share', body, wide: true, footer: [btn('Help: Godot & Blender', () => PL.pipelineHelp(ed), 'ghost', 'circle-help'), h('div', { class: 'grow' }), btn('Cancel', () => m.close(), 'ghost'), btn(o.format === 'png' ? 'Render…' : 'Export…', doExport, 'primary lg', 'share')], onClose: () => { estGen++; clearTimeout(estTimer); } });
  renderAll();
}
/** Runs an export and saves the result (one file, a folder of files, or a PNG render). */
async function runExport(ed, o) {
  const d = ed.doc, b = busy(o.format === 'png' ? 'Rendering…' : 'Exporting…');
  try {
    const f = FORMATS.find((x) => x.id === o.format);
    if (o.format === 'png') {
      const [w, hh] = o.imgSize.split('x').map(Number);
      const png = await ed.vp.renderImage({ width: w, height: hh, transparent: o.transparent });
      b.close();
      const path = await platform.files.save(`${o.name}.png`, png, [{ name: 'PNG image', extensions: ['png'] }]);
      if (path) done(ed, path, png.byteLength);
      ed.lastExport = o; return;
    }
    const r = await exportModel(d, { ...o });
    b.close();
    let path, size;
    if (r.files) {
      size = r.files.reduce((a, x) => a + x[1].byteLength, 0);
      if (isDesktop) {
        const pick = await platform.pipeline.pickDir({ title: `Choose a folder for ${o.name}.gltf and its ${r.files.length - 1} files` });
        if (!pick) return;
        const paths = await platform.pipeline.write(pick.dir, '', r.files.map(([n, x]) => [n, x instanceof Uint8Array ? x : new Uint8Array(x)]));
        path = paths[0];
      } else path = await platform.files.save(`${o.name}.zip`, zip(r.files.map(([n, x]) => [n, x instanceof Uint8Array ? x : new Uint8Array(x)])), [{ name: 'Zip', extensions: ['zip'] }]);
    } else {
      size = r.data.byteLength;
      path = await platform.files.save(`${o.name}.${f.ext}`, r.data, [{ name: f.label, extensions: [f.ext] }]);
    }
    if (!path) return;
    ed.lastExport = o;
    r.warnings.forEach((w) => toast(w, 4000));
    done(ed, path, size);
  } catch (e) { console.error(e); b.close(); toast('Export failed: ' + e.message, 5000); }
}
function done(ed, path, size) {
  if (isDesktop && typeof path === 'string') {
    const t = h('div', { class: 'hint', role: 'status' }, icon('circle-check'), h('p', null, `Exported ${bytes(size)} → ${path}`), btn('Show in folder', () => { platform.files.reveal(path); t.remove(); }, 'tinted'), ibtn('x', 'Dismiss', () => t.remove()));
    mount(ed.hintHost, t); setTimeout(() => t.remove(), 10000);
  } else toast('Exported ' + bytes(size));
}
/** Ctrl+Shift+E: repeats the last export with the same settings (asks where to save). */
export function quickExport(ed) {
  if (!ed.lastExport) { exportDialog(ed); return; }
  runExport(ed, { ...ed.lastExport, name: safeName(ed.doc.name) });
}
const safeName = (s) => (s || 'model').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80);
export const bytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

// =============================================================================== array
export function arrayDialog(ed) {
  const o = ed.doc.selected; if (!o) { toast('Select an object'); return; }
  const st = { mode: 'linear', count: 5, axis: 'x', gap: 0.1, angle: 360, rotate: true };
  const host = h('div');
  const render = () => mount(host,
    seg([['linear', 'In a line', 'move-horizontal'], ['radial', 'In a circle', 'rotate-3d']], st.mode, (v) => { st.mode = v; render(); }, 'accent', 'Array type'),
    slider({ label: 'Count', min: 2, max: 64, int: true, value: st.count, onInput: (v) => { st.count = v; } }),
    st.mode === 'linear' ? [h('div', { class: 'label', style: { margin: '8px 0 6px' } }, 'Direction'), seg([['x', 'X'], ['y', 'Y'], ['z', 'Z']], st.axis, (v) => { st.axis = v; }, '', 'Axis'),
      slider({ label: 'Gap between copies', min: -1, max: 5, step: 0.01, unit: ' m', value: st.gap, onInput: (v) => { st.gap = v; } })]
      : [slider({ label: 'Total angle', min: 30, max: 360, step: 5, unit: '°', value: st.angle, onInput: (v) => { st.angle = v; } }), toggle('Rotate copies to face out', st.rotate, (v) => { st.rotate = v; })],
    h('p', { class: 'muted' }, 'The original and its copies are put in a new group, so you can move them together.'));
  render();
  const m = modal({ title: `Array “${o.name}”`, icon: 'copy-plus', body: host, footer: [btn('Cancel', () => m.close(), 'ghost'), btn('Create', () => { m.close(); ed.actions.array(o, st); }, 'primary', 'copy-plus')] });
}

// =============================================================================== animation clips
/** Named ranges of the timeline: each becomes its own animation (Idle, Walk, Open…) in GLB exports. */
export function clipsDialog(ed) {
  const d = ed.doc, list = d.clips.map((c) => ({ ...c }));
  const host = h('div');
  const num = (c, k, lbl) => h('input', { class: 'field cw-num', type: 'number', min: '0', max: String(d.frameCount), value: c[k], 'aria-label': `${c.name} ${lbl}`, onchange: (e) => { c[k] = Math.max(0, Math.min(d.frameCount, Math.round(+e.target.value || 0))); } });
  const render = () => mount(host,
    h('p', { class: 'muted' }, `Timeline: 0 – ${d.frameCount} frames at ${d.fps} fps. Without clips, the whole timeline exports as one animation called “Animation”.`),
    list.length ? h('div', { class: 'cliptable', role: 'table', 'aria-label': 'Clips' },
      h('div', { class: 'cliprow head', role: 'row' }, h('span', { role: 'columnheader' }, 'Name'), h('span', { role: 'columnheader' }, 'Start'), h('span', { role: 'columnheader' }, 'End'), h('span', { role: 'columnheader' }, 'Loop'), h('span')),
      list.map((c, i) => h('div', { class: 'cliprow', role: 'row' },
        h('input', { class: 'field', value: c.name, 'aria-label': `Clip ${i + 1} name`, oninput: (e) => { c.name = e.target.value.trim() || 'Clip'; } }),
        num(c, 'start', 'start frame'), num(c, 'end', 'end frame'),
        h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!c.loop), 'aria-label': `${c.name} loops`, onclick: (e) => { c.loop = !c.loop; e.currentTarget.setAttribute('aria-checked', String(c.loop)); } }),
        ibtn('trash-2', `Delete ${c.name}`, () => { list.splice(i, 1); render(); })))) : h('div', { class: 'empty', style: { padding: '20px' } }, 'No clips yet.'),
    h('div', { class: 'row', style: { marginTop: '10px', flexWrap: 'wrap' } },
      btn('Add clip', () => { const s = list.length ? Math.min(d.frameCount, list[list.length - 1].end + 1) : 0; list.push({ name: ['Idle', 'Walk', 'Run', 'Jump', 'Open', 'Close'][list.length] || 'Clip ' + (list.length + 1), start: s, end: Math.min(d.frameCount, s + Math.max(10, Math.round(d.fps))), loop: true }); render(); }, 'tinted', 'plus'),
      btn('Clip from keys of selection', () => { const ks = d.selection.flatMap((o) => [...o.ed.keys.keys()]); if (!ks.length) { toast('Selection has no keys'); return; } list.push({ name: 'Clip ' + (list.length + 1), start: Math.min(...ks), end: Math.max(...ks), loop: true }); render(); }, 'ghost', 'diamond')),
    h('p', { class: 'muted' }, 'Godot: looping clips are exported with “-loop” when Godot hints are on. Blender: each clip becomes an Action.'));
  render();
  const m = modal({ title: 'Animation clips', icon: 'film', body: host, wide: true, footer: [btn('Cancel', () => m.close(), 'ghost'), btn('Save clips', () => {
    const clean = list.map((c) => ({ name: c.name.replace(/[^\w\- ]+/g, '').trim() || 'Clip', start: Math.min(c.start, c.end), end: Math.max(c.start, c.end), loop: !!c.loop })).filter((c) => c.end > c.start);
    d.transact('Animation clips', () => { d.clips = clean; }, []);
    if (ed.playClip && !d.clips.includes(ed.playClip)) ed.playClip = null;
    m.close(); if (ed.mode === 'animate') ed.renderTimeline();
  }, 'primary', 'check')] });
}

// =============================================================================== shortcuts
export function shortcutsDialog() {
  const groups = [
    ['Navigate', [['Orbit', 'Left-drag empty space · Right-drag · Alt+drag · Numpad 2 4 6 8 · Alt+arrows'], ['Pan', 'Middle-drag · Shift+drag'], ['Zoom', 'Scroll · = / −'], ['Frame selection / all', 'F / Home'], ['Front · Right · Top · Ortho', 'Numpad 1 · 3 · 7 · 5 (Ctrl = opposite side)'], ['Look through camera', 'Numpad 0']]],
    ['Select', [['Select / add / toggle', 'Click · Shift+click · Ctrl+click'], ['Pick inside a group', 'Double-click · Alt+click'], ['Box select', 'Ctrl+drag, or drag with the Select tool (Q)'], ['All · none · invert', 'Ctrl+A · Alt+A · Ctrl+Shift+I'], ['Previous / next object', '[ / ]']]],
    ['Object', [['Select · Move · Rotate · Scale · Measure', 'Q · W · E · R · M'], ['Nudge selection', 'Arrows (Shift = ×10) · PageUp/PageDown = depth'], ['Snapping on/off', 'Shift+Tab (hold Ctrl while dragging to flip)'], ['Add menu · 3D text', 'Shift+A · T'], ['Duplicate · copy · paste', 'Ctrl+D · Ctrl+C · Ctrl+V'], ['Group · ungroup', 'Ctrl+G · Ctrl+Shift+G'], ['Parent to active · clear parent', 'Ctrl+P · Alt+P'], ['Join meshes', 'Ctrl+J'], ['Hide · hide others · show all', 'H · Shift+H · Alt+H'], ['Rename · delete', 'F2 · Del']]],
    ['Modes & brushes', [['Object · Sculpt · Paint · Faces · Animate', '1 – 5'], ['Brush size', '[ and ] · Ctrl+scroll'], ['Sculpt: Clay Draw Smooth Inflate Pinch Grab Mask Layer', 'C D S I P G M L'], ['Smooth / invert while sculpting', 'hold Shift / Ctrl'], ['Paint: line · brush · eraser · eyedropper', 'L · B · E · I'], ['Straight line from last point', 'Shift+click'], ['Faces: add / remove', 'Shift+click / Ctrl+click']]],
    ['Animate', [['Play / pause · Keyframe', 'Space · K'], ['Previous / next frame', '← / → (Shift = 10)']]],
    ['App', [['Command palette', 'Ctrl+K or F3'], ['Menu bar', 'Alt or F10'], ['Undo / redo', 'Ctrl+Z / Ctrl+Shift+Z'], ['Save · import · export · repeat export', 'Ctrl+S · Ctrl+I · Ctrl+E · Ctrl+Shift+E'], ['Render image', 'F12'], ['X-ray · wireframe', 'Alt+Z · Shift+Z'], ['Hide the interface', 'Ctrl+\\'], ['Settings · close project', 'Ctrl+, · Ctrl+W']]],
  ];
  modal({ title: 'Keyboard & mouse', icon: 'keyboard', wide: true, body: h('div', { class: 'kbdcols' }, groups.map(([title, rows]) => h('section', null, h('h3', null, title), h('div', { class: 'kbdlist' }, rows.map(([a, b]) => [h('span', null, a), h('kbd', null, b)]))))) });
}
export { syncTextures, makeMesh, newMaterial, prepareGeometry, stickerTexture, menu, select, ibtn };
