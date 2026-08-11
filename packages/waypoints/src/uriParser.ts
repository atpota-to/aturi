import { upstreamFetch } from './upstreamFetch';

export type ParsedURI = {
  type: 'post' | 'profile' | 'list' | 'record' | 'unknown';
  uri: string;
  handle: string;
  did?: string;
  collection?: string;
  rkey?: string;
  error?: string;
};

/**
 * Parse URL path segments into structured AT URI data
 * Examples:
 * - /alice.bsky.social -> profile
 * - /alice.bsky.social/app.bsky.feed.post/3k7qw... -> post
 * - /did:plc:xxx/app.bsky.graph.list/abc -> list
 */
export function parseURI(handle: string, collection?: string, rkey?: string): ParsedURI {
  // Handle is required
  if (!handle) {
    return {
      type: 'unknown',
      uri: '',
      handle: '',
      error: 'Handle or DID is required',
    };
  }

  // Profile case (no collection/rkey)
  if (!collection && !rkey) {
    return {
      type: 'profile',
      uri: `at://${handle}`,
      handle,
      did: handle.startsWith('did:') ? handle : undefined,
    };
  }

  // Record case (has collection and rkey)
  if (collection && rkey) {
    let type: 'post' | 'list' | 'record' = 'record';
    
    if (collection === 'app.bsky.feed.post') {
      type = 'post';
    } else if (collection === 'app.bsky.graph.list') {
      type = 'list';
    }
    // All other collections are treated as generic records

    return {
      type,
      uri: `at://${handle}/${collection}/${rkey}`,
      handle,
      did: handle.startsWith('did:') ? handle : undefined,
      collection,
      rkey,
    };
  }

  // Invalid case
  return {
    type: 'unknown',
    uri: '',
    handle,
    error: 'Invalid URI structure',
  };
}

/**
 * Resolve a handle to a DID using the Bluesky API
 */
/**
 * Handle resolution that distinguishes a definitive "no such handle" from a
 * transient "resolver unavailable". Callers that need to decide between a real
 * 404 and a retry state use this; `resolveHandle` remains for the common
 * did-or-null case.
 *
 * - `not-found`: the appview returned a 4xx (invalid/unknown handle). Safe to
 *   surface as a 404.
 * - `unavailable`: network failure or 5xx. Must NOT be shown as a 404 — it's a
 *   real account we couldn't look up right now.
 */
export type HandleResolution =
  | { did: string; reason?: undefined }
  | { did: null; reason: 'not-found' | 'unavailable' };

export type ResolveHandleOptions = {
  /**
   * Appview to ask. Defaults to `NEXT_PUBLIC_BSKY_API_URL` when a build has
   * defined it, otherwise the public Bluesky appview. Browser consumers of the
   * standalone package have no env var, so this is how they point it elsewhere.
   */
  apiUrl?: string;
};

/**
 * Read the appview override without assuming `process` exists. The full
 * `process.env.NEXT_PUBLIC_BSKY_API_URL` expression is kept verbatim because
 * Next replaces that exact text at build time; the `typeof` guard is what keeps
 * the same code from throwing in a plain browser bundle, where the resulting
 * ReferenceError used to be swallowed by the catch below and reported as a
 * transient 'unavailable' — so handle resolution silently never worked.
 */
function defaultApiUrl(): string {
  const fromEnv =
    typeof process !== 'undefined' && process.env
      ? process.env.NEXT_PUBLIC_BSKY_API_URL
      : undefined;
  return fromEnv || 'https://public.api.bsky.app';
}

export async function resolveHandleStatus(
  handle: string,
  options: ResolveHandleOptions = {}
): Promise<HandleResolution> {
  if (handle.startsWith('did:')) {
    return { did: handle };
  }

  try {
    const apiUrl = options.apiUrl || defaultApiUrl();
    const response = await upstreamFetch(
      `${apiUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );

    if (!response.ok) {
      return { did: null, reason: response.status >= 500 ? 'unavailable' : 'not-found' };
    }

    const data = await response.json();
    if (data.did) return { did: data.did };
    return { did: null, reason: 'not-found' };
  } catch {
    // Deliberately silent: the returned `reason` already carries the signal,
    // and a library that logs on its consumer's behalf cannot be turned off.
    return { did: null, reason: 'unavailable' };
  }
}

export async function resolveHandle(
  handle: string,
  options: ResolveHandleOptions = {}
): Promise<string | null> {
  return (await resolveHandleStatus(handle, options)).did;
}

/**
 * Get display name from handle or DID
 */
export function getDisplayName(handle: string, did?: string): string {
  if (handle.startsWith('did:')) {
    // The handle *is* the DID here, so there is always something to show; the
    // separate `did` argument is only a preferred source for the same value.
    const identifier = did || handle;
    return `@${identifier.slice(0, 16)}...`;
  }
  return `@${handle}`;
}


