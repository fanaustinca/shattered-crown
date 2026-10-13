import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 900, height: 900 });
const windArg = +(process.argv[2] ?? 0), walk = +(process.argv[3] ?? 0);
for (const [k, ang] of [[0, 0], [1, Math.PI / 2]]) {
  await page.evaluate((windArg, walk, ang) => {
    const g = SC.game; g.manual = true; SC.setTime(11);
    g.weather.set('clear', true);
    for (const m of g.grass.meshes) m.visible = false;
    if (!window.__cs) {
      const rig = g.creatures.instance('human6', { coat: 0, cloth1: 0x7a3020, cloth2: 0x4a4436, boots: 0x3a2a1a, skin: 0xd8a888, hair: 0x4a2a14, belt: 0x2a1a0a });
      const A = window.__anim; const anim = new A.BipedAnimator(rig, (x, z) => g.world.heightAt(x, z));
      g.scene.add(rig.root);
      g.cloth.skirt(rig, 0x7a3020, 1, 0.1, rig);
      window.__cs = { rig, anim, st: { pos: new SC.THREE.Vector3(-900, g.world.heightAt(-900, 300), 300), yaw: 0, speed: walk, turn: 0, vel: new SC.THREE.Vector3(), action: 'idle', look: null } };
      g.freeCam = true; for (let i = 0; i < 180; i++) { const st = window.__cs.st; g.camera.position.set(st.pos.x + 2.4, st.pos.y + 1, st.pos.z); st.pos.z += Math.cos(st.yaw) * walk / 60; st.pos.y = g.world.heightAt(st.pos.x, st.pos.z); anim.update(1 / 60, st); SC.game.weather.cur.wind = windArg; SC.game.weather.update(0); g.clothDt = 1 / 60; g.renderFrame(); }
    }
    const p = window.__cs.st.pos;
    g.freeCam = true;
    g.camera.position.set(p.x + Math.sin(ang) * 2.4, p.y + 0.9, p.z + Math.cos(ang) * 2.4); g.camera.lookAt(p.x, p.y + 0.7, p.z);
    g.clothDt = 0; g.renderFrame();
  }, windArg, walk, ang);
  await page.screenshot({ path: `tests/screenshots/clothstudio-${k}.png` });
}
console.log(await page.evaluate(() => { const c0 = SC.game.cloth.cloths.at(-1); const before = c0.mesh.geometry.getAttribute('position').array[1]; SC.game.cloth.update(1 / 60, SC.game.camera.position, 1); window.__dbg = { before, after: c0.mesh.geometry.getAttribute('position').array[1], acc: SC.game.cloth.acc, en: SC.game.cloth.enabled }; return window.__dbg; }));
console.log(await page.evaluate(() => { const c = SC.game.cloth.cloths.at(-1); const m = c.mesh; let vis = true, o = m; const chain = []; while (o) { chain.push((o.name || o.type) + (o.visible ? '' : '(hidden)')); o = o.parent; } const a = m.geometry.getAttribute('position').array; return { sim: c.simulated, n: c.n, y0: c.pos[1], yb: c.pos[(c.n - 1) * 3 + 1], chain, mat: m.material.type, side: m.material.side, layers: m.layers.mask, mw: m.matrixWorld.elements.slice(12, 15), a0: [a[0], a[1], a[2]], idx: m.geometry.index.count, draw: m.geometry.drawRange }; }));
console.log(errors.slice(0, 5).join("\n"));
await browser.close(); srv.close();
