// Mountain roads and trails: aerial views of the climb to Ironspire and the mountain tracks, grade stats.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const t0 = Date.now();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 700, height: 500 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log('boot s', ((Date.now() - t0) / 1000).toFixed(1));
const stats = await page.evaluate(() => {
  const g = SC.game, W = g.world;
  const out = W.roads.map((r, i) => {
    let mx = 0, at = ''; const P = r.pts;
    for (let k = 0; k + 30 < P.length; k += 15) { let d = 0; for (let q = k; q < k + 30; q += 3) d += Math.hypot(P[q + 3] - P[q], P[q + 4] - P[q + 1]); const gr = Math.abs(P[k + 32] - P[k + 2]) / Math.max(1, d); if (gr > mx) { mx = gr; at = `@${Math.round(P[k])},${Math.round(P[k + 1])} k${k / 3}/${P.length / 3}`; } }
    return `${i}:${r.kind} len${Math.round(P.length / 3 * 2)} maxgrade ${(Math.atan(mx) * 57.3).toFixed(0)}° ${at}`;
  });
  // steepest terrain anywhere
  let steep = 0, n = 0; for (let x = -3000; x < 3000; x += 9) for (let z = -3000; z < 3000; z += 9) { const s = W.slopeAt(x, z); n++; if (s > 0.5) steep++; }
  return JSON.stringify(W.genTimes) + '\n' + out.join('\n') + `\nslopes>60°: ${(steep / n * 100).toFixed(3)}%`;
});
console.log(stats);
const files = [];
const views = [[1480, -520, 900, 1100, -480], [1300, -560, 260, 1150, -480]];
for (const [cx, cz, h, lx, lz] of views) {
  await page.evaluate(([cx, cz, h, lx, lz]) => {
    const g = SC.game; g.manual = true; SC.setTime(13);
    g.player.spawn(lx, lz); SC.stream(lx, lz);
    for (let i = 0; i < 20; i++) g.step(1 / 30);
    g.freeCam = true; g.camera.position.set(cx - 200, g.world.heightAt(cx, cz) + h, cz + 300); g.camera.lookAt(lx, g.world.heightAt(lx, lz), lz); g.camera.updateMatrixWorld(); SC.render(3);
  }, [cx, cz, h, lx, lz]);
  const f = path.join(shots, `mroad-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
// trails: from above the first few
const trails = await page.evaluate(() => SC.game.world.roads.slice(19).map((r) => [r.pts[0], r.pts[1], r.pts[r.pts.length - 3], r.pts[r.pts.length - 2]]));
for (const t of trails.slice(0, 4)) {
  await page.evaluate((t) => {
    const g = SC.game; const mx = (t[0] + t[2]) / 2, mz = (t[1] + t[3]) / 2;
    g.player.spawn(t[2], t[3]); SC.stream(mx, mz); for (let i = 0; i < 20; i++) g.step(1 / 30);
    const d = Math.hypot(t[2] - t[0], t[3] - t[1]);
    g.freeCam = true; g.camera.position.set(mx + 1, g.world.heightAt(mx, mz) + Math.max(400, d * 1.2), mz); g.camera.lookAt(mx, g.world.heightAt(mx, mz), mz); g.camera.updateMatrixWorld(); SC.render(3);
  }, t);
  const f = path.join(shots, `mroad-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(560, 400).toBuffer(), left: (i % 3) * 560, top: Math.floor(i / 3) * 400 })));
await sharp({ create: { width: 1680, height: 800, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'mountroads.png'));
console.log(trails.length, 'trails');
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
