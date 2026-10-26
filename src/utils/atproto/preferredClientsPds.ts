/**
 * Read / write the signed-in account's `to.aturi.actor.preferredClients/self`
 * record: the public declaration of which client they use for each kind of
 * link. The record's shape and the helpers for acting on it live in
 * `../preferredClients`, which ships in `@aturi.to/waypoints` too.
 *
 * Unlike `to.aturi.actor.preferences`, nothing here is mirrored to
 * localStorage or written on a debounce. A declaration exists for other apps
 * to read, so it is only ever written when the person presses Publish.
 */

import type { Agent } from '@atproto/api';
import {
  PREFERRED_CLIENTS_NSID,
  PREFERRED_CLIENTS_RKEY,
  buildPreferredClientsRecord,
  parsePreferredClients,
  type ClientPreference,
  type PreferredClientsRecord,
} from '../preferredClients';

export type PreferredClientsReadResult =
  | { status: 'ok'; record: PreferredClientsRecord }
  | { status: 'missing' }
  /** A record exists but isn't a declaration this code can read. */
  | { status: 'invalid' }
  | { status: 'error'; error: string };

export async function readPreferredClientsFromPds(
  agent: Agent,
  did: string,
): Promise<PreferredClientsReadResult> {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: PREFERRED_CLIENTS_NSID,
      rkey: PREFERRED_CLIENTS_RKEY,
    });
    const record = parsePreferredClients(res.data.value);
    return record ? { status: 'ok', record } : { status: 'invalid' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errName = (err as { error?: string })?.error ?? '';
    // Only `RecordNotFound` means "no declaration yet"; see the matching
    // check in `preferencesPds.ts` for why a bare 400 must not.
    if (
      /RecordNotFound/i.test(errName) ||
      /RecordNotFound|Could not locate record/i.test(msg)
    ) {
      return { status: 'missing' };
    }
    return { status: 'error', error: msg };
  }
}

/** Publish a declaration, replacing any existing one. Returns what was written. */
export async function writePreferredClientsToPds(
  agent: Agent,
  did: string,
  preferences: readonly ClientPreference[],
): Promise<PreferredClientsRecord> {
  const record = buildPreferredClientsRecord(preferences);
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: PREFERRED_CLIENTS_NSID,
    rkey: PREFERRED_CLIENTS_RKEY,
    record,
  });
  return record;
}

export async function deletePreferredClientsFromPds(agent: Agent, did: string): Promise<void> {
  await agent.com.atproto.repo.deleteRecord({
    repo: did,
    collection: PREFERRED_CLIENTS_NSID,
    rkey: PREFERRED_CLIENTS_RKEY,
  });
}
