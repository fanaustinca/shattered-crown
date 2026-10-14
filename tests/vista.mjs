import { launch, openPage, serve, shots } from './harness.mjs';
import sharp from 'sharp';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const out = [];
for (const [x, z, lx, lz] of [[900, -500, 1480, -520], [1150, -760, 1300, -700], [1600, -1000, 1780, -1350]]) {
  await page.evaluate(([x, z, lx, lz]) => { const g = SC.game; g.manual = true; SC.setTime(10); g.player.spawn(x, z); SC.stream(x, z); for (let i = 0; i < 30; i++) g.step(1 / 30); g.freeCam = true; g.camera.position.set(x, g.world.heightAt(x, z) + 2, z); g.camera.lookAt(lx, g.world.heightAt(lx, lz) + 20, lz); g.camera.updateMatrixWorld(); SC.render(3); }, [x, z, lx, lz]);
  const f = `/tmp/claude-1001/-home-austin/ed5aa146-5f10-4535-a705-54c8141c29de/scratchpad/v${out.length}.png`; await page.screenshot({ path: f }); out.push(f);
}
const comps = await Promise.all(out.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: i * 640, top: 0 })));
await sharp({ create: { width: 1920, height: 360, channels: 3, background: '#000' } }).composite(comps).png().toFile('/tmp/claude-1001/-home-austin/ed5aa146-5f10-4535-a705-54c8141c29de/scratchpad/vista.png');
await b.close(); srv.close();
