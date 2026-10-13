import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1280, height: 720 });
const r = await page.evaluate((where) => {
  const g = SC.game; g.manual = true; SC.setTime(11);
  if (where === 'forest') SC.view(700,'g+2',-1300,760,'g+6',-1350); else { SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(2); }
  g.renderFrame();
  const out = {};
  const top = (o) => { let p = o, path = []; while (p && p.parent && p.parent !== g.scene) { p = p.parent; } const i = g.scene.children.indexOf(p); const hint = p === g.props.group ? 'props' : p === g.settlements.structures ? 'structures' : p === g.settlements.lod ? 'lod' : [...g.settlements.live.values()].some((l) => l.root === p) ? 'buildingRoot' : 'idx' + i + ':' + p.children.length + ':' + Object.keys(p.userData).join('/'); return (p.name || p.type) + ' ' + hint; };
  g.scene.traverseVisible((o) => { if (!o.isMesh || !o.castShadow) return; const k = top(o) + ' ' + (o.isInstancedMesh ? 'inst' : o.isBatchedMesh ? 'batch' : o.isSkinnedMesh ? 'skinned' : 'mesh'); out[k] = (out[k] ?? 0) + 1; });
  return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 25);
}, process.argv[2] || 'town');
for (const [k, v] of r) console.log(String(v).padStart(6), k);
await browser.close(); srv.close();
