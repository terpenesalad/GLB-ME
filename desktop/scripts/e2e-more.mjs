// Regression sweep over the existing features after the 1.2 refactor.
export default async function ({ page, ev, shot, step }) {
  const W = (ms) => page.waitForTimeout(ms);
  await step('sculpt project', async () => { await page.locator('.create').nth(1).click(); for (let i = 0; i < 100 && !(await ev(() => window.app?.editor?.doc?.objects?.length > 0)); i++) await W(200); await W(600); const m = await ev(() => window.app.editor.mode); await ev(() => window.app.editor.setMode('sculpt')); return m; });
  await step('sculpt stroke + undo', async () => {
    const r = await page.locator('canvas.viewport').boundingBox(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const v0 = await ev(() => Array.from(window.app.editor.doc.selected.geometry.attributes.position.array.slice(0, 30000)).reduce((a, b) => a + Math.abs(b), 0));
    await page.mouse.move(cx - 40, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 10, { steps: 8 }); await page.mouse.up(); await W(200);
    const v1 = await ev(() => Array.from(window.app.editor.doc.selected.geometry.attributes.position.array.slice(0, 30000)).reduce((a, b) => a + Math.abs(b), 0));
    const label = await ev(() => window.app.editor.doc.history.undoStack.at(-1)?.label);
    await page.keyboard.press('Control+z'); await W(100);
    const v2 = await ev(() => Array.from(window.app.editor.doc.selected.geometry.attributes.position.array.slice(0, 30000)).reduce((a, b) => a + Math.abs(b), 0));
    await shot('more-sculpt');
    return { changed: Math.abs(v1 - v0) > 1e-3, restored: Math.abs(v2 - v0) < 1e-3, label };
  });
  await step('faces brush select', async () => {
    await ev(() => { const ed = window.app.editor; ed.setMode('edit'); ed.vp.faceTool.mode = 'brush'; ed.refresh(); }); await W(200);
    const r = await page.locator('canvas.viewport').boundingBox(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 30, cy, { steps: 4 }); await page.mouse.up();
    const n = await ev(() => window.app.editor.vp.faces.count());
    await ev(() => { window.app.editor.actions.extrude(0.05); window.app.editor.setMode('object'); });
    return n;
  });
  await step('3D text', async () => { await ev(() => window.app.editor.setMode('object')); await page.keyboard.press('t'); await W(1200); await page.keyboard.type('Hi!'); await W(800); await page.getByRole('button', { name: 'Done' }).click(); await W(300); return ev(() => { const o = window.app.editor.doc.selected; return { name: o.name, text: o.ed.text?.text, tris: o.geometry.index.count / 3 }; }); });
  await step('all templates', () => ev(async () => {
    const list = await (await fetch('templates/templates.json')).json(), out = {};
    const { parseGltf } = window.glbmeDebug.io || {};
    for (const t of list) { const data = await (await fetch(`templates/${t.id}.glb`)).arrayBuffer(); const r = await window.glbmeDebug.parseGltf(data); out[t.id] = r.objects.length + '/' + r.roots.length; }
    return out;
  }));
  await step('insert template via picker', async () => { await ev(() => window.glbmeDebug.studios.templatePicker(window.app.editor)); await W(500); await page.locator('.modal .pcard').nth(3).click(); await W(1200); return ev(() => window.app.editor.doc.objects.length); });
  await step('import STL/PLY/DAE/3MF/OBJ', () => ev(async () => {
    const ed = window.app.editor, D = window.glbmeDebug, out = {};
    for (const f of ['stl', 'ply']) { const r = await D.exportModel(ed.doc, { format: f }); const m = await D.importModel('t.' + f, r.data); out[f] = m.objects.length; }
    const dae = `<?xml version="1.0"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><unit meter="1"/><up_axis>Z_UP</up_axis></asset>
<library_geometries><geometry id="g"><mesh><source id="p"><float_array id="pa" count="9">0 0 0 1 0 0 0 1 1</float_array><technique_common><accessor source="#pa" count="3" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="v"><input semantic="POSITION" source="#p"/></vertices><triangles count="1"><input semantic="VERTEX" source="#v" offset="0"/><p>0 1 2</p></triangles></mesh></geometry></library_geometries>
<library_visual_scenes><visual_scene id="s"><node id="tri" name="Tri"><instance_geometry url="#g"/></node></visual_scene></library_visual_scenes><scene><instance_visual_scene url="#s"/></scene></COLLADA>`;
    out.dae = (await D.importModel('tri.dae', new TextEncoder().encode(dae).buffer)).objects.map((o) => o.name);
    const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="0" y="20" z="0"/><vertex x="0" y="0" z="20"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
    const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
    const enc = (s) => new TextEncoder().encode(s);
    const z = D.zip([['_rels/.rels', enc(rels)], ['3D/3dmodel.model', enc(model)], ['[Content_Types].xml', enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')]]);
    const t = await D.importModel('tet.3mf', z); const b = new (window.app.editor.vp.pivot.position.constructor)(); out['3mf'] = { n: t.objects.length, size: (() => { const box = new (window.glbmeDebug.THREE.Box3)(); for (const o of t.roots) { o.updateMatrixWorld(true); box.expandByObject(o); } return box.getSize(b).toArray().map((x) => +x.toFixed(3)); })() };
    const obj = 'o Quad\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n'; out.obj = (await D.importModel('q.obj', enc(obj).buffer)).objects.map((o) => o.name);
    return out;
  }));
  await step('copy / paste + duplicate subtree', () => ev(() => {
    const ed = window.app.editor, a = ed.actions, d = ed.doc; const c = a.addShape('CONE'); const s = a.addShape('TORUS'); d.setSelection([c, s]); const g = a.group();
    ed.copy(); ed.paste(); const pasted = d.selected; return { pasted: pasted.name, kids: d.children(pasted).length, total: d.objects.length };
  }));
  await step('sticker placement', async () => {
    await ev(() => { const ed = window.app.editor, d = ed.doc; const b = ed.actions.addShape('CUBE'); b.name = 'StickerBase'; d.select(b); ed.vp.frame([b], false); ed.actions.placeSticker({ kind: 'emoji', value: '⭐', label: 'Star' }); });
    await W(300); const r = await page.locator('canvas.viewport').boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await W(200);
    return ev(() => { const d = window.app.editor.doc, s = d.selected; return { name: s.name, parent: d.parentOf(s)?.name }; });
  });
  await step('animation preset play', async () => { await ev(() => { const ed = window.app.editor; ed.setMode('animate'); }); await page.getByRole('button', { name: 'Presets' }).click(); await page.locator('.menu .item').first().click(); await W(600); await shot('more-anim'); const r = await ev(() => ({ playing: window.app.editor.playing, keys: window.app.editor.doc.selected.ed.keys.size })); await ev(() => { window.app.editor.togglePlay(false); window.app.editor.setMode('object'); }); return r; });
  await step('light theme home', async () => { await ev(() => window.app.closeEditor()); await W(800); await shot('more-home'); });
}
