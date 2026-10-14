// The three warship classes: outside, on deck, below decks, in the great cabin. Also floating stats.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const files = [];
const classes = (process.env.CLS ?? 'brigantine,frigate,manowar').split(',');
for (const cls of classes) {
  const info = await page.evaluate((cls) => {
    const g = SC.game; g.manual = true; SC.setTime(11); weather('cloudy');
    const sh = g.ships.find((s) => s.cls === cls);
    window.__sh = sh;
    g.player.spawn(sh.pos.x + 80, sh.pos.z + 80);
    for (let i = 0; i < 240; i++) g.step(1 / 60);
    const e = new SC.THREE.Euler().setFromQuaternion(sh.quat, 'YXZ');
    return { cls, name: sh.name_, y: +sh.pos.y.toFixed(2), wl: sh.waterline, roll: +e.z.toFixed(3), pitch: +e.x.toFixed(3), guns: sh.plan.guns.length, sails: sh.sails.length, doors: sh.doors.length };
  }, cls);
  console.log(JSON.stringify(info));
  const views = [['out34', 'out'], ['side', 'out'], ['deck', 'in'], ['gundeck', 'in'], ['cabin', 'in']];
  for (const [n] of views) {
    await page.evaluate(([n]) => {
      const g = SC.game, sh = window.__sh, T = SC.THREE, pl = sh.plan, S = pl.spec;
      const W = (x, y, z) => new T.Vector3(x, y, z).applyQuaternion(sh.quat).add(sh.pos);
      const L = S.L, H = L / 2;
      let eye, at;
      if (n === 'out34') { eye = W(L * 0.9, L * 0.35, L * 0.8); at = W(0, pl.deckY, 0); }
      else if (n === 'side') { eye = W(-H * 0.1, pl.deckY * 0.6, L * 1.15); at = W(-H * 0.1, pl.deckY + 6, 0); }
      else if (n === 'deck') { eye = W(-H * 0.75, pl.weatherY(-H * 0.75) + 1.7, 0.5); at = W(H, pl.weatherY(0) + 3, 0); }
      else if (n === 'gundeck') { const di = S.gunDecks.length ? S.gunDecks[0] : 0; const y = S.decks[di] + 1.6; eye = W(H * 0.5, y, 0.3); at = W(-H * 0.5, y - 0.3, -1.5); }
      else { const c = pl.cabin; eye = W(c.x1 - 0.6, c.y + 1.6, 0.6); at = W(c.x0, c.y + 1.0, -0.4); }
      g.player.spawn(eye.x + 3, eye.z + 3);
      g.freeCam = true; g.camera.position.copy(eye); g.camera.lookAt(at); g.camera.updateMatrixWorld();
      SC.render(3);
    }, [n]);
    const f = path.join(shots, `ship-${cls}-${n}.png`); await page.screenshot({ path: f }); files.push(f);
  }
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(400, 225).toBuffer(), left: (i % 5) * 400, top: Math.floor(i / 5) * 225 })));
await sharp({ create: { width: 2000, height: 225 * Math.ceil(files.length / 5), channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'ships.png'));
console.log(errors.slice(0, 8).join('\n'));
await b.close(); srv.close();
