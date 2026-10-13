import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1280, height: 720 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(2);
  const found = [];
  g.scene.traverse((o) => {
    const check = (t, k) => { if (t && t.isTexture && t.image && t.image.width === 23) found.push(k + ' on ' + (o.type) + ' ' + (o.name || '') + ' v' + t.version); };
    if (o.isBatchedMesh) { check(o._matricesTexture, 'matrices'); check(o._indirectTexture, 'indirect'); check(o._colorsTexture, 'colors'); }
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { for (const k of Object.keys(m)) check(m[k], 'mat.' + k); if (m.uniforms) for (const [k, u] of Object.entries(m.uniforms)) check(u.value, 'u.' + k); }
  });
  const before = found.slice();
  for (let i = 0; i < 3; i++) { g.step(1 / 60); g.renderFrame(); }
  const after = []; g.scene.traverse((o) => { if (o.isBatchedMesh) for (const [k, t] of [['m', o._matricesTexture], ['i', o._indirectTexture]]) if (t.image.width === 23) after.push(k + ' v' + t.version + ' vis' + o._visibilityChanged + ' sort' + o.sortObjects + ' cull' + o.perObjectFrustumCulled + ' ' + (o.material.name || o.material.type) + ' parent=' + o.parent?.name); });
  return { before, after };
});
console.log(JSON.stringify(r, null, 1));
await browser.close(); srv.close();
