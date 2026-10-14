// Market stalls: real wares on the counters (for sale), and a close look at one stall.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 900, height: 500 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11);
  const pl = SC.site('aurelhold'); const st = pl.stalls[2];
  g.player.spawn(st.x + 3, st.z + 3); SC.stream(st.x, st.z);
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  const wares = [...g.props.props].filter((p) => p.price && p.obj.position.distanceTo(new T.Vector3(st.x, p.obj.position.y, st.z)) < 2.5);
  const y0 = wares.map((p) => p.obj.position.y);
  for (const p of wares) p.body?.wakeUp();
  for (let i = 0; i < 120; i++) g.step(1 / 30);
  const dropped = wares.filter((p, i) => y0[i] - p.obj.position.y > 0.3).length;
  const c = new T.Vector3(st.x, g.world.heightAt(st.x, st.z), st.z);
  const f = new T.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw));
  g.freeCam = true; g.camera.position.copy(c).addScaledVector(f, 2.6).add(new T.Vector3(0, 1.7, 0)); g.camera.lookAt(c.x, c.y + 0.9, c.z); g.camera.updateMatrixWorld();
  SC.render(3);
  return { total: [...g.props.props].filter((p) => p.price).length, here: wares.length, dropped, ids: wares.map((p) => p.def.id + ':' + p.price).join(' ') };
});
console.log(JSON.stringify(r));
await page.screenshot({ path: path.join(shots, 'market.png') });
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
