'use client';

/**
 * Lazy singleton for the BrowserOAuthClient.
 *
 * Production: serves metadata via /oauth-client-metadata.json (host-keyed
 *   so it works on aturi.to, *.vercel.app preview deploys, etc).
 * Development: uses the loopback shortcut the spec provides for localhost
 *   so we don't need a tunnel for the OAuth server to fetch metadata.
 *
 * The BrowserOAuthClient touches IndexedDB and crypto.subtle at module
 * load — even a top-level *value* import of `@atproto/oauth-client-browser`
 * crashes Node, so the package is imported dynamically only at call
 * time. The `BrowserOAuthClient` symbol used in this file is `import
 * type` only (erased at compile time) so the server bundle never tries
 * to evaluate the package.
 */

import type { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import type { HandleResolver } from '@atproto-labs/handle-resolver';
import { METADATA_SCOPE } from './scopes';
import { APPVIEW } from '@/utils/atproto/config';

let client: BrowserOAuthClient | null = null;
let pending: Promise<BrowserOAuthClient> | null = null;

// Module-level event bus. BrowserOAuthClient surfaces session lifecycle
// through `onDelete` / `onUpdate` hooks; we forward those into an
// EventTarget so React (and anything else) can subscribe normally.
// EventTarget is a global in Node 18+ too, so this is safe SSR-side.
const events = new EventTarget();

export function getOauthEvents(): EventTarget {
  return events;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function loopbackMetadataUrl(origin: string, redirectPath: string): string {
  // Per the lib docs, when running on a loopback origin, `client_id` must
  // be `http://localhost?redirect_uri=<encoded>` even though the page lives
  // at 127.0.0.1 — the library handles the dance internally.
  const redirect = `${origin}${redirectPath}`;
  return `http://localhost?redirect_uri=${encodeURIComponent(redirect)}`;
}

export async function getOauthClient(): Promise<BrowserOAuthClient> {
  if (typeof window === 'undefined') {
    throw new Error('getOauthClient() is browser-only');
  }
  if (client) return client;
  if (pending) return pending;

  pending = (async () => {
    const [oauthMod, { AtprotoDohHandleResolver, asResolvedHandle }] = await Promise.all([
      import('@atproto/oauth-client-browser'),
      import('@atproto-labs/handle-resolver'),
    ]);
    const { BrowserOAuthClient: Ctor } = oauthMod;

    const origin = window.location.origin;
    const redirectPath = '/oauth/callback';

    // Resolve handles via DNS-over-HTTPS first, then fall back to the appview.
    // DNS TXT records are authoritative for handles backed by did:web (and for
    // handles that migrated did:plc → did:web): the bsky.social entryway only
    // does HTTP handle resolution and hands back the stale did:plc, so OAuth
    // then aborts when the resolved DID document's handle no longer matches.
    // The appview fallback covers handles with no DNS record whose .well-known
    // endpoint the browser can't reach (CORS).
    const dohResolver = new AtprotoDohHandleResolver({
      dohEndpoint: 'https://dns.google/resolve',
    });
    const handleResolver: HandleResolver = {
      async resolve(handle, options) {
        try {
          const did = await dohResolver.resolve(handle, options);
          if (did) return did;
        } catch {
          // fall through to the appview fallback
        }
        try {
          const res = await fetch(
            `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(
              handle,
            )}`,
            { signal: options?.signal },
          );
          if (!res.ok) return null;
          const { did } = (await res.json()) as { did?: string };
          return did ? asResolvedHandle(did) : null;
        } catch {
          return null;
        }
      },
    };

    const hooks = {
      onDelete: (sub: string, cause?: unknown) => {
        events.dispatchEvent(new CustomEvent('deleted', { detail: { sub, cause } }));
      },
      onUpdate: (sub: string, session: unknown) => {
        events.dispatchEvent(new CustomEvent('updated', { detail: { sub, session } }));
      },
    };

    if (isLoopback(window.location.hostname)) {
      client = new Ctor({
        handleResolver,
        clientMetadata: loopbackMetadataUrl(origin, redirectPath) as unknown as undefined,
        ...hooks,
      } as ConstructorParameters<typeof Ctor>[0]);
    } else {
      client = new Ctor({
        handleResolver,
        clientMetadata: {
          client_id: `${origin}/oauth-client-metadata.json`,
          client_name: 'aturi.to',
          client_uri: origin,
          logo_uri: `${origin}/icon.svg`,
          tos_uri: `${origin}/terms`,
          policy_uri: `${origin}/terms`,
          redirect_uris: [`${origin}${redirectPath}`],
          scope: METADATA_SCOPE,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'web',
          dpop_bound_access_tokens: true,
        },
        ...hooks,
      });
    }
    return client;
  })();

  return pending;
}
