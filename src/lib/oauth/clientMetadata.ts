/**
 * The confidential client's metadata document.
 *
 * Pure — no secrets, no Node built-ins — so the edge route that serves it and
 * the Node runtime that constructs the OAuth client build the same object from
 * one function. That matters more than it looks: the authorization server
 * validates every requested scope against the document it fetched from us with
 * a plain string membership test, so the served `scope` and the requested one
 * have to agree byte for byte. Both come from `METADATA_SCOPE`.
 *
 * This is a SECOND client, published alongside the existing public one at
 * /oauth-client-metadata.json. That document is not touched. `client_id` is
 * the URL the metadata is served from, so mutating the existing one in place
 * would break every live session at its next refresh, with no rollback —
 * whereas two documents can run in parallel behind a flag.
 */

import { METADATA_SCOPE } from './scopes';

/** Path the confidential metadata is served from. It IS the client_id. */
export const CLIENT_METADATA_PATH = '/oauth/client-metadata.json';
/** The one redirect_uri registered with the authorization server. */
export const REDIRECT_PATH = '/api/oauth/callback';
export const JWKS_PATH = '/oauth/jwks.json';

export type ConfidentialClientMetadata = {
  client_id: string;
  client_name: string;
  client_uri: string;
  logo_uri: string;
  tos_uri: string;
  policy_uri: string;
  redirect_uris: [string, ...string[]];
  scope: string;
  grant_types: ['authorization_code', 'refresh_token'];
  response_types: ['code'];
  application_type: 'web';
  dpop_bound_access_tokens: true;
  token_endpoint_auth_method: 'private_key_jwt';
  token_endpoint_auth_signing_alg: 'ES256';
  jwks_uri: string;
};

/**
 * Four constraints below are enforced by the library at client-construction
 * time rather than at runtime, so getting one wrong is a hard failure on the
 * first request rather than a subtle one later:
 *
 *   - `token_endpoint_auth_signing_alg` is mandatory with `private_key_jwt`
 *     and forbidden with `none`.
 *   - The algorithm must be ES256. The reference backend's env.example and
 *     setup doc both still describe RS256 keys; following them produces a key
 *     the library refuses.
 *   - `jwks` and `jwks_uri` are mutually exclusive. `jwks_uri` is the one that
 *     makes rotation possible, so it is set explicitly — the library will
 *     otherwise inline `jwks` from the keyset.
 *   - `client_uri` must share the client_id's origin and be a path parent of it.
 */
export function buildClientMetadata(origin: string): ConfidentialClientMetadata {
  return {
    client_id: `${origin}${CLIENT_METADATA_PATH}`,
    client_name: 'aturi.to',
    client_uri: origin,
    logo_uri: `${origin}/icon.svg`,
    tos_uri: `${origin}/terms`,
    policy_uri: `${origin}/terms`,
    redirect_uris: [`${origin}${REDIRECT_PATH}`],
    scope: METADATA_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    application_type: 'web',
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    jwks_uri: `${origin}${JWKS_PATH}`,
  };
}
