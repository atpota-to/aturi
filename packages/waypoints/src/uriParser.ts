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
export async function resolveHandle(handle: string): Promise<string | null> {
  if (handle.startsWith('did:')) {
    return handle;
  }

  try {
    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';
    const response = await fetch(
      `${apiUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.did || null;
  } catch (error) {
    console.error('Error resolving handle:', error);
    return null;
  }
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


