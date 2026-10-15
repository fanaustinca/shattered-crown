// A siege at a gate: the portcullis drops, pikemen form up, archers man the wall-walk and shoot; stairs up.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const site = process.argv[2] || 'whitecrest';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
const info = await page.evaluate((site) => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11); weather('clear');
  const gts = g.gates.gates.filter((x) => x.site === site);
  const gt = gts[0]; window.__gt = gt;
  const out = gt.inward.clone().negate();
  g.player.spawn(gt.pos.x + out.x * 40 + 10, gt.pos.z + out.z * 40); SC.stream(gt.pos.x, gt.pos.z);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  spawn.siege(14);
  return { gates: g.gates.gates.length, here: gts.length, posts: g.settlements.wallWalk.length };
}, site);
console.log(JSON.stringify(info));
const cams = [
  (gt) => { const o = gt.inward.clone().negate(); return [gt.pos.clone().addScaledVector(o, 28).add(new SC.THREE.Vector3(o.z * 10, 6, -o.x * 10)), gt.pos.clone().add(new SC.THREE.Vector3(0, 4, 0))]; },
  (gt) => { const i = gt.inward; return [gt.pos.clone().addScaledVector(i, 26).add(new SC.THREE.Vector3(i.z * 14, 9, -i.x * 14)), gt.pos.clone().add(new SC.THREE.Vector3(0, 6, 0))]; },
];
for (let k = 0; k < 6; k++) {
  const r = await page.evaluate((k) => {
    const g = SC.game, gt = window.__gt;
    for (let i = 0; i < 30 * 10; i++) g.step(1 / 30);
    const d = gt.defenders.filter((s) => s.alive);
    const att = g.war.soldiers.filter((s) => s.alive && s.side !== gt.side && s.st.pos.distanceTo(gt.pos) < 200);
    const T = SC.THREE, o = gt.inward.clone().negate(), i2 = gt.inward;
    const [cp, lk] = k % 2 === 0 ? [gt.pos.clone().addScaledVector(o, 28).add(new T.Vector3(o.z * 10, 6, -o.x * 10)), gt.pos.clone().add(new T.Vector3(0, 4, 0))] : [gt.pos.clone().addScaledVector(i2, 26).add(new T.Vector3(i2.z * 14, 9, -i2.x * 14)), gt.pos.clone().add(new T.Vector3(0, 6, 0))];
    g.freeCam = true; g.camera.position.copy(cp); g.camera.lookAt(lk); g.camera.updateMatrixWorld(); SC.render(3);
    return `open ${gt.open.toFixed(2)} defenders ${d.length} (on walls ${d.filter((s) => s.st.pos.y > gt.pos.y + 6).length}) attackers ${att.length} arrows ${g.combat.arrows.length} batter ${gt.batter.toFixed(0)} forced ${gt.forcedT > 0}`;
  }, k);
  console.log(`t=${(k + 1) * 10}s`, r);
  const f = path.join(shots, `gs-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'gatesiege.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
