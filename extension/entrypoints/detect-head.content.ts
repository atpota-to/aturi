import { defineContentScript } from '#imports';
import { parseAtTagsFromDocument, isDidOnlyAtUri } from '@aturi/atproto/atTags';

/**
 * Content script that discovers the AT URI a page is "about" so the popup's
 * Waypoints tab can offer to open it in another client. Two signals, in
 * priority order:
 *
 *   1. AT Tags (https://tangled.org/chrisshank.com/at-tags/): the page's own
 *      `<meta name="at:canonical" content="at://...">` declaration, falling
 *      back to `at:alternate`. This is the record the page is rendering.
 *   2. Legacy `<link href="at://...">` in <head>, as used by Offprint, pckt,
 *      and Leaflet/standard.site pages before the AT Tags proposal.
 *
 * Author/me tags are deliberately ignored here: they point at a DID, not a
 * record, so they'd only surface profile waypoints for a record page.
 *
 * Communicates findings back to the popup/background via runtime messaging.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  main() {
    function findAtUriInHead(): string | null {
      // 1. AT Tags canonical/alternate — the record this page displays. Skip
      //    DID-only values (a spec-violating canonical points at a bare
      //    identity) so the jump flow surfaces record waypoints, not a profile.
      try {
        const tags = parseAtTagsFromDocument(document);
        const record = [...tags.canonical, ...tags.alternate].find(
          (uri) => !isDidOnlyAtUri(uri),
        );
        if (record) return record;
      } catch {
        /* fall through to the legacy <link> scan */
      }

      // 2. Legacy <link href="at://..."> alternate link.
      const links = document.querySelectorAll('head link[href^="at://"]');
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('at://')) {
          return href;
        }
      }
      return null;
    }

    const atUri = findAtUriInHead();

    if (atUri) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'aturi:query-head') {
          sendResponse({ atUri });
          return true;
        }
      });
    }
  },
});
