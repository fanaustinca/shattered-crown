import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); weather('clear');
  const out = [];
  // the moored boats at the docks, and a fresh one; then with the player rowing
  g.player.spawn(-1250, 2300); for (let i = 0; i < 30; i++) g.step(1 / 30);
  spawn.boat();
  const boats = g.ships.filter((s) => s.cls === 'boat').sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos)).slice(0, 3);
  for (let k = 0; k < 5; k++) { for (let i = 0; i < 60; i++) g.step(1 / 30); out.push(boats.map((s) => `y${(s.pos.y - g.world.waterLevelAt(s.pos.x, s.pos.z)).toFixed(2)} hp${s.hp?.toFixed?.(2)} buoy${s.buoyScale ?? '-'}`).join(' | ')); }
  const bt = boats[0]; bt.takeHelm?.();
  for (let i = 0; i < 90; i++) g.step(1 / 30);
  out.push('with rower: y' + (bt.pos.y - g.world.waterLevelAt(bt.pos.x, bt.pos.z)).toFixed(2) + ' mass ' + bt.mass);
  window.__bt = bt;
  const c = bt.pos; g.freeCam = true; g.camera.position.set(c.x + 5, c.y + 3, c.z + 5); g.camera.lookAt(c); g.camera.updateMatrixWorld(); SC.render(3);
  return out.join('\n');
}));
await page.screenshot({ path: path.join(shots, 'boat.png') });
await b.close(); srv.close();
