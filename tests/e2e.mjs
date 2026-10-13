// CI smoke suite: builds are served from dist/, the world boots headless (SwiftShader in CI, GPU=1 locally)
// and the core systems are exercised through the window.SC debug API.
import { launch, openPage, serve, test, assert, summary, shot } from './harness.mjs';

const srv = await serve();
const port = srv.address().port;
const browser = await launch();
let page, errors;
console.log('Shattered Crown e2e');

await test('boots to a playable world', async () => {
  ({ page, errors } = await openPage(browser, `http://127.0.0.1:${port}/?test&quality=low`, { width: 640, height: 360 }));
  await page.evaluate(() => { SC.game.manual = true; });
  const r = await page.evaluate(() => SC.render(2));
  assert(r.calls > 0, 'nothing drawn');
});

await test('version and help are present', async () => {
  const v = await page.evaluate(() => SC.game.version ?? document.body.innerText.match(/v\d+\.\d+\.\d+/)?.[0]);
  assert(v, 'no version string');
  const help = await page.evaluate(() => { const g = SC.game; const ui = Object.values(g).find((o) => o && typeof o.openPause === 'function'); ui?.openPause('help'); const ok = document.querySelectorAll('.help .hs').length; ui?.close(); return ok; });
  assert(help >= 5, `help has ${help} sections`);
});

await test('player spawns on the ground in Aurelhold', async () => {
  const p = await page.evaluate(() => { SC.advance(1); return SC.player(); });
  assert(Math.abs(p.y - p.ground) < 2.5, `player floating/buried: y=${p.y} ground=${p.ground}`);
  assert(Math.hypot(p.x + 1250, p.z - 350) < 120, `player not in Aurelhold: ${p.x},${p.z}`);
});

await test('walking moves the player', async () => {
  const a = await page.evaluate(() => SC.player());
  await page.evaluate(() => SC.hold(['KeyW'], 1.5));
  const b = await page.evaluate(() => SC.player());
  assert(Math.hypot(b.x - a.x, b.z - a.z) > 1.5, 'player did not move');
});

await test('buildings stream in with interiors', async () => {
  const n = await page.evaluate(() => SC.stream(-1250, 350));
  assert(n > 5, `only ${n} buildings live`);
});

await test('residents are simulated', async () => {
  const r = await page.evaluate(() => SC.npcTest('millbrook', 12, 4));
  assert(r.live > 10, `only ${r.live} residents`);
});

await test('dev console spawners work', async () => {
  if (!(await page.evaluate(() => !!window.spawn))) return;
  const r = await page.evaluate(() => { const p = SC.player(); return [spawn.horse(), spawn.cart(), spawn.item('apple', 5)].every(Boolean); });
  assert(r, 'a spawner returned nothing');
});

await test('renders without GL errors', async () => {
  await page.evaluate(() => SC.render(3));
  await shot(page, 'e2e-final.png');
  const bad = errors.filter((e) => !/favicon|AudioContext|Failed to load resource/.test(e));
  assert(bad.length === 0, bad.slice(0, 5).join('\n'));
});

await browser.close();
srv.close();
process.exit(summary() ? 1 : 0);
