// The real start flow: title screen -> Begin -> the player is in control.
import { launch, openPage, serve } from './harness.mjs';
const srv = await serve();
const browser = await launch();
const { page, errors, logs } = await openPage(browser, `http://127.0.0.1:${srv.address().port}/?quality=low`, { width: 960, height: 540 });
await page.waitForSelector('.title .go', { timeout: 60000 });
await new Promise((r) => setTimeout(r, 1000));
await page.click('.title .go');
await new Promise((r) => setTimeout(r, 3000));
const r = await page.evaluate(() => ({ freeCam: SC.game.freeCam, started: SC.game.started, paused: SC.game.paused, screen: SC.game.ui.screen, cam: SC.game.camera.position.toArray().map(Math.round), player: SC.player(), title: !!document.querySelector('.title') }));
console.log(JSON.stringify(r));
await page.screenshot({ path: 'tests/screenshots/title-after.png' });
console.log(errors.slice(0, 8).join('\n'));
await browser.close(); srv.close();
