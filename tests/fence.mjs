// A soldier told to walk straight across a fenced paddock must go round it (or through its gate).
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 320, height: 240 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true;
  const out = [];
  const pds = g.towns.plans.flatMap((p) => p.paddocks.map((d) => ({ d, p }))).slice(0, 4);
  for (const { d } of pds) {
    const f = new T.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    const a = new T.Vector3(d.x, 0, d.z).addScaledVector(f, -(d.d / 2 + 5)), bb = new T.Vector3(d.x, 0, d.z).addScaledVector(f, d.d / 2 + 5);
    g.player.spawn(a.x + 3, a.z + 3); SC.stream(d.x, d.z); for (let i = 0; i < 30; i++) g.step(1 / 30);
    a.y = g.world.heightAt(a.x, a.z); bb.y = g.world.heightAt(bb.x, bb.z);
    const s = g.war.spawnSoldier('vanguardia', a); s.order = 'advance'; s.path = [bb.clone()]; s.marching = true;
    let stuck = 0, minD = 1e9; const p0 = s.st.pos.clone();
    for (let i = 0; i < 30 * 40; i++) { g.step(1 / 30); minD = Math.min(minD, s.st.pos.distanceTo(bb)); }
    out.push(`paddock ${d.w.toFixed(0)}x${d.d.toFixed(0)} straight-clear ${g.nav.clear(a, bb)} reached ${minD.toFixed(1)} m (path now ${s.path.length})`);
    s.dispose(); g.war.soldiers.splice(g.war.soldiers.indexOf(s), 1);
  }
  return out.join('\n');
}));
await b.close(); srv.close();
