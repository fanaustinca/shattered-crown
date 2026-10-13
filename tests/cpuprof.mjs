// CPU profile of game.step + renderFrame in a busy spot; prints top self-time functions.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?test&quality=${process.argv[2] || 'ultra'}`, { width: 1920, height: 1080 });
await page.evaluate(() => { SC.game.manual = true; SC.setTime(11); SC.teleport(-1250 + 8, 350 + 10); SC.stream(-1250, 350); SC.advance(3); for (let i = 0; i < 90; i++) { SC.game.step(1 / 60); SC.game.renderFrame(); } });
const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.evaluate(() => { const g = SC.game; const gl = g.renderer.getContext(); const px = new Uint8Array(4); for (let i = 0; i < 40; i++) { g.step(1 / 60); g.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } });
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
let total = 0;
for (const [id, t] of counts) { const n = byId.get(id); const cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`; self.set(k, (self.get(k) ?? 0) + t); total += t; }
console.log('total ms', (total / 1000).toFixed(0));
for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, +(process.argv[3] || 40))) console.log((t / 1000).toFixed(1).padStart(8), k);
// parents of hot leaves, and inclusive time by function
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const name = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`;
const incl = new Map();
for (const [id, t] of counts) { const seen = new Set(); let c = id; while (c) { const k = name(byId.get(c)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + t); } c = parent.get(c); } }
console.log('--- inclusive');
for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 70)) console.log((t / 1000).toFixed(1).padStart(8), k);
for (const leaf of (process.argv[4] || 'texSubImage2D,updateMatrix').split(',')) {
  const pm = new Map();
  for (const [id, t] of counts) { const n = byId.get(id); if (n.callFrame.functionName !== leaf) continue; let c = parent.get(id); const chain = []; for (let k = 0; k < 6 && c; k++) { chain.push(name(byId.get(c))); c = parent.get(c); } const key = chain.join(' < '); pm.set(key, (pm.get(key) ?? 0) + t); }
  console.log('--- callers of', leaf); for (const [k, t] of [...pm].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log((t / 1000).toFixed(1).padStart(8), k);
}
await browser.close(); srv.close();
