// A pitched battle at a bridge: forming, advancing, charging; who wins; screenshots.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(10); weather('clear');
  const F = g.war.fronts, f = F.fronts[1];
  const { p, dir } = F.posAt(f, f.line);
  window.__f = f;
  g.player.spawn(p.x + dir.z * 60, p.z - dir.x * 60);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  F.begin(f);
});
const files = [];
for (let k = 0; k < 6; k++) {
  const r = await page.evaluate((k) => {
    const g = SC.game, f = window.__f, F = g.war.fronts;
    for (let i = 0; i < 30 * (k === 0 ? 15 : 12); i++) g.step(1 / 30);
    const L = f.live;
    const ids = L ? [...L.ids] : [];
    const count = (side) => ids.filter((s) => s.alive && s.side === side).length;
    const phases = {}; for (const s of ids) if (s.alive && s.battle) phases[s.battle.phase] = (phases[s.battle.phase] ?? 0) + 1;
    const cav = g.war.soldiers.filter((s) => s.alive && s.horse).length;
    const { p, dir } = F.posAt(f, f.line);
    // look at the thick of it: the centroid of the living soldiers, from behind the Vanguardian side
    const alive = ids.filter((s) => s.alive);
    const c = alive.reduce((a, s) => a.add(s.st.pos), new SC.THREE.Vector3()).multiplyScalar(1 / Math.max(1, alive.length));
    const d = L ? L.dir : dir;
    const side = new SC.THREE.Vector3(-d.z, 0, d.x);
    g.freeCam = true; g.camera.position.set(c.x - d.x * 30 + side.x * 18, c.y + 9, c.z - d.z * 30 + side.z * 18); g.camera.lookAt(c.x, c.y + 1, c.z); g.camera.updateMatrixWorld();
    SC.render(3);
    const proj = (side) => { const a = ids.filter((x) => x.alive && x.side === side); if (!a.length || !L) return '-'; const m = a.reduce((q, x) => q + x.st.pos.clone().sub(L.center).dot(L.dir), 0) / a.length; const y = a.reduce((q, x) => q + x.st.pos.y, 0) / a.length; const np = a.filter((x) => !x.path.length).length; const stuck = a.filter((x) => x.stuckT > 1).length; return `${m.toFixed(0)}m y${y.toFixed(1)} nopath${np} stuck${stuck} sp${a.reduce((q, x) => q + x.st.speed, 0).toFixed(0)}`; };
    return { pv: proj('vanguardia'), pi: proj('ironreach'), t: L?.t?.toFixed(0) ?? 'done', v: count('vanguardia'), i: count('ironreach'), phases, cav, line: f.line.toFixed(2), log: F.log.slice(-1)[0] ?? '' };
  }, k);
  console.log(JSON.stringify(r));
  const f = path.join(shots, `battle-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'battle.png'));
console.log(errors.slice(0, 8).join('\n'));
await b.close(); srv.close();
