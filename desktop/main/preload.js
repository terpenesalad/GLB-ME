// Narrow, promise-based API exposed to the renderer (no Node access in the page).
const { contextBridge, ipcRenderer } = require('electron');

const toAB = (buf) => (buf ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null);

contextBridge.exposeInMainWorld('glbme', {
  platform: process.platform,
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (meta) => ipcRenderer.invoke('projects:create', meta),
    save: (id, meta, glb, thumb) => ipcRenderer.invoke('projects:save', id, meta, glb, thumb),
    load: async (id) => toAB(await ipcRenderer.invoke('projects:load', id)),
    thumb: async (id) => toAB(await ipcRenderer.invoke('projects:thumb', id)),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
    remove: (id) => ipcRenderer.invoke('projects:delete', id),
    duplicate: (id, name) => ipcRenderer.invoke('projects:duplicate', id, name),
    reveal: (id) => ipcRenderer.invoke('projects:reveal', id),
  },
  files: {
    open: async (opts) => (await ipcRenderer.invoke('file:open', opts)).map((f) => ({ name: f.name, path: f.path, data: toAB(f.data) })),
    read: async (p) => { const f = await ipcRenderer.invoke('file:read', p); return { name: f.name, path: f.path, data: toAB(f.data) }; },
    save: (name, data, filters) => ipcRenderer.invoke('file:save', name, data, filters),
    reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  },
  fonts: {
    imported: () => ipcRenderer.invoke('fonts:imported'),
    system: () => ipcRenderer.invoke('fonts:system'),
    read: async (id) => toAB(await ipcRenderer.invoke('fonts:read', id)),
    import: (name, data) => ipcRenderer.invoke('fonts:import', name, data),
    remove: (id) => ipcRenderer.invoke('fonts:delete', id),
  },
  app: {
    pending: () => ipcRenderer.invoke('app:pending'),
    version: () => ipcRenderer.invoke('app:version'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, p) => cb(p)),
    onClosing: (cb) => ipcRenderer.on('app-closing', () => cb()),
    closeReady: () => ipcRenderer.invoke('app:closeReady'),
  },
});
