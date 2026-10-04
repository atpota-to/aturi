/**
 * The two things the iOS app (`ios/`) needs the website to publish.
 *
 * 1. OAuth client metadata for a *native* client. atproto OAuth identifies a
 *    client by the URL its metadata is served from, and a native app cannot
 *    share the web client's document: its redirect is a custom URL scheme,
 *    which the spec only allows when `application_type` is `native` and the
 *    scheme is the reverse of the client_id host (`aturi.to` → `to.aturi:`).
 * 2. An Apple App Site Association file, which is how iOS learns that
 *    `https://aturi.to/profile/…` and friends may open in the app instead of
 *    Safari. It has to name the developer's Team ID, which is not something
 *    to bake into the source, so it is published only once `IOS_APP_TEAM_ID`
 *    is set on the deployment.
 *
 * Both are pure builders so the route handlers stay one line and the shapes
 * are testable. The Swift side keeps matching constants in
 * `ios/Packages/AturiCore/Sources/AturiCore/OAuth/OAuthMetadata.swift`;
 * a test on each side pins the strings so the two cannot drift silently.
 */

import { BASE_SCOPE, GRANULAR_SCOPES, SPACE_SCOPE_IDS } from '@/lib/oauth/scopes';

export const IOS_BUNDLE_ID = 'to.aturi.app';

export const IOS_CLIENT_METADATA_PATH = '/oauth-client-metadata-ios.json';

/**
 * The reverse-domain scheme the spec requires for a native client whose
 * client_id lives on aturi.to. The path is a single slash, not two: a custom
 * scheme URI with an authority component is rejected by the authorization
 * server's redirect_uri validation.
 */
export const IOS_OAUTH_REDIRECT_URI = 'to.aturi:/oauth/callback';

/**
 * The web client advertises the permissioned-data (`space:`) scopes so its
 * picker can offer them; the iOS app has no spaces UI, so its metadata leaves
 * them out and the runtime request can never include one.
 */
export const IOS_METADATA_SCOPE = [
  BASE_SCOPE,
  ...GRANULAR_SCOPES.filter((s) => !SPACE_SCOPE_IDS.has(s.id)).map((s) => s.scope),
].join(' ');

/**
 * Universal-link path patterns the app claims, in AASA `components` syntax.
 * Bare `aturi.to/{handle}` links are deliberately left to Safari: claiming
 * `/*` would swallow every marketing and docs page too.
 */
export const IOS_UNIVERSAL_LINK_PATHS = ['/profile/*', '/explore/*', '/at/*', '/at:*'] as const;

export function buildIosClientMetadata(origin: string): Record<string, unknown> {
  return {
    client_id: `${origin}${IOS_CLIENT_METADATA_PATH}`,
    client_name: 'Aturi for iOS',
    client_uri: origin,
    logo_uri: `${origin}/icon.svg`,
    tos_uri: `${origin}/terms`,
    policy_uri: `${origin}/terms`,
    redirect_uris: [IOS_OAUTH_REDIRECT_URI],
    scope: IOS_METADATA_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    dpop_bound_access_tokens: true,
  };
}

/**
 * Apple's format: https://developer.apple.com/documentation/xcode/supporting-associated-domains
 * `appIDs` entries are `<Team ID>.<bundle id>`. Returns null without a Team
 * ID so the route can 404 rather than publish a file that names no app.
 */
export function buildAppleAppSiteAssociation(
  teamId: string | undefined,
): Record<string, unknown> | null {
  const trimmed = (teamId ?? '').trim();
  if (!/^[A-Z0-9]{10}$/.test(trimmed)) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${trimmed}.${IOS_BUNDLE_ID}`],
          components: IOS_UNIVERSAL_LINK_PATHS.map((path) => ({ '/': path })),
        },
      ],
    },
  };
}
