// Side and deck views of every bridge.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(12); weather('clear'); });
const files = [];
for (let i = 0; i < 3; i++) for (const v of ['side', 'deck', 'end']) {
  const info = await page.evaluate(([i, v]) => {
    const g = SC.game, br = g.world.bridges[i];
    const ax = Math.cos(br.yaw), az = -Math.sin(br.yaw);   // along the deck
    const nx = -az, nz = ax;                                  // across (upstream/downstream)
    g.player.spawn(br.x + ax * (br.len / 2 + 10), br.z + az * (br.len / 2 + 10));
    SC.stream(br.x, br.z);
    if (v === 'side') SC.view(br.x + nx * br.len * 0.9, br.deck + 4, br.z + nz * br.len * 0.9, br.x, br.deck - 2, br.z);
    else if (v === 'deck') SC.view(br.x - ax * (br.len / 2 + 14), br.deck + 3, br.z - az * (br.len / 2 + 14), br.x + ax * 20, br.deck, br.z + az * 20);
    else SC.view(br.x + ax * (br.len / 2 + 12) + nx * 14, br.deck + 2, br.z + az * (br.len / 2 + 12) + nz * 14, br.x + ax * (br.len / 2), br.deck - 3, br.z + az * (br.len / 2));
    SC.render(4);
    const e = [-1, 1].map((s) => { const x = br.x + ax * s * br.len / 2, z = br.z + az * s * br.len / 2; return +(g.world.heightAt(x, z) - br.deck).toFixed(1); });
    return { name: br.name, len: br.len, deck: br.deck, groundMinusDeckAtEnds: e };
  }, [i, v]);
  if (v === 'side') console.log(JSON.stringify(info));
  const f = path.join(shots, `br-${i}-${v}.png`); await page.screenshot({ path: f }); files.push(f);
}
const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(480, 270).toBuffer(), left: (i % 3) * 480, top: Math.floor(i / 3) * 270 })));
await sharp({ create: { width: 1440, height: 810, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'bridges.png'));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
