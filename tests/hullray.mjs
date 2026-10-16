import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 400 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(9); weather('clear'); g.player.spawn(-1250, 2300); spawn.ship('manowar');
  const s = g.ships.filter((x) => x.cls === 'manowar').sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
  for (let i = 0; i < 10; i++) g.step(1 / 30);
  const out = [];
  for (const z of [1, -1]) {
    g.freeCam = true; g.camera.position.copy(s.model.localToWorld(new T.Vector3(0, 11, z * 25))); g.camera.lookAt(s.model.localToWorld(new T.Vector3(0, 11, 0))); g.camera.updateMatrixWorld();
    SC.render(2);
    const rc = new T.Raycaster(); rc.setFromCamera(new T.Vector2(0, 0), g.camera);
    const hits = rc.intersectObject(s.model, true).slice(0, 3);
    for (const h of hits) { const c = h.object.geometry.getAttribute('color'); out.push(`side ${z}: ${h.object.material.name.slice(0, 50)} d${h.distance.toFixed(1)} col=${c ? [c.getX(h.face.a), c.getY(h.face.a), c.getZ(h.face.a)].map((v) => v.toFixed(2)) : '-'}`); }
  }
  return out.join('\n');
}));
await page.screenshot({ path: path.join(shots, 'hullray.png') });
await b.close(); srv.close();
