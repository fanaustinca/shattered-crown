// Destruction: fire at a castle wall until it cracks and falls; blow a powder keg on open ground.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const files = [];
const snap = async (n) => { const f = path.join(shots, `siege-${n}.png`); await page.screenshot({ path: f }); files.push(f); };
const info = await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11); weather('clear');
  const secs = g.destruct.sections.filter((s) => s.site === 'whitecrest');
  const s = secs[Math.floor(secs.length / 3)];
  window.__s = s;
  const out = s.center.clone().sub(new T.Vector3(SC.site('whitecrest').site.x, s.center.y, SC.site('whitecrest').site.z)).setY(0).normalize();
  window.__out = out;
  const gun = s.center.clone().addScaledVector(out, 40); gun.y = g.world.heightAt(gun.x, gun.z);
  g.player.spawn(gun.x + 3, gun.z + 3);
  SC.stream(s.center.x, s.center.z);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  return { sections: g.destruct.sections.length, here: secs.length, len: s.len.toFixed(1), h: s.height.toFixed(1) };
});
console.log(info);
const view = () => page.evaluate(() => { const g = SC.game, s = window.__s, out = window.__out; const e = s.center.clone().addScaledVector(out, 16).add(new SC.THREE.Vector3(out.z * 6, 2 - s.height / 2 + 3, -out.x * 6)); g.freeCam = true; g.camera.position.copy(e); g.camera.lookAt(s.center); g.camera.updateMatrixWorld(); SC.render(3); });
await view(); await snap('0-intact');
for (let shot = 1; shot <= 9; shot++) {
  const r = await page.evaluate(() => {
    const g = SC.game, s = window.__s, out = window.__out;
    const muzzle = s.center.clone().addScaledVector(out, 38).setY(s.center.y - s.height * 0.1 + Math.random() * 2);
    const dir = s.center.clone().add(new SC.THREE.Vector3((Math.random() - 0.5) * s.len * 0.6, (Math.random() - 0.5) * s.height * 0.4, 0)).sub(muzzle).normalize();
    g.war.fireBall(muzzle, dir, 120, 'ironreach', true);
    for (let i = 0; i < 90; i++) g.step(1 / 60);
    return { hp: s.hp.toFixed(2), cracks: s.cracks, collapsed: s.collapsed, debris: g.destruct.debris.length };
  });
  console.log('shot', shot, JSON.stringify(r));
  if (shot === 3 || shot === 6) { await view(); await snap(`${shot}-shots`); }
  if (r.collapsed) break;
}
await page.evaluate(() => { const g = SC.game; for (let i = 0; i < 30; i++) g.step(1 / 60); });
await view(); await snap('collapse-1s');
await page.evaluate(() => { const g = SC.game; for (let i = 0; i < 60 * 8; i++) g.step(1 / 60); });
await view(); await snap('collapse-9s');
// a powder keg on the grass
await page.evaluate(() => {
  const g = SC.game, T = SC.THREE, out = window.__out, s = window.__s;
  const p = s.center.clone().addScaledVector(out, 25); p.y = g.world.heightAt(p.x, p.z) + 0.5;
  const k = g.props.spawn('powder', p);
  for (let i = 0; i < 30; i++) g.step(1 / 60);
  g.destruct.detonate(k);
  for (let i = 0; i < 20; i++) g.step(1 / 60);
  window.__kp = p;
});
await page.evaluate(() => { const g = SC.game, p = window.__kp; g.freeCam = true; g.camera.position.set(p.x + 6, p.y + 4, p.z + 6); g.camera.lookAt(p); g.camera.updateMatrixWorld(); SC.render(3); });
await snap('keg');
await page.evaluate(() => { const g = SC.game; for (let i = 0; i < 60 * 6; i++) g.step(1 / 60); SC.render(3); });
await snap('crater');
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(480, 270).toBuffer(), left: (i % 4) * 480, top: Math.floor(i / 4) * 270 })));
await sharp({ create: { width: 1920, height: 270 * Math.ceil(files.length / 4), channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'siege.png'));
console.log(errors.slice(0, 8).join('\n'));
await b.close(); srv.close();
