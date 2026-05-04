const BSKY_API = 'https://public.api.bsky.app';

const didCache = new Map<string, string>();

/**
 * Resolve a handle to a DID via the public Bluesky API. Results are cached in
 * memory for the lifetime of the page/service worker. Pass through DIDs as-is.
 */
export async function resolveHandleToDid(handle: string): Promise<string | null> {
  if (handle.startsWith('did:')) return handle;
  const cached = didCache.get(handle);
  if (cached) return cached;

  try {
    const res = await fetch(
      `${BSKY_API}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { did?: string };
    if (data.did) {
      didCache.set(handle, data.did);
      return data.did;
    }
    return null;
  } catch {
    return null;
  }
}
