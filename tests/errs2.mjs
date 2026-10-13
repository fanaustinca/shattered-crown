import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=ultra', { width: 640, height: 360 });
await page.evaluate(() => { SC.game.manual = true; SC.gallery(-900, 300, ['horse','human0']); SC.view(-893, 'g+1.6', 305.5, -893, 'g+0.8', 300); SC.render(2); });
for (const e of errors) console.log(e.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 12).join('\n'));
await b.close();
