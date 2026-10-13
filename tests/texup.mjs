import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1280, height: 720 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(2);
  for (let i = 0; i < 5; i++) { g.step(1 / 60); g.renderFrame(); }
  const gl = g.renderer.getContext();
  const orig = gl.texSubImage2D.bind(gl), sizes = {};
  gl.texSubImage2D = function (...a) { const k = a[4] + 'x' + a[5]; sizes[k] = (sizes[k] ?? 0) + 1; return orig(...a); };
  for (let i = 0; i < 5; i++) { g.step(1 / 60); g.renderFrame(); }
  gl.texSubImage2D = orig;
  return sizes;
});
console.log(r);
await browser.close(); srv.close();
