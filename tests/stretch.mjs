// Stretch monitor: play normally (real frame loop) in a busy place and check every frame for skinned meshes or
// cloths whose vertices fly far from their owner (the one-frame "everything stretches" glitch).
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 960, height: 540 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const where = process.env.WHERE ?? 'aurelhold';
const r = await page.evaluate(async (where) => {
  const T = SC.THREE, g = SC.game;
  const pl = SC.site(where);
  g.player.spawn(pl.plaza.x + 2, pl.plaza.z + 2);
  SC.play();
  const v = new T.Vector3(), bad = [];
  const check = (frame) => {
    g.scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isSkinnedMesh) {
        const e = o.bindMatrix.elements, slot = e[3]; e[3] = 0;
        const pos = o.geometry.attributes.position; const bb = new T.Box3();
        for (let i = 0; i < pos.count; i += 11) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); bb.expandByPoint(v); }
        e[3] = slot;
        const s = bb.getSize(new T.Vector3()).length();
        if (!(s < 8)) bad.push({ frame, kind: 'skin', s: +s.toFixed(1), slot });
      } else if (o.isMesh && o.geometry?.userData?.cloth) {
        o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(new T.Vector3()).length();
        if (!(s < 8)) bad.push({ frame, kind: 'cloth', s: +s.toFixed(1) });
      }
    });
  };
  let frame = 0;
  // walk around the plaza for a while, running, turning
  const t0 = performance.now();
  while (performance.now() - t0 < 25000) {
    await new Promise((res) => requestAnimationFrame(res));
    frame++;
    g.player.yaw += 0.01;
    g.input.down.add('KeyW'); if (frame % 200 < 100) g.input.down.add('ShiftLeft'); else g.input.down.delete('ShiftLeft');
    if (frame % 3 === 0) check(frame);
  }
  return { frames: frame, bad: bad.slice(0, 20), nBad: bad.length };
}, where);
console.log(JSON.stringify(r, null, 1));
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
