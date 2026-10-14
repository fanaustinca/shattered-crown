// Look up and down the staircases of a few two-storey houses (headroom, beams, banisters).
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1280, height: 720 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
for (let k = 0; k < 3; k++) {
  for (const which of ['up', 'mid']) {
    await page.evaluate((k, which) => {
      const g = SC.game; g.manual = true; SC.setTime(12);
      const bs = g.towns.plans[0].buildings.filter((q) => q.spec.floors > 1 && ['house', 'tavern', 'shop'].includes(q.spec.type));
      const b = bs[k * 7 % bs.length];
      SC.stream(b.x, b.z);
      const l = g.settlements.live.get(b.id);
      const st = l.model.stairs[0];
      const M = l.root.matrixWorld;
      const from = st.from.clone().applyMatrix4(M), to = st.to.clone().applyMatrix4(M);
      const T = SC.THREE;
      if (which === 'up') { const e = from.clone().lerp(to, -0.12); g.freeCam = true; g.camera.position.set(e.x, e.y + 1.65, e.z); g.camera.lookAt(to.x, to.y + 1.2, to.z); }
      else { const e = from.clone().lerp(to, 0.55); g.freeCam = true; g.camera.position.set(e.x, e.y + 1.65, e.z); g.camera.lookAt(to.x, to.y + 1.7, to.z); }
      g.camera.updateMatrixWorld();
      for (let i = 0; i < 4; i++) g.renderFrame();
    }, k, which);
    await page.screenshot({ path: `tests/screenshots/stairs-${k}-${which}.png` });
  }
}
console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 5).join('\n'));
await browser.close(); srv.close();
