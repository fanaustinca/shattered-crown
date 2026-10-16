// Player locomotion: walk, sprint, backwards, crouch speeds (simulated keys).
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 640, height: 480 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); g.ui.close?.(); g.ui.screen = 'play';
  g.player.spawn(-900, 300); for (let i = 0; i < 30; i++) g.step(1 / 60);
  const inp = g.input; const out = [];
  for (const [name, keys] of [['walk', ['KeyW']], ['sprint', ['KeyW', 'ShiftLeft']], ['back', ['KeyS']], ['backShift', ['KeyS', 'ShiftLeft']]]) {
    for (const k of keys) inp.down.add(k);
    const p0 = g.player.pos.clone();
    for (let i = 0; i < 120; i++) g.step(1 / 60);
    out.push(`${name} ${(g.player.pos.distanceTo(p0) / 2).toFixed(2)} m/s sprinting=${g.player.sprinting} stamina=${g.player.stamina.toFixed(0)} crouch=${g.player.crouch}`);
    for (const k of keys) inp.down.delete(k);
    for (let i = 0; i < 30; i++) g.step(1 / 60);
  }
  return out.join('\n');
}));
console.log(errors.slice(0, 3).join('\n'));
await b.close(); srv.close();
