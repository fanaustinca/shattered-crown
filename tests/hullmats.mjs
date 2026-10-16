import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 320, height: 240 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game; g.player.spawn(-1250, 2300); spawn.ship('manowar');
  const s = g.ships.filter((x) => x.cls === 'manowar').sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
  const out = [];
  s.model.getObjectByName('hull').traverse((o) => { if (o.isMesh && o.material.vertexColors) { const c = o.geometry.getAttribute('color'); const hist = {}; for (let i = 0; i < c.count; i += 7) { const k = [c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(2)).join(','); hist[k] = (hist[k] ?? 0) + 1; } out.push(o.material.name + ' ' + JSON.stringify(Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8))); } });
  return out.join('\n');
}));
await b.close(); srv.close();
