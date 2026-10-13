import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 400, height: 400 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true;
  const rig = g.creatures.instance('human6', { coat: 0, cloth1: 0x7a3020, cloth2: 0x4a4436, boots: 0x3a2a1a, skin: 0xd8a888, hair: 0x4a2a14, belt: 0x2a1a0a });
  rig.root.position.set(-900, g.world.heightAt(-900, 300), 300);
  g.scene.add(rig.root); g.scene.updateMatrixWorld();
  const c = g.cloth.skirt(rig, 0x7a3020, 1, 0.1, rig);
  const A = window.__anim; const anim = new A.BipedAnimator(rig, (x, z) => g.world.heightAt(x, z));
  const st = { pos: new SC.THREE.Vector3(-900, g.world.heightAt(-900, 300), 300), yaw: 0, speed: 0, turn: 0, vel: new SC.THREE.Vector3(), action: 'idle', look: null };
  g.freeCam = true; g.camera.position.set(-897, st.pos.y + 1, 300);
  for (let i = 0; i < 60; i++) { anim.update(1 / 60, st); g.clothDt = 1 / 60; g.renderFrame(); }
  window.__c = c;
  const hip = rig.byName.hips.getWorldPosition(new SC.THREE.Vector3());
  const ring = (row) => { const out = []; for (let col = 0; col < 20; col += 5) { const k = (row * 20 + col) * 3; out.push([c.pos[k] - hip.x, c.pos[k + 1] - hip.y, c.pos[k + 2] - hip.z].map((v) => +v.toFixed(2))); } return out; };
  const res = { sim: c.simulated, wind: SC.game.weather.cur.wind, uw: SC.game.cloth && [...(window.__u ?? [])], t60: { top: ring(0), mid: ring(4), bot: ring(8) } };
  res.cols = c.colliders.map((k) => [k.a.toArray().map((v, i) => +(v - hip.toArray()[i]).toFixed(2)), k.r.toFixed(2)]);
  return res;
});
console.log(JSON.stringify(r));
await browser.close(); srv.close();
