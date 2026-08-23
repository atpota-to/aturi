/**
 * Facts about relaying an upstream HTTP response verbatim.
 *
 * Deliberately free of framework imports, so it can be unit-tested under plain
 * `node --test` — the Next-importing helpers next door cannot be.
 */

/**
 * Statuses the Response constructor refuses to pair with a body, including an
 * empty one: `new Response(new ArrayBuffer(0), { status: 204 })` throws. A
 * proxy that mirrors an upstream status must pass null for these, or a
 * perfectly good 204 from a PDS reaches the client as a 500.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export function bodyForStatus(status: number, body: ArrayBuffer): ArrayBuffer | null {
  return NULL_BODY_STATUSES.has(status) ? null : body;
}

/**
 * Whether a resource server said the access token is invalid.
 *
 * Mirrors `isInvalidTokenResponse` in @atproto/oauth-client's oauth-session.js,
 * which is not exported. The distinction matters because `fetchHandler`
 * RETURNS this response rather than throwing: it has already attempted a
 * forced refresh and been rejected again, so by the time one reaches us the
 * grant is genuinely dead rather than merely racing.
 *
 * Checking the challenge rather than the bare status is what keeps a 401 about
 * one record from being read as a dead session.
 */
export function isInvalidTokenResponse(response: Response): boolean {
  if (response.status !== 401) return false;
  const wwwAuth = response.headers.get('WWW-Authenticate');
  return (
    wwwAuth != null &&
    (wwwAuth.startsWith('Bearer ') || wwwAuth.startsWith('DPoP ')) &&
    wwwAuth.includes('error="invalid_token"')
  );
}
