// GLB&ME desktop – Electron main process: window, file system access for projects and fonts,
// native open/save dialogs and "open with" file handling.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isMac = process.platform === 'darwin';
// The UI is served from app://glbandme/ (a privileged, sandboxed scheme) so fetch() works for bundled assets.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const distDir = path.join(__dirname, '..', 'dist');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };
// WebGL must work even on PCs without a usable GPU driver (VMs, remote desktop): allow the software fallback.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// ---- logging & fatal errors: write to <userData>/logs/main.log and tell the user instead of failing silently
let logFile = null;
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (x instanceof Error ? x.stack : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { if (!logFile) { const d = path.join(app.getPath('userData'), 'logs'); fs.mkdirSync(d, { recursive: true }); logFile = path.join(d, 'main.log'); } fs.appendFileSync(logFile, line); } catch { /* ignore */ }
}
process.on('uncaughtException', (e) => { log('uncaught', e); try { dialog.showErrorBox('GLB&ME hit a problem', `${e && e.message}\n\nDetails were saved to:\n${logFile || 'the logs folder'}`); } catch { /* ignore */ } });
process.on('unhandledRejection', (e) => log('unhandled rejection', e));
let win = null;
let quitting = false; // Cmd+Q / app.quit(): finish quitting after the project has been saved
app.on('before-quit', () => { quitting = true; });
let pendingOpen = [];
const allowedFiles = new Set();
const systemFontFiles = new Set();

const dataDir = () => path.join(app.getPath('userData'), 'library');
const projectsDir = () => path.join(dataDir(), 'projects');
const fontsDir = () => path.join(dataDir(), 'fonts');

function ensureDirs() { for (const d of [dataDir(), projectsDir(), fontsDir()]) fs.mkdirSync(d, { recursive: true }); }

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 600,
    backgroundColor: '#0b0b0e',
    title: 'GLB&ME',
    titleBarStyle: 'hidden',
    titleBarOverlay: isMac ? false : { color: '#00000000', symbolColor: '#d8d8de', height: 46 },
    trafficLightPosition: { x: 16, y: 15 },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  const wc = win.webContents;
  wc.on('did-fail-load', (_e, code, desc, url) => { log('did-fail-load', code, desc, url); if (url.startsWith('app://')) showError(`The interface failed to load (${desc}, ${code}).`); });
  wc.on('render-process-gone', (_e, d) => { log('render-process-gone', d); if (d.reason !== 'clean-exit') showError(`The editor stopped unexpectedly (${d.reason}). Your projects are saved automatically.`, true); });
  wc.on('preload-error', (_e, p, err) => log('preload-error', p, err));
  wc.on('console-message', (_e, level, message, line, source) => { if (level >= 3) log('renderer', message, source + ':' + line); });
  // let the renderer save the open project before the window goes away
  let allowClose = false;
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app-closing');
    setTimeout(() => { allowClose = true; if (win && !win.isDestroyed()) win.close(); if (quitting) app.quit(); }, 10000);
  });
  ipcMain.removeHandler('app:closeReady');
  ipcMain.handle('app:closeReady', () => { allowClose = true; setImmediate(() => { if (win && !win.isDestroyed()) win.close(); if (quitting) app.quit(); }); });
  win.on('closed', () => { win = null; });
  win.loadURL('app://glbandme/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://glbandme/')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}

function showError(msg, reloadable = false) {
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) win.show();
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0b0e;color:#f5f5f7;font:15px system-ui,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;-webkit-app-region:drag">
    <div style="max-width:520px;padding:32px;-webkit-app-region:no-drag"><h2 style="margin:0 0 10px">GLB&amp;ME couldn’t start</h2><p style="color:#b4b4bc;line-height:1.5">${msg.replace(/</g, '&lt;')}</p>
    <p style="color:#8a8a93;font-size:13px">Log file: ${String(logFile || '').replace(/</g, '&lt;')}</p>
    ${reloadable ? '<button onclick="location.href=\'app://glbandme/index.html\'" style="background:#6e56f7;color:#fff;border:0;border-radius:10px;padding:10px 18px;font:inherit">Reload</button>' : ''}</div></body>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
}

