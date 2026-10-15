import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1920, height: 1080 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); try { weather('clear'); } catch {} SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(3);
  const keys = []; g.scene.traverse((o) => { if (o.isBatchedMesh) keys.push(o.material.name || o.material.type); });
  return keys.length + '\n' + keys.sort().join('\n');
}));
await b.close(); srv.close();
