import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const q = process.argv[2] || 'ultra';
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=${q}`, { width: 1920, height: 1080 });
const spots = { aurel: 'SC.teleport(-1250+8, 350+10); SC.stream(-1250,350);', millbrook: 'SC.teleport(-620+6, 940+6); SC.stream(-620,940);', plains: 'SC.teleport(-900, 300);' };
for (const [name, setup] of Object.entries(spots)) {
  const r = await page.evaluate(async (setup) => {
    const g = SC.game; g.manual = true; SC.setTime(11); eval(setup); g.freeCam = false;
    for (let i = 0; i < 40; i++) { g.step(1 / 60); g.renderFrame(); }
    const gl = g.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return 'no timer ext';
    const res = [];
    for (let i = 0; i < 10; i++) {
      g.step(1 / 60);
      const qq = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq); g.renderFrame(); gl.endQuery(ext.TIME_ELAPSED_EXT);
      res.push(qq);
    }
    await new Promise((r) => setTimeout(r, 500));
    const ms = res.map((qq) => gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE) ? gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6 : -1);
    return ms.map((x) => x.toFixed(1)).join(' ');
  }, setup);
  console.log(name, r);
}
await browser.close(); srv.close();
