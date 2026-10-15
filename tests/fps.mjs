// Real frame rate with the normal rAF loop (no forced GPU sync): GPU=1 node tests/fps.mjs [quality] [w] [h]
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const q = process.argv[2] || 'ultra', W = +(process.argv[3] || 1920), H = +(process.argv[4] || 1080);
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=${q}`, { width: W, height: H });
const spots = [
  ['aurel-street', 'SC.teleport(-1250+8, 350+10); SC.stream(-1250,350);'],
  ['millbrook', 'SC.teleport(-620+6, 940+6); SC.stream(-620,940);'],
  ['plains', "SC.teleport(-900, 300);"],
  ['forest', "SC.teleport(720, -1320);"],
  ['ironspire', 'SC.teleport(1480-20, -520+20); SC.stream(1480,-520);'],
];
for (const [name, setup] of spots) {
  const r = await page.evaluate(async (setup) => {
    const g = SC.game; g.manual = true; SC.setTime(11); try { weather('clear'); } catch {} eval(setup); g.freeCam = false;
    for (let i = 0; i < 30; i++) { g.step(1 / 60); g.renderFrame(); }
    g.manual = false;
    await new Promise((r) => setTimeout(r, 1500));
    const t0 = performance.now(); let n = 0, worst = 0, last = t0;
    await new Promise((res) => { const f = () => { const t = performance.now(); worst = Math.max(worst, t - last); last = t; n++; if (t - t0 < 4000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    g.manual = true;
    return { fps: n / ((performance.now() - t0) / 1000), worst, prof: 'opaque ' + g.pipeline.cpu.opaque.toFixed(1) + ' water ' + g.pipeline.cpu.water.toFixed(1) + ', ' + Object.entries(g.prof).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ') };
  }, setup);
  console.log(name.padEnd(13), `${r.fps.toFixed(1)} fps  worst ${r.worst.toFixed(0)}ms   ${r.prof}`);
}
await browser.close(); srv.close();
