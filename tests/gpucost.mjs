// GPU-synced frame cost with individual features toggled (ms saved = cost of that feature).
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1920, height: 1080 });
const view = process.argv[2] || 'plains';
const r = await page.evaluate((view) => {
  const g = SC.game; g.manual = true; SC.setTime(11);
  if (view === 'plains') SC.view(-900, 'g+1.7', 300, -800, 'g+1.5', 250);
  else if (view === 'town') { SC.stream(-620, 940); SC.view(-620 + 6, 'g+1.7', 940 + 6, -600, 'g+2', 980); }
  else if (view === 'forest') SC.view(700, 'g+2', -1300, 760, 'g+6', -1350);
  const gl = g.renderer.getContext(), px = new Uint8Array(4);
  const time = () => { for (let i = 0; i < 4; i++) g.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); for (let i = 0; i < 20; i++) { g.lighting.forceShadows = false; g.renderFrame(); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / 20; };
  const out = { base: time() };
  const tog = (name, on, off) => { off(); out[name] = +(out.base - time()).toFixed(2); on(); };
  tog('grass', () => g.grass.meshes.forEach((m) => (m.visible = true)), () => g.grass.meshes.forEach((m) => (m.visible = false)));
  tog('trees', () => (g.trees.group.visible = true), () => (g.trees.group.visible = false));
  tog('terrain', () => (g.terrain.mesh.visible = true), () => (g.terrain.mesh.visible = false));
  tog('water', () => { g.water.ocean.visible = true; g.water.river.visible = true; }, () => { g.water.ocean.visible = false; g.water.river.visible = false; });
  tog('shadows', () => (g.renderer.shadowMap.enabled = true), () => (g.renderer.shadowMap.enabled = false));
  const au = g.pipeline.atmoUniforms; const cc = au.uCloudCover.value;
  tog('clouds', () => (au.uCloudCover.value = cc), () => (au.uCloudCover.value = 0));
  tog('settlements', () => { g.settlements.shells.group.visible = true; g.settlements.structures.visible = true; g.settlements.lod.visible = true; }, () => { g.settlements.shells.group.visible = false; g.settlements.structures.visible = false; g.settlements.lod.visible = false; });
  const pl = g.pipeline; const bl = pl.bloom; tog('bloom', () => (pl.bloom = bl), () => (pl.bloom = null));
  const gr = pl.q.godrays; tog('godrays', () => (pl.q.godrays = gr), () => (pl.q.godrays = false));
  out.tris = g.pipeline.stats.tris; out.calls = g.pipeline.stats.calls;
  return out;
}, view);
console.log(view, JSON.stringify(r));
await browser.close(); srv.close();
