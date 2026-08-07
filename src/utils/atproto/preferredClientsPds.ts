/**
 * Publish / read / withdraw the signed-in user's public
 * `to.aturi.actor.preferredClients/self` record.
 *
 * This is the outward-facing half of the feature. `to.aturi.actor.preferences`
 * is Aturi's own settings blob and nobody else is expected to read it; this
 * record exists purely so *other* Atmosphere apps can find out where the user
 * wants their records opened. Schema:
 * `lexicons/to/aturi/actor/preferredClients.json`.
 *
 * Because it's public and other people's software acts on it, publishing is
 * explicit (see `Preferences.publishPreferredClients`) rather than a silent
 * side effect of editing settings.
 */

import type { Agent } from '@atproto/api';
import {
  buildPreferredClientsRecord,
  parsePreferredClientsRecord,
  PREFERRED_CLIENTS_NSID,
  PREFERRED_CLIENTS_RKEY,
  type PreferredClientRule,
  type PreferredClientsRecord,
} from '../preferredClients';

export { PREFERRED_CLIENTS_NSID, PREFERRED_CLIENTS_RKEY };

export type PreferredClientsReadResult =
  | { status: 'ok'; record: PreferredClientsRecord }
  | { status: 'missing' }
  | { status: 'error'; error: string };

function isRecordNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const name = (err as { error?: string })?.error ?? '';
  return /RecordNotFound/i.test(name) || /RecordNotFound|Could not locate record/i.test(msg);
}

/**
 * Read the user's own published record. `missing` is the normal state for
 * anyone who hasn't opted in, and is deliberately distinguished from `error`:
 * the caller uses `missing` to decide it may publish, and a transient failure
 * misread as `missing` would clobber a record written from another device.
 */
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
    const value = (res?.data || res) as { value?: unknown };
    const record = parsePreferredClientsRecord(value?.value);
    // A record that exists but parses to nothing (every rule dropped) is
    // reported as present-but-empty rather than missing, so we don't treat a
    // deliberate empty state as "never published".
    return record
      ? { status: 'ok', record }
      : { status: 'ok', record: { preferences: [] } };
  } catch (err) {
    if (isRecordNotFound(err)) return { status: 'missing' };
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Publish (or update) the record. `createdAt` is preserved across updates when
 * the caller passes the existing value, so the record keeps its real age.
 */
export async function writePreferredClientsToPds(
  agent: Agent,
  did: string,
  rules: PreferredClientRule[],
  existing?: PreferredClientsRecord | null,
): Promise<void> {
  const record = buildPreferredClientsRecord(rules, {
    createdAt: existing?.createdAt,
    updatedAt: new Date().toISOString(),
  });
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: PREFERRED_CLIENTS_NSID,
    rkey: PREFERRED_CLIENTS_RKEY,
    record,
  });
}

/**
 * Withdraw the record entirely. Used when the user turns publishing off — the
 * honest way to stop advertising a preference is to remove the declaration,
 * not to publish an empty one.
 *
 * A record that's already gone counts as success.
 */
export async function deletePreferredClientsFromPds(
  agent: Agent,
  did: string,
): Promise<void> {
  try {
    await agent.com.atproto.repo.deleteRecord({
      repo: did,
      collection: PREFERRED_CLIENTS_NSID,
      rkey: PREFERRED_CLIENTS_RKEY,
    });
  } catch (err) {
    if (isRecordNotFound(err)) return;
    throw err;
  }
}
