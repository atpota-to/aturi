/**
 * Record that the user agreed to let this app ask a space authority for a
 * credential in their name.
 *
 * Separate from the mint endpoint on purpose. A `consent: true` field in the
 * mint request would be set by whoever makes the request and would therefore
 * enforce nothing at all — the point of the gate is that it reflects a real
 * click, so it has to be its own recorded act.
 *
 * Consent is per (session, authority) and dies with the session.
 */

import { isValidDid } from '@/utils/atproto/spaceUri';
import { corsPreflight, fail, guarded, json, resolveOrigin } from '@/lib/oauth/server/http';
import { getStore, TABLE } from '@/lib/oauth/server/store';
import { resolveActor } from '@/lib/oauth/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');

    const actor = await resolveActor(request, origin);
    if (!actor.ok) return fail(actor.status, actor.code, 'Not signed in');

    let body: { authority?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return fail(400, 'INVALID_BODY', 'Expected a JSON body');
    }
    const authority = typeof body.authority === 'string' ? body.authority : '';
    if (!isValidDid(authority)) {
      return fail(400, 'INVALID_PARAMETER', 'authority must be a DID');
    }

    await getStore().upsert(
      TABLE.spaceConsents,
      { session_sha256: actor.tokenHash, authority_did: authority },
      'session_sha256,authority_did',
    );
    return json({ ok: true });
  });
}
