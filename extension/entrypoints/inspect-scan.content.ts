import { defineContentScript } from '#imports';
import {
  dedupeByUri,
  scanDocumentForAtUris,
  type DetectedAtUri,
} from '../lib/inspectScanner';

/**
 * Content script for the Inspect tab. Scans the current page on demand for
 * AT URIs (head/meta/link/JSON-LD/text) and reports them back to the popup.
 *
 * Runs alongside `detect-head.content.ts` — that script handles a different
 * message (`aturi:query-head`) used by the Waypoints flow, while this one
 * answers `aturi:inspect-scan` for the new Inspect tab.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
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
