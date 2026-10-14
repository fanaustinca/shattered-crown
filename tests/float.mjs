// Objects in water: what floats, what sinks, drifting with the river.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true;
  const out = {};
  for (const [where, x, z] of [['river', null, 200], ['sea', 0, 2900]]) {
    const wx = x ?? (g.world.bridges[1].x), wz = z;
    let px = wx, pz = wz;
    if (where === 'river') { px = g.world.bridges[1].x; pz = 200; }
    g.player.spawn(px + 30, pz);
    const wl0 = g.props.waterAt(px, pz);
    const items = ['apple', 'wood_log', 'barrel', 'antique_estoc', 'basket', 'cannonball'].filter((id) => SC.game.props && window.ITEMS !== null);
    const made = items.map((id, i) => g.props.spawn(id, new T.Vector3(px + i * 1.5, wl0 + 3, pz))); const ok = made.map((m) => !!m);
    for (let i = 0; i < 600; i++) g.step(1 / 60);
    out[where] = { water: +wl0.toFixed(2), items: made.map((p, i) => !p ? { id: items[i], missing: true } : ({ id: items[i], dy: +(p.obj.position.y - g.props.waterAt(p.obj.position.x, p.obj.position.z)).toFixed(2), drift: +Math.hypot(p.obj.position.x - (px + i * 1.5), p.obj.position.z - pz).toFixed(1) })) };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
