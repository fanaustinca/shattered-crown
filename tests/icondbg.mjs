import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 300, height: 200 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(async () => {
  const { ITEMS, buildItemMesh } = await import(document.querySelector('script[type=module]').src).catch(() => ({}));
  const out = [];
  const g = SC.game; const pr = g.props.spawn('shield', g.player.pos.clone().setY(g.player.pos.y + 3));
  pr.obj.traverse((o) => { if (o.isMesh) { const m = o.material; out.push(`${m.type} ${m.name} col=${m.color?.getHexString()} map=${m.map?.constructor?.name} img=${!!m.map?.image} metal=${m.metalness} ver=${m.vertexColors}`); } });
  return out.join('\n');
}));
await b.close(); srv.close();
