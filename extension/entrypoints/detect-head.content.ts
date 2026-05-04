import { defineContentScript } from '#imports';

/**
 * Content script that scans the page's <head> for <link> tags containing
 * AT URIs (at://...). This enables detection of atmosphere apps like Offprint,
 * pckt, and Leaflet/standard.site pages that embed their AT URI in the document
 * head rather than the URL path.
 *
 * Communicates findings back to the popup/background via runtime messaging.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  main() {
    function findAtUriInHead(): string | null {
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
