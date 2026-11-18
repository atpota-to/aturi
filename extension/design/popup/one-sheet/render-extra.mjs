// Extra states render.mjs does not cover: the end of the post sheet with the
// filed drawer pulled open and auto-redirect on; the no-data page with one
// group opened. Run after render.mjs (it needs post.index.html).
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/node_modules/')('playwright');
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch();
for (const theme of ['light']) {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 600 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(here, 'post.index.html'), { waitUntil: 'load' });
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    document.querySelector('.os-drawer').open = true;
  }, theme);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(here, `post-end-open-${theme}__view.png`) });
  // Auto-redirect on.
  await page.goto('file://' + path.join(here, 'post.index.html'), { waitUntil: 'load' });
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    const f = document.querySelector('.os-redirect');
    f.classList.add('is-on');
    f.querySelector('.popup-redirect-label').insertAdjacentHTML('beforeend', '<span class="popup-redirect-sub">Posts open in Anisota</span>');
    f.querySelector('.aturi-switch').insertAdjacentHTML('beforebegin', '<button type="button" class="popup-redirect-pause">Pause on this tab</button>');
    f.querySelector('.aturi-switch').classList.add('on');
    f.querySelector('.popup-redirect-state').textContent = 'On';
    document.querySelector('.os-topbar-redirect').hidden = false;
  }, theme);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(here, `post-redirect-on-${theme}__view.png`) });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(here, `post-redirect-on-end-${theme}__view.png`) });
  // No-data page with the first group open.
  await page.goto('file://' + path.join(here, 'nopage.index.html'), { waitUntil: 'load' });
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; document.querySelector('.os-group').open = true; }, theme);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(here, `nopage-group-open-${theme}__view.png`) });
  await ctx.close();
}
await browser.close();
console.log('extra renders ok');
