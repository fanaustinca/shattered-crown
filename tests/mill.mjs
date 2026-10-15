import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 600 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(10.5); weather('clear');
  const e = SC.game.towns.plans.flatMap((p) => p.extras.filter((e) => e.kind === 'windmill'))[1];
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  g.player.spawn(e.x + fx * 25, e.z + fz * 25); SC.stream(e.x, e.z); for (let i = 0; i < 40; i++) g.step(1 / 30);
  const y = g.world.heightAt(e.x, e.z);
  g.freeCam = true; g.camera.position.set(e.x + fx * 22 + fz * 8, y + 5, e.z + fz * 22 - fx * 8); g.camera.lookAt(e.x, y + 7, e.z); g.camera.updateMatrixWorld(); SC.render(3);
});
await page.screenshot({ path: path.join(shots, 'mill.png') });
await b.close(); srv.close();
