// Storage & file access. Uses the Electron bridge when present, otherwise IndexedDB + browser
// file pickers / downloads (so the same app also runs as a web page).

const electron = typeof window !== 'undefined' ? window.glbme : null;
export const isDesktop = !!electron;

// ---------------------------------------------------------------------------- IndexedDB (web)
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('glbandme', 1);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ['meta', 'scene', 'thumb', 'fonts']) d.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode); const st = tx.objectStore(store);
    const req = fn(st); tx.oncomplete = () => res(req?.result); tx.onerror = () => rej(tx.error);
  });
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === 'x' ? 0 : 8)).toString(16)));

const web = {
  projects: {
    async list() { const d = await db(); return new Promise((res) => { const out = []; const tx = d.transaction('meta'); tx.objectStore('meta').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; }); },
    async create(meta) { const id = uuid(), now = Date.now(); const m = { name: 'Untitled', triangles: 0, objects: 0, animated: false, ...meta, id, created: now, modified: now }; await idb('meta', 'readwrite', (s) => s.put(m, id)); return m; },
    async save(id, meta, glb, thumb) {
      const old = (await idb('meta', 'readonly', (s) => s.get(id))) || {};
      const m = { ...old, ...meta, id, modified: Date.now() };
      await idb('scene', 'readwrite', (s) => s.put(glb, id)); if (thumb) await idb('thumb', 'readwrite', (s) => s.put(thumb, id));
      await idb('meta', 'readwrite', (s) => s.put(m, id)); return m;
    },
    load: (id) => idb('scene', 'readonly', (s) => s.get(id)),
    thumb: (id) => idb('thumb', 'readonly', (s) => s.get(id)),
    async rename(id, name) { const m = await idb('meta', 'readonly', (s) => s.get(id)); m.name = name; await idb('meta', 'readwrite', (s) => s.put(m, id)); return m; },
    async remove(id) { for (const st of ['meta', 'scene', 'thumb']) await idb(st, 'readwrite', (s) => s.delete(id)); return true; },
    async duplicate(id, name) {
      const m = { ...(await idb('meta', 'readonly', (s) => s.get(id))) }; const nid = uuid();
      Object.assign(m, { id: nid, name, modified: Date.now() });
      await idb('scene', 'readwrite', (s) => s.put(null, nid));
      const scene = await idb('scene', 'readonly', (s) => s.get(id)); const thumb = await idb('thumb', 'readonly', (s) => s.get(id));
      await idb('scene', 'readwrite', (s) => s.put(scene, nid)); if (thumb) await idb('thumb', 'readwrite', (s) => s.put(thumb, nid));
      await idb('meta', 'readwrite', (s) => s.put(m, nid)); return m;
    },
    reveal() {},
  },
  files: {
    open(opts) {
      return new Promise((res) => {
        const i = document.createElement('input'); i.type = 'file'; i.multiple = !!opts?.multi;
        const ext = (opts?.filters || []).flatMap((f) => f.extensions).filter((e) => e !== '*');
        if (ext.length) i.accept = ext.map((e) => '.' + e).join(',');
        i.onchange = async () => res(await Promise.all([...i.files].map(async (f) => ({ name: f.name, path: null, data: await f.arrayBuffer() }))));
        i.click();
      });
    },
    async save(name, data) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data])); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000); return name;
    },
    reveal() {},
  },
  fonts: {
    async imported() { const d = await db(); return new Promise((res) => { const out = []; d.transaction('fonts').objectStore('fonts').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push({ id: c.key, name: c.value.name, file: c.value.name }); c.continue(); } else res(out); }; }); },
    async system() { return []; },
    async read(id) { return (await idb('fonts', 'readonly', (s) => s.get(id)))?.data; },
    async import(name, data) { const id = 'file:' + name; await idb('fonts', 'readwrite', (s) => s.put({ name: name.replace(/\.(ttf|otf|woff)$/i, ''), data }, id)); return id; },
    remove: (id) => idb('fonts', 'readwrite', (s) => s.delete(id)),
  },
  app: { pending: async () => [], version: async () => '1.2.0', openExternal: async (u) => window.open(u, '_blank'), onOpenFile() {} },
};

web.pipeline = {
  pickDir: async () => null, inspect: async () => ({ exists: false }), findTool: async () => null, pickTool: async () => null,
  write: async (dir, sub, files) => { for (const [n, d] of files) await web.files.save(n, d); return files.map(([n]) => n); },
  writeTemp: async (n) => n, launch: async () => { throw new Error('desktop only'); },
};
export const platform = electron || web;
export const MODEL_FILTERS = [{ name: '3D models', extensions: ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae', '3mf'] }];
export const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }];
export const FONT_FILTERS = [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff'] }];
