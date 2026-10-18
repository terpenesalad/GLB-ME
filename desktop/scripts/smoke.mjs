// Launches the packaged app, checks that the home screen and the 3D editor work, saves screenshots.
// usage: node scripts/smoke.mjs <path-to-executable> <out-dir>
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
const [exe, out = 'smoke'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const errors = [];
const app = await electron.launch({ executablePath: exe, args: process.platform === 'linux' ? ['--no-sandbox'] : [], timeout: 60000 });
app.process().stdout?.on('data', (d) => process.stdout.write('[app] ' + d));
app.process().stderr?.on('data', (d) => process.stdout.write('[app] ' + d));
const page = await app.firstWindow({ timeout: 60000 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
try {
  await page.waitForSelector('.create', { timeout: 30000 });
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()));
  if (!visible.some(Boolean)) throw new Error('window is not visible');
  await page.screenshot({ path: `${out}/home.png` });
  await page.keyboard.press('Escape');
  await page.locator('.create').nth(1).click();
  await page.waitForFunction(() => window.app?.editor?.doc?.objects?.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/editor.png` });
  const info = await page.evaluate(() => { const r = window.app.editor.vp.renderer; return { tris: window.app.editor.doc.stats().tris, gl: r.getContext().getParameter(r.getContext().VERSION) }; });
  console.log('editor ok', JSON.stringify(info));
  await page.evaluate(() => window.app.closeEditor());
  await page.waitForSelector('.pcard', { timeout: 30000 });
  console.log('project saved and listed');
} catch (e) {
  errors.push('FAILED: ' + e.message);
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
}
await app.close().catch(() => {});
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('smoke test passed');
