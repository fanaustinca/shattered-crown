// Close strip of a person walking, running, idling (fidgets) and talking: side view, portrait crops.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const id = process.argv[2] || 'human0';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 900, height: 900 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(10.5); });
const rows = [['walk', 1.4, 0, 0.5], ['run', 4.6, 0, 0.5], ['idle', 0, 0, 2.5], ['talk', 0, 1, 0.4]];
const files = [];
for (const [name, speed, talk, stepT] of rows) {
  for (let k = 0; k < 6; k++) {
    await page.evaluate(([id, speed, talk, k, stepT]) => {
      const g = SC.game, T = SC.THREE;
      const x0 = -900, z0 = 120;
      if (k === 0) {
        g.player.spawn(x0 + 40, z0 + 40);
        SC.studio(id, 0, 'idle', 0.1, 0, 0.95);
        window.__ms = { pos: new T.Vector3(x0, g.world.heightAt(x0, z0), z0), yaw: Math.PI / 2, speed, turn: 0, vel: new T.Vector3(), action: 'idle', look: null };
        g.__studio.anim.talking = talk;
        for (let t = 0; t < 1.5; t += 1 / 120) { __ms.pos.x += speed / 120; __ms.pos.y = g.world.heightAt(__ms.pos.x, __ms.pos.z); g.__studio.anim.update(1 / 120, __ms); }
      }
      const A = g.__studio.anim;
      const freq = speed > 0 ? 0.75 + speed * 0.32 : 1;
      const T2 = speed > 0 ? 1 / freq / 6 : stepT;
      for (let t = 0; t < T2; t += 1 / 120) { __ms.pos.x += speed / 120; __ms.pos.y = g.world.heightAt(__ms.pos.x, __ms.pos.z); A.update(1 / 120, __ms); }
      g.__studio.rig.root.updateMatrixWorld(true);
      const c = g.__studio.rig.root.position;
      g.camera.position.set(c.x + 0.4, c.y + 1.05, c.z + 2.6); g.camera.lookAt(c.x, c.y + 0.92, c.z); g.camera.updateMatrixWorld();
      SC.render(2);
    }, [id, speed, talk, k, stepT]);
    const f = path.join(shots, `hw-${name}-${k}.png`);
    await page.screenshot({ path: f, clip: { x: 270, y: 60, width: 360, height: 780 } }); files.push(f);
  }
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(240, 520).toBuffer(), left: (i % 6) * 240, top: Math.floor(i / 6) * 520 })));
await sharp({ create: { width: 1440, height: 520 * rows.length, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `humanwalk-${id}.png`));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
