// Which objects produce draw calls in one frame (main + shadow + water passes).
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1920, height: 1080 });
const where = process.argv[2] || 'millbrook';
const r = await page.evaluate((where) => {
  const g = SC.game; g.manual = true; SC.setTime(11);
  if (where === 'millbrook') { SC.teleport(-620 + 6, 940 + 6); SC.stream(-620, 940); SC.advance(3); }
  else if (where === 'aurel') { SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(3); }
  else if (where === 'plains') SC.view(-900, 'g+1.7', 300, -800, 'g+1.5', 250);
  for (let i = 0; i < 30; i++) { g.step(1/60); g.renderFrame(); }
  const r = g.renderer, orig = r.renderBufferDirect.bind(r), out = {};
  const hint = (o) => { let p = o; while (p.parent && p.parent !== g.scene) p = p.parent; return p === g.props.group ? 'props' : p === g.settlements.structures ? 'structures' : p === g.settlements.lod ? 'lod' : p.name === 'batches' ? 'batches' : [...g.settlements.live.values()].some((l) => l.root === p) ? 'building' : (p.name || p.type) + '/' + (p.children[0]?.type ?? '') + '#' + g.scene.children.indexOf(p) + ':' + (o.name || o.geometry?.type || '') + ':' + (o.material?.name || o.material?.type || ''); };
  let shadow = false;
  r.renderBufferDirect = function (cam, scene, geo, mat, obj, grp) { const k = (cam.isOrthographicCamera ? 'SH ' : 'MAIN ') + hint(obj) + ' ' + (obj.isSkinnedMesh ? 'skin' : obj.isInstancedMesh ? 'inst' : obj.isBatchedMesh ? 'batch' : obj.type); out[k] = (out[k] ?? 0) + 1; return orig(cam, scene, geo, mat, obj, grp); };
  g.renderFrame();
  r.renderBufferDirect = orig;
  return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 30);
}, where);
for (const [k, v] of r) console.log(String(v).padStart(6), k);
await browser.close(); srv.close();
