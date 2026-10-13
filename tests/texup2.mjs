import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1920, height: 1080 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(3);
  for (let i = 0; i < 90; i++) { g.step(1 / 60); g.renderFrame(); }
  const gl = g.renderer.getContext();
  const orig = gl.texSubImage2D, out = {};
  const texOf = new Map();
  gl.texSubImage2D = function (...a) {
    const t0 = performance.now(); const r = orig.apply(gl, a); const dt = performance.now() - t0;
    const k = a[4] + 'x' + a[5] + ' type' + a[7] + ' ' + (a[8]?.constructor?.name ?? '');
    out[k] ??= [0, 0]; out[k][0]++; out[k][1] += dt; return r;
  };
  for (let i = 0; i < 40; i++) { g.step(1 / 60); g.renderFrame(); }
  gl.texSubImage2D = orig;
  return out;
});
console.log(r);
await browser.close(); srv.close();
