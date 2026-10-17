// Sea surface over time: 6 frames 1/15 s apart from a deck-height viewpoint, in a fresh breeze.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 360 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
const w = process.env.W || 'cloudy';
for (let k = 0; k < 6; k++) {
  await page.evaluate(([k, w]) => {
    const g = SC.game; g.manual = true;
    if (k === 0) { SC.setTime(11); weather(w); g.player.spawn(-1250, 2300); for (let i = 0; i < 60; i++) g.step(1 / 30); g.time = +(window.__T || 0) || g.time; }
    g.step(1 / 15);
    g.freeCam = true; g.camera.position.set(-1250, 6, 2700); g.camera.lookAt(-1250 + 60, 0, 2800); g.camera.updateMatrixWorld(); SC.render(1);
  }, [k, w]);
  const f = path.join(shots, `wave-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
console.log(await page.evaluate(() => { const u = SC.game; return `time ${u.time.toFixed(1)} amp ${window.SC.water?.uWaveAmp?.value ?? '?'} weather ${u.weather.kind}`; }));
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'waves.png'));
await b.close(); srv.close();
