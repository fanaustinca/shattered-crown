import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=${process.argv[2] || 'ultra'}`, { width: 1920, height: 1080 });
const spots = { aurel: 'SC.teleport(-1250+8, 350+10); SC.stream(-1250,350);', plains: 'SC.teleport(-900, 300);', forest: 'SC.teleport(720, -1320);' };
for (const [name, setup] of Object.entries(spots)) {
  const r = await page.evaluate(async (setup) => {
    const g = SC.game; g.manual = true; SC.setTime(11); eval(setup); g.freeCam = false;
    for (let i = 0; i < 40; i++) { g.step(1 / 60); g.renderFrame(); }
    const gl = g.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const lights = g.lighting.csm.lights;
    const origUpd = g.lighting.update.bind(g.lighting);
    const measure = async (mask) => {
      const qs = [];
      for (let k = 0; k < 6; k++) {
        g.lighting.update = (cam) => { origUpd(cam); lights.forEach((l, i) => { l.shadow.needsUpdate = !!(mask & (1 << i)); }); };
        const qq = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, qq); g.renderFrame(); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(qq);
      }
      await new Promise((r) => setTimeout(r, 300));
      const v = qs.map((qq) => gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
      return v[2];
    };
    const out = { none: await measure(0) };
    for (let i = 0; i < lights.length; i++) out['c' + i] = +((await measure(1 << i)) - out.none).toFixed(1);
    out.none = +out.none.toFixed(1);
    const tc = g.terrain.mesh.castShadow; g.terrain.mesh.castShadow = false;
    out.c0_noTerrain = +((await measure(1)) - out.none).toFixed(1);
    g.terrain.mesh.castShadow = tc;
    const sk = []; g.scene.traverse((o) => { if (o.isSkinnedMesh && o.castShadow) sk.push(o); }); sk.forEach((o) => (o.castShadow = false));
    out.c0_noSkinned = +((await measure(1)) - out.none).toFixed(1); sk.forEach((o) => (o.castShadow = true));
    g.settlements.structures.visible = false; out.c0_noStruct = +((await measure(1)) - out.none).toFixed(1); g.settlements.structures.visible = true;
    g.trees.group.visible = false; out.c0_noTrees = +((await measure(1)) - out.none).toFixed(1); g.trees.group.visible = true;
    g.props.group.visible = false; out.c0_noProps = +((await measure(1)) - out.none).toFixed(1); g.props.group.visible = true;
    out.ext = lights.map((l) => Math.round(l.shadow.camera.right - l.shadow.camera.left));
    g.lighting.update = origUpd;
    return out;
  }, setup);
  console.log(name, JSON.stringify(r));
}
await browser.close(); srv.close();
