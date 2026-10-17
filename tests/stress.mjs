// Everything at once near the player: a field battle, kegs going up among the soldiers, cannon fire, a boarding
// action offshore. Reports every console error (looking for Rapier "recursive use of an object").
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 640, height: 400 });
const all = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') all.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => all.push('PAGEERROR ' + String(e).slice(0, 300)));
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const r = await page.evaluate(async () => {
  const g = SC.game; g.manual = true; SC.setTime(11); g.ui.screen = 'play';
  g.player.spawn(-900, 300); g.player.god = true; for (let i = 0; i < 30; i++) g.step(1 / 30);
  spawn.armies(40);
  for (let i = 0; i < 30 * 25; i++) g.step(1 / 30);
  spawn.powder(6); spawn.cannon();
  const kegs = [...g.props.props].filter((p) => p.def.id === 'powder');
  for (const k of kegs) g.destruct.light(k);
  for (let i = 0; i < 30 * 30; i++) { g.step(1 / 30); if (i % 60 === 0) g.renderFrame(); }
  g.naval.startBattle(g.player.pos);
  for (let i = 0; i < 30 * 30; i++) g.step(1 / 30);
  return { dead: g.war.soldiers.filter((s) => !s.alive).length, dolls: g.ragdolls.dolls.length };
});
console.log(JSON.stringify(r));
const uniq = [...new Set(all)];
console.log(uniq.length + ' distinct messages\n' + uniq.slice(0, 15).join('\n'));
await b.close(); srv.close();
