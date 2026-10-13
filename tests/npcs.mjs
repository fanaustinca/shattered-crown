import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=low', { width: 480, height: 270 });
for (const [site, h] of (process.argv[2] ? JSON.parse(process.argv[2]) : [['millbrook', 7.2], ['millbrook', 21.5], ['aurelhold', 12]])) {
  const r = await page.evaluate(([s, h]) => { SC.game.manual = true; return SC.npcTest(s, h, 40); }, [site, h]);
  console.log(site, h, JSON.stringify(r));
}
console.log(errors.filter((e) => !e.includes('404')).slice(0, 5).join('\n'));
await b.close();
