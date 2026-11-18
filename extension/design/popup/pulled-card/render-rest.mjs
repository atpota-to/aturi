// Renders rest.html (the resting state) the way ../render.mjs renders
// post.html and nopage.html: light view, light full (if taller than 600),
// dark view, 380x600 at 2x.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const frame = fs.readFileSync(path.join(path.dirname(here), 'frame-open.html'), 'utf8');
const browser = await chromium.launch();
for (const name of ['rest', 'rest-on']) {
const src = path.join(here, `${name}.html`);
const html = frame.replace('<!-- BODY -->', fs.readFileSync(src, 'utf8'));
const out = path.join(here, `${name}.index.html`); fs.writeFileSync(out, html);
for (const theme of (name === 'rest' ? ['light', 'dark'] : ['light'])) {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 600 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('file://' + out, { waitUntil: 'load' });
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(here, `${name}-${theme}__view.png`) });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  if (h > 600 && theme === 'light' && name === 'rest') {
    await page.addStyleTag({ content: '.popup-topbar,.popup-redirect,[data-sticky]{position:static!important}' });
    await page.screenshot({ path: path.join(here, `${name}-${theme}__full.png`), fullPage: true });
  }
  console.log('ok', name, theme, 'height', h);
  await ctx.close();
}
}
await browser.close();
