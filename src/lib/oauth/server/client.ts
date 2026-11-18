/**
 * The confidential OAuth client. SERVER ONLY.
 *
 * One `NodeOAuthClient` per (origin, client kind). They share one keyset, one
 * `client_id`, one `redirect_uri` and one state store, and differ only in
 * which session-store rows they read — the library keys its store on the bare
 * DID, so a store that closes over a `client` column is entirely transparent
 * to it.
 *
 * That is what makes per-client grants nearly free. The web app and the
 * extension hold independent authorizations and independent rotating refresh
 * tokens, so they cannot race each other's refreshes; signing out of the
 * extension is a local delete that leaves the web session and the PDS grant
 * alone; and the extension can request strictly narrower scopes. The user
 * authorizes once more the first time they sign in on the extension, under the
 * same client name.
 *
 * Per-origin because `client_id` is the URL the metadata is served from:
 * aturi.to and testing.aturi.to are genuinely different OAuth clients, with
 * separate consent records, and always have been.
 */

import {
  AtprotoHandleResolverNode,
  NodeOAuthClient,
  asResolvedHandle,
} from '@atproto/oauth-client-node';
import type { HandleResolver } from '@atproto/oauth-client-node';
import { APPVIEW } from '@/utils/atproto/config';
import { buildClientMetadata } from '../clientMetadata';
import type { OAuthClientKind } from './env';
import { getKeyset } from './keyset';
import { requestLock } from './lock';
import { SealedSessionStore, SealedStateStore } from './oauthStores';

/**
 * DNS first, then the AppView.
 *
 * DNS TXT records are authoritative for handles backed by did:web, and for
 * handles that migrated did:plc → did:web: the bsky.social entryway only does
 * HTTP resolution and hands back the stale did:plc, after which OAuth aborts
 * because the resolved document's handle no longer matches. The AppView
 * fallback covers handles that publish no TXT record at all. This mirrors the
 * browser client's resolver in src/lib/oauth/client.ts.
 */
function createHandleResolver(): HandleResolver {
  const dns = new AtprotoHandleResolverNode();
  return {
    async resolve(handle, options) {
      try {
        const did = await dns.resolve(handle, options);
        if (did) return did;
      } catch {
        // fall through
      }
      const res = await fetch(
        `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
        { signal: options?.signal },
      );
      if (!res.ok) return null;
      const { did } = (await res.json()) as { did?: string };
      return did ? asResolvedHandle(did) : null;
    },
  };
}

type Entry = { client: NodeOAuthClient; sessionStore: SealedSessionStore };

const clients = new Map<string, Entry>();

export function getStateStore(): SealedStateStore {
  return new SealedStateStore();
}

export async function getOAuthClient(
  origin: string,
  kind: OAuthClientKind,
): Promise<Entry> {
  const cacheKey = `${origin}|${kind}`;
  const hit = clients.get(cacheKey);
  if (hit) return hit;

  const sessionStore = new SealedSessionStore(kind);
  const client = new NodeOAuthClient({
    clientMetadata: buildClientMetadata(origin),
    keyset: await getKeyset(),
    stateStore: getStateStore(),
    sessionStore,
    requestLock,
    handleResolver: createHandleResolver(),
  });

  const entry = { client, sessionStore };
  clients.set(cacheKey, entry);
  return entry;
}

/** The public JWKS the authorization server fetches. */
export async function getPublicJwks(origin: string) {
  const { client } = await getOAuthClient(origin, 'web');
  return client.jwks;
}
