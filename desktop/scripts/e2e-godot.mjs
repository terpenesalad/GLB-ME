// Builds a game-asset scene and sends it to a Godot project through the live link.
export default async function ({ page, ev, step }) {
  const W = (ms) => page.waitForTimeout(ms);
  await step('new project', async () => { await page.locator('.create').first().click(); for (let i = 0; i < 100 && !(await ev(() => !!window.app?.editor?.vp)); i++) await W(200); await W(500); await page.keyboard.press('Escape'); });
  await step('build scene', () => ev(() => {
    const ed = window.app.editor, a = ed.actions, d = ed.doc;
    const floor = a.addShape('PLANE', { width: 10, depth: 10 }); floor.name = 'Floor'; a.setCollision(floor, 'col');
    const crate = a.addShape('CUBE', { width: 1, height: 1, depth: 1 }); crate.name = 'Crate'; crate.scale.set(2, 1, 1); a.setCollision(crate, 'convcol');
    const ball = a.addShape('SPHERE'); ball.name = 'Ball'; a.setCollision(ball, 'rigid'); ball.position.set(3, 2, 0);
    a.material('m', (m) => { m.color.set(0xff3300); m.metalness = 1; m.roughness = 0.2; m.emissive.set(0x220000); m.emissiveIntensity = 3; m.name = 'RedMetal'; }, ball);
    const door = a.addShape('CUBE', { width: 1, height: 2, depth: 0.1 }); door.name = 'Door';
    d.setSelection([door]); const g = a.group(); g.name = 'DoorPivot';
    d.select(g); ed.setMode('animate'); d.frame = 0; ed.insertKey(); d.frame = 30; g.rotation.y = Math.PI / 2; ed.insertKey(); ed.setKeyEasing('ease'); d.frame = 60; g.rotation.y = 0; ed.insertKey(); ed.setMode('object');
    d.transact('clips', () => { d.clips = [{ name: 'Open', start: 0, end: 30, loop: false }, { name: 'Swing', start: 0, end: 60, loop: true }]; }, []);
    const spawn = a.addEmpty(); spawn.name = 'PlayerSpawn'; a.setProps(spawn, [['team', 'blue'], ['health', '100']]);
    const cam = a.addCamera(); cam.name = 'MainCam';
    a.addLight('spot');
    const ref = a.addShape('CUBE'); ref.name = 'ReferenceOnly'; a.setExport(ref, false);
    const D = window.glbmeDebug;
    const wall = a.addShape('CUBE'); wall.name = 'BrickWall'; wall.position.set(-3, 0.5, 0);
    a.material('bricks', (m) => { D.applyPattern(m, D.defaultSpec('BRICKS'), 512); m.name = 'Bricks'; }, wall);
    const glass = a.addShape('SPHERE'); glass.name = 'GlassBall'; glass.position.set(-3, 2, 0);
    a.material('glass', (m) => { m.transmission = 1; m.ior = 1.5; m.roughness = 0.05; m.name = 'Glass'; }, glass);
    const car = a.addShape('ROUNDED_BOX'); car.name = 'CarBody'; car.position.set(0, 0.5, -3);
    a.material('paint', (m) => { m.color.set(0x1144aa); m.clearcoat = 1; m.clearcoatRoughness = 0.05; m.metalness = 0.6; m.name = 'CarPaint'; }, car);
    return d.objects.length;
  }));
  await step('send to godot (live link)', () => ev(async (dir) => {
    const ed = window.app.editor, D = window.glbmeDebug;
    ed.doc.link = { kind: 'godot', root: dir, project: 'GLBME Test', sub: 'models', file: 'level', live: true, opts: D.pipeline.godotOptions({}) };
    const ok = await D.pipeline.syncLink(ed, true);
    // gltf + files variant too
    ed.doc.link = { kind: 'godot', root: dir, project: 'GLBME Test', sub: 'models/split', file: 'level_split', live: false, opts: D.pipeline.godotOptions({ format: 'gltfsep' }) };
    const ok2 = await D.pipeline.syncLink(ed, true);
    return { ok, ok2, path: ed.doc.link.lastPath };
  }, process.env.E2E_ALLOW_DIR));
  await step('save triggers live sync', async () => {
    await ev((dir) => { const ed = window.app.editor, D = window.glbmeDebug; ed.doc.link = { kind: 'godot', root: dir, sub: 'models', file: 'level', live: true, opts: D.pipeline.godotOptions({}) }; ed.doc.objects.find((o) => o.name === 'Crate').position.x = 1.5; ed.doc.dirty = true; }, process.env.E2E_ALLOW_DIR);
    await ev(() => window.app.editor.save());
    await W(1500);
    return ev(() => ({ last: window.app.editor.doc.link.lastSync > 0, chip: document.querySelector('.linkchip')?.getAttribute('aria-label') }));
  });
}
