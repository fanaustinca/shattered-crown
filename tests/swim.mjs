import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 400 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
for (const [k, moving] of [[0, true], [1, true], [2, false]]) {
  await page.evaluate(([k, moving]) => {
    const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11); weather('clear'); g.ui.screen = 'play';
    if (k === 0) { g.player.spawn(-1250, 2500); g.player.thirdPerson = true; }
    const inp = g.input; inp.down.clear(); if (moving) inp.down.add('KeyW');
    for (let i = 0; i < 60 + k * 17; i++) g.step(1 / 60);
    const p = g.player.pos;
    g.freeCam = true; g.camera.position.set(p.x + 3.5, p.y + 1.8, p.z + 2); g.camera.lookAt(p.x, p.y + 1.1, p.z); g.camera.updateMatrixWorld(); SC.render(3);
  }, [k, moving]);
  const f = path.join(shots, `swim-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
console.log(await page.evaluate(() => `mode ${SC.game.player.mode} inWater ${SC.game.player.inWater.toFixed(2)}`));
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).toBuffer(), left: i * 640, top: 0 })));
await sharp({ create: { width: 1920, height: 400, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'swim.png'));
await b.close(); srv.close();
