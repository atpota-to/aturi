/**
 * The PDS version check's one request of its own: a release list. What it
 * means is in pdsVersion.ts; the host is asked through pdsTargetClient.ts.
 */

import { PDS_SOFTWARE, readReleaseList, type PdsReleaseList, type PdsSoftwareId } from './pdsVersion';

/**
 * The shared run every asker of one software's list joins (runCache.ts), so
 * the Explorer's PDS page and the tool page it links to read it once between
 * them.
 */
export function pdsReleasesRun(software: PdsSoftwareId): string {
  return `pds-releases:${software}`;
}

/** One software's releases, from the tool's own route (src/app/api/tools/pds). */
export async function fetchPdsReleases(software: PdsSoftwareId, signal?: AbortSignal): Promise<PdsReleaseList> {
  const res = await fetch(`/api/tools/pds?software=${software}`, { signal });
  const list = res.ok ? readReleaseList(await res.json().catch(() => null)) : null;
  if (!list || list.software !== software) {
    throw new Error(`The releases of ${PDS_SOFTWARE[software].name} could not be read.`);
  }
  return list;
}
