// Template catalogue: procedurally built, fully editable asset-pack templates (Melbourne
// architecture, trams & streets, rooms, windows & doors, furniture, animals, nature …).
// Each entry: { id, name, category, desc, tags, env?, animated?, build(kit) }.
import { Kit } from './kit.js';
import melbourne from './fam/melbourne.js';
import trams from './fam/trams.js';
import streets from './fam/streets.js';
import rooms from './fam/rooms.js';
import openings from './fam/openings.js';
import furniture from './fam/furniture.js';
import buildings from './fam/buildings.js';
import animals from './fam/animals.js';
import nature from './fam/nature.js';
import props from './fam/props.js';

export const CATEGORY_ORDER = ['Melbourne', 'Trams & roads', 'Buildings', 'Rooms', 'Building kit', 'Windows & doors', 'Furniture', 'Street props', 'Animals', 'Nature'];
export const CATALOG = [...melbourne, ...trams, ...streets, ...buildings, ...rooms, ...openings, ...furniture, ...props, ...animals, ...nature];
const byId = new Map(CATALOG.map((t) => [t.id, t]));
export const findTemplate = (id) => byId.get(id);

/** Builds a template into a Kit (objects + shared materials, textures loaded). */
export async function buildTemplate(id) {
  const t = byId.get(id); if (!t) throw new Error('Unknown template ' + id);
  const k = new Kit(t.name);
  await t.build(k, t.opts || {});
  await k.done();
  return k;
}
