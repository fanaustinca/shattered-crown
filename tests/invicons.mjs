import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve(); const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 1100, height: 700 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
await page.evaluate(() => {
  const g = SC.game, P = g.interaction.pack; g.manual = true;
  for (const id of ['sword', 'bow', 'arrow', 'apple', 'bread', 'cheese', 'musket', 'lantern', 'jug', 'shield', 'axe', 'candle', 'book', 'rope', 'coin_purse', 'goblet', 'bandage', 'smoked_fish']) P.add(id, id === 'arrow' ? 12 : 1);
  g.ui.openInventory();
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: path.join(shots, 'invicons.png') });
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
