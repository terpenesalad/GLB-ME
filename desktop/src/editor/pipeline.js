// Game-engine & DCC pipeline: export straight into a Godot project (with a live link that
// re-exports on every save), open the model in Blender, and a short guide for each tool.
import { h, icon, btn, ibtn, mount, modal, toggle, seg, section, toast, busy } from '../ui/dom.js';
import { platform, isDesktop } from '../platform.js';
import { exportModel } from './io.js';

export const safeName = (s) => (s || 'model').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'model';
const cleanSub = (s) => (s || '').replace(/\\/g, '/').split('/').map((x) => x.trim().replace(/[:*?"<>|]+/g, '')).filter((x) => x && x !== '.' && x !== '..').join('/');

/** Export options used for engines (hierarchy, lights, cameras, custom properties, Godot hints). */
export function godotOptions(extra = {}) {
  return { format: 'glb', godot: true, applyScale: true, animations: true, lights: true, cameras: true, vertexColors: true, origin: 'keep', scale: 1, maxTris: 0, textureMax: 2048, includeHidden: false, ...extra };
}
export function blenderOptions(extra = {}) {
  return { format: 'glb', animations: true, lights: true, cameras: true, vertexColors: true, origin: 'keep', scale: 1, maxTris: 0, textureMax: 0, includeHidden: false, ...extra };
}
function needDesktop() { toast('Sending to other apps works in the GLB&ME desktop app', 4000); }

// ------------------------------------------------------------------------------- Godot
export async function sendToGodot(ed) {
  if (!isDesktop) return needDesktop();
  const d = ed.doc, link = d.link?.kind === 'godot' ? d.link : null;
  const st = {
    root: link?.root || ed.settings.lastGodotRoot || '', project: link?.project || '', sub: link?.sub ?? 'models', file: link?.file || safeName(d.name),
    format: link?.opts?.format || 'glb', godot: link?.opts?.godot ?? true, applyScale: link?.opts?.applyScale ?? true, textureMax: link?.opts?.textureMax ?? 2048, live: link?.live ?? true, onlySelected: false,
  };
  if (st.root && !st.project) { try { const info = await platform.pipeline.inspect(st.root); if (info?.godotRoot) { st.project = info.projectName || ''; } else st.root = ''; } catch { st.root = ''; } }
  const host = h('div');
  const render = () => mount(host,
    h('div', { class: 'summary' }, h('div', { class: 'row' }, icon('gamepad-2'), h('div', { class: 'grow' },
      h('b', null, st.root ? (st.project || 'Godot project') : 'No project chosen'),
      h('div', { class: 'muted', style: { wordBreak: 'break-all' } }, st.root || 'Pick the folder that contains project.godot')),
    btn(st.root ? 'Change…' : 'Choose project…', async () => {
      const r = await platform.pipeline.pickDir({ title: 'Choose your Godot project folder', defaultPath: st.root || undefined });
      if (!r) return;
      if (r.godotRoot) { st.root = r.godotRoot; st.project = r.projectName || ''; const rel = r.dir.slice(r.godotRoot.length).replace(/^[\\/]+/, ''); if (rel) st.sub = cleanSub(rel); }
      else { toast('That folder isn’t inside a Godot project (no project.godot found)', 4500); return; }
      ed.settings.lastGodotRoot = st.root; ed.saveSettings(); render();
    }, st.root ? 'ghost' : 'primary', 'folder-open'))),
    section('Where in the project'),
    h('div', { class: 'row' }, h('span', { class: 'mono muted' }, 'res://'), h('input', { class: 'field grow', value: st.sub, 'aria-label': 'Folder inside the Godot project', oninput: (e) => { st.sub = e.target.value; preview.textContent = pathText(); } })),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'label', style: { width: '70px' } }, 'File name'), h('input', { class: 'field grow', value: st.file, 'aria-label': 'File name', oninput: (e) => { st.file = safeName(e.target.value); preview.textContent = pathText(); } })),
    preview,
    section('Format'), seg([['glb', 'GLB (one file)'], ['gltfsep', 'glTF + textures']], st.format, (v) => { st.format = v; preview.textContent = pathText(); }, 'accent', 'Format'),
    section('Godot import'),
    toggle('Godot import hints', st.godot, (v) => { st.godot = v; }, 'Collision (-col, -convcol, -rigid…) from each object’s Collision setting, and -loop on looping clips'),
    toggle('Apply scale to static meshes', st.applyScale, (v) => { st.applyScale = v; }, 'Physics and collision shapes work best with a scale of 1'),
    toggle('Only the selection', st.onlySelected, (v) => { st.onlySelected = v; }, d.selection.length ? `${d.selection.length} selected` : 'Nothing selected'),
    h('div', { class: 'label', style: { margin: '8px 0 6px' } }, 'Max texture size'), seg([[0, 'Original'], [4096, '4K'], [2048, '2K'], [1024, '1K']], st.textureMax, (v) => { st.textureMax = v; }),
    section('Live link'),
    toggle('Update Godot every time I save', st.live, (v) => { st.live = v; }, 'Godot re-imports the file when you switch back to it'));
  const pathText = () => `res://${cleanSub(st.sub) ? cleanSub(st.sub) + '/' : ''}${safeName(st.file)}.${st.format === 'glb' ? 'glb' : 'gltf'}`;
  const preview = h('div', { class: 'muted mono', style: { marginTop: '6px' } }, pathText());
  render();
  const m = modal({ title: 'Send to Godot', icon: 'gamepad-2', wide: false, body: host, footer: [
    btn('How it works', () => pipelineHelp(ed), 'ghost', 'circle-help'), h('div', { class: 'grow' }),
    btn('Cancel', () => m.close(), 'ghost'),
    btn('Export to Godot', async () => {
      if (!st.root) { toast('Choose your Godot project first'); return; }
      d.link = { kind: 'godot', root: st.root, project: st.project, sub: cleanSub(st.sub), file: safeName(st.file), live: st.live, opts: godotOptions({ format: st.format, godot: st.godot, applyScale: st.applyScale, textureMax: st.textureMax, onlySelected: st.onlySelected }) };
      d.dirty = true;
      m.close();
      const ok = await syncLink(ed, true);
      if (ok) ed.linkHint?.();
    }, 'primary', 'send')] });
}

