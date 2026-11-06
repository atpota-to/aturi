// node render.mjs <dir> : assembles frame.html + <dir>/body.html + <dir>/style.css
// into <dir>/index.html and renders light and dark, view (380x600) and full.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.resolve(here, process.argv[2]);
const frame = fs.readFileSync(path.join(here, 'frame-inspect.html'), 'utf8');
const body = fs.readFileSync(path.join(dir, 'body.html'), 'utf8');
fs.writeFileSync(path.join(dir, 'index.html'), frame.replace('<!-- BODY -->', body));
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 600 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(dir, 'index.html'), { waitUntil: 'load' });
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(dir, `${theme}__view.png`) });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  if (h > 600) {
    await page.addStyleTag({ content: '.popup-topbar,.popup-redirect{position:static!important}' });
    await page.screenshot({ path: path.join(dir, `${theme}__full.png`), fullPage: true });
  }
  console.log('ok', path.basename(dir), theme, 'height', h);
  await ctx.close();
}
await browser.close();
