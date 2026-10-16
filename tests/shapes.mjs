// New building forms: L-shaped houses, flags, church towers, shop fronts and side booths.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 640, height: 480 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const files = [];
const pick = async (pred, label, back = 1, side = 0.6, h = 3) => {
  const ok = await page.evaluate(([pred, back, side, h]) => {
    const g = SC.game; g.manual = true; SC.setTime(10.5); weather('clear');
    const all = g.towns.plans.filter((p) => !p.minor).flatMap((p) => p.buildings);
    const bd = all.find(new Function('b', 'return ' + pred));
    if (!bd) return false;
    g.player.spawn(bd.x + 12, bd.z + 12); SC.stream(bd.x, bd.z); for (let i = 0; i < 40; i++) g.step(1 / 30); g.settlements.update(new SC.THREE.Vector3(bd.x, bd.y, bd.z), 0);
    const f = new SC.THREE.Vector3(Math.sin(bd.yaw), 0, Math.cos(bd.yaw)), sd = new SC.THREE.Vector3(f.z, 0, -f.x);
    const D = Math.max(bd.spec.w, bd.spec.d) * 1.3 + 6;
    const c = new SC.THREE.Vector3(bd.x, bd.y, bd.z);
    g.freeCam = true; g.camera.position.copy(c).addScaledVector(f, D * back).addScaledVector(sd, D * side).add(new SC.THREE.Vector3(0, h, 0)); g.camera.lookAt(c.x, c.y + 3, c.z); g.camera.updateMatrixWorld(); SC.render(3);
    return true;
  }, [pred, back, side, h]);
  if (!ok) { console.log('none for', label); return; }
  const f = path.join(shots, `shape-${files.length}.png`); await page.screenshot({ path: f }); files.push(f); console.log('shot', label);
};
await pick(process.env.CH || "b.spec.type === 'chapel'", 'church', -1.2, 0.9, 5);
await pick("b.spec.type === 'chapel' && b.site === 'millbrook'", 'church2', 1.2, -0.9, 6);
await pick("b.spec.type === 'shop' && b.spec.w >= 6.5 && b.site === 'millbrook'", 'shop front', 0.7, 0.15, 1.8);
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 480 })));
await sharp({ create: { width: 1920, height: 960, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'shapes.png'));
await b.close(); srv.close();
