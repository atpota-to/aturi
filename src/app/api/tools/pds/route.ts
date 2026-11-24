import { PDS_PACKAGE, readPackument } from '@/lib/tools/pdsVersion';
import { toolError, toolJson } from '@/lib/tools/server/respond';
import { readCappedJson } from '@/utils/cappedJson';
import { upstreamFetch } from '@/utils/upstreamFetch';

// Never rendered at build time: a build should not depend on the registry.
export const dynamic = 'force-dynamic';

/**
 * The releases of the reference PDS, for the PDS version check and the mark
 * beside a version on the Explorer's PDS page.
 *
 *   GET /api/tools/pds
 *
 * Read from npm, where `@atproto/pds` is published, and trimmed to each
 * stable release and the day it came out (src/lib/tools/pdsVersion.ts). The
 * registry would answer a browser directly, but its document for this
 * package describes every version in full and runs past a megabyte, where
 * the trimmed list is a few kilobytes. Reading it here also means one
 * request to the registry an hour, however many pages ask.
 *
 * It takes no input, so the only URL this ever fetches is the one below.
 */

const REGISTRY_URL = `https://registry.npmjs.org/${PDS_PACKAGE}`;

/**
 * The document was 1.6MB at 381 versions and grows with each one, so the
 * default ceiling (2MB) would start refusing it within the year.
 */
const PACKUMENT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Releases come out a few times a week and a host takes a night to pick one
 * up (RECENT_RELEASE_MS), so an hour's delay in seeing one changes nothing.
 */
const CACHE_SECONDS = 3600;

export async function GET() {
  try {
    const res = await upstreamFetch(REGISTRY_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return toolError(502, 'upstream_error', `The npm registry answered HTTP ${res.status}`);
    }
    const list = readPackument(await readCappedJson<unknown>(res, PACKUMENT_MAX_BYTES));
    if (!list) {
      return toolError(502, 'upstream_error', 'The npm registry’s answer did not name a latest release');
    }
    return toolJson({ ok: true, ...list }, CACHE_SECONDS);
  } catch {
    return toolError(502, 'upstream_error', 'The npm registry did not answer');
  }
}
