// node render2.mjs <dir> [state ...]: renders every <dir>/<state>.html (all
// top-level *.html except *.index.html when no states are given) into the
// open frame: light view, light full (if taller than 600) and dark view.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.resolve(here, process.argv[2]);
const states = process.argv.length > 3 ? process.argv.slice(3) : fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.endsWith('.index.html')).map((f) => f.slice(0, -5));
const frame = fs.readFileSync(path.join(here, 'frame-open.html'), 'utf8');
const browser = await chromium.launch();
for (const st of states) {
  const src = path.join(dir, `${st}.html`);
  if (!fs.existsSync(src)) { console.log('skip', st); continue; }
  const out = path.join(dir, `${st}.index.html`);
  fs.writeFileSync(out, frame.replace('<!-- BODY -->', fs.readFileSync(src, 'utf8')));
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 380, height: 600 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('file://' + out, { waitUntil: 'load' });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(dir, `${st}-${theme}__view.png`) });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (h > 600 && theme === 'light') {
      await page.addStyleTag({ content: '.popup-topbar,.popup-redirect,[data-sticky]{position:static!important}' });
      await page.screenshot({ path: path.join(dir, `${st}-${theme}__full.png`), fullPage: true });
    }
    console.log('ok', path.basename(dir), st, theme, 'height', h);
    await ctx.close();
  }
}
await browser.close();
