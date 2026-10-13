import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=' + (process.argv[2] || 'ultra'), { width: 640, height: 360 });
await page.evaluate(() => { SC.game.manual = true; SC.render(2); });
for (const e of errors) console.log(e.split('\n').filter((l) => /ERROR|error|Error/.test(l)).slice(0, 12).join('\n'));
await b.close();
