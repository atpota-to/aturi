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

  // The literal `space` marker sits where a public collection NSID would in a
  // permissioned AT URI (at://{did}/space/{type}/{skey}/…). An NSID always
  // carries at least two dots and the marker carries none, so the two never
  // collide. A space address needs four or more segments and names private
  // data, so the three-segment universal-link route can never render one.
  // Kept as a local literal rather than an import: this file is copied verbatim
  // into @aturi.to/waypoints, which cannot resolve src/utils/atproto/*.
  if (collection === 'space') {
    return {
      type: 'unknown',
      uri: '',
      handle,
      error: 'Space URIs are not public records',
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

export async function resolveHandleStatus(handle: string): Promise<HandleResolution> {
  if (handle.startsWith('did:')) {
    return { did: handle };
  }

  try {
    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';
    const response = await upstreamFetch(
      `${apiUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );

    if (!response.ok) {
      return { did: null, reason: response.status >= 500 ? 'unavailable' : 'not-found' };
    }

    const data = await response.json();
    if (data.did) return { did: data.did };
    return { did: null, reason: 'not-found' };
  } catch (error) {
    console.error('Error resolving handle:', error);
    return { did: null, reason: 'unavailable' };
  }
}

export async function resolveHandle(handle: string): Promise<string | null> {
  return (await resolveHandleStatus(handle)).did;
}

/**
 * Get display name from handle or DID
 */
export function getDisplayName(handle: string, did?: string): string {
  if (handle.startsWith('did:')) {
    return did ? `@${did.slice(0, 16)}...` : 'Unknown';
  }
  return `@${handle}`;
}


