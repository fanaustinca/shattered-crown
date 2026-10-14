// Close side views of a horse: standing, walking, galloping (several phases), and ridden by the player.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 480 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(10.5); });
const files = [];
const shotsList = [['idle', 0, 0], ['walk', 1.5, 0.3], ['trot', 3.4, 0.2], ['canter', 6, 0.2], ['gal0', 11, 0], ['gal1', 11, 0.25], ['gal2', 11, 0.5], ['gal3', 11, 0.75]];
for (const [n, speed, ph] of shotsList) {
  await page.evaluate(([speed, ph]) => {
    const g = SC.game, T = SC.THREE;
    // open ground east of the capital
    const x0 = -900, z0 = 120;
    g.player.spawn(x0 + 40, z0 + 40);
    SC.studio('horse', 0, 'idle', 0.1, 0, 0.95);
    const s = g.__studio, A = s.anim;
    const freq = speed > 0 ? A.gait(speed).freq : 1, dt = 1 / 240;
    const ms = { pos: new T.Vector3(x0, g.world.heightAt(x0, z0), z0), yaw: Math.PI / 2, speed, turn: 0, vel: new T.Vector3(), action: 'idle', look: null };
    A.initFeet = true;
    const total = 2 + (speed > 0 ? ph / freq : 0);
    for (let t = 0; t < total; t += dt) { ms.pos.x += speed * dt; ms.pos.y = g.world.heightAt(ms.pos.x, ms.pos.z); A.update(dt, ms); }
    s.rig.root.updateMatrixWorld(true);
    const c = s.rig.root.position;
    g.camera.position.set(c.x, c.y + 1.3, c.z + 4.6); g.camera.lookAt(c.x, c.y + 1.15, c.z); g.camera.updateMatrixWorld();
    SC.render(2);
  }, [speed, ph]);
  const f = path.join(shots, `hh-${n}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(480, 360).toBuffer(), left: (i % 4) * 480, top: Math.floor(i / 4) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'horsehead.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
