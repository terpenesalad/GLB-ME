// Developer end-to-end check: launches the unpacked Electron app and drives the editor.
// usage: xvfb-run -a node scripts/e2e.mjs <out-dir> [step]
import { _electron as electron } from 'playwright-core';
import fs from 'fs';
import path from 'path';
const out = process.argv[2] || 'e2e-out';
fs.mkdirSync(out, { recursive: true });
const errors = [];
const userData = fs.mkdtempSync('/tmp/glbme-e2e-');
if (process.env.E2E_ALLOW_DIR) fs.writeFileSync(path.join(userData, 'pipeline.json'), JSON.stringify({ dirs: [process.env.E2E_ALLOW_DIR], tools: {} }));
const app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron'), args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], timeout: 60000 });
const page = await app.firstWindow({ timeout: 60000 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('response', (r) => { if (r.status() >= 400) errors.push('http ' + r.status() + ' ' + r.url()); });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.setViewportSize?.({ width: 1440, height: 900 });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = async (name, fn) => { try { const r = await fn(); console.log('✔', name, r !== undefined ? JSON.stringify(r).slice(0, 300) : ''); } catch (e) { errors.push(`✘ ${name}: ${e.message}`); console.log('✘', name, e.message); await shot('fail-' + name.replace(/\W+/g, '_')).catch(() => {}); } };
globalThis.ctx = { page, ev, shot, step, errors, app };
await page.waitForSelector('.create', { timeout: 30000 });
await page.waitForTimeout(900); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const mod = await import(path.resolve(process.argv[3] || 'scripts/e2e-steps.mjs'));
await mod.default(globalThis.ctx);
await app.close().catch(() => {});
console.log('\n' + (errors.length ? errors.join('\n') : 'NO ERRORS'));
process.exit(errors.length ? 1 : 0);
