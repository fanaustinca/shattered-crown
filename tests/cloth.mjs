// Cloth QA: find dressed residents near the square, film them walking.
import { launch, openPage, serve } from './harness.mjs';
import path from 'node:path';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1280, height: 720 });
const info = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350);
  for (let i = 0; i < 120; i++) { g.step(1 / 60); g.renderFrame(); }
  const cl = g.cloth.cloths;
  return { total: cl.length, sim: cl.filter((c) => c.simulated).length };
});
console.log(info);
for (let k = 0; k < 4; k++) {
  await page.evaluate((k) => {
    const g = SC.game;
    const n = g.residents.live.filter((n) => n.person.variant === 2 && n.st.speed > 0.5).sort((a, b) => a.st.pos.distanceTo(g.player.pos) - b.st.pos.distanceTo(g.player.pos))[k % 3] ?? g.residents.live.find((n) => n.person.variant === 2);
    if (!n) return;
    for (let i = 0; i < 20; i++) { g.step(1 / 60); g.renderFrame(); }
    const p = n.st.pos, yaw = n.st.yaw + Math.PI / 2 + k * 0.5;
    g.freeCam = true;
    g.camera.position.set(p.x + Math.sin(yaw) * 2.6, p.y + 1.1, p.z + Math.cos(yaw) * 2.6);
    g.camera.lookAt(p.x, p.y + 0.7, p.z);
    g.renderFrame(); g.freeCam = false;
  }, k);
  await page.screenshot({ path: path.join('tests/screenshots', `cloth-${k}.png`) });
}
console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 5).join('\n'));
await browser.close(); srv.close();
