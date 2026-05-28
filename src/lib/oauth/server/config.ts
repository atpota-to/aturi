/**
 * Server-side configuration for Aturi's CONFIDENTIAL OAuth client.
 *
 * This is the backend counterpart to the public BrowserOAuthClient in
 * `src/lib/oauth/client.ts`. Where the browser client is a public client
 * (`token_endpoint_auth_method: 'none'`) with short-lived sessions, this
 * confidential client authenticates to the token endpoint with a private-key
 * JWT (`private_key_jwt` + ES256) so its refresh tokens are long-lived.
 *
 * It is a DISTINCT OAuth client from the browser one — different `client_id`
 * (served at /api/oauth/backend-client-metadata.json), different redirect_uri,
 * different auth method — because a single client-metadata document cannot
 * advertise both `none` and `private_key_jwt`.
 *
 * Server-only. Never import this from a client component: it reads
 * SUPABASE_SERVICE_KEY / OAUTH_PRIVATE_KEY_* which must stay out of the client
 * bundle.
 */

import type { OAuthClientMetadataInput } from '@atproto/oauth-types';
import { METADATA_SCOPE } from '@/lib/oauth/scopes';

const DEFAULT_BASE_URL = 'https://aturi.to';

/**
 * The canonical origin the confidential client_id / redirect_uri / jwks_uri are
 * built from. This MUST be fixed (not derived per-request) because the
 * NodeOAuthClient singleton is constructed once with one immutable client_id,
 * and the Authorization Server fetches the metadata document to verify that the
 * client_id used at authorize time matches the document it serves.
 */
export const oauthBaseUrl = (process.env.OAUTH_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

export const supabaseUrl = process.env.SUPABASE_URL;
export const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export type OAuthPrivateJwk = Record<string, unknown> & { kid: string };

function loadOAuthPrivateKeys(): OAuthPrivateJwk[] {
  const keys: OAuthPrivateJwk[] = [];
  // Up to three keys so we can rotate without downtime (the AS accepts any key
  // in the published JWKS; we sign new assertions with the first one).
  for (let i = 1; i <= 3; i++) {
    const raw = process.env[`OAUTH_PRIVATE_KEY_${i}`];
    if (!raw) continue;
    try {
      const jwk = JSON.parse(raw) as Record<string, unknown>;
      keys.push({ ...jwk, kid: (jwk.kid as string) || `key${i}` });
    } catch {
      console.warn(`[oauth/config] Invalid JWK JSON in OAUTH_PRIVATE_KEY_${i} — ignoring`);
    }
  }
  return keys;
}

export const oauthPrivateKeys = loadOAuthPrivateKeys();

/** True once the confidential client is fully configured (keys + Supabase). */
export function isBackendOauthConfigured(): boolean {
  return oauthPrivateKeys.length > 0 && !!supabaseUrl && !!supabaseServiceKey;
}

/**
 * Origins we will redirect a freshly-authenticated user back to (the value the
 * frontend passes as `redirect_uri` to /api/oauth/login). Mirrors the host
 * allowlist used by the public browser metadata route.
 */
const ALLOWED_FRONTEND_ORIGINS = new Set<string>([
  'https://aturi.to',
  'https://www.aturi.to',
  'https://testing.aturi.to',
  oauthBaseUrl,
]);

export function isAllowedFrontend(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return ALLOWED_FRONTEND_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/** Hosts permitted to serve the confidential metadata / jwks documents. */
export function isAllowedHost(hostname: string): boolean {
  return (
    hostname === 'aturi.to' ||
    hostname === 'www.aturi.to' ||
    hostname === 'testing.aturi.to' ||
    (() => {
      try {
        return new URL(oauthBaseUrl).hostname === hostname;
      } catch {
        return false;
      }
    })()
  );
}

/** Default frontend landing page when the request omits a redirect_uri. */
export const defaultFrontendCallback = `${oauthBaseUrl}/oauth/callback`;

/**
 * The confidential client metadata document. Served verbatim at
 * /api/oauth/backend-client-metadata.json and handed to NodeOAuthClient.
 */
export function getClientMetadata(): OAuthClientMetadataInput {
  const hasKeys = oauthPrivateKeys.length > 0;

  const base = {
    client_id: `${oauthBaseUrl}/api/oauth/backend-client-metadata.json`,
    client_name: 'aturi.to',
    client_uri: oauthBaseUrl,
    logo_uri: `${oauthBaseUrl}/icon.svg`,
    tos_uri: `${oauthBaseUrl}/terms`,
    policy_uri: `${oauthBaseUrl}/terms`,
    redirect_uris: [`${oauthBaseUrl}/api/oauth/callback`] as [string],
    // Must equal the superset advertised by the browser client, or the AS
    // rejects narrower runtime scopes with invalid_scope.
    scope: METADATA_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token'],
    response_types: ['code'] as ['code'],
    application_type: 'web' as const,
    dpop_bound_access_tokens: true,
  };

  const metadata = hasKeys
    ? {
        ...base,
        token_endpoint_auth_method: 'private_key_jwt',
        token_endpoint_auth_signing_alg: 'ES256',
        jwks_uri: `${oauthBaseUrl}/api/oauth/jwks.json`,
      }
    : {
        ...base,
        token_endpoint_auth_method: 'none',
      };

  return metadata as OAuthClientMetadataInput;
}
