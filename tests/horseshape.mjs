// Horse conformation sheet: side, front 3/4, rear 3/4, gallop; a 1.8 m man beside it for scale.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const id = process.argv[2] || 'horse';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 480 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(10.5); });
const files = [];
for (const [ang, dist, h, speed] of (process.env.CLOSE ? [[0, 3.6, 1.0, 0], [0, 3.6, 2.2, 0], [0.9, 3.4, 1.6, 0], [2.4, 3.4, 1.8, 0]] : [[0, 5.2, 1.2, 0], [0.9, 5, 1.6, 0], [2.4, 5, 1.6, 0], [0, 5.6, 1.2, 11]])) {
  await page.evaluate(([id, ang, dist, h, speed]) => {
    const g = SC.game, T = SC.THREE;
    const x0 = -900, z0 = 120;
    g.player.spawn(x0 + 40, z0 + 40);
    for (const m of g.grass.meshes) m.visible = false;
    SC.studio(id, 0, 'idle', 0.1, 0, 0.95);
    const s = g.__studio, A = s.anim, dt = 1 / 240;
    const ms = { pos: new T.Vector3(x0, g.world.heightAt(x0, z0), z0), yaw: Math.PI / 2, speed, turn: 0, vel: new T.Vector3(), action: 'idle', look: null };
    A.initFeet = true;
    for (let t = 0; t < 2.1; t += dt) { ms.pos.x += speed * dt; ms.pos.y = g.world.heightAt(ms.pos.x, ms.pos.z); A.update(dt, ms); }
    s.rig.root.updateMatrixWorld(true);
    const c = s.rig.root.position;
    if (!window.__man) { const r = g.creatures.instance('human0', { coat: 0, cloth1: 0x6a5a3a, cloth2: 0x3a3a3a, boots: 0x2a1c12, skin: 0xd8a888, hair: 0x3a2a1a, belt: 0x2a1a0a }); g.scene.add(r.root); window.__man = r; }
    window.__man.root.position.set(c.x - 0.3, g.world.heightAt(c.x - 0.3, c.z - 1.2), c.z - 1.2); window.__man.root.updateMatrixWorld(true);
    g.camera.position.set(c.x + Math.sin(ang) * dist * (ang > 2 ? -1 : 1) * 0 + (ang === 0 ? 0 : Math.cos(ang) * dist * (ang > 2 ? 1 : 1)), c.y + h, c.z + Math.sin(ang === 0 ? Math.PI / 2 : ang) * dist);
    g.camera.lookAt(c.x, c.y + 1.0, c.z); g.camera.updateMatrixWorld();
    SC.render(2);
  }, [id, ang, dist, h, speed]);
  const f = path.join(shots, `hs-${files.length}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).toBuffer(), left: (i % 2) * 640, top: Math.floor(i / 2) * 480 })));
await sharp({ create: { width: 1280, height: 960, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `horseshape-${id}.png`));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
