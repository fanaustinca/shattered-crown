// The Leviathan: spawn her, look her over, set her on an enemy squadron.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
const info = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(14); weather('clear');
  g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30);
  const t0 = performance.now();
  spawn.leviathan('vanguardia');
  const L = g.ships.find((s) => s.cls === 'leviathan'); window.__L = L;
  const ms = performance.now() - t0;
  // the enemy squadron, close by
  const c = L.pos.clone();
  const Ship = L.constructor;
  for (const [cls, off] of [['frigate', 260], ['manowar', 340], ['brigantine', 300]]) {
    const p = c.clone().add(new SC.THREE.Vector3(off * 0.7, 0, off * 0.7));
    const s = new Ship(g, g.deepWater(p, p.clone().normalize(), 0, 30, 9), Math.random() * 6, cls, 'Enemy ' + cls); s.side = 'ironreach'; s.anchored = false;
    for (const sl of s.sails) sl.target = 1;
    g.ships.push(s); g.naval.spawned.add(s);
  }
  return { buildMs: Math.round(ms), guns: L.plan.guns.length, len: L.length, crew: g.naval.crews.get(L)?.length, colliders: L.plan.colliders.length };
});
console.log(JSON.stringify(info));
const views = [[-90, 30, 70], [0, 12, 30], [60, 55, 0]];
for (const [dx, dy, dz] of views) {
  await page.evaluate(([dx, dy, dz]) => { const g = SC.game, L = window.__L; for (let i = 0; i < 30; i++) g.step(1 / 30); const c = L.model.localToWorld(new SC.THREE.Vector3(dx, dy, dz)); g.freeCam = true; g.camera.position.copy(c); g.camera.lookAt(L.model.localToWorld(new SC.THREE.Vector3(0, 18, 0))); g.camera.updateMatrixWorld(); SC.render(3); }, [dx, dy, dz]);
  const f = path.join(shots, `lev-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
for (let k = 0; k < 3; k++) {
  const r = await page.evaluate(() => {
    const g = SC.game, L = window.__L;
    const t0 = performance.now();
    for (let i = 0; i < 20 * 30; i++) g.step(1 / 30);
    const ms = (performance.now() - t0) / 600;
    const foes = [...g.naval.spawned].filter((s) => s.side === 'ironreach');
    const f0 = foes[0];
    const c = L.pos.clone().lerp(f0 ? f0.pos : L.pos, 0.5);
    g.freeCam = true; g.camera.position.set(c.x + 150, 80, c.z + 150); g.camera.lookAt(c.x, 10, c.z); g.camera.updateMatrixWorld(); SC.render(3);
    return `step ${ms.toFixed(1)}ms  L hp ${L.hp.toFixed(2)} reload ${(L.reload[1] + L.reload[-1]).toFixed(0)} balls ${g.war.balls.length} | ` + foes.map((s) => `${s.cls} hp${s.hp.toFixed(2)} d${s.pos.distanceTo(L.pos).toFixed(0)}`).join(' ');
  });
  console.log(r);
  const f = path.join(shots, `lev-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'leviathan.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
