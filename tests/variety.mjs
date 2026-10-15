// Street views for building variety (colours, framing, dormers, signs, awnings) and a windmill.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
const mills = await page.evaluate(() => SC.game.towns.plans.flatMap((p) => p.extras.filter((e) => e.kind === 'windmill').map((e) => [e.x, e.z, p.site.name])));
console.log('windmills', mills.length, mills.slice(0, 4).map((m) => m[2]).join(', '));
const views = [['millbrook', 0], ['millbrook', 2], ['aurelhold', 1], ['aurelhold', 3]];
for (const [site, k] of views) {
  await page.evaluate(([site, k]) => {
    const g = SC.game; g.manual = true; SC.setTime(10.5); weather('clear');
    const pl = SC.site(site); const a = k * 1.6 + 0.3, R = pl.plaza.r + 14;
    const x = pl.plaza.x + Math.cos(a) * R, z = pl.plaza.z + Math.sin(a) * R;
    g.player.spawn(x, z); SC.stream(x, z); for (let i = 0; i < 40; i++) g.step(1 / 30);
    g.freeCam = true; g.camera.position.set(x, g.world.heightAt(x, z) + 2.2, z); g.camera.lookAt(pl.plaza.x + Math.cos(a + 0.9) * R * 1.4, g.world.heightAt(x, z) + 4, pl.plaza.z + Math.sin(a + 0.9) * R * 1.4); g.camera.updateMatrixWorld(); SC.render(3);
  }, [site, k]);
  const f = path.join(shots, `var-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
for (const m of mills.slice(0, 2)) {
  await page.evaluate((m) => {
    const g = SC.game; const [x, z] = m; g.player.spawn(x + 20, z + 20); SC.stream(x, z); for (let i = 0; i < 40; i++) g.step(1 / 30);
    g.freeCam = true; g.camera.position.set(x + 22, g.world.heightAt(x, z) + 6, z + 18); g.camera.lookAt(x, g.world.heightAt(x, z) + 6, z); g.camera.updateMatrixWorld(); SC.render(3);
  }, m);
  const f = path.join(shots, `var-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'variety.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
