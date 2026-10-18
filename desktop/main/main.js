// GLB&ME desktop – Electron main process: window, file system access for projects and fonts,
// native open/save dialogs and "open with" file handling.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isMac = process.platform === 'darwin';
// The UI is served from app://glbandme/ (a privileged, sandboxed scheme) so fetch() works for bundled assets.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const distDir = path.join(__dirname, '..', 'dist');
let win = null;
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
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  win.once('ready-to-show', () => win.show());
  // let the renderer save the open project before the window goes away
  let allowClose = false;
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app-closing');
    setTimeout(() => { allowClose = true; if (win && !win.isDestroyed()) win.close(); }, 10000);
  });
  ipcMain.removeHandler('app:closeReady');
  ipcMain.handle('app:closeReady', () => { allowClose = true; setImmediate(() => win && !win.isDestroyed() && win.close()); });
  win.on('closed', () => { win = null; });
  win.loadURL('app://glbandme/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://glbandme/')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}

// ---- single instance + "open with" ---------------------------------------------------------
const fileArgs = (argv) => argv.filter((a) => /\.(glb|gltf|obj|stl|ply|fbx)$/i.test(a) && fs.existsSync(a));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const files = fileArgs(argv);
    files.forEach((f) => allowedFiles.add(path.resolve(f)));
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); files.forEach((f) => win.webContents.send('open-file', f)); }
  });
}
app.on('open-file', (e, file) => {
  e.preventDefault();
  allowedFiles.add(path.resolve(file));
  if (win && !win.isDestroyed()) win.webContents.send('open-file', file);
  else { pendingOpen.push(file); if (app.isReady()) createWindow(); }
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const file = path.normalize(path.join(distDir, decodeURIComponent(u.pathname)));
    if (!file.startsWith(distDir + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
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
});
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
