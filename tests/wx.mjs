import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1280, height: 720 });
process.on('exit', () => console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 3).join('\n').slice(0, 600)));
for (const k of ['rain', 'overcast']) {
  const r = await page.evaluate((k) => { const g = SC.game; g.manual = true; weather(k); SC.setTime(10); for (let i = 0; i < 30; i++) { g.step(1 / 30); } SC.render(2); const au = g.pipeline.atmoUniforms; return { kind: g.weather.kind, cur: g.weather.cur, cover: au.uCloudCover.value, overcast: g.overcast, sky: SC.game.pipeline.atmoUniforms.uMist.value }; }, k);
  console.log(JSON.stringify(r));
  await page.screenshot({ path: `tests/screenshots/wx-${k}.png` });
}
const errs = await page.evaluate(() => 0); await browser.close(); srv.close();
