// Aerial and ground views of a few farming hamlets.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const info = await page.evaluate(() => { const h = SC.game.towns.plans.filter((p) => p.minor && p.site.r === 60); return { n: h.length, homes: h.reduce((s, p) => s + p.buildings.length, 0), names: h.slice(0, 6).map((p) => p.site.name) }; });
console.log(info);
await page.evaluate(() => { SC.game.manual = true; SC.setTime(10); weather('clear'); });
const files = [];
for (let i = 0; i < 3; i++) for (const v of ['air', 'ground']) {
  await page.evaluate(([i, v]) => {
    const g = SC.game, p = g.towns.plans.filter((q) => q.minor && q.site.r === 60)[i * 3];
    const s = p.site;
    g.player.spawn(s.x + 10, s.z + 10); SC.stream(s.x, s.z);
    for (let k = 0; k < 30; k++) g.step(1 / 30);
    if (v === 'air') SC.view(s.x + 120, 'g+80', s.z + 120, s.x, 'g+0', s.z);
    else SC.view(s.x + 45, 'g+1.7', s.z + 30, s.x, 'g+2', s.z);
    SC.render(4);
  }, [i, v]);
  const f = path.join(shots, `ham-${i}-${v}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(480, 270).toBuffer(), left: (i % 2) * 480, top: Math.floor(i / 2) * 270 })));
await sharp({ create: { width: 960, height: 810, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'hamlets.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
