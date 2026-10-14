// Crews at work on deck, then a boarding action: grapple, haul alongside, leap across, fight, strike colours.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const setup = await page.evaluate(() => {
  const g = SC.game, T = SC.THREE;
  g.manual = true; SC.setTime(14); weather('clear');
  g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30);
  const Ship = g.ships.find((s) => s.plan).constructor;
  const c = g.naval.startBattle(g.player.pos, true);
  for (const s of [...g.naval.spawned]) g.naval['remove'](s);
  const a = new Ship(g, c.clone(), 0, 'frigate', 'Test Frigate'); a.side = 'vanguardia'; a.anchored = true;
  const bb = new Ship(g, c.clone().add(new T.Vector3(0, 0, 30)), 0, 'brigantine', 'Test Brig'); bb.side = 'ironreach'; bb.anchored = true;
  g.ships.push(a, bb); g.naval.spawned.add(a); g.naval.spawned.add(bb);
  g.player.spawn(c.x + 60, c.z + 60);
  window.__A = a; window.__B = bb;
  g.naval.manShip(a); g.naval.manShip(bb);
  const p0 = g.naval.crews.get(a).map((h) => h.st.pos.clone());
  for (let i = 0; i < 20 * 30; i++) g.step(1 / 30);
  const hs = g.naval.crews.get(a);
  const moved = hs.filter((h, i) => h.st.pos.distanceTo(p0[i]) > 1).length;
  const offDeck = hs.filter((h) => Math.abs(h.st.pos.y - g.naval.deckH(a, h.st.pos.x, h.st.pos.z)) > 0.05).length;
  return { n: hs.length, moved, offDeck, levels: hs.map((h) => h.st.pos.x.toFixed(0)).join(',') };
});
console.log('peace', JSON.stringify(setup));
const files = [];
const shot = async (name, fn) => { await page.evaluate(fn); const f = path.join(shots, `brd-${name}.png`); await page.screenshot({ path: f }); files.push(f); };
const deckCam = () => { const g = SC.game, a = window.__A; const c = a.model.localToWorld(new SC.THREE.Vector3(-4, 18, 14)); g.freeCam = true; g.camera.position.copy(c); g.camera.lookAt(a.model.localToWorld(new SC.THREE.Vector3(3, 8, 0))); g.camera.updateMatrixWorld(); SC.render(3); };
await shot('peace', deckCam);
await page.evaluate(() => { const g = SC.game; g.naval.foeOf.set(window.__A, window.__B); for (let i = 0; i < 8 * 30; i++) { g.naval.foeOf.set(window.__A, window.__B); g.step(1 / 30); } });
await shot('quarters', deckCam);
await page.evaluate(() => { const g = SC.game; window.__A.anchored = false; window.__B.anchored = false; window.__gp = g.naval.grapple(window.__A, window.__B); });
for (let k = 0; k < 6; k++) {
  const r = await page.evaluate(() => {
    const g = SC.game, a = window.__A, bb = window.__B, gp = window.__gp;
    for (let i = 0; i < 10 * 30; i++) g.step(1 / 30);
    const ca = g.naval.crews.get(a) ?? [], cb = g.naval.crews.get(bb) ?? [];
    const al = (l) => l.filter((h) => h.alive && !h.prisoner);
    return `gap ${a.pos.distanceTo(bb.pos).toFixed(1)} ready ${gp.ready} grappled ${g.naval.grapples.length} | A:${al(ca).length} (${ca.filter((h) => h.jump).length} jumping) B: van ${al(cb).filter((h) => h.side === 'vanguardia').length} iron ${al(cb).filter((h) => h.side === 'ironreach').length} pris ${cb.filter((h) => h.prisoner).length} | B side ${bb.side}`;
  });
  console.log(`t=${(k + 1) * 10}s`, r);
  await shot('b' + k, () => { const g = SC.game, a = window.__A, bb = window.__B; const m = a.pos.clone().lerp(bb.pos, 0.5); g.freeCam = true; g.camera.position.set(m.x + 22, m.y + 16, m.z - 4); g.camera.lookAt(m.x, m.y + 6, m.z); g.camera.updateMatrixWorld(); SC.render(3); });
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 4) * 640, top: Math.floor(i / 4) * 360 })));
await sharp({ create: { width: 2560, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'boarding.png'));
console.log(errors.slice(0, 8).join('\n'));
await b.close(); srv.close();
