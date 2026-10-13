import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=ultra`, { width: 1280, height: 720 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(3);
  const w = g.physics.world;
  let bodies = 0, dyn = 0, awake = 0, kin = 0, fixed = 0, cols = 0;
  w.bodies.forEach((b) => { bodies++; if (b.isDynamic()) { dyn++; if (!b.isSleeping()) awake++; } else if (b.isKinematic()) kin++; else fixed++; });
  w.colliders.forEach(() => cols++);
  let objs = 0, auto = 0, meshes = 0; const trans = new Set();
  g.scene.traverse((o) => { objs++; if (o.matrixAutoUpdate) auto++; if (o.isMesh) { meshes++; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m.transmission > 0) trans.add(m.name || m.uuid); } });
  // textures whose version changes across a frame
  const texs = new Map();
  g.scene.traverse((o) => { if (!o.material) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { for (const k of Object.keys(m)) if (m[k]?.isTexture) texs.set(m[k], k); if (m.uniforms) for (const [k, u] of Object.entries(m.uniforms)) if (u.value?.isTexture) texs.set(u.value, k); if (m.userData?.shader) for (const [k, u] of Object.entries(m.userData.shader.uniforms)) if (u.value?.isTexture) texs.set(u.value, k); } });
  const v0 = new Map([...texs.keys()].map((t) => [t, t.version]));
  g.step(1 / 60); g.renderFrame();
  const changed = [...texs.keys()].filter((t) => t.version !== v0.get(t)).map((t) => texs.get(t) + ' ' + (t.image?.width ?? '?') + 'x' + (t.image?.height ?? '?') + ' ' + t.constructor.name);
  return { bodies, dyn, awake, kin, fixed, cols, objs, auto, meshes, trans: [...trans].slice(0, 10), transN: trans.size, changed, props: g.props.props.size };
});
console.log(JSON.stringify(r, null, 1));
await browser.close(); srv.close();
