// Gallop strip: one horse cycle in 8 frames from the side (plus canter/trot rows) into a contact sheet.
//   GPU=1 node tests/gallop.mjs [species]
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const id = process.argv[2] || 'horse';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 480, height: 360 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(10.5); });
const rows = id.startsWith('human') ? [['run', 4.6], ['walk', 1.4], ['idle', 0]] : [['gallop', 11], ['canter', 6], ['trot', 3.4], ['walk', 1.5]];
const files = [];
for (const [name, speed] of rows) {
  for (let k = 0; k < 8; k++) {
    await page.evaluate(([id, speed, k]) => {
      const g = SC.game; const st = g.__studio;
      // advance to a known phase: settle 2 s, then step to frame k of the cycle
      SC.studio(id, speed, 'idle', 2.0, 0, 0.95);
      const s = g.__studio; const A = s.anim;
      const freq = A.gait ? A['gait'](speed).freq : speed > 0 ? 0.75 + speed * 0.32 : 0.125;
      const dt = 1 / 240, T = (k / 8) / freq;
      const pos = s.rig.root.position.clone();
      const ms = { pos: new SC.THREE.Vector3(pos.x, SC.game.world.heightAt(pos.x, pos.z), pos.z), yaw: Math.PI / 2, speed, turn: 0, vel: new SC.THREE.Vector3(), action: 'idle', look: null };
      for (let t = 0; t < T; t += dt) { ms.pos.x += speed * dt; ms.pos.y = SC.game.world.heightAt(ms.pos.x, ms.pos.z); A.update(dt, ms); }
      s.rig.root.updateMatrixWorld(true);
      const c = s.rig.root.position;
      const hum = id.startsWith('human'); g.camera.position.set(c.x, c.y + (hum ? 1.1 : 1.2), c.z + (hum ? 3.0 : 5.2)); g.camera.lookAt(c.x, c.y + (hum ? 1.0 : 1.0), c.z); g.camera.updateMatrixWorld();
      SC.render(2);
    }, [id, speed, k]);
    const f = path.join(shots, `gal-${name}-${k}.png`);
    await page.screenshot({ path: f }); files.push(f);
  }
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(240, 180).toBuffer(), left: (i % 8) * 240, top: Math.floor(i / 8) * 180 })));
await sharp({ create: { width: 1920, height: 180 * rows.length, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `gallop-${id}.png`));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