// ---- single instance + "open with" ---------------------------------------------------------
const fileArgs = (argv) => argv.filter((a) => /\.(glb|gltf|obj|stl|ply|fbx|dae|3mf)$/i.test(a) && fs.existsSync(a));
// The first desktop build (GLB&ME.exe) could get stuck running invisibly in the background, which
// holds the single-instance lock so every later launch quit silently. A healthy instance writes a
// heartbeat file; if the lock is busy but there's no fresh heartbeat, the old process is cleared.
const heartbeatFile = () => path.join(app.getPath('userData'), 'running.json');
function healthyInstanceRunning() {
  try { const hb = JSON.parse(fs.readFileSync(heartbeatFile(), 'utf8')); return Date.now() - hb.t < 6000 && hb.pid !== process.pid; } catch { return false; }
}
function killOtherInstances() {
  if (process.platform !== 'win32') return false;
  const { execFileSync } = require('child_process');
  let killed = false;
  for (const image of ['GLB&ME.exe', 'GLB-ME.exe']) {
    try {
      const list = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
      const pids = [...list.matchAll(/^"[^"]+","(\d+)"/gm)].map((m) => +m[1]).filter((pid) => pid !== process.pid);
      for (const pid of pids) { try { execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }); killed = true; } catch { /* gone */ } }
    } catch (e) { log('tasklist', e); }
  }
  return killed;
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  const retry = process.argv.includes('--glbme-retry');
  log('single-instance lock busy', retry ? '(retry)' : '');
  if (healthyInstanceRunning()) app.quit(); // the running window brings itself to the front
  else if (!retry && killOtherInstances()) { app.relaunch({ args: [...process.argv.slice(1), '--glbme-retry'] }); app.exit(0); }
  else app.whenReady().then(() => { dialog.showErrorBox('GLB&ME is already running', 'Another copy of GLB&ME seems stuck in the background. Restart your PC (or end “GLB&ME” in Task Manager) and open it again.'); app.quit(); });
}
else {
  app.on('second-instance', (_e, argv) => {
    const files = fileArgs(argv);
    files.forEach((f) => allowedFiles.add(path.resolve(f)));
    if (!win || win.isDestroyed()) { pendingOpen.push(...files); if (app.isReady()) createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    files.forEach((f) => win.webContents.send('open-file', f));
  });
}
app.on('open-file', (e, file) => {
  e.preventDefault();
  allowedFiles.add(path.resolve(file));
  if (win && !win.isDestroyed()) win.webContents.send('open-file', file);
  else { pendingOpen.push(file); if (app.isReady()) createWindow(); }
});

if (gotLock) app.whenReady().then(() => {
  log('start', app.getVersion(), process.platform, process.arch, process.versions.electron);
  const beat = () => { try { fs.writeFileSync(heartbeatFile(), JSON.stringify({ pid: process.pid, t: Date.now() })); } catch { /* ignore */ } };
  beat(); setInterval(beat, 2000).unref();
  app.on('will-quit', () => { try { fs.rmSync(heartbeatFile(), { force: true }); } catch { /* ignore */ } });
  // serve the bundled UI straight from the app archive (works inside app.asar on every OS)
  protocol.handle('app', (req) => {
    try {
      const u = new URL(req.url);
      const file = path.normalize(path.join(distDir, decodeURIComponent(u.pathname)));
      if (!file.startsWith(distDir + path.sep)) return new Response('forbidden', { status: 403 });
      const data = fs.readFileSync(file);
      return new Response(data, { status: 200, headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch (e) {
      log('protocol', req.url, e);
      return new Response('not found', { status: 404 });
    }
  });
  ensureDirs();
  pendingOpen.push(...fileArgs(process.argv.slice(1)));
  pendingOpen.forEach((f) => allowedFiles.add(path.resolve(f)));
  if (isMac) Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }] }, { role: 'windowMenu' },
  ]));
  else Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((e) => { log('startup', e); dialog.showErrorBox('GLB&ME couldn’t start', String(e && e.stack || e)); app.quit(); });
