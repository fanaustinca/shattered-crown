// spawn.armies(): two armies meet in the field, form lines and fight; commanders; ragdoll dead; surrender.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); weather('clear');
  // open, level, dry ground far from any town, with room for two armies along +x
  const W = g.world; let best = null, bs = 1e9;
  for (let x = -2400; x < 2400; x += 120) for (let z = -2400; z < 2400; z += 120) {
    if (g.towns.plans.some((p) => Math.hypot(p.site.x - x, p.site.z - z) < (p.siteR ?? 80) + 250)) continue;
    let lo = 1e9, hi = -1e9, bad = false, wood = 0;
    for (let u = -1; u <= 4; u++) for (let v = -1; v <= 1; v++) { const px = x + u * 60, pz = z + v * 40, h = W.heightAt(px, pz); if (W.waterLevelAt(px, pz) > h - 0.5) bad = true; lo = Math.min(lo, h); hi = Math.max(hi, h); wood += W.forestAt(px, pz); }
    if (bad) continue;
    const sc = hi - lo + wood * 30;
    if (sc < bs) { bs = sc; best = [x, z]; }
  }
  window.__site = best;
  g.player.spawn(best[0], best[1]); g.player.yaw = -Math.PI / 2; for (let i = 0; i < 30; i++) g.step(1 / 30);
  g.player.god = true;
  spawn.armies(40);
});
const files = [];
for (let k = 0; k < 7; k++) {
  const r = await page.evaluate((k) => {
    const g = SC.game, F = g.war.fronts;
    for (let i = 0; i < 30 * (k === 0 ? 6 : 12); i++) g.step(1 / 30);
    const fld = F.fields[0];
    const all = g.war.soldiers;
    const alive = (side) => all.filter((s) => s.alive && s.side === side).length;
    const sur = all.filter((s) => s.surrendered).length;
    const dead = all.filter((s) => !s.alive);
    const cmd = all.filter((s) => s.commander).map((s) => `${s.side[0]}:${s.person.name}${s.alive ? '' : '†'}`).join(',');
    // view: the middle of the fighting, or a corpse close up later
    const T = SC.THREE;
    let c = fld?.live?.center ?? all.filter((s) => s.alive).reduce((a, s) => a.add(s.st.pos), new T.Vector3()).multiplyScalar(1 / Math.max(1, all.filter((s) => s.alive).length));
    if (k >= 5 && dead.length) { const d = dead[0].st.pos; g.freeCam = true; g.camera.position.set(d.x + 3, d.y + 2.2, d.z + 3); g.camera.lookAt(d.x, d.y + 0.2, d.z); }
    else { g.freeCam = true; g.camera.position.set(c.x - 40, c.y + 18, c.z + 30); g.camera.lookAt(c.x, c.y + 1, c.z); }
    g.camera.updateMatrixWorld(); SC.render(3);
    const dbg = all.filter((s) => s.alive && s.battle).slice(0, 4).map((s) => { let nd = 1e9; for (const o of all) if (o.alive && o.side !== s.side) nd = Math.min(nd, o.st.pos.distanceTo(s.st.pos)); return `${s.side[0]} ft${s.fightTarget ? 1 : 0} nd${nd.toFixed(0)} p${s.path.length} sp${s.st.speed.toFixed(1)} act:${s.activity} h${s.hostile ? 1 : 0}`; }).join(' ; ');
    return dbg + '\n  ' + `t=${k} field ${!!fld?.live} phase ${fld?.live ? [...fld.live.ids].filter((s) => s.battle).map((s) => s.battle.phase[0]).sort().join('').replace(/(.)\1+/g, (m) => m[0] + m.length) : '-'} v${alive('vanguardia')} i${alive('ironreach')} dead ${dead.length} ragdolls ${g.ragdolls.dolls.length} surrendered ${sur} cmd ${cmd} | ${F.log.slice(-3).join(' || ')}`;
  }, k);
  console.log(r);
  const f = path.join(shots, `fb-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.slice(0, 6).map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'fieldbattle.png'));
console.log(errors.slice(0, 6).join('\n'));
await b.close(); srv.close();
