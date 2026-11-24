import { NextRequest } from 'next/server';
import {
  PDS_SOFTWARE,
  isPdsSoftwareId,
  readPackument,
  readTagRefs,
  type PdsReleaseList,
  type PdsSoftware,
} from '@/lib/tools/pdsVersion';
import { guardedFetch } from '@/lib/tools/server/guardedFetch';
import { toolError, toolJson } from '@/lib/tools/server/respond';

// Node runtime: the guard in guardedFetch resolves DNS before it dials.
export const runtime = 'nodejs';
// Never rendered at build time: a build should not depend on these hosts.
export const dynamic = 'force-dynamic';

/**
 * The releases of one kind of PDS software, for the PDS version check and
 * the mark beside a version on the Explorer's PDS page.
 *
 *   GET /api/tools/pds?software=tranquil
 *
 * `software` is one of the ids in PDS_SOFTWARE (src/lib/tools/pdsVersion.ts)
 * and defaults to the reference PDS. Each is read from where it publishes:
 * npm's document for a package, or the tags a git repository advertises. The
 * answer is trimmed to each stable release and, where the source has one,
 * the day it came out.
 *
 * The registry would answer a browser directly, but its document for the
 * reference PDS describes every version in full and runs past a megabyte,
 * where the trimmed list is a few kilobytes; and a git host's ref list is
 * not readable cross-origin at all. Reading here also means one request to
 * each source an hour, however many pages ask.
 *
 * The caller chooses among fixed sources and never names a URL. The fetch
 * still goes through the guard, because a source can redirect: tangled.org
 * sends a repository's git requests on to the knot that hosts it, and that
 * hop is a host this code does not choose.
 */

/**
 * The reference PDS's document was 1.6MB at 381 versions and grows with each
 * one. A ref list is far smaller (GitHub's for Cocoon is 26KB), though it
 * names every branch and pull request along with the tags.
 */
const PACKUMENT_MAX_BYTES = 8 * 1024 * 1024;
const REFS_MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;

/**
 * Releases come out a few times a week at most, and a host takes a night to
 * pick one up (RECENT_RELEASE_MS), so an hour's delay in seeing one changes
 * nothing.
 */
const CACHE_SECONDS = 3600;

async function readReleases(software: PdsSoftware): Promise<PdsReleaseList | null> {
  const { source } = software;
  if (source.kind === 'npm') {
    const res = await guardedFetch(`https://registry.npmjs.org/${source.package}`, {
      maxBytes: PACKUMENT_MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      httpsOnly: true,
      accept: 'application/json',
    });
    // Half a document is not one: a cut-off body fails to parse, as it should.
    if (res.status !== 200 || res.truncated) return null;
    return readPackument(software.id, JSON.parse(res.text));
  }
  const res = await guardedFetch(source.refs, {
    maxBytes: REFS_MAX_BYTES,
    timeoutMs: TIMEOUT_MS,
    httpsOnly: true,
    accept: 'application/x-git-upload-pack-advertisement',
  });
  // A cut-off list could be missing the newest tag, which would call a host
  // up to date when it is not.
  if (res.status !== 200 || res.truncated) return null;
  return readTagRefs(software.id, res.text);
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('software') ?? 'reference';
  if (!isPdsSoftwareId(id)) {
    return toolError(
      400,
      'invalid_parameter',
      'Unknown software',
      `Expected one of: ${Object.keys(PDS_SOFTWARE).join(', ')}.`,
    );
  }
  const software = PDS_SOFTWARE[id];
  try {
    const list = await readReleases(software);
    if (!list) return toolError(502, 'upstream_error', `The releases of ${software.name} could not be read`);
    return toolJson({ ok: true, ...list }, CACHE_SECONDS);
  } catch {
    return toolError(502, 'upstream_error', `The source for ${software.name}’s releases did not answer`);
  }
}
