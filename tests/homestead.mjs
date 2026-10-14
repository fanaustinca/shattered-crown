import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1600, height: 900 });
const shots = [
  ['homestead', (SC) => { const p = SC.game.towns.plans.filter((p) => p.minor && p.buildings.length > 1 && p.site.kingdom === 'vanguardia')[3]; SC.stream(p.site.x, p.site.z); SC.view(p.site.x + 40, 'g+14', p.site.z + 34, p.site.x, 'g+2', p.site.z); }],
  ['homestead-iron', (SC) => { const p = SC.game.towns.plans.filter((p) => p.minor && p.site.kingdom === 'ironreach')[5]; SC.stream(p.site.x, p.site.z); SC.view(p.site.x - 38, 'g+12', p.site.z + 30, p.site.x, 'g+2', p.site.z); }],
  ['village-lane', (SC) => { const s = SC.site('millbrook').site; SC.stream(s.x, s.z); SC.view(s.x + 30, 'g+28', s.z - 50, s.x, 'g+1', s.z + 10); }],
  ['aurel-far', (SC) => { const s = SC.site('aurelhold').site; SC.view(s.x + 520, 'g+60', s.z + 260, s.x, 'g+10', s.z); }],
];
for (const [name, fn] of shots) {
  await page.evaluate((src) => { SC.game.manual = true; SC.setTime(10.5); eval('(' + src + ')')(SC); SC.render(3); }, fn.toString());
  await page.screenshot({ path: `tests/screenshots/${name}.png` });
}
await browser.close(); srv.close();
