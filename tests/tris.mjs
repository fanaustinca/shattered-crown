import { launch, openPage } from './harness.mjs';
const b = await launch();
const { page } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=low', { width: 480, height: 270 });
const r = await page.evaluate(() => {
  SC.game.manual = true;
  const out = {};
  SC.game.scene.traverse((o) => { if (!o.isMesh) return; const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (g.isInstancedBufferGeometry ? g.instanceCount : o.isInstancedMesh ? o.count : 1); const k = (o.material?.name || o.material?.type) + (o.parent?.name ? '@' + o.parent.name : ''); out[k] = (out[k] || 0) + n; });
  return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 12);
});
console.log(r);
await b.close();
