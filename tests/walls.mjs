// House shells up close: corners, gables and eaves from outside, looking for gaps you can see inside through.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const site = process.argv[2] || 'millbrook';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 500, height: 500 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const n = await page.evaluate((site) => {
  const g = SC.game; g.manual = true; SC.setTime(15);
  const pl = SC.site(site); g.player.spawn(pl.plaza.x + 3, pl.plaza.z + 3); SC.stream(pl.plaza.x, pl.plaza.z);
  for (let i = 0; i < 90; i++) g.step(1 / 30);
  window.__bs = [...g.settlements.live.values()].filter((l) => l.furnished).map((l) => l.placed);
  return window.__bs.length;
}, site);
console.log('buildings', n);
const files = [];
for (let k = 0; k < 16; k++) {
  const desc = await page.evaluate((k) => {
    const g = SC.game, T = SC.THREE;
    const bd = window.__bs[Math.floor(k / 2) % window.__bs.length];
    const s = Math.sin(bd.yaw), c = Math.cos(bd.yaw), W = bd.spec.w / 2, D = bd.spec.d / 2;
    // two views per building: a front corner from low down, a back corner from up at the eaves
    const sx = k % 2 ? -1 : 1, sz = k % 2 ? -1 : 1;
    const lx = sx * (W + 3.5), lz = sz * (D + 3.5);
    const wx = bd.x + lx * c + lz * s, wz = bd.z - lx * s + lz * c;
    const tx = bd.x + sx * W * 0.9 * c + sz * D * 0.9 * s, tz = bd.z - sx * W * 0.9 * s + sz * D * 0.9 * c;
    const h = k % 2 ? 4.5 : 1.6;
    g.freeCam = true; g.camera.position.set(wx, bd.y + h, wz); g.camera.lookAt(tx, bd.y + (k % 2 ? 3.5 : 1.5), tz); g.camera.updateMatrixWorld(); SC.render(3);
    return `${bd.spec.type} ${bd.spec.style} f${bd.spec.floors} roof:${bd.spec.roof}`;
  }, k);
  console.log(k, desc);
  const f = path.join(shots, `wall-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(320, 320).toBuffer(), left: (i % 8) * 320, top: Math.floor(i / 8) * 320 })));
await sharp({ create: { width: 2560, height: 640, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `walls-${site}.png`));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
