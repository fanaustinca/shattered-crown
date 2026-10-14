// Town gates vs roads: top-down views of the walled towns and castles.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const ids = (process.argv[2] || 'aurelhold,whitecrest,sunmere,ironspire').split(',');
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 700, height: 700 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const files = [];
for (const id of ids) {
  const info = await page.evaluate((id) => {
    const g = SC.game; g.manual = true; SC.setTime(12);
    const pl = SC.site(id); const s = pl.site;
    g.player.spawn(s.x + s.r * 0.5, s.z); SC.stream(s.x, s.z);
    for (let i = 0; i < 30; i++) g.step(1 / 30);
    g.freeCam = true; const H = s.r * (s.kind === 'capital' ? 2.6 : 3.6);
    g.camera.position.set(s.x, g.world.heightAt(s.x, s.z) + H, s.z + 1); g.camera.lookAt(s.x, g.world.heightAt(s.x, s.z), s.z); g.camera.updateMatrixWorld();
    SC.render(3);
    return pl.walls?.gates.map((a) => a.toFixed(2)).join(',');
  }, id);
  console.log(id, info);
  const f = path.join(shots, `gates-${id}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(480, 480).toBuffer(), left: (i % 4) * 480, top: 0 })));
await sharp({ create: { width: 1920, height: 480, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'gates.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
