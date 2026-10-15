// A/B toggles at runtime in Aurelhold: submit time with features switched off one at a time.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1920, height: 1080 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); weather('clear');
  SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(3);
  const gl = g.renderer.getContext(), px = new Uint8Array(4), sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const meas = () => { for (let i = 0; i < 6; i++) g.renderFrame(); sync(); let s = 0, f = 0; for (let i = 0; i < 30; i++) { const t0 = performance.now(); g.renderFrame(); const t1 = performance.now(); sync(); const t2 = performance.now(); s += t1 - t0; f += t2 - t0; } return `submit ${(s / 30).toFixed(1)} frame ${(f / 30).toFixed(1)} calls ${g.pipeline.stats.calls}`; };
  const out = ['base ' + meas()];
  const hideWhere = (pred, name) => { const hidden = []; g.scene.traverse((o) => { if (o.visible && pred(o)) { o.visible = false; hidden.push(o); } }); out.push(name + ' (' + hidden.length + ') ' + meas()); for (const o of hidden) o.visible = true; };
  hideWhere((o) => o.isBatchedMesh && /^cloth:canvas/.test(o.material.name), 'no awnings');
  hideWhere((o) => o.isBatchedMesh && /^color:/.test(o.material.name), 'no sign colours');
  hideWhere((o) => o.isInstancedMesh && g.gates.meshes.includes(o), 'no gates');
  hideWhere((o) => o === g.posts.group, 'no posts');
  hideWhere((o) => o.isMesh && o.material?.vertexColors, 'no vcol meshes');
  hideWhere((o) => o.isBatchedMesh && o.material?.vertexColors, 'no vcol batches');
  hideWhere((o) => o === g.props.group, 'no props');
  hideWhere((o) => o === g.settlements.structures, 'no structures');
  hideWhere((o) => o.isSkinnedMesh, 'no skinned');
  hideWhere((o) => o.name === 'interior', 'no interiors');
  return out.join('\n');
});
console.log(r);
await b.close(); srv.close();
