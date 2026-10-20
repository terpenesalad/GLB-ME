// Feature walk-through used during development (see e2e.mjs).
export default async function ({ page, ev, shot, step, app }) {
  const W = (ms) => page.waitForTimeout(ms);
  await step('new project', async () => { await page.locator('.create').first().click(); await page.waitForFunction(() => window.app?.editor?.vp, null, { timeout: 20000 }); await W(600); await page.keyboard.press('Escape'); });
  await step('shapes + group', () => ev(() => {
    const ed = window.app.editor, a = ed.actions, d = ed.doc;
    const c = a.addShape('CUBE'); const s = a.addShape('SPHERE'); const y = a.addShape('CYLINDER');
    d.setSelection([c, s]); const g = a.group();
    return { roots: d.roots().map((o) => o.name), kids: d.children(g).map((o) => o.name), sel: d.selected.name };
  }));
  await step('undo/redo group', () => ev(() => { const d = window.app.editor.doc; d.undo(); const a = d.roots().length; d.redo(); return [a, d.roots().length]; }));
  await step('multi gizmo move', () => ev(() => {
    const ed = window.app.editor, d = ed.doc, vp = ed.vp; const [c, s] = d.objects.filter((o) => o.name === 'Cube' || o.name === 'Sphere');
    d.setSelection([c, s]); vp.syncGizmo();
    const before = [c.getWorldPosition(new vp.pivot.position.constructor()).x, s.getWorldPosition(new vp.pivot.position.constructor()).x];
    vp.onGizmoDrag(true); vp.pivot.position.x += 1; vp.pivot.updateMatrixWorld(); vp.onGizmoMove(); vp.onGizmoDrag(false);
    const after = [c.getWorldPosition(new vp.pivot.position.constructor()).x, s.getWorldPosition(new vp.pivot.position.constructor()).x];
    return { attached: vp.gizmo.object === vp.pivot, dx: after.map((x, i) => +(x - before[i]).toFixed(3)), undo: d.history.undoStack.at(-1).label };
  }));
  await W(300); await shot('group-multi');
  await step('boolean subtract', () => ev(() => {
    const ed = window.app.editor, a = ed.actions, d = ed.doc;
    const box = a.addShape('CUBE'); box.name = 'Block'; const cut = a.addShape('CYLINDER', { radius: 0.25, height: 2 }); cut.position.copy(box.position);
    d.setSelection([cut, box]); const ok = a.boolean('subtract');
    return { ok, tris: box.geometry.index.count / 3, gone: !d.objects.includes(cut) };
  }));
  await step('boolean union + intersect', () => ev(() => {
    const ed = window.app.editor, a = ed.actions, d = ed.doc;
    const s1 = a.addShape('SPHERE'), s2 = a.addShape('SPHERE'); s2.position.copy(s1.position); s2.position.x += 0.4;
    d.setSelection([s2, s1]); const u = a.boolean('union');
    const s3 = a.addShape('CUBE'), s4 = a.addShape('SPHERE', { radius: 0.7 }); s4.position.copy(s3.position);
    d.setSelection([s4, s3]); const i = a.boolean('intersect');
    return { u, i, t1: s1.geometry.index.count / 3, t3: s3.geometry.index.count / 3 };
  }));
  await step('push/pull face', async () => {
    const r = await ev(() => {
      const ed = window.app.editor, a = ed.actions, d = ed.doc;
      const b = a.addShape('CUBE', { divisions: 1 }); b.name = 'PP'; ed.setMode('edit');
      const vp = ed.vp; vp.bindFaces();
      // top face = the triangle whose normal is +Y
      const g = b.geometry, p = g.attributes.position.array, idx = g.index.array; let top = -1;
      for (let t = 0; t < idx.length / 3; t++) { const ys = [0, 1, 2].map((k) => p[idx[t * 3 + k] * 3 + 1]); if (ys.every((y) => Math.abs(y - 0.5) < 1e-4)) { top = t; break; } }
      ed.facePick({ faceIndex: top }, { shiftKey: false, ctrlKey: false });
      const sel = vp.faces.count(), attached = vp.gizmo.object === vp.ppProxy;
      const h0 = new (b.position.constructor)(); b.geometry.computeBoundingBox(); const y0 = b.geometry.boundingBox.max.y;
      vp.onGizmoDrag(true); vp.ppProxy.position.addScaledVector(vp.pp.nWorld, 0.5); vp.onGizmoMove(); vp.onGizmoDrag(false);
      b.geometry.computeBoundingBox();
      return { top, sel, attached, y0, y1: b.geometry.boundingBox.max.y, label: d.history.undoStack.at(-1).label };
    });
    await W(300); await shot('pushpull'); return r;
  });
  await step('back to object + layers keyboard', async () => {
    await ev(() => window.app.editor.setMode('object'));
    await page.locator('.tree .layer').first().click(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    return ev(() => window.app.editor.doc.selected?.name);
  });
  await step('drag-parent via dropOn', () => ev(() => {
    const ed = window.app.editor, d = ed.doc; const cyl = d.objects.find((o) => o.name === 'Cylinder'), grp = d.objects.find((o) => o.name === 'Group');
    const w0 = cyl.getWorldPosition(cyl.position.clone()); ed.actions.dropOn([cyl], grp, 'inside'); const w1 = cyl.getWorldPosition(cyl.position.clone());
    return { parent: d.parentOf(cyl)?.name, same: w0.distanceTo(w1) < 1e-6 };
  }));
  await step('camera + empty + props', () => ev(() => {
    const ed = window.app.editor, a = ed.actions, d = ed.doc; const cam = a.addCamera(); const e = a.addEmpty(); e.name = 'Spawn';
    a.setProps(e, [['team', 'red'], ['hp', '100'], ['boss', 'true']]); const cube = d.objects.find((o) => o.name === 'Cube'); a.setCollision(cube, 'convcol');
    return { cam: cam.name, props: e.ed.props.length, col: cube.ed.collision };
  }));
  await step('materials: physical + link', () => ev(() => {
    const ed = window.app.editor, a = ed.actions, d = ed.doc; const cube = d.objects.find((o) => o.name === 'Cube'), sph = d.objects.find((o) => o.name === 'Sphere');
    a.material('Glass', (m) => { m.transmission = 1; m.ior = 1.45; m.clearcoat = 0.5; m.name = 'GlassMat'; }, cube);
    d.setSelection([sph, cube]); a.linkMaterial(cube.material);
    return { phys: cube.material.isMeshPhysicalMaterial, shared: sph.material === cube.material, mats: d.materials().size };
  }));
  await step('animation clips + easing', () => ev(() => {
    const ed = window.app.editor, d = ed.doc; const sph = d.objects.find((o) => o.name === 'Sphere'); ed.setMode('animate');
    d.select(sph); d.frame = 0; ed.insertKey(); d.frame = 30; sph.position.y += 1; ed.insertKey(); ed.setKeyEasing('ease'); d.frame = 60; sph.position.y -= 1; ed.insertKey();
    d.transact('clips', () => { d.clips = [{ name: 'Up', start: 0, end: 30, loop: false }, { name: 'Bob', start: 0, end: 60, loop: true }]; }, []);
    ed.setFrame(15); const y15 = sph.position.y; ed.setMode('object');
    return { keys: sph.ed.keys.size, y15: +y15.toFixed(3) };
  }));
  await W(300); await shot('animate');
  await step('export GLB (godot) + validate structure', () => ev(async () => {
    const ed = window.app.editor; const r = await window.glbmeDebug.exportModel(ed.doc, { format: 'gltf', godot: true, applyScale: true, animations: true, lights: true, cameras: true });
    const j = JSON.parse(new TextDecoder().decode(r.data));
    return { nodes: j.nodes.map((n) => n.name + (n.children ? '[' + n.children.length + ']' : '') + (n.camera != null ? '(cam)' : '') + (n.extras ? '{x}' : '')), anims: j.animations?.map((a) => a.name), ext: j.extensionsUsed };
  }));
  await step('export all formats', () => ev(async () => {
    const ed = window.app.editor, out = {};
    for (const f of ['glb', 'gltf', 'gltfsep', 'usdz', 'obj', 'stl', 'ply']) { const r = await window.glbmeDebug.exportModel(ed.doc, { format: f, name: 'test' }); out[f] = r.files ? r.files.map((x) => x[0]) : r.data.byteLength; }
    return out;
  }));
  await step('render PNG', () => ev(async () => { const b = await window.app.editor.vp.renderImage({ width: 800, height: 450, transparent: true }); return b.byteLength; }));
  await step('texture paint line', async () => {
    await ev(() => { const ed = window.app.editor, d = ed.doc; const p = ed.actions.addShape('ROUNDED_BOX'); p.name = 'Canvas'; d.select(p); ed.vp.frame([p], false); ed.setMode('paint'); ed.setPaintColor('#ff0000'); ed.paintBrush.radiusPx = 8; ed.paintBrush.line = true; });
    await W(500);
    await page.getByRole('button', { name: 'Unwrap for painting' }).click(); await W(400);
    const r = await page.locator('canvas.viewport').boundingBox();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    await page.mouse.move(cx - 120, cy); await page.mouse.down(); await page.mouse.move(cx, cy + 10, { steps: 5 }); await page.mouse.move(cx + 120, cy + 20, { steps: 5 }); await page.mouse.up();
    await W(300);
    // shift+click line from the last point with the brush tool
    await ev(() => { window.app.editor.paintBrush.line = false; window.app.editor.setPaintColor('#0044ff'); });
    await page.keyboard.down('Shift'); await page.mouse.click(cx, cy - 100); await page.keyboard.up('Shift');
    await W(300); await shot('paint');
    return ev(() => { const o = window.app.editor.doc.selected, m = o.material; const c = m.map.image, ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data; let red = 0, blue = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) red++; if (d[i + 2] > 200 && d[i] < 80) blue++; } return { size: c.width, red, blue, undo: window.app.editor.doc.history.undoStack.slice(-3).map((x) => x.label) }; });
  });
  await step('unwrap keeps pattern look', async () => {
    const r = await ev(() => {
      const ed = window.app.editor, a = ed.actions, d = ed.doc, D = window.glbmeDebug;
      const c = a.addShape('CUBE'); c.name = 'Bricks'; c.position.set(-2.5, 0.5, 0);
      a.material('Bricks', (m) => D.applyPattern(m, D.defaultSpec('BRICKS'), 512), c);
      const before = D.uvOverlap(c.geometry);
      ed.unwrapForPainting(c);
      return { before: +before.toFixed(3), after: +D.uvOverlap(c.geometry).toFixed(3), map: c.material.map.image.width, normal: !!c.material.normalMap };
    });
    await ev(() => { const ed = window.app.editor; ed.vp.frame([ed.doc.objects.find((o) => o.name === 'Bricks')], false); }); await W(400); await shot('unwrapped-bricks');
    return r;
  });
  await step('undo paint', () => ev(() => { const ed = window.app.editor; ed.doc.undo(); const c = ed.doc.selected.material.map.image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let blue = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 200 && d[i] < 80) blue++; ed.doc.redo(); return { blueAfterUndo: blue }; }));
  await step('eyedropper', async () => {
    await ev(() => window.app.editor.eyedropper());
    const r = await page.locator('canvas.viewport').boundingBox(); await page.mouse.click(r.x + r.width / 2 - 60, r.y + r.height / 2 + 5);
    return ev(() => window.app.editor.paintBrush.hex);
  });
  await step('colour popover', async () => {
    await ev(() => window.app.editor.setMode('paint'));
    await page.locator('.strip .swatch.picker').click(); await W(200);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
    await shot('colorwheel');
    const hex = await page.locator('.popover .cw-hex').inputValue();
    await page.locator('.popover .cw-hex').fill('#22cc88'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    return { hex, now: await ev(() => window.app.editor.paintBrush.hex) };
  });
  await step('vertex paint line', async () => {
    await ev(() => { const ed = window.app.editor; ed.paintTarget = 'vertex'; ed.paintBrush.line = true; ed.refresh(); });
    const r = await page.locator('canvas.viewport').boundingBox(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    await page.mouse.move(cx - 100, cy + 40); await page.mouse.down(); await page.mouse.move(cx + 100, cy + 40, { steps: 4 }); await page.mouse.up();
    const res = await ev(() => { const o = window.app.editor.doc.selected; return { hasColor: !!o.geometry.attributes.color, label: window.app.editor.doc.history.undoStack.at(-1).label }; });
    await ev(() => { const ed = window.app.editor; ed.paintTarget = 'texture'; ed.paintBrush.line = false; ed.setMode('object'); });
    return res;
  });
  await step('menu bar keyboard', async () => {
    await page.locator('.menubar .mb').nth(3).click(); await W(150); await shot('menu-object');
    await page.keyboard.press('ArrowRight'); await W(100); const lbl = await page.locator('.menu').first().getAttribute('aria-label'); await page.keyboard.press('Escape');
    return lbl;
  });
  await step('command palette', async () => {
    await page.keyboard.press('Control+k'); await W(150); await page.keyboard.type('x-ray'); await W(100); await shot('palette'); await page.keyboard.press('Enter'); await W(150);
    return ev(() => window.app.editor.vp.render.xray);
  });
  await step('x-ray off & measure', async () => { await ev(() => { window.app.editor.toggleRender('xray'); window.app.editor.toggleMeasure(); }); const r = await page.locator('canvas.viewport').boundingBox(); await page.mouse.click(r.x + r.width / 2 - 50, r.y + r.height / 2); await page.mouse.click(r.x + r.width / 2 + 60, r.y + r.height / 2 + 30); await W(200); await shot('measure'); const t = await page.locator('.measure-label').textContent(); await page.keyboard.press('Escape'); return t; });
  await step('box select', async () => {
    await ev(() => { const ed = window.app.editor; ed.doc.select(null); ed.vp.frame(ed.doc.objects, false); });
    await W(200);
    const r = await page.locator('canvas.viewport').boundingBox();
    await page.keyboard.down('Control'); await page.mouse.move(r.x + 300, r.y + 120); await page.mouse.down(); await page.mouse.move(r.x + r.width - 360, r.y + r.height - 120, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Control');
    return ev(() => window.app.editor.doc.selection.map((o) => o.name));
  });
  await step('nudge + align', async () => { await page.locator('canvas.viewport').focus(); const x0 = await ev(() => window.app.editor.doc.selected.position.y); await page.keyboard.press('ArrowUp'); const x1 = await ev(() => window.app.editor.doc.selected.position.y); await ev(() => window.app.editor.actions.align('y', 'min')); return { dy: +(x1 - x0).toFixed(3) }; });
  await step('array', () => ev(() => { const ed = window.app.editor, d = ed.doc; const o = ed.actions.addShape('CUBE', { width: 0.2, height: 0.2, depth: 0.2 }); ed.actions.array(o, { count: 6, mode: 'radial' }); const g = d.selected; return { name: g.name, kids: d.children(g).length, undo: d.history.undoStack.at(-1).label }; }));
  await step('mesh cleanup', () => ev(() => { const ed = window.app.editor, d = ed.doc, o = d.objects.find((x) => x.name === 'Block'); ed.actions.mergeByDistance(o); ed.actions.recalcNormals(o); ed.inspectorTab = 'mesh'; d.select(o); return o.geometry.index.count / 3; }));
  await W(400); await shot('meshcheck');
  await step('save & reopen round trip', async () => {
    const before = await ev(() => { const d = window.app.editor.doc; return { n: d.objects.length, tree: d.treeOrder().map((o) => '  '.repeat(d.depth(o)) + o.name + ':' + o.ed.kind).join('\n'), clips: d.clips.length }; });
    await ev(() => window.app.closeEditor()); await page.waitForSelector('.pcard', { timeout: 30000 }); await W(500); await shot('home-after');
    await page.locator('.pcard').first().click(); for (let i = 0; i < 100 && !(await ev(() => window.app?.editor?.doc?.objects?.length > 0)); i++) await W(200); await W(800);
    const after = await ev(() => { const d = window.app.editor.doc; const sp = d.objects.find((o) => o.name === 'Spawn'); const s = d.objects.find((o) => o.name === 'Sphere'); return { n: d.objects.length, tree: d.treeOrder().map((o) => '  '.repeat(d.depth(o)) + o.name + ':' + o.ed.kind).join('\n'), clips: d.clips.length, props: sp?.ed.props, ease: [...(s?.ed.keys.values() || [])].map((k) => k.i || 'linear'), shared: s?.material === d.objects.find((o) => o.name === 'Cube')?.material, trans: s?.material.transmission, painted: !!d.objects.find((o) => o.name === 'Canvas')?.material.map }; });
    return { same: before.tree === after.tree, clips: [before.clips, after.clips], props: after.props, ease: after.ease, shared: after.shared, trans: after.trans, painted: after.painted };
  });
  await W(500); await shot('reopened');
}
