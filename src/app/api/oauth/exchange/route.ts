/**
 * Redeem an extension's one-time code for its session token.
 *
 * The `verifier` is not optional, and this endpoint is the reason it exists.
 * The route answers `Access-Control-Allow-Origin: *` and takes no credential,
 * so a bare code would be redeemable by anyone who observed the redirect — and
 * an extension's redirect URL cannot be allowlisted to prevent that: Firefox
 * derives the host from an internal UUID that is randomised per install, and a
 * Chrome extension's id is unstable until it is published to the store.
 *
 * So the code is bound at issuance to base64url(SHA-256(verifier)), and only
 * the extension that started the flow holds the verifier. The comparison is
 * constant-time, and the row is deleted before the token is returned so a
 * replay finds nothing.
 */

import { sha256Base64Url, sha256Hex, safeEqual } from '@/lib/oauth/server/crypto';
import { mintAppSession } from '@/lib/oauth/server/session';
import { corsPreflight, fail, guarded, json, resolveOrigin } from '@/lib/oauth/server/http';
import { allow, callerKey, RATE_LIMITS } from '@/lib/oauth/server/rateLimit';
import { getStore, TABLE } from '@/lib/oauth/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');

    if (!(await allow(`exchange:${sha256Hex(callerKey(request))}`, RATE_LIMITS.exchange))) {
      return fail(429, 'RATE_LIMITED', 'Too many attempts');
    }

    let body: { code?: unknown; verifier?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return fail(400, 'INVALID_BODY', 'Expected a JSON body');
    }
    const code = typeof body.code === 'string' ? body.code : '';
    const verifier = typeof body.verifier === 'string' ? body.verifier : '';
    if (!code || !verifier) {
      return fail(400, 'MISSING_PARAMETER', 'Both code and verifier are required');
    }

    const store = getStore();
    const hash = sha256Hex(code);
    const row = await store.selectOne(
      TABLE.exchangeCodes,
      { code_sha256: hash },
      'challenge_b64,user_did,expires_at',
    );

    // Single use: the row goes whether or not the verifier matches, so a wrong
    // guess burns the code rather than allowing another attempt against it.
    if (row) await store.remove(TABLE.exchangeCodes, { code_sha256: hash });

    if (!row || new Date(String(row.expires_at)).getTime() <= Date.now()) {
      return fail(400, 'CODE_INVALID', 'That sign-in code is no longer valid');
    }
    if (!safeEqual(sha256Base64Url(verifier), String(row.challenge_b64))) {
      return fail(400, 'CODE_INVALID', 'That sign-in code is no longer valid');
    }

    // Minted here rather than at the callback, so the code table never holds a
    // credential to leak.
    const session = await mintAppSession(String(row.user_did), 'extension', 'Aturi extension');
    return json({
      ok: true,
      token: session.token,
      did: session.userDid,
      expiresAt: session.expiresAt.toISOString(),
    });
  });
}
