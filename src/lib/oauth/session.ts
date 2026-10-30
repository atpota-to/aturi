/**
 * The session shape the app depends on, independent of which OAuth client
 * produced it.
 *
 * `OAuthSession` from `@atproto/oauth-client-browser` satisfies this
 * structurally, so widening the provider's `session` field to this type is
 * invisible to the 23 files that read only identity off it, and to the space
 * layer, which needs exactly `sub` and `fetchHandler`.
 */

export type AtSession = {
  /** The signed-in account's DID. */
  sub: string;
  /** Alias, for the SDK's SessionManager shape. */
  did?: string;
  /** A fetch against the user's own PDS, authenticated. */
  fetchHandler(path: string, init?: RequestInit): Promise<Response>;
  /**
   * The granted scope and the PDS (the token's audience).
   *
   * `refresh` is accepted and ignored by the backend implementation, which
   * reads both off a stored row. The browser implementation takes `false` to
   * mean "read the cached token, never spend a refresh round trip just to
   * answer a capability question".
   */
  getTokenInfo(refresh?: boolean | 'auto'): Promise<{ scope?: string; aud?: string }>;
  signOut(): Promise<void>;
};
