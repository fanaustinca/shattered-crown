import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=ultra', { width: 800, height: 450 });
const r = await page.evaluate(() => {
  SC.game.manual = true;
  SC.setTime(11);
  SC.view(-900, 'g+3', 300, -880, 'g+0', 280);
  SC.render(3);
  return SC.probe([[0.5, 0.9], [0.5, 0.6], [0.5, 0.95], [0.2, 0.98]]);
});
console.log(JSON.stringify(r));
const r2 = await page.evaluate(() => { SC.view(-900, 'g+3', 300, -880, 'g+30', 280); SC.render(3); return SC.probe([[0.5, 0.9], [0.5, 0.5], [0.1,0.8]]); });
console.log(JSON.stringify(r2));
await b.close();
