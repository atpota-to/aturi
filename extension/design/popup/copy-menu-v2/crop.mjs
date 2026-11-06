// node crop.mjs <state> <x> <y> <w> <h> [theme]: a 3x crop of one rendered state, for checking hairlines.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const [st, x, y, w, h, theme = 'light'] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 380, height: 600 }, deviceScaleFactor: 3, colorScheme: theme, reducedMotion: 'reduce' });
const page = await ctx.newPage();
await page.goto('file://' + path.join(here, `${st}.index.html`), { waitUntil: 'load' });
await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(here, `crop-${st}-${theme}.png`), clip: { x: +x, y: +y, width: +w, height: +h } });
await browser.close();
console.log('ok');