app.on('child-process-gone', (_e, d) => log('child-process-gone', d));
app.on('window-all-closed', () => { if (!isMac) app.quit(); });

// ---- IPC: projects ---------------------------------------------------------------------------
const pdir = (id) => { if (!/^[a-f0-9-]{8,64}$/i.test(id)) throw new Error('bad id'); return path.join(projectsDir(), id); };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

ipcMain.handle('projects:list', () => {
  ensureDirs();
  return fs.readdirSync(projectsDir()).map((id) => {
    const m = readJson(path.join(projectsDir(), id, 'meta.json'), null);
    return m && fs.existsSync(path.join(projectsDir(), id, 'scene.glb')) ? { ...m, id } : null;
  }).filter(Boolean);
});
ipcMain.handle('projects:create', (_e, meta) => {
  const id = crypto.randomUUID(); fs.mkdirSync(pdir(id), { recursive: true });
  const now = Date.now(); const m = { name: 'Untitled', triangles: 0, objects: 0, animated: false, ...meta, id, created: now, modified: now };
  fs.writeFileSync(path.join(pdir(id), 'meta.json'), JSON.stringify(m)); return m;
});
ipcMain.handle('projects:save', (_e, id, meta, glb, thumb) => {
  const d = pdir(id); fs.mkdirSync(d, { recursive: true });
  const tmp = path.join(d, 'scene.glb.tmp'); fs.writeFileSync(tmp, Buffer.from(glb)); fs.renameSync(tmp, path.join(d, 'scene.glb'));
  if (thumb) fs.writeFileSync(path.join(d, 'thumb.png'), Buffer.from(thumb));
  const old = readJson(path.join(d, 'meta.json'), {});
  const m = { ...old, ...meta, id, modified: Date.now() };
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify(m)); return m;
});
ipcMain.handle('projects:load', (_e, id) => fs.readFileSync(path.join(pdir(id), 'scene.glb')));
ipcMain.handle('projects:thumb', (_e, id) => { const f = path.join(pdir(id), 'thumb.png'); return fs.existsSync(f) ? fs.readFileSync(f) : null; });
ipcMain.handle('projects:rename', (_e, id, name) => { const f = path.join(pdir(id), 'meta.json'); const m = readJson(f, {}); m.name = name; fs.writeFileSync(f, JSON.stringify(m)); return m; });
ipcMain.handle('projects:delete', (_e, id) => { fs.rmSync(pdir(id), { recursive: true, force: true }); return true; });
ipcMain.handle('projects:duplicate', (_e, id, name) => {
  const nid = crypto.randomUUID(); fs.cpSync(pdir(id), pdir(nid), { recursive: true });
  const f = path.join(pdir(nid), 'meta.json'); const m = readJson(f, {}); Object.assign(m, { id: nid, name, modified: Date.now() }); fs.writeFileSync(f, JSON.stringify(m)); return m;
});
ipcMain.handle('projects:reveal', (_e, id) => shell.showItemInFolder(path.join(pdir(id), 'scene.glb')));

