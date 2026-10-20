// Bakes the procedural PBR material library to assets/materials/<id>_{c,n,r}.webp (1024², tileable).
// usage: xvfb-run -a node scripts/e2e.mjs .dev/out scripts/bake-materials.mjs   (env IDS=a,b to limit)
import fs from 'fs';
export default async ({ ev, step }) => {
  fs.mkdirSync('assets/materials', { recursive: true });
  const ids = (process.env.IDS || '').split(',').filter(Boolean);
  const all = ids.length ? ids : await ev(() => Object.keys(window.glbmeDebug.pbr.LIB));
  const size = +(process.env.SIZE || 1024);
  for (const id of all) {
    await step('bake ' + id, async () => {
      const r = await ev(({ id, size }) => {
        const P = window.glbmeDebug.pbr, d = P.LIB[id];
        const m = P.bakeMaps(id, P.GEN[d.gen](d.o || {}), d.size || size, { normal: d.normal ?? 3 });
        const q = { c: 0.86, n: 0.88, r: 0.8 };
        return { c: m.map.image.toDataURL('image/webp', q.c), n: m.normalMap.image.toDataURL('image/webp', q.n), r: m.roughnessMap.image.toDataURL('image/webp', q.r) };
      }, { id, size });
      let total = 0;
      for (const k of ['c', 'n', 'r']) { const b = Buffer.from(r[k].split(',')[1], 'base64'); total += b.length; fs.writeFileSync(`assets/materials/${id}_${k}.webp`, b); }
      return Math.round(total / 1024) + ' KB';
    });
  }
};
