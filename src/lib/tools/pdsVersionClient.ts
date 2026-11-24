/**
 * The PDS version check's one request of its own: the release list. What it
 * means is in pdsVersion.ts; the host is asked through pdsTargetClient.ts.
 */

import { readReleaseList, type PdsReleaseList } from './pdsVersion';

/**
 * The shared run every asker joins (runCache.ts), so the Explorer's PDS page
 * and the tool page it links to read the list once between them.
 */
export const PDS_RELEASES_RUN = 'pds-releases';

/** The releases of the reference PDS, from the tool's own route (src/app/api/tools/pds). */
export async function fetchPdsReleases(signal?: AbortSignal): Promise<PdsReleaseList> {
  const res = await fetch('/api/tools/pds', { signal });
  const list = res.ok ? readReleaseList(await res.json().catch(() => null)) : null;
  if (!list) throw new Error('The list of PDS releases could not be read from the npm registry.');
  return list;
}
