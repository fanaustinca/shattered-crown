import { launch, openPage, serve } from './harness.mjs';
const srv = await serve(); const b = await launch();
const { page } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 640, height: 480 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
console.log(await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11); g.ui.screen = 'play';
  g.player.spawn(-900, 300); for (let i = 0; i < 30; i++) g.step(1 / 60);
  const h = g.spawnAnimal('horse', new T.Vector3(-898, g.world.heightAt(-898, 300), 300)); h.mount(g.player);
  const out = [];
  for (const cmd of [1, 2, 3, 4]) {
    h.speedCmd = cmd; for (let i = 0; i < 180; i++) g.step(1 / 60);
    const p0 = h.st.pos.clone(); for (let i = 0; i < 120; i++) g.step(1 / 60);
    out.push(`cmd ${cmd}: ${(h.st.pos.distanceTo(p0) / 2).toFixed(2)} m/s st.speed ${h.st.speed.toFixed(2)} gait ${h.anim.gaitName ?? ''}`);
  }
  return out.join('\n');
}));
await b.close(); srv.close();
