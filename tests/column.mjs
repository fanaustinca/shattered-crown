import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1280, height: 720 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(10);
  SC.teleport(-500, 520); // near the Bridgewatch approach road
  for (let i = 0; i < 10; i++) { g.step(1 / 60); g.renderFrame(); }
  const n = g.war.spawnColumn('vanguardia', 18, g.player.pos);
  for (let i = 0; i < 240; i++) { g.step(1 / 60); g.renderFrame(); }
  const col = g.war.soldiers.filter((s) => s.marching);
  const sb = g.war.soldiers.find((s) => s.standard) ?? col[0];
  const c = col.reduce((a, s) => a.add(s.st.pos), new SC.THREE.Vector3()).multiplyScalar(1 / Math.max(1, col.length));
  const fwd = sb.path[0] ? sb.path[0].clone().sub(sb.st.pos).setY(0).normalize() : new SC.THREE.Vector3(1, 0, 0);
  g.freeCam = true;
  g.camera.position.set(c.x + fwd.x * 14 + fwd.z * 7, c.y + 3, c.z + fwd.z * 14 - fwd.x * 7); g.camera.lookAt(c.x, c.y + 1.2, c.z);
  for (let i = 0; i < 3; i++) { g.clothDt = 1 / 60; g.renderFrame(); }
  return { n, marching: col.length, dist: c.distanceTo(g.player.pos) };
});
console.log(r);
await page.screenshot({ path: 'tests/screenshots/column.png' });
console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 5).join('\n'));
await browser.close(); srv.close();
