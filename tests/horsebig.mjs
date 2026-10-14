// One big close render of a creature standing (side, 3/4 front, 3/4 rear) for model quality checks.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const id = process.argv[2] || 'horse';
const speed = +(process.argv[3] || 0);
const DIST = +(process.argv[4] || 3.6), LOOKY = +(process.argv[5] || 0.9);
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 960, height: 720 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(10.5); });
const files = [];
for (const [n, ang, h] of [['side', 0, 0.3], ['front34', 0.9, 0.35], ['rear34', -2.3, 0.4]]) {
  await page.evaluate(([id, ang, h, speed, DIST, LOOKY]) => {
    const g = SC.game, T = SC.THREE;
    const x0 = -900, z0 = 120;
    g.player.spawn(x0 + 40, z0 + 40);
    SC.studio(id, 0, 'idle', 0.1, 0, 0.95);
    const s = g.__studio, A = s.anim;
    const ms = { pos: new T.Vector3(x0, g.world.heightAt(x0, z0), z0), yaw: Math.PI / 2, speed, turn: 0, vel: new T.Vector3(), action: 'idle', look: null };
    A.initFeet = true;
    for (let t = 0; t < 2; t += 1 / 120) { ms.pos.x += speed / 120; ms.pos.y = g.world.heightAt(ms.pos.x, ms.pos.z); A.update(1 / 120, ms); }
    s.rig.root.updateMatrixWorld(true);
    const c = s.rig.root.position.clone(); c.y += LOOKY;
    const d = DIST;
    g.camera.position.set(c.x + Math.sin(ang) * d, c.y + h, c.z + Math.cos(ang) * d); g.camera.lookAt(c); g.camera.updateMatrixWorld();
    SC.render(3);
  }, [id, ang, h, speed, DIST, LOOKY]);
  const f = path.join(shots, `big-${id}-${n}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 480).toBuffer(), left: i * 640, top: 0 })));
await sharp({ create: { width: 1920, height: 480, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `big-${id}.png`));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
