import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); weather('clear');
  const F = g.war.fronts, f = F.fronts[1];
  const { p, dir } = F.posAt(f, f.line);
  g.player.spawn(p.x + dir.z * 60, p.z - dir.x * 60);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  F.begin(f); const L = f.live; window.__L = L; g.player.spawn(L.center.x - L.dir.z * 45, L.center.z + L.dir.x * 45);
});
const files = [];
for (const [t, dist, h] of [[20, 40, 3], [30, 70, 6], [40, 30, 2]]) {
  await page.evaluate(([t, dist, h]) => {
    const g = SC.game, L = window.__L;
    for (let i = 0; i < 30 * t; i++) g.step(1 / 30);
    const side = new SC.THREE.Vector3(-L.dir.z, 0, L.dir.x);
    const alive = [...L.ids].filter((s) => s.alive);
    const c = alive.reduce((a, s) => a.add(s.st.pos), new SC.THREE.Vector3()).multiplyScalar(1 / Math.max(1, alive.length));
    g.freeCam = true; g.camera.position.copy(c).addScaledVector(side, dist).add(new SC.THREE.Vector3(0, h, 0)); g.camera.lookAt(c.x, c.y + 1, c.z); g.camera.updateMatrixWorld(); SC.render(3);
  }, [t, dist, h]);
  const f = path.join(shots, `mid-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: i * 640, top: 0 })));
await sharp({ create: { width: 1920, height: 360, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'midbattle.png'));
await b.close(); srv.close();
