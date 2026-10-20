export default async function ({ page, ev, step }) {
  const W = (ms) => page.waitForTimeout(ms);
  await step('new project', async () => { await page.locator('.create').first().click(); for (let i = 0; i < 100 && !(await ev(() => !!window.app?.editor?.vp)); i++) await W(200); await W(500); await page.keyboard.press('Escape'); });
  await step('send to blender', () => ev(async () => {
    const ed = window.app.editor, a = ed.actions; const c = a.addShape('CUBE'); a.setProps(c, [['material_id', '7']]); const s = a.addShape('SPHERE'); ed.doc.setSelection([c, s]); a.group(); a.addLight('point');
    const found = await window.glbmeDebug.platform.pipeline.findTool('blender');
    await window.glbmeDebug.pipeline.sendToBlender(ed);
    return found;
  }));
  await W(1500);
}
