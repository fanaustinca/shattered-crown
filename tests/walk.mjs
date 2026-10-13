import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=low', { width: 640, height: 360 });
const r = await page.evaluate(() => {
  SC.game.manual = true;
  const a = SC.player();
  SC.hold(['KeyW'], 3);
  const b = SC.player();
  SC.hold(['KeyW', 'ShiftLeft'], 3);
  const c = SC.player();
  SC.tap('Space'); SC.hold([], 0.3); const j = SC.player(); SC.hold([], 1.5); const d = SC.player();
  // swim: teleport into the river
  const z = -200, rx = 60 + 140 * Math.sin(z / 610 + 0.4) + 55 * Math.sin(z / 233 + 1.3) + 18 * Math.sin(z / 97 + 2.1);
  SC.teleport(rx, z); SC.hold([], 2); const e = SC.player();
  SC.hold(['KeyW'], 2); const f = SC.player();
  return { a, b, c, j, d, e, f };
});
console.log(JSON.stringify(r, null, 1));
console.log(errors.slice(0, 5));
await b.close();
