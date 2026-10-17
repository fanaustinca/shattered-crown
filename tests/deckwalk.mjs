// The player and crew on a sailing frigate's deck: are the legs sane while the ship moves and rolls?
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 400 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11); weather('cloudy'); g.ui.screen = 'play';
  g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30);
  spawn.ship('frigate');
  const s = g.ships[g.ships.length - 1]; window.__S = s;
  const out = new T.Vector3(s.pos.x, 0, s.pos.z).normalize().multiplyScalar(220); const t = s.body.translation(); s.body.setTranslation({ x: t.x + out.x, y: t.y, z: t.z + out.z }, true);
  s.anchored = false; for (const sl of s.sails) sl.target = 1;
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  const deck = s.model.localToWorld(new T.Vector3(2, s.plan.deckY + 1.2, 1.5));
  g.player.spawn(deck.x, deck.z); g.player.collider.setTranslation?.({ x: deck.x, y: deck.y + 0.6, z: deck.z });
  g.player.thirdPerson = true;
  g.naval.manShip(s);
});
const files = [];
for (let k = 0; k < 6; k++) {
  await page.evaluate((k) => {
    const g = SC.game, s = window.__S, T = SC.THREE;
    for (let i = 0; i < 40; i++) g.step(1 / 30);
    const p = g.player.pos;
    g.freeCam = true; g.camera.position.copy(p).add(s.forward().multiplyScalar(-3)).add(new T.Vector3(1.5, 1.6, 1.5)); g.camera.lookAt(p.x, p.y + 0.9, p.z); g.camera.updateMatrixWorld(); SC.render(2);
  }, k);
  const f = path.join(shots, `deck-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
console.log(await page.evaluate(() => { const g = SC.game, s = window.__S; const hs = g.naval.crews.get(s) ?? []; return hs.slice(0, 12).map((h) => `${h.role} ${h.task} sp${h.st.speed.toFixed(1)} sit${!!h.st.sitting} pr${h.prisoner} alive${h.alive} y${(h.st.pos.y - g.naval.deckH(s, h.st.pos.x, h.st.pos.z)).toFixed(2)} sitW${h.anim.sit.toFixed(2)} swim${h.anim.swim}`).join('\n') + `\nspeed ${Math.hypot(s.body.linvel().x, s.body.linvel().z).toFixed(1)} on ${!!g.player.platform} y ${(g.player.pos.y).toFixed(1)}`; }));
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 400 })));
await sharp({ create: { width: 1920, height: 800, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'deckwalk.png'));
await b.close(); srv.close();
