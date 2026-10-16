// Close-ups of house windows (front, at a slant) in Millbrook and Ironspire.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 480 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
for (const [site, k] of [['millbrook', 0], ['millbrook', 3], ['aurelhold', 1], ['ironspire', 2]]) {
  await page.evaluate(([site, k]) => {
    const g = SC.game; g.manual = true; SC.setTime(15); weather('clear');
    const pl = SC.site(site); g.player.spawn(pl.plaza.x + 3, pl.plaza.z + 3); SC.stream(pl.plaza.x, pl.plaza.z);
    for (let i = 0; i < 40; i++) g.step(1 / 30);
    const lives = [...g.settlements.live.values()].filter((l) => l.model.windows.length > 2);
    const l = lives[k % lives.length];
    const w = l.model.windows.find((x) => x.normal.z > 0.5) ?? l.model.windows[0];
    const m = l.root.matrixWorld;
    const wp = w.pos.clone().applyMatrix4(m), wn = w.normal.clone().transformDirection(m);
    const side = new SC.THREE.Vector3(-wn.z, 0, wn.x);
    g.freeCam = true; g.camera.position.copy(wp).addScaledVector(wn, 2.6).addScaledVector(side, 1.1).add(new SC.THREE.Vector3(0, -0.2, 0)); g.camera.lookAt(wp); g.camera.updateMatrixWorld(); SC.render(3);
  }, [site, k]);
  const f = path.join(shots, `win-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).toBuffer(), left: (i % 2) * 640, top: Math.floor(i / 2) * 480 })));
await sharp({ create: { width: 1280, height: 960, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'windows.png'));
await b.close(); srv.close();
