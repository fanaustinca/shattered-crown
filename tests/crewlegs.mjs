import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 500, height: 500 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11); weather('cloudy');
  g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30);
  spawn.ship('frigate'); const s = g.ships[g.ships.length - 1]; window.__S = s;
  const out = new T.Vector3(s.pos.x, 0, s.pos.z).normalize().multiplyScalar(220); const t = s.body.translation(); s.body.setTranslation({ x: t.x + out.x, y: t.y, z: t.z + out.z }, true);
  s.anchored = false; for (const sl of s.sails) sl.target = 1;
  g.player.spawn(s.pos.x, s.pos.z + 40);
  g.naval.manShip(s); for (let i = 0; i < 60; i++) g.step(1 / 30);
});
const files = [];
for (let k = 0; k < 8; k++) {
  await page.evaluate((k) => {
    const g = SC.game, s = window.__S, T = SC.THREE;
    for (let i = 0; i < 7; i++) g.step(1 / 30);
    const hs = g.naval.crews.get(s); const h = hs.filter((x) => x.st.speed > 0.5)[0] ?? hs[0]; window.__H = h;
    const w = s.model.localToWorld(h.st.pos.clone());
    const side = new T.Vector3(Math.cos(h.st.yaw), 0, -Math.sin(h.st.yaw)).applyQuaternion(s.quat);
    g.freeCam = true; g.camera.position.copy(w).addScaledVector(side, 2.2).add(new T.Vector3(0, 2.2, 0)); g.camera.lookAt(w.x, w.y + 0.9, w.z); g.camera.updateMatrixWorld(); SC.render(2);
  }, k);
  const f = path.join(shots, `cl-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(400, 400).toBuffer(), left: (i % 4) * 400, top: Math.floor(i / 4) * 400 })));
await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'crewlegs.png'));
await b.close(); srv.close();
