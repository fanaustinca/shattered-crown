// A sea battle: two squadrons offshore. Do they close, fire, hit and sink? Screenshots along the way.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { const g = SC.game; g.manual = true; SC.setTime(15); weather('cloudy'); g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30); window.__c = g.naval.startBattle(); });
const files = [];
for (let k = 0; k < 6; k++) {
  const r = await page.evaluate(() => {
    const g = SC.game;
    let shots = 0; const b0 = g.war.balls.length;
    for (let i = 0; i < 60 * 30; i++) { g.step(1 / 60); }
    const fleet = [...g.naval.spawned];
    const c = fleet.reduce((a, s) => a.add(s.pos), new SC.THREE.Vector3()).multiplyScalar(1 / Math.max(1, fleet.length));
    const a = fleet[0];
    g.freeCam = true; g.camera.position.set(c.x + 160, 70, c.z + 160); g.camera.lookAt(c.x, 5, c.z); g.camera.updateMatrixWorld();
    SC.render(3);
    return fleet.map((s) => `${s.side[0]}:${s.cls[0]} hp${s.hp.toFixed(2)} v${Math.hypot(s.body.linvel().x, s.body.linvel().z).toFixed(1)} r${(s.reload[1] + s.reload[-1]).toFixed(0)}`).join(' | ') + `  dist ${fleet.length > 2 ? fleet[0].pos.distanceTo(fleet[2].pos).toFixed(0) : '-'}`;
  });
  console.log(`t=${(k + 1) * 30}s`, r);
  const f = path.join(shots, `sea-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'seabattle.png'));
console.log(errors.slice(0, 8).join('\n'));
await b.close(); srv.close();
