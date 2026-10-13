import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1280, height: 720 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(2);
  const out = {};
  for (const c of g.scene.children) {
    let n = 0, auto = 0, bones = 0; c.traverse((o) => { n++; if (o.matrixAutoUpdate) auto++; if (o.isBone) bones++; });
    const hint = c === g.props.group ? 'props' : c === g.settlements.structures ? 'structures' : c === g.settlements.lod ? 'lod' : [...g.settlements.live.values()].some((l) => l.root === c) ? 'buildingRoot' : (c.name || c.type) + ':' + (c.children[0]?.type ?? '');
    const k = hint; out[k] ??= [0, 0, 0, 0]; out[k][0]++; out[k][1] += n; out[k][2] += auto; out[k][3] += bones;
  }
  return Object.entries(out).sort((a, b) => b[1][1] - a[1][1]).slice(0, 20);
});
for (const [k, [c, n, a, b]] of r) console.log(String(n).padStart(6), String(a).padStart(6), String(b).padStart(6), c, k);
await browser.close(); srv.close();
