'use client';

/**
 * Lazy singleton for the BrowserOAuthClient.
 *
 * Production: serves metadata via /oauth-client-metadata.json (host-keyed
 *   so it works on aturi.to, *.vercel.app preview deploys, etc).
 * Development: uses the loopback shortcut the spec provides for localhost
 *   so we don't need a tunnel for the OAuth server to fetch metadata.
 *
 * The BrowserOAuthClient touches IndexedDB and crypto.subtle on construction,
 * so this module is browser-only — never import it from a server component.
 */

import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

let client: BrowserOAuthClient | null = null;

// Module-level event bus. BrowserOAuthClient surfaces session lifecycle
// through `onDelete` / `onUpdate` hooks; we forward those into an
// EventTarget so React (and anything else) can subscribe normally.
const events: EventTarget =
  typeof window !== 'undefined' ? new EventTarget() : ({} as EventTarget);

export const OAUTH_SCOPE = 'atproto transition:generic';

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

export function getOauthClient(): BrowserOAuthClient {
  if (typeof window === 'undefined') {
    throw new Error('getOauthClient() is browser-only');
  }
  if (client) return client;

  const origin = window.location.origin;
  const redirectPath = '/oauth/callback';

  const hooks = {
    onDelete: (sub: string, cause?: unknown) => {
      events.dispatchEvent(new CustomEvent('deleted', { detail: { sub, cause } }));
    },
    onUpdate: (sub: string, session: unknown) => {
      events.dispatchEvent(new CustomEvent('updated', { detail: { sub, session } }));
    },
  };

  if (isLoopback(window.location.hostname)) {
    client = new BrowserOAuthClient({
      handleResolver: 'https://bsky.social',
      clientMetadata: loopbackMetadataUrl(origin, redirectPath) as unknown as undefined,
      ...hooks,
    } as ConstructorParameters<typeof BrowserOAuthClient>[0]);
    return client;
  }

  client = new BrowserOAuthClient({
    handleResolver: 'https://bsky.social',
    clientMetadata: {
      client_id: `${origin}/oauth-client-metadata.json`,
      client_name: 'aturi.to',
      client_uri: origin,
      logo_uri: `${origin}/icon.svg`,
      tos_uri: `${origin}/terms`,
      policy_uri: `${origin}/terms`,
      redirect_uris: [`${origin}${redirectPath}`],
      scope: OAUTH_SCOPE,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'web',
      dpop_bound_access_tokens: true,
    },
    ...hooks,
  });
  return client;
}
