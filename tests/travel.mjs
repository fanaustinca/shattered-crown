// Stable yards, stablemasters and fast travel; harbour views.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = SC.game;
  const major = g.towns.plans.filter((p) => !p.minor);
  const yards = major.filter((p) => p.stableYard).map((p) => p.site.id);
  const sm = g.towns.people.filter((p) => p.role === 'stablemaster').length, fm = g.towns.people.filter((p) => p.role === 'ferryman').length;
  // fast travel Aurelhold -> Millbrook through the dialogue
  g.manual = true; SC.setTime(9);
  const au = SC.site('aurelhold');
  const [ax, az] = au.stableYard.arrive;
  g.player.spawn(ax, az); SC.stream(ax, az);
  for (let i = 0; i < 90; i++) g.step(1 / 30);
  g.interaction.money = 500;
  let n = g.residents.live.find((x) => x.person.role === 'stablemaster');
  if (!n) return { yards, sm, fm, err: 'no live stablemaster near the yard', live: g.residents.live.length };
  g.ui.openDialogue(n);
  const btn = [...document.querySelectorAll('.dlg .opts button')].find((x) => /Hire a horse/.test(x.textContent)); btn.click();
  const opts = [...document.querySelectorAll('.dlg .opts button')].map((x) => x.textContent.trim());
  const mb = [...document.querySelectorAll('.dlg .opts button')].find((x) => /Millbrook/.test(x.textContent)); mb?.click();
  const after = g.player.pos.clone(); const mill = SC.site('millbrook');
  return { yards, sm, fm, opts, arrivedDist: Math.round(Math.hypot(after.x - mill.stableYard.arrive[0], after.z - mill.stableYard.arrive[1])), hours: g.hours.toFixed(2), money: g.interaction.money };
});
console.log(JSON.stringify(r, null, 1));
const files = [];
for (const [id, v] of [['saltmarsh', 'harbour'], ['gullrock', 'harbour'], ['aurelhold', 'yard'], ['millbrook', 'yard']]) {
  await page.evaluate(([id, v]) => {
    const g = SC.game, p = SC.site(id); SC.setTime(10); g.pipeline.finalUniforms.uFade.value = 0;
    if (v === 'harbour') { const d = p.site.dock; const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw); g.player.spawn(d.x - fx * 30, d.z - fz * 30); SC.stream(d.x, d.z); SC.view(d.x + Math.cos(d.yaw) * 60 + fx * 20, 18, d.z - Math.sin(d.yaw) * 60 + fz * 20, d.x - fx * 20, 2, d.z - fz * 20); }
    else { const y = p.stableYard; g.player.spawn(y.arrive[0], y.arrive[1]); SC.stream(y.x, y.z); for (let i = 0; i < 60; i++) g.step(1 / 30); SC.view(y.arrive[0] + 18, 'g+6', y.arrive[1] + 14, y.x, 'g+1', y.z); }
    SC.render(4);
  }, [id, v]);
  const f = path.join(shots, `tr-${id}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(640, 360).toBuffer(), left: (i % 2) * 640, top: Math.floor(i / 2) * 360 })));
await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'travel.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
