// Sail each class with the wind on the quarter for a minute; fire a broadside; screenshots under full sail.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const files = [];
for (const cls of ['brigantine', 'frigate', 'manowar']) {
  const r = await page.evaluate((cls) => {
    const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(14); weather('cloudy');
    const sh = g.ships.find((s) => s.cls === cls && s.side === 'ironreach') ?? g.ships.find((s) => s.cls === cls);
    window.__sh = sh;
    // head her out to sea (away from the land), the wind on her starboard quarter
    const out = new T.Vector3(sh.pos.x, 0, sh.pos.z).normalize();
    const yaw = Math.atan2(-out.z, out.x);
    sh.body.setRotation(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw), true);
    const fwd = sh.forward(); const wa = Math.atan2(fwd.z, fwd.x) + 0.7; g.weather.windDir = wa;
    sh.anchored = false; for (const s of sh.sails) s.target = 1; sh.trim = 0;
    g.player.spawn(sh.pos.x + 90, sh.pos.z + 90);
    const p0 = sh.pos.clone();
    let vmax = 0;
    for (let i = 0; i < 60 * 60; i++) { g.weather.windDir = Math.atan2(sh.forward().z, sh.forward().x) + 0.7; g.step(1 / 60); if (i % 60 === 0) vmax = Math.max(vmax, Math.hypot(sh.body.linvel().x, sh.body.linvel().z)); }
    const balls0 = g.war.balls.length;
    sh.broadside(1, true);
    return { cls, moved: +sh.pos.distanceTo(p0).toFixed(0), vmax: +vmax.toFixed(2), knots: +(vmax * 1.94).toFixed(1), set: +sh.sailSet.toFixed(2) };
  }, cls);
  console.log(JSON.stringify(r));
  await new Promise((res) => setTimeout(res, 3500));
  await page.evaluate(() => {
    const g = SC.game, sh = window.__sh, T = SC.THREE;
    for (let i = 0; i < 30; i++) g.step(1 / 60);
    const W = (x, y, z) => new T.Vector3(x, y, z).applyQuaternion(sh.quat).add(sh.pos);
    const L = sh.length;
    const eye = W(L * 0.4, L * 0.45, L * 1.4), at = W(0, sh.deckY + L * 0.3, 0);
    g.freeCam = true; g.camera.position.copy(eye); g.camera.lookAt(at); g.camera.updateMatrixWorld();
    SC.render(3);
  });
  const f = path.join(shots, `sail-${cls}.png`); await page.screenshot({ path: f }); files.push(f);
  const r2 = await page.evaluate(() => SC.game.war.balls.length);
  console.log('balls in flight', r2);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: i * 640, top: 0 })));
await sharp({ create: { width: 1920, height: 360, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'sailing.png'));
console.log(errors.slice(0, 8).join('\n'));
await b.close(); srv.close();
