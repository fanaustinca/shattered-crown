import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?quality=high`, { width: 1600, height: 900 });
await page.waitForSelector('.title .go', { timeout: 120000 });
await page.click('.title .go');
await new Promise((r) => setTimeout(r, 1500));
const m = await page.evaluate(async () => { const g = SC.game; g.music.silence = 0; await new Promise((r) => setTimeout(r, 1500)); return { ctx: !!g.audio.ctx, state: g.audio.ctx?.state, playing: (g.music.playingUntil ?? 0) > (g.audio.ctx?.currentTime ?? 0) }; });
console.log('music', m);
for (const [name, kind, t] of [['sea-calm', 'clear', 11], ['sea-storm', 'storm', 15]]) {
  await page.evaluate((kind, t) => {
    const g = SC.game; g.manual = true;
    weather(kind); SC.setTime(t);
    const ship = g.ships.find((s) => s.cls === 'manowar') ?? g.ships.find((s) => s.kind === 'ship');
    let rmax = 0, pmax = 0;
    for (let i = 0; i < 240; i++) { g.weather.update(1 / 60 * 50); g.step(1 / 60); }
    for (let i = 0; i < 1200; i++) { g.step(1 / 60); const e = new SC.THREE.Euler().setFromQuaternion(ship.quat, 'YXZ'); rmax = Math.max(rmax, Math.abs(e.x)); pmax = Math.max(pmax, Math.abs(e.z)); }
    const p = ship.pos;
    g.freeCam = true;
    g.camera.position.set(p.x + 75, p.y + 18, p.z + 60); g.camera.lookAt(p.x, p.y + 8, p.z);
    for (let i = 0; i < 2; i++) g.renderFrame();
    window.__roll = [rmax, pmax, g.weather.cur.wind, SC.game && 0];
  }, kind, t);
  await page.screenshot({ path: `tests/screenshots/${name}.png` });
  console.log(name, await page.evaluate(() => window.__roll.map((v) => v.toFixed(3))));
}
console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 5).join('\n'));
await browser.close(); srv.close();
