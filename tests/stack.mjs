import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 640, height: 400 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11);
  const F = g.war.fronts, f = F.fronts[1];
  const { p, dir } = F.posAt(f, f.line);
  g.player.spawn(p.x + dir.z * 60, p.z - dir.x * 60); for (let i = 0; i < 30; i++) g.step(1 / 30);
  F.begin(f); const L = f.live; g.player.spawn(L.center.x - L.dir.z * 45, L.center.z + L.dir.x * 45);
  const out = [];
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 30 * 8; i++) g.step(1 / 30);
    const high = g.war.soldiers.filter((s) => s.alive && s.st.pos.y - g.world.heightAt(s.st.pos.x, s.st.pos.z) > 1.0);
    out.push(`t${(k + 1) * 8}: high ${high.length}/${g.war.soldiers.filter((s) => s.alive).length} ` + high.slice(0, 4).map((s) => { const t = s.collider.translation(); return `${s.horse ? 'cav' : s.archer ? 'arch' : 'inf'} dy${(s.st.pos.y - g.world.heightAt(s.st.pos.x, s.st.pos.z)).toFixed(1)} col${(t.y - g.world.heightAt(t.x, t.z)).toFixed(1)} ph${s.battle?.phase}`; }).join(', '));
  }
  return out.join('\n');
}));
await b.close(); srv.close();
