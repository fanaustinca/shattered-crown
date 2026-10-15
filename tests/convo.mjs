// Conversations drift: after an insult, a compliment or a topic, the choices change with what was said.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 240000 });
const r = await page.evaluate(() => {
  const g = SC.game; g.manual = true; SC.setTime(11);
  const pl = SC.site('millbrook'); g.player.spawn(pl.plaza.x + 3, pl.plaza.z + 3); SC.stream(pl.plaza.x, pl.plaza.z);
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  const out = [];
  const people = g.residents.live.filter((n) => n.alive && n.person.role !== 'guard').slice(0, 3);
  const show = (tag, node) => out.push(`${tag}: "${node.line}"\n    → ${node.options.map((o) => o.label).join(' | ')}`);
  for (const [k, n] of people.entries()) {
    let node = g.talk.begin(n); show('root', node);
    const pickL = (re) => node.options.find((o) => re.test(o.label));
    if (k === 0) { node = pickL(/Insult/).go(); show('insult', node); const o = node.options.find((x) => /jesting|Forgive/.test(x.label)); node = o.go(); show(o.label, node); if (node?.options?.length) { node = node.options[0].go(); if (node) show('then', node); } }
    if (k === 1) { node = pickL(/war/).go(); show('war', node); node = node.options[0].go(); show('…', node); node = node.options[0].go(); show('…', node); node = node.options[0].go(); show('…', node); }
    if (k === 2) { node = pickL(/Compliment/).go(); show('compliment', node); node = node.options[0].go(); show('…', node); node = node.options[0].go(); show('…', node); }
    g.talk.end();
  }
  return out.join('\n');
});
console.log(r);
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
