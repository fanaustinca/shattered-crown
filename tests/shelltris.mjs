import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 640, height: 360 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350);
  let tris = 0, n = 0; const byType = {};
  for (const l of g.settlements.live.values()) { n++; let t = 0; for (const [, geo] of l.model.exterior.build()) t += (geo.index?.count ?? 0) / 3; tris += t; const k = l.placed.spec.type; byType[k] = byType[k] ?? [0, 0]; byType[k][0]++; byType[k][1] += t; }
  let lodTris = 0; for (const m of g.settlements.lod.children) lodTris += (m.geometry.index?.count ?? 0) / 3;
  let structTris = 0; for (const m of g.settlements.structures.children) structTris += (m.geometry.index?.count ?? 0) / 3;
  return { n, tris, avg: tris / n, byType: Object.fromEntries(Object.entries(byType).map(([k, [c, t]]) => [k, Math.round(t / c)])), lodTris, structTris };
});
console.log(r);
await browser.close(); srv.close();
