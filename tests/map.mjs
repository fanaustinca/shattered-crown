import { launch, openPage, shots } from './harness.mjs';
import fs from 'node:fs';
const b = await launch();
const { page, errors } = await openPage(b, 'http://127.0.0.1:8941/?test&quality=low');
console.log(await page.evaluate(() => SC.stats()));
const url = await page.evaluate(() => SC.mapImage(1024));
fs.writeFileSync(shots + '/map.png', Buffer.from(url.split(',')[1], 'base64'));
console.log(errors.slice(0, 5));
await b.close();
