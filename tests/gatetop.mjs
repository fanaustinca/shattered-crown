// Top-down and wall-walk views of a gate: stairs, landing, archers on the wall.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const site = process.argv[2] || 'whitecrest';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 600 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
await page.evaluate((site) => {
  const g = SC.game; g.manual = true; SC.setTime(11); weather('clear');
  const gt = g.gates.gates.filter((x) => x.site === site)[0]; window.__gt = gt;
  g.player.spawn(gt.pos.x + gt.inward.x * 20, gt.pos.z + gt.inward.z * 20); SC.stream(gt.pos.x, gt.pos.z);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  spawn.siege(8);
  for (let i = 0; i < 30 * 8; i++) g.step(1 / 30);
}, site);
const views = [
  'const T = SC.THREE; return [gt.pos.clone().add(new T.Vector3(0.1, 70, 0)), gt.pos.clone()];',
  'const T = SC.THREE, i = gt.inward, a = new T.Vector3(-i.z, 0, i.x); return [gt.pos.clone().addScaledVector(i, 30).addScaledVector(a, 25).add(new T.Vector3(0, 14, 0)), gt.pos.clone().addScaledVector(a, 12).add(new T.Vector3(0, 6, 0))];',
  'const T = SC.THREE, i = gt.inward, a = new T.Vector3(-i.z, 0, i.x); return [gt.pos.clone().addScaledVector(i, 30).addScaledVector(a, -25).add(new T.Vector3(0, 14, 0)), gt.pos.clone().addScaledVector(a, -12).add(new T.Vector3(0, 6, 0))];',
];
for (const v of views) {
  await page.evaluate((v) => { const g = SC.game, gt = window.__gt; const [c, l] = new Function('gt', v)(gt); g.freeCam = true; g.camera.position.copy(c); g.camera.lookAt(l); g.camera.updateMatrixWorld(); SC.render(3); }, v);
  const f = path.join(shots, `gt-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(600, 450).toBuffer(), left: i * 600, top: 0 })));
await sharp({ create: { width: 1800, height: 450, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `gatetop-${site}.png`));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