let syncing = null;
/** Exports the project to its linked folder (Godot project or folder). Returns true on success. */
export async function syncLink(ed, manual = false) {
  const d = ed.doc, link = d.link;
  if (!link || !isDesktop) return false;
  while (syncing) await syncing;
  let done; syncing = new Promise((r) => { done = r; });
  const b = manual ? busy('Exporting to ' + (link.project || 'folder') + '…') : null;
  ed.setLinkStatus?.('syncing');
  try {
    const opts = { ...link.opts, name: link.file };
    const r = await exportModel(d, opts);
    const files = r.files || [[`${link.file}.${opts.format === 'glb' ? 'glb' : 'gltf'}`, new Uint8Array(r.data)]];
    const paths = await platform.pipeline.write(link.root, link.sub, files.map(([n, data]) => [n, data instanceof Uint8Array ? data : new Uint8Array(data)]));
    link.lastPath = paths[0]; link.lastSync = Date.now();
    ed.setLinkStatus?.('ok');
    if (manual) toast(`Exported to res://${link.sub ? link.sub + '/' : ''}${files[0][0]}`, 3500);
    return true;
  } catch (e) {
    console.error(e); ed.setLinkStatus?.('error', e.message);
    toast('Live link failed: ' + e.message + (manual ? '' : ' – check the folder still exists'), 5000);
    return false;
  } finally { b?.close(); syncing = null; done(); }
}
export function revealLink(ed) { const p = ed.doc.link?.lastPath; if (p) platform.files.reveal(p); else toast('Sync once first'); }
export function unlink(ed) { ed.doc.link = null; ed.doc.dirty = true; ed.setLinkStatus?.(null); toast('Live link stopped'); }
export async function openGodot(ed) {
  if (!isDesktop) return needDesktop();
  const root = ed.doc.link?.root || ed.settings.lastGodotRoot; if (!root) { toast('Send to Godot first'); return; }
  const exe = await findOrPickTool(ed, 'godot'); if (!exe) return;
  try { await platform.pipeline.launch('godot', root); toast('Opening Godot…'); } catch (e) { toast('Couldn’t start Godot: ' + e.message, 5000); }
}

