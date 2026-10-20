// Visual / keyboard checks: themes, narrow window, dialogs, keyboard-only use.
export default async function ({ page, ev, shot, step, app }) {
  const W = (ms) => page.waitForTimeout(ms);
  await step('new project + scene', async () => {
    await page.locator('.create').first().click(); for (let i = 0; i < 100 && !(await ev(() => !!window.app?.editor?.vp)); i++) await W(200); await W(500); await page.keyboard.press('Escape');
    await ev(() => { const ed = window.app.editor, a = ed.actions; a.addShape('CUBE'); const s = a.addShape('SPHERE'); a.addShape('TORUS'); a.addLight('spot'); a.addCamera(); ed.doc.setSelection([s]); a.group(); ed.vp.frame(ed.doc.objects, false); });
    await W(300);
  });
  await step('export dialog', async () => { await page.keyboard.press('Control+e'); await W(700); await shot('ui-export'); await page.keyboard.press('Escape'); });
  await step('send to godot dialog', async () => { await ev(() => window.glbmeDebug.pipeline.sendToGodot(window.app.editor)); await W(400); await shot('ui-godot'); await page.keyboard.press('Escape'); });
  await step('clips dialog', async () => { await page.keyboard.press('Control+k'); await page.keyboard.type('clips'); await W(150); await shot('ui-palette-clips'); await page.keyboard.press('Enter'); await W(400); await page.getByRole('button', { name: 'Add clip' }).click(); await page.getByRole('button', { name: 'Add clip' }).click(); await W(100); await shot('ui-clips'); await page.keyboard.press('Escape'); });
  await step('shortcuts', async () => { await page.locator('canvas.viewport').focus(); await page.keyboard.press('Shift+?'); await W(300); await shot('ui-shortcuts'); await page.keyboard.press('Escape'); });
  await step('settings', async () => { await page.keyboard.press('Control+,'); await W(400); await shot('ui-settings'); await page.keyboard.press('Escape'); });
  await step('keyboard: F10 menu, arrows, enter', async () => {
    await page.locator('canvas.viewport').focus(); await page.keyboard.press('F10'); await W(100);
    const f = await ev(() => document.activeElement.textContent);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await W(150);
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await W(150); await shot('ui-kbd-menu');
    const focused = await ev(() => document.activeElement.textContent);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    return { first: f, focused };
  });
  await step('keyboard: tab through panels (no UI hiding)', async () => {
    await page.locator('canvas.viewport').focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    return ev(() => ({ hidden: window.app.editor.el.classList.contains('ui-hidden'), focus: document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.slice(0, 30) }));
  });
  await step('light theme', async () => { await ev(() => { window.app.settings.theme = 'light'; window.app.saveSettings(); }); await W(300); await shot('ui-light'); });
  await step('contrast theme + cvd axes', async () => { await ev(() => { window.app.settings.theme = 'contrast'; window.app.settings.axisColors = 'cvd'; window.app.saveSettings(); window.app.editor.setMode('paint'); }); await W(800); await page.keyboard.press('Escape'); await W(200); await shot('ui-contrast'); });
  await step('narrow window', async () => {
    await ev(() => { window.app.settings.theme = 'dark'; window.app.settings.axisColors = 'standard'; window.app.saveSettings(); window.app.editor.setMode('object'); });
    await page.setViewportSize({ width: 980, height: 680 }); await W(800); await shot('ui-narrow');
    const overflow = await ev(() => { const t = document.querySelector('.editor .titlebar'); return t.scrollWidth - t.clientWidth; });
    await page.locator('.mb-burger').click(); await W(150); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await W(150); await shot('ui-burger'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 }); await W(500);
    return { overflow };
  });
}
