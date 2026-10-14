// Riding and looking about: the rider's body should stay square to the horse while the head/shoulders turn.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 480 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(10.5); });
const files = [];
for (const [k, look] of [[0, 0], [1, 1.2], [2, -1.2], [3, 2.6]].map((x) => x)) {
  const info = await page.evaluate(([k, look]) => {
    const g = SC.game, T = SC.THREE;
    if (k === 0) {
      const x0 = -900, z0 = 120; g.player.spawn(x0, z0); SC.stream(x0, z0);
      for (let i = 0; i < 30; i++) g.step(1 / 30);
      const h = g.spawnAnimal('horse', new T.Vector3(x0 + 2, g.world.heightAt(x0 + 2, z0), z0));
      h.st.yaw = Math.PI / 2; h.mount(g.player);
      for (let i = 0; i < 30; i++) g.step(1 / 30);
      window.__h = h;
    }
    const h = window.__h;
    g.player.yaw = h.st.yaw + Math.PI + look; g.player.pitch = 0;
    for (let i = 0; i < 10; i++) g.step(1 / 30);
    // view from the side, independent of the player's look
    const c = h.st.pos;
    g.player.thirdPerson = false;
    g.freeCam = true;
    g.camera.position.set(c.x + 0.5, c.y + 2.4, c.z + 5); g.camera.lookAt(c.x, c.y + 1.8, c.z); g.camera.updateMatrixWorld();
    SC.render(2);
    return { horseYaw: h.st.yaw.toFixed(2), bodyYaw: g.playerBody.rig.root.rotation.y.toFixed(2) };
  }, [k, look]);
  console.log(k, JSON.stringify(info));
  const f = path.join(shots, `ride-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(480, 360).toBuffer(), left: (i % 4) * 480, top: 0 })));
await sharp({ create: { width: 1920, height: 360, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'ridelook.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
