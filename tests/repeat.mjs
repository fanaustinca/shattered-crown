// Use the same things over and over (pick up / drop / throw, doors, drawers, mounting, carts, ships' helm and
// doors), watching for Rapier errors.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 640, height: 400 });
const all = [];
page.on('console', (m) => { if (m.type() === 'error') all.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => all.push('PAGEERROR ' + String(e).slice(0, 400) + ' ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const steps = ['props', 'doors', 'drawers', 'horse', 'cart', 'ship'];
for (const st of steps) {
  const r = await page.evaluate(async (st) => {
    const g = SC.game, T = SC.THREE, ia = g.interaction; g.manual = true; g.ui.screen = 'play';
    const run = (n, f) => { for (let i = 0; i < n; i++) { try { f(i); } catch (e) { return 'THROW ' + e; } for (let k = 0; k < 4; k++) g.step(1 / 60); } return 'ok'; };
    if (st === 'props') {
      const pl = SC.site('millbrook'); g.player.spawn(pl.plaza.x + 3, pl.plaza.z + 3); SC.stream(pl.plaza.x, pl.plaza.z); for (let i = 0; i < 60; i++) g.step(1 / 30);
      const pr = g.props.spawn('crate', g.player.pos.clone().add(new T.Vector3(1, 1, 0)));
      return run(60, (i) => { if (ia.held) ia.release(i % 3 === 0); else ia.grab(pr); });
    }
    if (st === 'doors') { const ds = [...g.settlements.live.values()].flatMap((l) => l.doors).slice(0, 10); return run(80, (i) => { const d = ds[i % ds.length]; d.toggle?.() ?? d.interact?.(); }); }
    if (st === 'drawers') { const ms = [...g.settlements.live.values()].flatMap((l) => l.furniture.flatMap((f) => f.movables)).slice(0, 20); return run(80, (i) => { const m = ms[i % ms.length]; m.furniture.toggle(m); }); }
    if (st === 'horse') { const h = g.spawnAnimal('horse', g.player.pos.clone().add(new T.Vector3(2, 0, 0))); return run(40, (i) => { if (g.mount) g.player.standUp(); else h.mount(g.player); }); }
    if (st === 'cart') { spawn.team(2); const c = g.carts[g.carts.length - 1]; return run(30, (i) => { const acts = c.actions?.(g) ?? []; const a = acts[i % Math.max(1, acts.length)]; a?.run(); }); }
    if (st === 'ship') { g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30); spawn.ship('frigate'); const s = g.ships[g.ships.length - 1]; return run(40, (i) => { if (i % 2) s.takeHelm(); else g.player.standUp(); s.doors[0]?.toggle(); }); }
  }, st);
  console.log(st, r);
}
const uniq = [...new Set(all)];
console.log(uniq.length + ' distinct errors\n' + uniq.slice(0, 12).join('\n'));
await b.close(); srv.close();
