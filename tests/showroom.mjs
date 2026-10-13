// Furniture showroom QA: GPU=1 node tests/showroom.mjs bed,chair,...
import { launch, openPage, shots } from './harness.mjs';
import path from 'node:path';
const cats = (process.argv[2] || 'bed,chair,stool,bench,table,desk,wardrobe,drawers,chest,shelf,cupboard,candle,rug,misc').split(',');
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=ultra', { width: 1400, height: 800 });
await page.evaluate(() => { SC.game.manual = true; document.getElementById('loading')?.remove(); SC.setTime(10.5); });
for (const c of cats) {
  const info = await page.evaluate((c) => {
    const r = SC.showroom(c, 12);
    SC.view(-1250 + 6.5, 'g+3.2', 330 + 9.5, -1250 + 6.5, 'g+0.4', 330 + 1.3);
    return r;
  }, c);
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => SC.render(3));
  await page.screenshot({ path: path.join(shots, `show-${c}.png`) });
  console.log(c, JSON.stringify(info));
}
console.log(errors.slice(0, 5).join('\n'));
await b.close();
