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
const fileArgs = (argv) => argv.filter((a) => /\.(glb|gltf|obj|stl|ply|fbx)$/i.test(a) && fs.existsSync(a));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
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