// ---- IPC: files ------------------------------------------------------------------------------
ipcMain.handle('file:open', async (_e, opts) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(opts?.multi ? ['multiSelections'] : [])], filters: opts?.filters || [] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ name: path.basename(p), path: p, data: fs.readFileSync(p) }));
});
// only files the user opened through the OS ("Open with" / drag onto the icon) can be read by path
ipcMain.handle('file:read', (_e, p) => {
  const rp = path.resolve(String(p));
  if (!allowedFiles.has(rp)) throw new Error('not allowed');
  return { name: path.basename(rp), path: rp, data: fs.readFileSync(rp) };
});
ipcMain.handle('file:save', async (_e, name, data, filters) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: filters || [] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(data));
  return r.filePath;
});
ipcMain.handle('file:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('app:pending', () => { const p = pendingOpen; pendingOpen = []; return p; });
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:openExternal', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// ---- IPC: fonts ------------------------------------------------------------------------------
ipcMain.handle('fonts:imported', () => {
  ensureDirs();
  return fs.readdirSync(fontsDir()).filter((f) => /\.(ttf|otf|woff)$/i.test(f)).map((f) => ({ id: 'file:' + f, name: f.replace(/\.(ttf|otf|woff)$/i, '').replace(/[_-]+/g, ' '), file: f }));
});
ipcMain.handle('fonts:read', (_e, id) => {
  if (id.startsWith('file:')) return fs.readFileSync(path.join(fontsDir(), path.basename(id.slice(5))));
  if (id.startsWith('sys:')) { const p = path.resolve(id.slice(4)); if (!systemFontFiles.has(p)) throw new Error('unknown font'); return fs.readFileSync(p); }
  throw new Error('unknown font');
});
ipcMain.handle('fonts:import', (_e, name, data) => {
  ensureDirs();
  const clean = name.replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'Font.ttf';
  let f = path.join(fontsDir(), clean); let i = 2;
  while (fs.existsSync(f)) { const ext = path.extname(clean); f = path.join(fontsDir(), `${path.basename(clean, ext)} ${i++}${ext}`); }
  fs.writeFileSync(f, Buffer.from(data));
  return 'file:' + path.basename(f);
});
ipcMain.handle('fonts:delete', (_e, id) => { if (id.startsWith('file:')) fs.rmSync(path.join(fontsDir(), path.basename(id.slice(5))), { force: true }); return true; });
ipcMain.handle('fonts:system', () => {
  const dirs = [];
  if (process.platform === 'win32') {
    dirs.push(path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'));
  } else if (isMac) dirs.push('/System/Library/Fonts', '/Library/Fonts', path.join(app.getPath('home'), 'Library', 'Fonts'));
  else dirs.push('/usr/share/fonts', '/usr/local/share/fonts', path.join(app.getPath('home'), '.local', 'share', 'fonts'), path.join(app.getPath('home'), '.fonts'));
  const out = [];
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      else if (/\.(ttf|otf)$/i.test(e.name)) { systemFontFiles.add(path.resolve(p)); out.push({ id: 'sys:' + p, file: e.name }); }
    }
  };
  dirs.forEach((d) => walk(d, 0));
  return out.slice(0, 3000);
});

