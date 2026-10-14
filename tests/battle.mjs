// A pitched battle at a bridge: forming, advancing, charging; who wins; screenshots.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate((top) => {
  window.__top = top; const g = SC.game; g.manual = true; SC.setTime(10); weather('clear');
  const F = g.war.fronts, f = F.fronts[1];
  const { p, dir } = F.posAt(f, f.line);
  window.__f = f;
  g.player.spawn(p.x + dir.z * 60, p.z - dir.x * 60);
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  F.begin(f);
  const L = f.live; g.player.spawn(L.center.x - L.dir.z * 45, L.center.z + L.dir.x * 45);
}, !!process.env.TOP);
const files = [];
for (let k = 0; k < 6; k++) {
  const r = await page.evaluate((k) => {
    const g = SC.game, f = window.__f, F = g.war.fronts;
    for (let i = 0; i < 30 * (k === 0 ? 15 : 12); i++) g.step(1 / 30);
    const L = f.live;
    const ids = L ? [...L.ids] : [];
    const count = (side) => ids.filter((s) => s.alive && s.side === side).length;
    const phases = {}; for (const s of ids) if (s.alive && s.battle) phases[s.battle.phase] = (phases[s.battle.phase] ?? 0) + 1;
    const cav = g.war.soldiers.filter((s) => s.alive && s.horse).length;
    const { p, dir } = F.posAt(f, f.line);
    // look at the thick of it: the centroid of the living soldiers, from behind the Vanguardian side
    const alive = ids.filter((s) => s.alive);
    const c = alive.reduce((a, s) => a.add(s.st.pos), new SC.THREE.Vector3()).multiplyScalar(1 / Math.max(1, alive.length));
    const d = L ? L.dir : dir;
    const side = new SC.THREE.Vector3(-d.z, 0, d.x);
    g.freeCam = true; if (window.__top) { g.camera.position.set(L.center.x - d.x * 1 , L.center.y + 140, L.center.z - d.z * 1); g.camera.lookAt(L.center.x, L.center.y, L.center.z); } else { g.camera.position.set(L.center.x - d.x * 20 + side.x * 75, L.center.y + 22, L.center.z - d.z * 20 + side.z * 75); g.camera.lookAt(L.center.x, L.center.y + 1, L.center.z); } g.camera.updateMatrixWorld();
    SC.render(3);
    const proj = (side) => { const a = ids.filter((x) => x.alive && x.side === side); if (!a.length || !L) return '-'; const m = a.reduce((q, x) => q + x.st.pos.clone().sub(L.center).dot(L.dir), 0) / a.length; const y = a.reduce((q, x) => q + x.st.pos.y, 0) / a.length; const np = a.filter((x) => !x.path.length).length; const stuck = a.filter((x) => x.stuckT > 1).length; return `${m.toFixed(0)}m y${y.toFixed(1)} nopath${np} stuck${stuck} sp${a.reduce((q, x) => q + x.st.speed, 0).toFixed(0)}`; };
    const ax = L ? L.dir : dir, ac = new SC.THREE.Vector3(-ax.z, 0, ax.x), C0 = L ? L.center : p;
    window.__plots = window.__plots ?? [];
    window.__plots.push(ids.map((x) => [x.st.pos.clone().sub(C0).dot(ac), x.st.pos.clone().sub(C0).dot(ax), x.side === 'vanguardia' ? 0 : 1, x.alive ? (x.archer ? 2 : x.horse ? 3 : 1) : 0]));
    return { arrows: g.combat.arrows.length, guns: L?.guns?.length, pv: proj('vanguardia'), pi: proj('ironreach'), t: L?.t?.toFixed(0) ?? 'done', v: count('vanguardia'), i: count('ironreach'), phases, cav, line: f.line.toFixed(2), log: F.log.slice(-1)[0] ?? '' };
  }, k);
  console.log(JSON.stringify(r));
  const f = path.join(shots, `battle-${k}.png`); await page.screenshot({ path: f }); files.push(f);
}
const plots = await page.evaluate(() => window.__plots);
{
  const W = 300, svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W * 3}" height="${W * 2}"><rect width="100%" height="100%" fill="#ddd"/>`];
  plots.forEach((pts, k) => {
    const ox = (k % 3) * W, oy = Math.floor(k / 3) * W;
    svg.push(`<rect x="${ox}" y="${oy}" width="${W}" height="${W}" fill="none" stroke="#000"/>`);
    for (const [x, y, sd, kind] of pts) {
      const px = ox + W / 2 + x * 1.2, py = oy + W / 2 - y * 1.2;
      const col = kind === 0 ? '#888' : sd ? (kind === 2 ? '#f80' : kind === 3 ? '#800' : '#d00') : (kind === 2 ? '#0cf' : kind === 3 ? '#008' : '#03f');
      svg.push(`<circle cx="${px}" cy="${py}" r="${kind === 0 ? 1.5 : 2.5}" fill="${col}"/>`);
    }
  });
  svg.push('</svg>');
  await sharp(Buffer.from(svg.join(''))).png().toFile(path.join(shots, 'battle-plot.png'));
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 3) * 640, top: Math.floor(i / 3) * 360 })));
await sharp({ create: { width: 1920, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'battle.png'));
console.log(errors.slice(0, 8).join('\n'));
await b.close(); srv.close();
