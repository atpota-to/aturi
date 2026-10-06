/**
 * Request-scoped memoized loaders for the universal-link pages, which call
 * the same lookups from both generateMetadata and the page body.
 *
 * Next dedupes identical fetch() calls within a request, but not calls that
 * carry an AbortSignal, and upstreamFetch always attaches one for its
 * timeout. Without this, every upstream call on these pages ran twice per
 * render: handle resolution, DID document, record or thread, profile.
 * React's cache() memoizes for the lifetime of one server request, and it
 * stores the in-flight promise, so callers that overlap still share a single
 * fetch. Nothing carries over between requests, so nothing goes stale.
 *
 * A failed lookup is now shared too: the page sees the same null that
 * metadata did, rather than retrying on its own. upstreamFetch already
 * retries once inside each call.
 *
 * This lives in src/lib rather than beside the loaders because src/utils is
 * also compiled into the extension, which has no use for React's server
 * cache.
 */
import { cache } from 'react';
import { resolveHandleStatus as resolveHandleStatusUncached } from '@/utils/uriParser';
import { resolveDidToHandle as resolveDidToHandleUncached } from '@/utils/didResolver';
import { fetchRecordData as fetchRecordDataUncached } from '@/utils/recordFetcher';
import { fetchProfile as fetchProfileUncached } from '@/utils/profileFetcher';

export const resolveHandleStatus = cache(resolveHandleStatusUncached);

/** Same contract as the uriParser export, backed by the memoized status. */
export async function resolveHandle(handle: string): Promise<string | null> {
  return (await resolveHandleStatus(handle)).did;
}

export const resolveDidToHandle = cache(resolveDidToHandleUncached);
export const fetchRecordData = cache(fetchRecordDataUncached);
export const fetchProfile = cache(fetchProfileUncached);
