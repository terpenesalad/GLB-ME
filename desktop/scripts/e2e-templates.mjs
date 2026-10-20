// Template library check: builds templates, exports GLB (+ Godot preset), validates with the Khronos
// glTF validator, re-imports, and checks project save/load round-trips.
// usage: xvfb-run -a node scripts/e2e.mjs out scripts/e2e-templates.mjs   (env IDS=a,b to limit)
import fs from 'fs';
import validator from 'gltf-validator';
export default async ({ page, ev, step, errors }) => {
  await page.locator('.create').nth(1).click();
  await page.waitForFunction(() => window.app?.editor?.doc, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const ids = (process.env.IDS || 'mel_terrace_fitzroy,tram_w_class,tram_e_class,road_intersection,room_living,d_victorian,a_kangaroo,n_red_gum,mel_laneway,b_church').split(',');
  for (const id of ids) {
    await step('export ' + id, async () => {
      const r = await ev(async (id) => {
        const ed = window.app.editor, D = window.glbmeDebug, d = ed.doc;
        for (const o of [...d.objects]) d.detach(o);
        const t = (await D.studios.templateList()).find((x) => x.id === id);
        await D.studios.insertTemplate(ed, t, true);
        const n = d.objects.length, glb = await D.exportModel(d, { format: 'glb' }), godot = await D.exportModel(d, { format: 'glb', godot: true, applyScale: true, textureMax: 2048 });
        const back = await D.parseGltf(glb.data.slice ? glb.data.slice(0) : glb.data);
        const proj = await D.saveProject(d, ed.vp), reload = await D.parseGltf(proj);
        const b64 = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(new Blob([glb.data])); });
        return { n, glb: b64, godotBytes: godot.data.byteLength, back: back.objects.length, reload: reload.objects.length, clips: d.clips.length };
      }, id);
      const bytes = new Uint8Array(Buffer.from(r.glb, 'base64'));
      const rep = await validator.validateBytes(bytes, { maxIssues: 50 });
      const errs = rep.issues.numErrors, warns = rep.issues.numWarnings;
      if (errs) { errors.push(`${id}: ${errs} validator errors – ` + rep.issues.messages.filter((m) => m.severity === 0).slice(0, 3).map((m) => m.code + ' ' + m.pointer).join('; ')); }
      if (r.reload < r.n * 0.9) errors.push(`${id}: project reload lost objects (${r.reload}/${r.n})`);
      return { objects: r.n, kb: Math.round(bytes.length / 1024), errs, warns, infos: rep.issues.numInfos, reimported: r.back, reload: r.reload, clips: r.clips, warnCodes: [...new Set(rep.issues.messages.filter((m) => m.severity === 1).map((m) => m.code))].slice(0, 4) };
    });
  }
};
