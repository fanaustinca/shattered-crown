import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1280, height: 720 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(2);
  const log = [];
  g.scene.traverse((o) => { if (!o.isBatchedMesh) return; for (const fn of ['setVisibleAt', 'addInstance', 'deleteInstance', 'deleteGeometry', 'optimize', 'setInstanceCount']) { const orig = o[fn].bind(o); o[fn] = (...a) => { log.push(fn + ' ' + new Error().stack.split('\n').slice(2, 5).map((l) => l.trim().split(' ')[1]).join('<')); return orig(...a); }; } });
  for (let i = 0; i < 3; i++) { g.step(1 / 60); g.renderFrame(); }
  return log.slice(0, 20);
});
console.log(r.join('\n'));
await browser.close(); srv.close();
