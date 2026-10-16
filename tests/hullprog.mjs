import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 320, height: 240 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game; g.manual = true; g.player.spawn(-1250, 2300); spawn.ship('manowar');
  const s = g.ships.filter((x) => x.cls === 'manowar').sort((a, b) => a.pos.distanceTo(g.player.pos) - b.pos.distanceTo(g.player.pos))[0];
  g.freeCam = true; g.camera.position.copy(s.pos).add(new SC.THREE.Vector3(40, 10, 40)); g.camera.lookAt(s.pos); g.camera.updateMatrixWorld();
  SC.render(2);
  let out = [];
  s.model.getObjectByName('hull').traverse((o) => { if (o.isMesh && o.material.vertexColors) { const p = g.renderer.properties.get(o.material); const prog = p.currentProgram; const gl = g.renderer.getContext(); const sh = prog ? gl.getAttachedShaders(prog.program) : []; const src = sh.map((x) => gl.getShaderSource(x)).join(''); out.push(o.material.name + ' USE_COLOR=' + /#define USE_COLOR\b/.test(src) + ' vColor=' + src.includes('vColor')); } });
  // what does the pipeline draw the hull with? find any override material
  out.push('overrideMaterial=' + (g.scene.overrideMaterial?.type ?? 'none'));
  return out.join('\n');
}));
await b.close(); srv.close();
