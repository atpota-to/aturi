import { browser, defineContentScript } from '#imports';

/**
 * Safari only: tell the background that a sign-in tab has reached the return
 * page, and with what URL.
 *
 * The background already watches `tabs.onUpdated` for this (lib/tabSignIn.ts).
 * This is the second path, because a message reliably wakes a background page
 * Safari has unloaded and a tab update is not documented to. Both end in the
 * same idempotent `completeTabSignIn`, which checks the URL exactly and only
 * acts for the tab the pending flow opened, so a second report is harmless.
 *
 * It runs only where the user has granted aturi.to, which the Account tab asks
 * for before it opens the sign-in tab. `document_start` because the URL is all
 * it needs and the page has nothing else to wait for.
 */
export default defineContentScript({
  include: ['safari'],
  matches: ['https://aturi.to/api/oauth/extension/return*'],
  runAt: 'document_start',
  main() {
    try {
      void Promise.resolve(
        browser.runtime.sendMessage({ type: 'aturi:signin-return', url: location.href }),
      ).catch(() => {});
    } catch {
      /* extension reloaded underneath the page; the tab watcher still runs */
    }
  },
});
