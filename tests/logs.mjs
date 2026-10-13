import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page, errors, logs } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=' + (process.argv[2] || 'ultra'), { width: 640, height: 360 });
await page.evaluate(() => { SC.game.manual = true; SC.render(2); });
const seen = new Set();
for (const l of [...logs, ...errors]) { const k = l.slice(0, 160); if (seen.has(k)) continue; seen.add(k); if (/warn|error|Error/.test(l)) console.log(k); }
await b.close();