// ---- IPC: pipeline (Godot projects, Blender, folder exports) ----------------------------------
// Folders the user picked in a dialog are remembered so live links keep working after a restart.
const pipeFile = () => path.join(app.getPath('userData'), 'pipeline.json');
const pipe = () => readJson(pipeFile(), { dirs: [], tools: {} });
const savePipe = (p) => { try { fs.writeFileSync(pipeFile(), JSON.stringify(p)); } catch (e) { log('pipeline save', e); } };
const writtenFiles = new Set();
const within = (child, parent) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
function allowedDir(dir) { const d = path.resolve(String(dir)); return pipe().dirs.some((x) => within(d, path.resolve(x))); }
function godotProject(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 12; i++) {
    const f = path.join(d, 'project.godot');
    if (fs.existsSync(f)) {
      let name = path.basename(d);
      try { const m = fs.readFileSync(f, 'utf8').match(/^config\/name\s*=\s*"([^"]*)"/m); if (m) name = m[1]; } catch { /* ignore */ }
      return { root: d, name };
    }
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return null;
}
ipcMain.handle('pipe:pickDir', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, { title: opts.title || 'Choose a folder', defaultPath: opts.defaultPath, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0], gp = godotProject(dir);
  const p = pipe(); const keep = gp ? gp.root : dir;
  if (!p.dirs.includes(keep)) { p.dirs = [keep, ...p.dirs].slice(0, 40); savePipe(p); }
  return { dir, godotRoot: gp?.root || null, projectName: gp?.name || null };
});
ipcMain.handle('pipe:inspect', (_e, dir) => {
  const d = path.resolve(String(dir)); const gp = fs.existsSync(d) ? godotProject(d) : null;
  return { exists: fs.existsSync(d), allowed: allowedDir(d), godotRoot: gp?.root || null, projectName: gp?.name || null };
});
const cleanName = (n) => path.basename(String(n)).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 120) || 'file';
ipcMain.handle('pipe:write', (_e, dir, sub, files) => {
  const base = path.resolve(String(dir));
  if (!allowedDir(base)) throw new Error('Choose this folder again (it was not picked in GLB&ME)');
  const parts = String(sub || '').split(/[\\/]+/).filter((x) => x && x !== '.' && x !== '..').map(cleanName);
  const target = path.join(base, ...parts);
  if (!within(target, base)) throw new Error('bad folder');
  fs.mkdirSync(target, { recursive: true });
  const out = [];
  for (const [name, data] of files) {
    const f = path.join(target, cleanName(name));
    const tmp = f + '.tmp'; fs.writeFileSync(tmp, Buffer.from(data)); fs.renameSync(tmp, f);
    writtenFiles.add(f); out.push(f);
  }
  return out;
});
ipcMain.handle('pipe:writeTemp', (_e, name, data) => {
  const d = path.join(app.getPath('userData'), 'exports'); fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, cleanName(name)); fs.writeFileSync(f, Buffer.from(data)); writtenFiles.add(f); return f;
});
function toolCandidates(tool) {
  const out = [], env = process.env, home = app.getPath('home');
  const pathDirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  const byVersion = (a, b) => b.localeCompare(a, undefined, { numeric: true });
  if (tool === 'blender') {
    if (process.platform === 'win32') {
      for (const pf of [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
        const bf = path.join(pf, 'Blender Foundation'); for (const v of ls(bf).sort(byVersion)) out.push(path.join(bf, v, 'blender.exe'));
        out.push(path.join(pf, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'));
      }
      pathDirs.forEach((d) => out.push(path.join(d, 'blender.exe')));
    } else if (isMac) out.push('/Applications/Blender.app/Contents/MacOS/Blender', path.join(home, 'Applications/Blender.app/Contents/MacOS/Blender'), path.join(home, 'Library/Application Support/Steam/steamapps/common/Blender/Blender.app/Contents/MacOS/Blender'));
    else { pathDirs.forEach((d) => out.push(path.join(d, 'blender'))); out.push('/snap/bin/blender', '/var/lib/flatpak/exports/bin/org.blender.Blender', path.join(home, '.local/share/flatpak/exports/bin/org.blender.Blender')); }
  } else if (tool === 'godot') {
    if (process.platform === 'win32') {
      const wg = path.join(env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
      for (const p of ls(wg).filter((x) => /godot/i.test(x))) for (const f of ls(path.join(wg, p)).filter((x) => /^godot.*\.exe$/i.test(x) && !/console/i.test(x)).sort(byVersion)) out.push(path.join(wg, p, f));
      for (const pf of [env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', env.ProgramFiles || 'C:\\Program Files']) { const s = path.join(pf, 'Steam', 'steamapps', 'common', 'Godot Engine'); for (const f of ls(s).filter((x) => /^godot.*\.exe$/i.test(x) && !/console/i.test(x))) out.push(path.join(s, f)); }
      pathDirs.forEach((d) => { for (const f of ls(d).filter((x) => /^godot.*\.exe$/i.test(x) && !/console/i.test(x))) out.push(path.join(d, f)); });
    } else if (isMac) out.push('/Applications/Godot.app/Contents/MacOS/Godot', '/Applications/Godot_mono.app/Contents/MacOS/Godot', path.join(home, 'Applications/Godot.app/Contents/MacOS/Godot'));
    else { pathDirs.forEach((d) => out.push(path.join(d, 'godot'), path.join(d, 'godot4'))); out.push('/var/lib/flatpak/exports/bin/org.godotengine.Godot', '/snap/bin/godot-4'); }
  }
  return out;
}
const validTool = (tool, f) => { try { return f && fs.statSync(f).isFile() && new RegExp(tool, 'i').test(path.basename(f) + path.dirname(f)); } catch { return false; } };
ipcMain.handle('pipe:findTool', (_e, tool) => {
  if (!['blender', 'godot'].includes(tool)) return null;
  const saved = pipe().tools[tool]; if (validTool(tool, saved)) return saved;
  return toolCandidates(tool).find((f) => validTool(tool, f)) || null;
});
ipcMain.handle('pipe:pickTool', async (_e, tool) => {
  if (!['blender', 'godot'].includes(tool)) return null;
  const r = await dialog.showOpenDialog(win, { title: `Locate ${tool === 'blender' ? 'Blender' : 'Godot'}`, properties: ['openFile', 'treatPackageAsDirectory'], filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe'] }] : [] });
  if (r.canceled || !r.filePaths[0]) return null;
  let f = r.filePaths[0];
  if (isMac && f.endsWith('.app')) f = path.join(f, 'Contents', 'MacOS', tool === 'blender' ? 'Blender' : 'Godot');
  if (!validTool(tool, f)) throw new Error(`That doesn’t look like ${tool === 'blender' ? 'Blender' : 'Godot'}`);
  const p = pipe(); p.tools[tool] = f; savePipe(p); return f;
});
const BLENDER_SCRIPT = `# GLB&ME → Blender: imports the model passed after "--" into an empty scene
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path = argv[0] if argv else ""
def run():
    try:
        bpy.ops.wm.read_homefile(use_empty=True)
    except Exception as e:
        print("GLB&ME: could not reset scene", e)
    if path and os.path.exists(path):
        try:  # "Unitless" lights look like they did in GLB&ME (physical candela import is very dim)
            bpy.ops.import_scene.gltf(filepath=path, export_import_convert_lighting_mode="COMPAT")
        except TypeError:
            bpy.ops.import_scene.gltf(filepath=path)
        try:
            for window in bpy.context.window_manager.windows:
                for area in window.screen.areas:
                    if area.type == "VIEW_3D":
                        for region in area.regions:
                            if region.type == "WINDOW":
                                with bpy.context.temp_override(window=window, area=area, region=region):
                                    bpy.ops.view3d.view_all()
        except Exception as e:
            print("GLB&ME: could not frame view", e)
    return None
bpy.app.timers.register(run, first_interval=0.5)
`;
ipcMain.handle('pipe:launch', (_e, tool, target) => {
  const exe = ['blender', 'godot'].includes(tool) ? (pipe().tools[tool] && validTool(tool, pipe().tools[tool]) ? pipe().tools[tool] : toolCandidates(tool).find((f) => validTool(tool, f))) : null;
  if (!exe) throw new Error(`${tool} not found`);
  const t = path.resolve(String(target));
  let args;
  if (tool === 'blender') {
    if (!writtenFiles.has(t)) throw new Error('not allowed');
    const sd = path.join(app.getPath('userData'), 'scripts'); fs.mkdirSync(sd, { recursive: true });
    const script = path.join(sd, 'glbme_blender_import.py'); fs.writeFileSync(script, BLENDER_SCRIPT);
    args = ['--python', script, '--', t];
  } else {
    if (!allowedDir(t) || !fs.existsSync(path.join(t, 'project.godot'))) throw new Error('not a Godot project');
    args = ['--editor', '--path', t];
  }
  const { spawn } = require('child_process');
  const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.on('error', (e) => log('launch', tool, e));
  child.unref();
  log('launched', tool, exe);
  return true;
});
