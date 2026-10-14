import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1600, height: 900 });
const r = await page.evaluate(() => {
  const g = SC.game;
  const minor = g.towns.plans.filter((p) => p.minor);
  const ir = SC.site('ironspire');
  const out = ir.buildings.filter((b) => Math.hypot(b.x - ir.site.x, b.z - ir.site.z) > ir.site.r);
  return { homesteads: minor.length, homesteadBuildings: minor.reduce((s, p) => s + p.buildings.length, 0), plans: g.towns.plans.filter((p) => !p.minor).map((p) => p.site.id + ':' + p.buildings.length).join(' '), ironOutside: out.length, people: g.towns.people.length, sample: out.slice(0, 3).map((b) => [Math.round(b.x), Math.round(b.z), Math.round(b.y)]) };
});
console.log(r);
// view up the road to Ironspire
await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(14.5);
  const ir = SC.site('ironspire');
  const out = ir.buildings.filter((b) => Math.hypot(b.x - ir.site.x, b.z - ir.site.z) > ir.site.r + 60);
  const b = out[Math.floor(out.length / 2)] ?? out[0];
  SC.stream(b.x, b.z);
  const dx = ir.site.x - b.x, dz = ir.site.z - b.z, l = Math.hypot(dx, dz);
  SC.view(b.x - dx / l * 70, 'g+22', b.z - dz / l * 70, ir.site.x, 'g+10', ir.site.z);
  SC.render(3);
});
await page.screenshot({ path: 'tests/screenshots/ironspire-road.png' });
await browser.close(); srv.close();
