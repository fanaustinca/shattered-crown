// Render a few seconds of each ensemble offline (OfflineAudioContext) to check they make sound and don't clip.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=low`, { width: 800, height: 450 });
await page.waitForFunction(() => window.SC?.game?.ready, { timeout: 180000 });
const r = await page.evaluate(async () => {
  const M = SC.game.music.constructor;
  const out = {};
  for (const mood of ['day', 'dusk', 'night', 'mountain', 'sea', 'rain', 'town', 'tavern', 'battle', 'hall']) {
    for (let k = 0; k < 2; k++) {
      const ctx = new OfflineAudioContext(2, 44100 * 20, 44100);
      const m = new M(); m.attach(ctx, ctx.destination);
      const len = m.compose(mood, 0.1);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0); let pk = 0, rms = 0; for (let i = 0; i < d.length; i++) { pk = Math.max(pk, Math.abs(d[i])); rms += d[i] * d[i]; }
      out[mood + '/' + m.ens] = { len: +len.toFixed(1), peak: +pk.toFixed(3), rms: +Math.sqrt(rms / d.length).toFixed(4) };
    }
  }
  return out;
});
console.table(r);
console.log(errors.filter((e) => !/favicon|404/.test(e)).slice(0, 5).join('\n'));
await browser.close(); srv.close();
