// Travel posts: one outside every town; ride to another post, pack left in the strongbox, collect it back.
import { launch, openPage, serve, shots } from './harness.mjs';
import path from 'node:path';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=high`, { width: 900, height: 500 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const r = await page.evaluate(() => {
  const g = SC.game, T = SC.THREE; g.manual = true; SC.setTime(11);
  const P = g.posts.posts, a = P.find((p) => p.plan.site.id === 'aurelhold'), m = P.find((p) => p.plan.site.id === 'millbrook');
  g.player.spawn(a.pos.x + 3, a.pos.z + 3); SC.stream(a.pos.x, a.pos.z);
  for (let i = 0; i < 40; i++) g.step(1 / 30);
  const c = a.pos, f = new T.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
  g.freeCam = true; g.camera.position.copy(c).addScaledVector(f, 5).add(new T.Vector3(2.5, 2.2, 0)); g.camera.lookAt(c.x, c.y + 1.4, c.z); g.camera.updateMatrixWorld(); SC.render(3);
  g.freeCam = false;
  g.interaction.money = 100; g.interaction.pack.add('apple', 3); g.interaction.pack.add('sword', 1);
  const before = g.interaction.pack.items.length;
  g.posts.travel(a, m, 0.5);
  const arrived = g.player.pos.distanceTo(m.pos);
  const packAfter = g.interaction.pack.items.length, stash = a.stash.length;
  // back again and collect
  g.posts.travel(m, a, 0.5);
  const node = g.posts['menu'](a); node.options[0].go();
  return { posts: P.length, names: P.map((p) => p.name).join(', '), before, packAfter, stash, arrived: arrived.toFixed(1), collected: g.interaction.pack.items.length, left: a.stash.length };
});
console.log(JSON.stringify(r));
await page.screenshot({ path: path.join(shots, 'post.png') });
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
