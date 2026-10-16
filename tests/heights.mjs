import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 500 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11); weather('clear');
  const x0 = -900, z0 = 120; g.player.spawn(x0 + 6, z0 + 6); for (let i = 0; i < 30; i++) g.step(1 / 30);
  const s = g.war.spawnSoldier('vanguardia', new T.Vector3(x0, 0, z0)); s.order = 'hold';
  const s2 = g.war.spawnSoldier('ironreach', new T.Vector3(x0 + 1.2, 0, z0)); s2.order = 'hold'; g.war.enlisted = null;
  const civ = g.residents.live[0]; const civRig = g.creatures.instance('human0', { coat: 0, cloth1: 0x7a3020, cloth2: 0x4a4436, boots: 0x3a2a1a, skin: 0xd8a888, hair: 0x4a2a14, belt: 0x2a1a0a });
  g.scene.add(civRig.root); civRig.root.position.set(x0 - 1.2, g.world.heightAt(x0 - 1.2, z0), z0); civRig.root.updateMatrixWorld(true);
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  const hgt = (rig) => { const bb = new T.Box3().setFromObject(rig.mesh); return (bb.max.y - bb.min.y).toFixed(2); };
  g.freeCam = true; g.camera.position.set(x0, g.world.heightAt(x0, z0) + 1.2, z0 + 5); g.camera.lookAt(x0, g.world.heightAt(x0, z0) + 1, z0); g.camera.updateMatrixWorld(); SC.render(3);
  return `soldier ${hgt(s.rig)} scale ${s.anim.heightScale.toFixed(2)} rootScale ${s.rig.root.scale.x.toFixed(2)} | soldier2 ${hgt(s2.rig)} | civilian rig ${hgt(civRig)} | resident ${civ ? hgt(civ.rig) + ' ' + civ.anim.heightScale.toFixed(2) : '-'} | player ${g.player.pos.y.toFixed(1)}`;
}));
await page.screenshot({ path: path.join(shots, 'heights.png') });
await b.close(); srv.close();
