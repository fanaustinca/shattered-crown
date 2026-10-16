// Big-ship QA: exterior 3/4, weather deck, gun deck, lower deck/hold, a hatch ladder (man-o'-war, Leviathan).
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const cls = process.argv[2] || 'manowar';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
await page.evaluate((h) => { window.__HOUR = h; }, +(process.env.HOUR || 13));
const info = await page.evaluate((cls) => {
  const g = SC.game; g.manual = true; SC.setTime(window.__HOUR || 13); weather('clear');
  g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30);
  if (cls === 'leviathan') spawn.leviathan(); else spawn.ship(cls);
  const s = g.ships.filter((x) => x.cls === cls).sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
  const out = new SC.THREE.Vector3(s.pos.x, 0, s.pos.z).normalize().multiplyScalar(250); const t = s.body.translation(); s.body.setTranslation({ x: t.x + out.x, y: t.y, z: t.z + out.z }, true); s.body.setRotation(new SC.THREE.Quaternion().setFromAxisAngle(new SC.THREE.Vector3(0, 1, 0), 0.6), true);
  s.anchored = true; window.__S = s;
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  const P = s.plan; return { decks: P.spec.decks, hatches: P.hatches.map((h) => h.x), L: P.spec.L };
}, cls);
console.log(JSON.stringify(info));
const views = [
  ['ext', (S) => [[S.L * 0.75, S.decks[S.decks.length - 1] * 0.6, S.L * 0.55], [0, S.decks[S.decks.length - 1] * 0.5, 0]]],
  ['ext2', (S) => [[-S.L * 0.7, S.decks[S.decks.length - 1] * 0.7, -S.L * 0.6], [0, S.decks[S.decks.length - 1] * 0.5, 0]]],
  ['stern', (S) => [[-S.L * 0.95, S.decks[S.decks.length - 1] * 0.9, S.L * 0.25], [-S.L * 0.3, S.decks[S.decks.length - 1] * 0.6, 0]]],
  ['deck', (S) => [[-S.L * 0.3, S.decks[S.decks.length - 1] + 4, S.B * 0.25], [S.L * 0.3, S.decks[S.decks.length - 1] + 1, 0]]],
  ['gundeck', (S) => [[-S.L * 0.3, S.decks[S.gunDecks[0] ?? 1] + 1.4, 0], [S.L * 0.3, S.decks[S.gunDecks[0] ?? 1] + 1.0, S.B * 0.2]]],
  ['hold', (S) => [[-S.L * 0.25, S.decks[0] + 1.4, 0], [S.L * 0.25, S.decks[0] + 0.8, 0]]],
  ['hatch', (S) => [[S.L / 2 * 0.18 - 3, S.decks[1] + 1.5, 1.5], [S.L / 2 * 0.18, S.decks[1] + 2.2, 0]]],
  //['orlop', (S) => [[S.L * 0.2, S.decks[1] + 1.4, -S.B * 0.2], [-S.L * 0.2, S.decks[1] + 1.0, S.B * 0.1]]],
];
const files = [];
for (const [name, fn] of views) {
  await page.evaluate((fnSrc) => {
    const g = SC.game, s = window.__S, S = s.plan.spec;
    const [c, l] = new Function('S', 'return (' + fnSrc + ')(S)')(S);
    s.hold.visible = true; g.freeCam = true; g.camera.position.copy(s.model.localToWorld(new SC.THREE.Vector3(...c))); g.camera.lookAt(s.model.localToWorld(new SC.THREE.Vector3(...l))); g.camera.updateMatrixWorld(); SC.render(3);
  }, fn.toString());
  const f = path.join(shots, `sv-${cls}-${name}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `shipviews-${cls}.png`));
console.log(errors.slice(0, 4).join('\n'));
await b.close(); srv.close();
