// Conversations: a multi-step dialogue with a resident, and residents chatting with each other.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const b = await launch();
const { page, errors } = await openPage(b, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 1280, height: 720 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const r = await page.evaluate(async () => {
  const g = SC.game; g.manual = true; SC.setTime(11);
  const pl = SC.site('aurelhold');
  g.player.spawn(pl.plaza.x + 2, pl.plaza.z + 2);
  for (let i = 0; i < 60; i++) g.step(1 / 30);
  // chats among residents over two minutes of town life
  let chats = 0; const heard = [];
  for (let i = 0; i < 3600; i++) { g.step(1 / 30); if (g.talk.chats.length > chats) chats = g.talk.chats.length; for (const c of g.talk.chats) if (c.i >= 0 && c.lines[c.i] && heard.length < 12 && !heard.includes(c.lines[c.i].text)) heard.push(c.lines[c.i].text); }
  const n = g.residents.live.find((x) => x.alive && !x.hostile);
  g.player.spawn(n.st.pos.x + 1.5, n.st.pos.z);
  g.ui.openDialogue(n);
  const path = [];
  for (const pickLabel of [/Who are you/, /family/, /War|war/, /winning/, /place/, /weather/, /help/, /bring/]) {
    const btns = [...document.querySelectorAll('.dlg .opts button')];
    const bt = btns.find((x) => pickLabel.test(x.textContent)) ?? btns[0];
    path.push(bt.textContent.trim());
    bt.click();
    if (g.ui.screen !== 'dialogue') break;
  }
  const log = [...document.querySelectorAll('.dlg .log div')].map((d) => d.textContent);
  return { maxChats: chats, heard, path, log, still: g.ui.screen };
});
console.log(JSON.stringify(r, null, 1));
await page.screenshot({ path: 'tests/screenshots/talk.png' });
console.log(errors.slice(0, 5).join('\n'));
await b.close(); srv.close();
