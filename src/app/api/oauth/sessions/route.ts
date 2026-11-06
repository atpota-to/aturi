/**
 * The signed-in devices list behind the account page: what is signed in, when
 * it was last seen, and a way to end any one of them.
 *
 * A user who has granted an extension access to their repo should be able to
 * see that and take it back without signing out everywhere, which is both an
 * ordinary expectation and the kind of control a store reviewer looks for once
 * an extension declares that it collects authentication information.
 *
 * Rows are addressed by an opaque id — the token's sha256, which is already
 * what the table is keyed on. The token itself is never stored and never
 * leaves the client that holds it, so listing sessions cannot expose one.
 */

import { corsPreflight, fail, guarded, json, resolveOrigin } from '@/lib/oauth/server/http';
import { getStore, TABLE } from '@/lib/oauth/server/store';
import { deleteAppSession, resolveActor } from '@/lib/oauth/server/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');

    const actor = await resolveActor(request, origin);
    if (!actor.ok) return fail(actor.status, actor.code, 'Not signed in');

    const rows = await getStore().select(
      TABLE.appSessions,
      { user_did: actor.userDid },
      'token_sha256,client,label,created_at,last_seen_at,expires_at',
    );

    return json({
      ok: true,
      sessions: rows.map((r) => ({
        id: String(r.token_sha256),
        client: String(r.client),
        label: (r.label as string | null) ?? null,
        createdAt: String(r.created_at),
        lastSeenAt: String(r.last_seen_at),
        expiresAt: String(r.expires_at),
        current: String(r.token_sha256) === actor.tokenHash,
      })),
    });
  });
}

export async function DELETE(request: Request) {
  return guarded(async () => {
    const origin = resolveOrigin(request);
    if (!origin) return fail(400, 'UNKNOWN_HOST', 'Unknown host');

    const actor = await resolveActor(request, origin);
    if (!actor.ok) return fail(actor.status, actor.code, 'Not signed in');

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return fail(400, 'MISSING_PARAMETER', 'Missing id');

    // Confirm the row belongs to the caller before deleting it — the id is
    // opaque but guessable-shaped, and this is the check that makes it safe.
    const row = await getStore().selectOne(TABLE.appSessions, { token_sha256: id }, 'user_did');
    if (!row || String(row.user_did) !== actor.userDid) {
      return fail(404, 'NOT_FOUND', 'No such session');
    }

    await deleteAppSession(id);
    return json({ ok: true });
  });
}
