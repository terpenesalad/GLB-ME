// Renders a thumbnail for every procedural template to assets/templates/thumbs/<id>.webp.
// usage: xvfb-run -a node scripts/e2e.mjs .dev/out scripts/bake-thumbs.mjs   (env IDS=a,b to limit)
import fs from 'fs';
export default async ({ page, ev, step }) => {
  fs.mkdirSync('assets/templates/thumbs', { recursive: true });
  await page.locator('.create').nth(1).click();
  await page.waitForFunction(() => window.app?.editor?.doc, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const ids = (process.env.IDS || '').split(',').filter(Boolean);
  const all = ids.length ? ids : await ev(() => window.glbmeDebug.templates.CATALOG.map((t) => t.id));
  for (const id of all) {
    await step('thumb ' + id, async () => {
      const url = await ev(async (id) => {
        const ed = window.app.editor, D = window.glbmeDebug, d = ed.doc;
        for (const o of [...d.objects]) d.detach(o);
        d.clips = []; d.frame = 0;
        const t = (await D.studios.templateList()).find((x) => x.id === id);
        await D.studios.insertTemplate(ed, t, true);
        const rs = ed.vp.render; rs.envBg = true; rs.envBlur = 0.35; rs.shadows = true; rs.grid = false; rs.ao = false; ed.vp.applyRender();
        await ed.vp.envReady; ed.vp.applyEnvBackground();
        const [yaw, pitch, fit] = t.view || [32, 16, 0.85];
        const png = await ed.vp.renderImage({ width: 640, height: 480, framed: true, yaw, pitch, fit });
        const img = await createImageBitmap(new Blob([png], { type: 'image/png' }));
        const c = document.createElement('canvas'); c.width = 400; c.height = 300;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, 400, 300);
        return c.toDataURL('image/webp', 0.8);
      }, id);
      const b = Buffer.from(url.split(',')[1], 'base64');
      fs.writeFileSync(`assets/templates/thumbs/${id}.webp`, b);
      return Math.round(b.length / 1024) + ' KB';
    });
  }
};
