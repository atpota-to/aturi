/**
 * Base URL helper for cross-product deep links. The extension links into the
 * web app's /explore views from the Inspect tab. In dev we usually want
 * those to hit localhost so the developer can test changes end-to-end
 * without bouncing through aturi.to.
 *
 * For now we default to production. A future enhancement could expose this
 * as a pref in the options page.
 */

export const ATURI_BASE = 'https://aturi.to';

export function buildExploreUrl(repo: string, collection?: string, rkey?: string): string {
  const encodedRepo = encodeURIComponent(repo).replace(/%3A/g, ':');
  if (collection && rkey) {
    return `${ATURI_BASE}/explore/${encodedRepo}/${collection}/${encodeURIComponent(rkey)}`;
  }
  if (collection) {
    return `${ATURI_BASE}/explore/${encodedRepo}/${collection}`;
  }
  return `${ATURI_BASE}/explore/${encodedRepo}`;
}

/**
 * Deep link to the web explorer's PDS-host page (e.g. /explore/pds/pds.atpota.to).
 * Accepts either a bare hostname or a full URL.
 */
export function buildExplorePdsUrl(pdsHost: string): string {
  // Strip protocol if a full URL was passed.
  const host = pdsHost.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return `${ATURI_BASE}/explore/pds/${encodeURIComponent(host)}`;
}
