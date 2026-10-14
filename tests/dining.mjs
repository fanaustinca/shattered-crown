// Dining tables and their chairs, seen from above inside houses (chairs square to the sides, facing in).
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 600, height: 600 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const n = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(12);
  const pl = SC.site('millbrook'); g.player.spawn(pl.plaza.x + 3, pl.plaza.z + 3); SC.stream(pl.plaza.x, pl.plaza.z);
  for (let i = 0; i < 90; i++) g.step(1 / 30);
  const T = SC.THREE; window.__tables = [];
  for (const live of g.settlements.live.values()) {
    if (!live.furnished) continue;
    for (const f of live.furniture) if (f.model.category === 'table') window.__tables.push(f.group.getWorldPosition(new T.Vector3()));
  }
  return window.__tables.length;
});
console.log('tables', n);
const files = [];
for (let k = 0; k < Math.min(8, n); k++) {
  await page.evaluate((k) => {
    const g = SC.game, p = window.__tables[k * 2 % window.__tables.length];
    g.freeCam = true; g.camera.position.set(p.x + 0.01, p.y + 2.3, p.z); g.camera.lookAt(p.x, p.y, p.z); g.camera.updateMatrixWorld(); SC.render(3);
  }, k);
  const f = path.join(shots, `dine-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(400, 400).toBuffer(), left: (i % 4) * 400, top: Math.floor(i / 4) * 400 })));
await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'dining.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
