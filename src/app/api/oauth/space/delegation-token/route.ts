/**
 * Mint a space delegation token — the one hop of the permissioned-spaces flow
 * that needs the OAuth token, and therefore the only one that moves here.
 *
 * The split is forced, and it is the right one:
 *
 *   hop 1  getDelegationToken, on the user's OWN PDS, over OAuth        → here
 *   hop 2  getSpaceCredential, on the AUTHORITY's host, presenting that
 *          token plus a DPoP proof from a non-extractable browser key   → browser
 *   reads  Authorization: DPoP <credential> + a fresh proof             → browser
 *
 * Moving hops 2 and 3 server-side would force the DPoP key to be persisted
 * across stateless invocations and therefore to be extractable, destroying the
 * property `spaceDpop.ts` generates it for, and would put credentials that read
 * OTHER members' private records into a database at rest.
 *
 * Why this is not simply another entry in the generic proxy's allowlist: a
 * `read` grant is `authority=*`, so the PDS will mint a token for any space ref
 * it is handed. Opening a link to `/explore/{attacker}/space/…` and doing
 * nothing else would otherwise tell the attacker's server who the visitor is,
 * where their PDS is, and that they hold whole-space access. In the browser
 * that is bounded by an in-memory set of unlocked authorities; once it is an
 * endpoint that anything holding a session token can call — and the extension
 * holds exactly that — the bound has to be server-side.
 */

import { NextResponse } from 'next/server';
import { formatSpaceRef, isSpaceRefParts, parseSpaceAtUri } from '@/utils/atproto/spaceUri';
import { spaceGrantLevel } from '@/lib/oauth/scopes';
import { getOAuthClient } from '@/lib/oauth/server/client';
import { CORS_HEADERS, corsPreflight, fail, guarded, resolveOrigin } from '@/lib/oauth/server/http';
import { bodyForStatus } from '@/lib/oauth/server/upstream';
import { allow, RATE_LIMITS } from '@/lib/oauth/server/rateLimit';
import { resolveActor } from '@/lib/oauth/server/session';
import { getStore, TABLE } from '@/lib/oauth/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

/**
 * Auto-consent for members.
 *
 * `listSpaces` with an authority filter answers from the visitor's own PDS —
 * it asks the authority nothing — so running it discloses nothing and lets an
 * existing member skip a prompt that would tell them what they already know.
 *
 * A false answer is the safe answer: any failure reads as "not a member",
 * which means the visitor gets the prompt.
 */
async function holdsRepoUnderAuthority(
  fetchHandler: (path: string, init?: RequestInit) => Promise<Response>,
  authorityDid: string,
): Promise<boolean> {
  try {
    const res = await fetchHandler(
      `/xrpc/com.atproto.space.listSpaces?did=${encodeURIComponent(authorityDid)}&limit=1`,
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { spaces?: unknown[] };
    return Array.isArray(body.spaces) && body.spaces.length > 0;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');

    const actor = await resolveActor(request, origin);
    if (!actor.ok) return fail(actor.status, actor.code, 'Not signed in');

    if (!(await allow(`delegation:${actor.tokenHash}`, RATE_LIMITS.delegation))) {
      return fail(429, 'RATE_LIMITED', 'Too many credential requests');
    }

    let body: { space?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return fail(400, 'INVALID_BODY', 'Expected a JSON body');
    }
    const raw = typeof body.space === 'string' ? body.space : '';
    const parts = parseSpaceAtUri(raw);
    if (!parts || !isSpaceRefParts(parts)) {
      return fail(400, 'INVALID_PARAMETER', 'Not a valid space reference');
    }
    // Re-serialise rather than echoing what the caller sent. The PDS compares a
    // credential's subject against this string byte for byte, and the strict
    // parser rejects trailing slashes, queries, fragments and handle
    // authorities that a lenient echo would pass straight through.
    const ref = formatSpaceRef(parts);

    const grant = await getStore().selectOne(
      TABLE.oauthSessions,
      { sub: actor.userDid, client: actor.client },
      'granted_scope',
    );
    if (spaceGrantLevel((grant?.granted_scope as string | null) ?? null) !== 'read') {
      return fail(
        403,
        'SCOPE_MISSING',
        'This sign-in did not include whole-space read access',
      );
    }

    const { client } = await getOAuthClient(origin, actor.client);
    let session;
    try {
      session = await client.restore(actor.userDid);
    } catch {
      return fail(401, 'GRANT_MISSING', 'Re-authorization required');
    }
    if (!session) return fail(401, 'GRANT_MISSING', 'Re-authorization required');

    const fetchHandler = (path: string, init?: RequestInit) => session.fetchHandler(path, init);

    const consented = await getStore().selectOne(
      TABLE.spaceConsents,
      { session_sha256: actor.tokenHash, authority_did: parts.authority },
      'authority_did',
    );
    if (!consented && !(await holdsRepoUnderAuthority(fetchHandler, parts.authority))) {
      return fail(
        403,
        'CONSENT_REQUIRED',
        'You have not agreed to contact this space authority',
        'Confirm the unlock prompt, which records the consent, then retry.',
      );
    }

    let upstream: Response;
    try {
      upstream = await fetchHandler(
        `/xrpc/com.atproto.space.getDelegationToken?space=${encodeURIComponent(ref)}`,
      );
    } catch {
      return fail(502, 'UPSTREAM_UNREACHABLE', 'Could not reach your PDS');
    }

    // Mirrored verbatim so the browser's own error classification keeps
    // working unmodified. Never logged: the body is a bearer credential, and
    // it is single-use with a ~60 second life, so it must not be retried
    // either — a spent token comes back as InvalidDelegationToken.
    const payload = bodyForStatus(upstream.status, await upstream.arrayBuffer());
    return new NextResponse(payload, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  });
}
