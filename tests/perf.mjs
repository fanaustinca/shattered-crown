// Performance profile on the real GPU: per view, CPU step time, CPU render-submit time, GPU-synced frame time,
// draw calls (split main/shadow), triangles. Usage: GPU=1 node tests/perf.mjs [quality] [viewFilter]
import { launch, openPage, serve } from './harness.mjs';

const quality = process.argv[2] || 'ultra';
const filter = process.argv[3] || '';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=${quality}`, { width: 1920, height: 1080 });
await page.evaluate(() => { SC.game.manual = true; });

const VIEWS = [
  { name: 'aurel-street', setup: 'SC.teleport(-1250+8, 350+10); SC.stream(-1250,350); SC.advance(3);', play: true },
  { name: 'aurel-over', setup: "SC.stream(-1250,350); SC.view(-1250+60,'g+25',350+50,-1250,'g+3',350);" },
  { name: 'millbrook', setup: "SC.teleport(-620+6, 940+6); SC.stream(-620,940); SC.advance(3);", play: true },
  { name: 'plains', setup: "SC.view(-900,'g+1.7',300,-800,'g+1.5',250);" },
  { name: 'forest', setup: "SC.view(700,'g+2',-1300,760,'g+6',-1350);" },
  { name: 'ironspire', setup: "SC.stream(1480,-520); SC.view(1480-80,'g+30',-520+80,1480,'g+3',-520);" },
  { name: 'aerial', setup: 'SC.view(-2500,1800,3500,0,0,0);' },
].filter((v) => v.name.includes(filter));

for (const v of VIEWS) {
  const r = await page.evaluate(async (v) => {
    const g = SC.game;
    g.freeCam = false;
    SC.setTime(11);
    eval(v.setup);
    const gl = g.renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // warm up (shader compile, streaming)
    for (let i = 0; i < 8; i++) { if (v.play) g.step(1 / 60); g.renderFrame(); }
    sync();
    const N = 30; let step = 0, submit = 0, total = 0;
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      if (v.play) g.step(1 / 60);
      const t1 = performance.now();
      g.renderFrame();
      const t2 = performance.now();
      sync();
      const t3 = performance.now();
      step += t1 - t0; submit += t2 - t1; total += t3 - t0;
    }
    // shadow pass share: render once with shadows forced vs disabled
    const info = g.renderer.info;
    const sm = g.renderer.shadowMap;
    const ae = sm.enabled;
    g.pipeline.shadowsDirty = true; g.renderFrame(); const withSh = g.pipeline.stats.calls;
    sm.enabled = false; g.renderFrame(); const noSh = g.pipeline.stats.calls; sm.enabled = ae; g.renderFrame();
    return { step: step / N, submit: submit / N, frame: total / N, calls: g.pipeline.stats.calls, shadowCalls: withSh - noSh, tris: g.pipeline.stats.tris, programs: info.programs.length, geos: info.memory.geometries, tex: info.memory.textures, live: g.settlements.live.size, npcs: g.residents.live.length, prof: Object.entries(g.prof).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ') };
  }, v);
  console.log(v.name.padEnd(13), `frame ${r.frame.toFixed(1)}ms  step ${r.step.toFixed(1)}  submit ${r.submit.toFixed(1)}  calls ${r.calls} (shadow ${r.shadowCalls})  tris ${(r.tris / 1e6).toFixed(1)}M  prog ${r.programs} geo ${r.geos} tex ${r.tex} live ${r.live} npc ${r.npcs}\n      ${r.prof}`);
}
for (const e of errors.slice(0, 5)) console.log('ERR', e.slice(0, 200));
await browser.close(); srv.close();
