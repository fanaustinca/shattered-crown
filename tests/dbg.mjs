import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=ultra', { width: 800, height: 450 });
const r = await page.evaluate(() => { try { SC.game.manual = true; const s = SC.site('millbrook').site; const n = SC.stream(s.x, s.z); SC.view(s.x - 40, 'g+14', s.z + 30, s.x, 'g+2', s.z); SC.render(); const x = SC.render(); const y = SC.render(); return JSON.stringify({ n, x, y, nb: SC.site('millbrook').buildings.length, census: SC.census() }); } catch (e) { return 'ERR ' + e.stack; } });
console.log(r);
console.log(errors.slice(0, 8).join('\n'));
await b.close();
