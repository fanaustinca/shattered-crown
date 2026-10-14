// Wagons with 1-4 horses: drive them and look.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const files = [];
for (const n of [1, 2, 3, 4]) {
  const r = await page.evaluate(async (n) => {
    const g = SC.game; g.manual = true; SC.setTime(11);
    g.player.spawn(-900, 120 + n * 30); g.player.yaw = Math.PI / 2;
    for (let i = 0; i < 20; i++) g.step(1 / 30);
    spawn.team(n);
    const c = g.carts[g.carts.length - 1];
    for (let i = 0; i < 60; i++) g.step(1 / 30);
    c.board(g.player); c.reins = 3;
    const p0 = c.pos.clone();
    for (let i = 0; i < 300; i++) g.step(1 / 30);
    const sp = c.speed;
    const lag = c.team.map((a) => +a.st.pos.distanceTo(a.hitch.pos).toFixed(2));
    const up = new SC.THREE.Vector3(0, 1, 0).applyQuaternion(c.quat).y.toFixed(2); const hits = [up];
    g.freeCam = true;
    const q = c.pos, yw = c.yaw;
    SC.view(q.x + Math.cos(yw) * 11 + Math.sin(yw) * 4, q.y + 3, q.z - Math.sin(yw) * 11 + Math.cos(yw) * 4, q.x + Math.sin(yw) * 3, q.y, q.z + Math.cos(yw) * 3);
    SC.render(3);
    g.player.standUp?.();
    return { n, speed: +sp.toFixed(2), moved: +c.pos.distanceTo(p0).toFixed(1), team: c.team.length, lag, reins: c.reins, hits };
  }, n);
  console.log(JSON.stringify(r));
  const f = path.join(shots, `team-${n}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 2) * 640, top: Math.floor(i / 2) * 360 })));
await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'teams.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
