import { defineContentScript } from '#imports';
import {
  dedupeByUri,
  scanDocumentForAtUris,
  type DetectedAtUri,
} from '../lib/inspectScanner';
import { matchSupportedUrl } from '@aturi/reverseParsers';

/**
 * Content script for the Inspect tab. Has two jobs:
 *
 * 1. Passive: on every page load (and on SPA route changes) run a fast
 *    structured scan and report the count to the background worker, which
 *    drives the toolbar badge + icon swap. Gated on the
 *    `passiveScanEnabled` user preference.
 *
 * 2. On demand: answer `aturi:inspect-scan` messages from the popup with a
 *    full scan (including the body-text regex). This is unconditional —
 *    even when passive scanning is off, the popup's manual button still
 *    works.
 *
 * Runs alongside `detect-head.content.ts` — that script handles a different
 * message (`aturi:query-head`) used by the Waypoints flow.
 */

const STORAGE_KEY = 'aturi.prefs.v1';
const DEBOUNCE_MS = 400;

type PartialPrefs = { passiveScanEnabled?: boolean };

async function readPassiveScanEnabled(): Promise<boolean> {
  // Default: enabled. Errors fall back to the default so a missing storage
  // area never silently disables the feature.
  try {
    const sync = chrome.storage?.sync;
    if (sync) {
      const got = await sync.get(STORAGE_KEY);
      const prefs = got?.[STORAGE_KEY] as PartialPrefs | undefined;
      if (prefs && typeof prefs.passiveScanEnabled === 'boolean') {
        return prefs.passiveScanEnabled;
      }
    }
    const local = chrome.storage?.local;
    if (local) {
      const got = await local.get(STORAGE_KEY);
      const prefs = got?.[STORAGE_KEY] as PartialPrefs | undefined;
      if (prefs && typeof prefs.passiveScanEnabled === 'boolean') {
        return prefs.passiveScanEnabled;
      }
    }
  } catch {
    /* ignore */
  }
  return true;
}

function countAtUris(): number {
  const hits: DetectedAtUri[] = [];
  // URL-pattern detection: the page URL itself may match a known app.
  try {
    const url = new URL(window.location.href);
    const match = matchSupportedUrl(url);
    if (match?.parsed.uri) {
      hits.push({ uri: match.parsed.uri, where: 'url' });
    }
  } catch {
    /* ignore */
  }
  // Use the same full scanner the popup runs on demand so the toolbar
  // badge count matches what the popup will show when the user clicks
  // through. The fast structured-only scan undercounted body-text URIs
  // (e.g. at:// strings quoted inside post text) and produced a badge
  // of "1" against a popup that listed several.
  hits.push(...scanDocumentForAtUris(document));
  return dedupeByUri(hits).length;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let lastUrl = window.location.href;
    let scheduled: number | null = null;
    let enabled = true;

    function report(count: number) {
      try {
        // sendMessage returns a Promise in MV3; we don't need a response,
        // but we still attach a .catch so an unhandled-rejection from a
        // sleeping worker doesn't pollute the page's console.
        const out = chrome.runtime.sendMessage({ type: 'aturi:detected', count });
        if (out && typeof (out as Promise<unknown>).catch === 'function') {
          (out as Promise<unknown>).catch(() => {
            /* background not alive yet — next scan will retry */
          });
        }
      } catch {
        /* ignore */
      }
    }

    function scheduleScan() {
      if (!enabled) return;
      if (scheduled != null) window.clearTimeout(scheduled);
      scheduled = window.setTimeout(() => {
        scheduled = null;
        try {
          report(countAtUris());
        } catch {
          /* ignore */
        }
      }, DEBOUNCE_MS);
    }

    function clearBadge() {
      // Reporting 0 explicitly so the background clears any stale state.
      report(0);
    }

    // Initial passive scan.
    void readPassiveScanEnabled().then((on) => {
      enabled = on;
      if (enabled) scheduleScan();
      else clearBadge();
    });

    // React to pref toggles without a page reload.
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'sync' && area !== 'local') return;
      const change = changes[STORAGE_KEY];
      if (!change) return;
      const next = (change.newValue as PartialPrefs | undefined)?.passiveScanEnabled;
      if (typeof next !== 'boolean') return;
      const was = enabled;
      enabled = next;
      if (!was && enabled) scheduleScan();
      if (was && !enabled) clearBadge();
    });

    // SPA navigation: patch history methods and listen for popstate so we
    // re-scan when the page changes without a full reload.
    const wrap = (key: 'pushState' | 'replaceState') => {
      const original = history[key];
      history[key] = function (this: History, ...args: Parameters<typeof original>) {
        const ret = original.apply(this, args);
        window.dispatchEvent(new Event('aturi:locationchange'));
        return ret;
      } as typeof original;
    };
    try {
      wrap('pushState');
      wrap('replaceState');
    } catch {
      /* ignore — some pages forbid patching history */
    }
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('aturi:locationchange'));
    });
    window.addEventListener('aturi:locationchange', () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        scheduleScan();
      }
    });

    // DOM mutations: scan again when significant content lands (e.g. SPA
    // routers swapping in a thread view). We watch additions to the body,
    // not attribute changes, to keep this cheap.
    try {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.addedNodes.length > 0) {
            scheduleScan();
            return;
          }
        }
      });
      if (document.body) {
        obs.observe(document.body, { childList: true, subtree: true });
      } else {
        // body may not exist yet at document_idle on some pages
        document.addEventListener('DOMContentLoaded', () => {
          if (document.body) obs.observe(document.body, { childList: true, subtree: true });
        });
      }
    } catch {
      /* ignore */
    }

    // On-demand: answer popup full-scan requests.
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== 'aturi:inspect-scan') return undefined;
      try {
        const hits: DetectedAtUri[] = scanDocumentForAtUris(document);
        sendResponse({ atUris: dedupeByUri(hits) });
      } catch (err) {
        sendResponse({ atUris: [], error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    });
  },
});
