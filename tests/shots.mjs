// Visual QA: renders named views with the real GPU and saves screenshots.
//   GPU=1 node tests/shots.mjs [filter] [--url=http://127.0.0.1:8941/] [--q=ultra]
import { launch, openPage, shots } from './harness.mjs';
import path from 'node:path';
const args = process.argv.slice(2);
const url = (args.find((a) => a.startsWith('--url=')) || '--url=http://127.0.0.1:8941/').slice(6);
const q = (args.find((a) => a.startsWith('--q=')) || '--q=ultra').slice(4);
const filter = args.find((a) => !a.startsWith('--'));
const W = +(process.env.W || 1600), H = +(process.env.H || 900);
const VIEWS = (await import('./views.mjs')).VIEWS;
const b = await launch();
const { page, errors, logs } = await openPage(b, `${url}?test&quality=${q}`, { width: W, height: H });
await page.evaluate(() => { SC.game.manual = true; document.getElementById('loading')?.remove(); });
for (const v of VIEWS) {
  if (filter && !v.name.includes(filter)) continue;
  const t0 = Date.now();
  const info = await page.evaluate(async (v) => {
    if (v.setup) await (0, eval)('(' + v.setup + ')')(SC);
    if (v.time !== undefined) SC.setTime(v.time);
    if (v.overcast !== undefined) SC.setOvercast(v.overcast);
    if (v.cam) SC.view(...v.cam);
    else if (window.__h) SC.view(window.__h.x + 9, 'g+2.2', window.__h.z + 9, window.__h.x, 'g+0.8', window.__h.z);
    for (let i = 0; i < (v.frames || 4); i++) SC.render();
    await new Promise((r) => setTimeout(r, 50));
    return SC.render();
  }, { ...v, setup: v.setup ? v.setup.toString() : null });
  await page.screenshot({ path: path.join(shots, `v-${v.name}.png`) });
  console.log(v.name, JSON.stringify(info), Date.now() - t0 + 'ms');
}
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 20).join('\n'));
console.log(logs.filter((l) => l.startsWith('[warn')).slice(0, 10).join('\n'));
await b.close();
