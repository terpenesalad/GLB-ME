// Font registry for 3D text: bundled OFL fonts, fonts imported into the library and (desktop) the
// PC's installed fonts. Fonts are parsed with opentype.js and previewed with the FontFace API.
import { parseFont, cachedFont } from '../core/text.js';
import { platform } from '../platform.js';

export const BUILTIN = [
  ['michroma', 'Michroma', 'Wide futuristic – Horizon-style titles'],
  ['orbitron', 'Orbitron', 'Geometric sci-fi'],
  ['audiowide', 'Audiowide', 'Wide techno'],
  ['russo-one', 'Russo One', 'Bold game titles'],
  ['bungee', 'Bungee', 'Chunky signage'],
  ['bebas-neue', 'Bebas Neue', 'Tall condensed caps'],
  ['anton', 'Anton', 'Heavy condensed'],
  ['montserrat', 'Montserrat', 'Clean geometric sans'],
  ['inter', 'Inter', 'Neutral UI sans'],
  ['roboto-slab', 'Roboto Slab', 'Slab serif'],
  ['lobster', 'Lobster', 'Bold script'],
  ['pacifico', 'Pacifico', 'Surf script'],
  ['press-start-2p', 'Press Start 2P', 'Pixel arcade'],
  ['jetbrains-mono', 'JetBrains Mono', 'Monospace'],
].map(([id, name, desc]) => ({ id: 'builtin:' + id, name, desc, url: `fonts/${id}.woff` }));

const DEFAULT = 'builtin:michroma';
const pending = new Map();

async function bufferFor(id) {
  if (id.startsWith('builtin:')) {
    const f = BUILTIN.find((b) => b.id === id); if (!f) throw new Error('unknown font');
    const r = await fetch(f.url); if (!r.ok) throw new Error('font missing'); return r.arrayBuffer();
  }
  const b = await platform.fonts.read(id);
  if (!b) throw new Error('font missing');
  return b;
}
/** Parsed opentype font (falls back to Michroma if a font can't be loaded). */
export async function loadFont(id) {
  id = id || DEFAULT;
  const c = cachedFont(id); if (c) return c;
  if (!pending.has(id)) pending.set(id, (async () => {
    try { return parseFont(id, await bufferFor(id)); }
    catch (e) { console.warn('font', id, e); if (id !== DEFAULT) return loadFont(DEFAULT); throw e; }
    finally { pending.delete(id); }
  })());
  return pending.get(id);
}

const faces = new Map();
/** Registers a CSS font-face for previews; returns the CSS family name. */
export function cssFamily(id) {
  if (faces.has(id)) return faces.get(id);
  const fam = 'f_' + id.replace(/[^a-z0-9]/gi, '_').slice(-60);
  faces.set(id, fam);
  bufferFor(id).then((buf) => { const ff = new FontFace(fam, buf); return ff.load().then(() => document.fonts.add(ff)); }).catch(() => {});
  return fam;
}

let importedCache = null, systemCache = null;
export async function importedFonts(refresh = false) { if (!importedCache || refresh) importedCache = await platform.fonts.imported(); return importedCache; }
export async function systemFonts() {
  if (!systemCache) {
    const list = await platform.fonts.system();
    const seen = new Set();
    systemCache = list.map((f) => ({ id: f.id, name: prettyName(f.file) })).filter((f) => { const k = f.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.name.localeCompare(b.name));
  }
  return systemCache;
}
export function prettyName(file) {
  return file.replace(/\.(ttf|otf|woff)$/i, '').replace(/[_]+/g, ' ').replace(/-(Regular|Normal)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ').trim();
}
export async function importFontFiles(files) {
  const ids = [];
  for (const f of files) {
    try { parseFont('probe:' + f.name + Math.random(), f.data); } catch { throw new Error(`${f.name} isn't a font GLB&ME can read (use .ttf, .otf or .woff)`); }
    ids.push(await platform.fonts.import(f.name, f.data));
  }
  importedCache = null;
  return ids;
}
export async function fontName(id) {
  if (!id) return 'Michroma';
  if (id.startsWith('builtin:')) return BUILTIN.find((b) => b.id === id)?.name || 'Font';
  if (id.startsWith('file:')) return prettyName(id.slice(5));
  if (id.startsWith('sys:')) return prettyName(id.split(/[\\/]/).pop());
  return 'Font';
}
