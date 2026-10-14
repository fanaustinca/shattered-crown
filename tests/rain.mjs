// Rain visibility: a storm seen in a street, over open fields and against the sky.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=${process.env.Q ?? 'high'}`, { width: 1600, height: 900 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const views = (process.env.VIEWS ?? 'field,street,sky').split(',');
for (const v of views) {
  await page.evaluate(async (v) => {
    const g = SC.game; g.manual = true;
    weather('storm'); SC.setTime(13);
    const s = g.towns.plans[0].site;
    if (v === 'street') g.player.spawn(s.x + 6, s.z + 30);
    else g.player.spawn(s.x + 420, s.z + 260);
    for (let i = 0; i < 120; i++) { g.weather.update(1); g.step(1 / 60); }
    g.player.pitch = v === 'sky' ? 0.35 : 0.02;
    for (let i = 0; i < 30; i++) { g.step(1 / 60); g.renderFrame(); }
  }, v);
  await page.screenshot({ path: `tests/screenshots/rain-${v}.png` });
}
console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 5).join('\n'));
await browser.close(); srv.close();
