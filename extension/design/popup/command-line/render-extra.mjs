// node render-extra.mjs <basename...> : renders <basename>.html in this
// directory the way ../render.mjs does (light and dark view at 380x600, 2x;
// light full when taller than 600).
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const frame = fs.readFileSync(path.join(here, '..', 'frame-open.html'), 'utf8');
const browser = await chromium.launch();
for (const name of process.argv.slice(2)) {
  const src = path.join(here, `${name}.html`);
  const html = frame.replace('<!-- BODY -->', fs.readFileSync(src, 'utf8'));
  const out = path.join(here, `${name}.index.html`); fs.writeFileSync(out, html);
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 380, height: 600 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('file://' + out, { waitUntil: 'load' });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(here, `${name}-${theme}__view.png`) });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (h > 600 && theme === 'light') {
      await page.addStyleTag({ content: '.popup-topbar,.popup-redirect,[data-sticky]{position:static!important}' });
      await page.screenshot({ path: path.join(here, `${name}-${theme}__full.png`), fullPage: true });
    }
    console.log('ok', name, theme, 'height', h);
    await ctx.close();
  }
}
await browser.close();
