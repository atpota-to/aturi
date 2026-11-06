// node check-presets.mjs: renders the top bar and the strip of post-closed at
// the small (360), medium (380), large (420) and xlarge (460) text presets,
// to prove the switch and the two glyphs hold and the +N count follows.
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const presets = [['small', 360], ['medium', 380], ['large', 420], ['xlarge', 460]];
const browser = await chromium.launch();
for (const [fs, w] of presets) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 600 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(here, 'post-closed.index.html'), { waitUntil: 'load' });
  await page.evaluate(([f, width]) => { document.documentElement.dataset.fs = f; document.body.style.width = width + 'px'; }, [fs, w]);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  // Re-run the strip script's measurement by nudging a scroll event.
  await page.evaluate(() => { const r = document.querySelector('.cm2-tabs-scroll'); if (r) r.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(200);
  const info = await page.evaluate(() => {
    const right = document.querySelector('.cm2-topbar-right').getBoundingClientRect();
    const title = document.querySelector('.popup-title').getBoundingClientRect();
    const more = document.querySelector('.cm2-tab-more');
    return { rightWidth: Math.round(right.width), gapBrandToControls: Math.round(right.left - title.right), more: more && more.textContent };
  });
  console.log(fs, w, JSON.stringify(info));
  await page.screenshot({ path: path.join(here, `preset-${fs}-bar.png`), clip: { x: 0, y: 0, width: w, height: 200 } });
  await ctx.close();
}
await browser.close();