// ------------------------------------------------------------------------------- Blender
export async function sendToBlender(ed) {
  if (!isDesktop) return needDesktop();
  const exe = await findOrPickTool(ed, 'blender'); if (!exe) return;
  const b = busy('Preparing for Blender…');
  try {
    const name = safeName(ed.doc.name);
    const r = await exportModel(ed.doc, blenderOptions({ name }));
    const path = await platform.pipeline.writeTemp(`${name}.glb`, new Uint8Array(r.data));
    await platform.pipeline.launch('blender', path);
    toast('Opening in Blender… (it imports the model into a new scene)', 4500);
  } catch (e) { console.error(e); toast('Couldn’t open Blender: ' + e.message, 5000); }
  finally { b.close(); }
}

const TOOLS = {
  blender: { name: 'Blender', url: 'https://www.blender.org/download/', hint: 'Usually C:\\Program Files\\Blender Foundation\\Blender 4.x\\blender.exe, /Applications/Blender.app, or “blender” on Linux.' },
  godot: { name: 'Godot', url: 'https://godotengine.org/download', hint: 'The Godot 4 editor executable (e.g. Godot_v4.x-stable_win64.exe or /Applications/Godot.app).' },
};
/** Finds Blender / Godot (saved path or common install locations), or asks the user to locate it. */
export async function findOrPickTool(ed, tool) {
  const found = await platform.pipeline.findTool(tool).catch(() => null);
  if (found) return found;
  const t = TOOLS[tool];
  return new Promise((res) => {
    let done = false;
    const m = modal({ title: `Where is ${t.name}?`, icon: 'search', body: h('div', null, h('p', null, `GLB&ME couldn’t find ${t.name} on this computer.`), h('p', { class: 'muted' }, t.hint)),
      footer: [btn(`Get ${t.name}`, () => platform.app.openExternal(t.url), 'ghost', 'external-link'), h('div', { class: 'grow' }), btn('Cancel', () => m.close(), 'ghost'),
        btn(`Locate ${t.name}…`, async () => { const p = await platform.pipeline.pickTool(tool); if (p) { done = true; m.close(); res(p); } }, 'primary', 'folder-open')],
      onClose: () => { if (!done) res(null); } });
  });
}

// ------------------------------------------------------------------------------- guide
export function pipelineHelp() {
  const item = (ic, title, ...lines) => h('div', { class: 'welcome-feature' }, icon(ic), h('div', null, h('b', null, title), ...lines.map((l) => h('span', { style: { display: 'block', marginTop: '3px' } }, l))));
  modal({ title: 'Using your model in other apps', icon: 'gamepad-2', wide: true, body: h('div', null,
    item('gamepad-2', 'Godot 4',
      'File → Send to Godot writes a GLB into your project (res://models by default). With the live link on, every save updates it and Godot re-imports when you switch back.',
      'Set Collision on objects (Object tab) and keep “Godot import hints” on to get StaticBody / RigidBody / NavigationMesh nodes automatically. Looping clips get “-loop”.',
      'Groups become Node3D, lights become Light3D nodes, cameras Camera3D, and named clips appear in the AnimationPlayer. Custom properties arrive as node metadata (“extras”) in Godot 4.4+. 1 unit = 1 metre, Y up.'),
    item('send', 'Blender',
      'File → Send to Blender opens a new Blender window with your model imported (glTF importer, Y-up converted to Z-up for you).',
      'Or export GLB / glTF and use File → Import → glTF 2.0 (set Lighting Mode to “Unitless” so lights keep their brightness). Custom properties show up as Blender custom properties; materials keep clearcoat, transmission, sheen and emission; named clips become Actions.'),
    item('boxes', 'Unity & Unreal',
      'Unity: install the glTFast package (com.unity.cloud.gltfast), then drop the GLB into Assets.',
      'Unreal Engine 5: drag the GLB into the Content Browser (built-in glTF import).'),
    item('printer', '3D printing', 'Use the 3D print preset (STL, millimetres, Z up). Mesh → Check mesh tells you if the model is watertight.'),
    item('shield-check', 'Tips for clean game assets', 'Apply scale before adding collision, put the origin at the bottom (Object → Transform), keep textures 2K or smaller, and name objects – the names become node names.'),
  ) });
}
export { ibtn };
