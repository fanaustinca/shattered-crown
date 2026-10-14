// Z-fighting finder: render each view, nudge the camera by half a millimetre, render again. Coplanar surfaces
// fighting for the same depth flip between materials; everything else barely changes. Flagged pixels are
// painted magenta in tests/screenshots/zf-<view>.png.
import fs from 'node:fs';
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 1280, height: 720 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(13); weather('clear');
  g.pipeline.finalUniforms.uGrain.value = 0;
  window.__grab = () => { const c = g.renderer.domElement, k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const x = k.getContext('2d'); x.drawImage(c, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
  window.__zf = (setup) => {
    setup();
    for (let i = 0; i < 4; i++) g.renderFrame();
    const a = __grab();
    const cam = g.camera, p0 = cam.position.clone();
    let flagged = null;
    for (const off of [[0.0005, 0.0003, -0.0004], [-0.0004, -0.0005, 0.0006], [0.0006, 0.0001, 0.0005]]) {
      cam.position.set(p0.x + off[0], p0.y + off[1], p0.z + off[2]); cam.updateMatrixWorld();
      g.renderFrame();
      const b = __grab();
      const W = a.width, H = a.height, f = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) { const k = i * 4; f[i] = Math.abs(a.data[k] - b.data[k]) + Math.abs(a.data[k + 1] - b.data[k + 1]) + Math.abs(a.data[k + 2] - b.data[k + 2]) > 70 ? 1 : 0; }
      if (!flagged) flagged = f; else for (let i = 0; i < f.length; i++) flagged[i] |= f[i];
    }
    cam.position.copy(p0); cam.updateMatrixWorld();
    const W = a.width, H = a.height;
    let n = 0; const out = new ImageData(new Uint8ClampedArray(a.data), W, H);
    const boxes = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (!flagged[i]) continue;
      let nb = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nb += flagged[i + dy * W + dx];
      if (nb < 5) continue;   // thin edges shimmer when the camera moves; blotches are z-fighting
      n++; const k = i * 4; out.data[k] = 255; out.data[k + 1] = 0; out.data[k + 2] = 255;
      if (boxes.length < 400 && n % 25 === 0) boxes.push([x, y]);
    }
    const k = document.createElement('canvas'); k.width = W; k.height = H; k.getContext('2d').putImageData(out, 0, 0);
    // what is under a few flagged pixels
    const hits = [];
    const ray = new SC.THREE.Raycaster();
    for (const [x, y] of boxes.filter((_, j) => j % Math.max(1, Math.floor(boxes.length / 8)) === 0).slice(0, 8)) {
      ray.setFromCamera(new SC.THREE.Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), cam);
      cam.layers.enableAll(); ray.layers.enableAll();
      const hs = ray.intersectObjects(g.scene.children, true).filter((h) => h.object.visible).slice(0, 3);
      hits.push(hs.map((h) => `${h.object.name || h.object.type}${h.object.parent ? '<' + (h.object.parent.name || h.object.parent.type) : ''}@${h.distance.toFixed(2)}${h.object.material ? ':' + ([].concat(h.object.material)[0].name || '') : ''}`).join(' | '));
    }
    return { frac: n / (W * H), png: k.toDataURL('image/png'), hits };
  };
});
const views = {
  street: `const s = g.towns.plans[0].site; SC.stream(s.x, s.z + 30); SC.view(s.x + 4, 'g+1.7', s.z + 40, s.x, 'g+3', s.z);`,
  bridge: `const b = g.world.bridges[1]; SC.view(b.x + Math.sin(b.yaw) * 40 + 25, b.deck + 4, b.z + Math.cos(b.yaw) * 40, b.x, b.deck, b.z);`,
  interior: `const pl = g.towns.plans[0]; const bd = pl.buildings.find((q) => q.spec.type === 'house' && q.spec.floors > 1); SC.stream(bd.x, bd.z); g.settlements.update?.(new SC.THREE.Vector3(bd.x, bd.y, bd.z)); const cy = bd.y + 1.0 + 1.6; SC.view(bd.x + 0.3, cy, bd.z + 0.4, bd.x - 3, cy - 0.6, bd.z - 2);`,
  castle: `const s = SC.site('whitecrest').site; SC.stream(s.x, s.z); SC.view(s.x + s.r * 1.6, 'g+12', s.z + s.r * 0.6, s.x, 'g+8', s.z);`,
  farm: `const p = g.towns.plans.find((q) => q.minor); const b = p.buildings[0]; SC.stream(b.x, b.z); SC.view(b.x + 18, 'g+3', b.z + 14, b.x, 'g+2', b.z);`,
  ironspire: `const s = SC.site('ironspire').site; SC.stream(s.x, s.z + 20); SC.view(s.x + 10, 'g+1.7', s.z + 30, s.x, 'g+4', s.z);`,
};
const want = process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(views);
for (const v of want) {
  const r = await page.evaluate((code) => { const g = SC.game; return __zf(() => { eval(code); }); }, views[v]).catch((e) => ({ err: String(e) }));
  if (r.err) { console.log(v, r.err); continue; }
  fs.writeFileSync(`tests/screenshots/zf-${v}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(v, (r.frac * 100).toFixed(3) + '%');
  for (const h of r.hits) console.log('   ', h);
}
console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 5).join('\n'));
await browser.close(); srv.close();
