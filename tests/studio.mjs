// Creature studio: renders each species in poses from several angles into a contact sheet.
//   GPU=1 node tests/studio.mjs horse,cow [poses]
import { launch, openPage, shots } from './harness.mjs';
import path from 'node:path';
import sharp from 'sharp';
const ids = (process.argv[2] || 'horse,donkey,cow,pig,bunny').split(',');
const poses = [
  { n: 'side', speed: 0, action: 'idle', t: 0.5, ang: 0, dist: 0.9 },
  { n: '34', speed: 0, action: 'idle', t: 0.5, ang: 0.8, dist: 0.85 },
  { n: 'front', speed: 0, action: 'idle', t: 0.5, ang: Math.PI / 2, dist: 0.9 },
  { n: 'walk', speed: 1.4, action: 'idle', t: 2.3, ang: 0, dist: 0.9 },
  { n: 'trot', speed: 3.2, action: 'idle', t: 2.15, ang: 0.3, dist: 0.9 },
  { n: 'gallop', speed: 10, action: 'idle', t: 2.07, ang: 0, dist: 0.9 },
  { n: 'graze', speed: 0, action: 'graze', t: 3, ang: 0.6, dist: 0.9 },
  { n: 'sleep', speed: 0, action: 'sleep', t: 5, ang: 0.6, dist: 0.9 },
];
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=ultra', { width: 640, height: 480 });
await page.evaluate(() => { SC.game.manual = true; document.getElementById('loading')?.remove(); SC.setTime(10.5); });
for (const id of ids) {
  const files = [];
  for (const p of poses) {
    await page.evaluate(([id, p]) => { SC.studio(id, p.speed, p.action, p.t, p.ang, p.dist); SC.render(3); }, [id, p]);
    const f = path.join(shots, `st-${id}-${p.n}.png`);
    await page.screenshot({ path: f }); files.push(f);
  }
  const comps = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(400, 300).toBuffer(), left: (i % 4) * 400, top: Math.floor(i / 4) * 300 })));
  await sharp({ create: { width: 1600, height: 600, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, `studio-${id}.png`));
  console.log('studio', id);
}
console.log(errors.slice(0, 5).join('\n'));
await b.close();
