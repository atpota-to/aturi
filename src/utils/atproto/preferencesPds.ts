/**
 * Read / write the user's Aturi preferences to their PDS as a
 * `to.aturi.actor.preferences/self` record.
 *
 * Lexicon (informal):
 *
 *   $type: to.aturi.actor.preferences
 *   waypointGroups?: Array<{
 *     id: string,
 *     name: string,
 *     waypointIds: string[],
 *     collapsed?: boolean,
 *   }>
 *   customWaypoints?: Array<{
 *     id, name, domain?, description?,
 *     supportedTypes: string[],
 *     templates: { post?, profile?, list?, record?: string }
 *   }>
 *   knownWaypointIds?: string[]       // built-ins the user has been notified about
 *   pinnedLexicons?: string[]         // NSIDs pinned in the explorer
 *   pinnedLexiconsOthers?: string[]   // separate list for others' repos in split mode
 *   pinScope?: 'own' | 'all' | 'split'
 *   collectionGroupsCollapsedByDefault?: boolean
 *   hideRelationshipBar?: boolean         // hide the explorer relationship strip
 *   hideRepoGlance?: boolean              // hide the "Repo at a glance" section
 *   repoGlanceCollapsedByDefault?: boolean // start that section collapsed
 *   minimalProfile?: boolean              // minimal profile on repo pages
 *   hideRichPreview?: boolean             // collapse the rich preview on record pages
 *   showRawRecordJson?: boolean           // show raw record JSON on record pages
 *   updatedAt: datetime
 *
 *   // Legacy — still written for back-compat with older Aturi clients
 *   // that read these fields directly. New code migrates them into
 *   // `waypointGroups` on read.
 *   hiddenWaypoints?: string[]
 *   waypointOrder?: string[]
 */

import type { Agent } from '@atproto/api';
import {
  DEFAULT_PREFERENCES,
  mergeWithDefaults,
  type Preferences,
} from '../preferences';

export const PREFERENCES_NSID = 'to.aturi.actor.preferences';
export const PREFERENCES_RKEY = 'self';

export type PdsReadResult =
  | { status: 'ok'; prefs: Preferences }
  | { status: 'missing' }
  | { status: 'error'; error: string };

/**
 * Fetch the user's preferences record from their PDS. Returns
 * `{ status: 'missing' }` when the record doesn't exist (common case for
 * first-time sign-in), `{ status: 'error' }` for transport failures.
 */
export async function readPreferencesFromPds(
  agent: Agent,
  did: string,
): Promise<PdsReadResult> {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: PREFERENCES_NSID,
      rkey: PREFERENCES_RKEY,
    });
    const value = (res?.data || res) as { value?: unknown };
    const prefs = mergeWithDefaults(value?.value as Partial<Preferences> | null);
    return { status: 'ok', prefs };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The PDS responds with `RecordNotFound` (HTTP 400 / NotFound) when the
    // record simply hasn't been created yet. Treat that as "no prefs in
    // PDS" rather than an error worth surfacing.
    if (/RecordNotFound|Could not locate record/i.test(msg) || /\b400\b/.test(msg)) {
      return { status: 'missing' };
    }
    return { status: 'error', error: msg };
  }
}

/**
 * Persist preferences to the user's PDS. Always writes a fresh `updatedAt`
 * so concurrent edits from another device are detectable on next load.
 */
export async function writePreferencesToPds(
  agent: Agent,
  did: string,
  prefs: Preferences,
): Promise<void> {
  const record = {
    $type: PREFERENCES_NSID,
    waypointGroups: prefs.waypointGroups,
    customWaypoints: prefs.customWaypoints,
    knownWaypointIds: prefs.knownWaypointIds,
    pinnedLexicons: prefs.pinnedLexicons,
    pinnedLexiconsOthers: prefs.pinnedLexiconsOthers,
    pinScope: prefs.pinScope,
    collectionGroupsCollapsedByDefault: prefs.collectionGroupsCollapsedByDefault,
    hideRelationshipBar: prefs.hideRelationshipBar,
    hideRepoGlance: prefs.hideRepoGlance,
    repoGlanceCollapsedByDefault: prefs.repoGlanceCollapsedByDefault,
    minimalProfile: prefs.minimalProfile,
    hideRichPreview: prefs.hideRichPreview,
    showRawRecordJson: prefs.showRawRecordJson,
    // Legacy fields kept for back-compat with older clients.
    hiddenWaypoints: prefs.hiddenWaypoints,
    waypointOrder: prefs.waypointOrder,
    updatedAt: new Date().toISOString(),
  };
  await agent.com.atproto.repo.putRecord({
    repo: did,
    collection: PREFERENCES_NSID,
    rkey: PREFERENCES_RKEY,
    record,
  });
}

/**
 * Pick the "newer" of two preferences blobs by `updatedAt`. When the
 * timestamps are equal, prefer `b` (typically the PDS copy on first
 * sign-in, since cross-device sync is the higher-value direction).
 */
export function pickNewer(a: Preferences, b: Preferences): Preferences {
  if (!a) return b;
  if (!b) return a;
  return new Date(b.updatedAt).getTime() >= new Date(a.updatedAt).getTime() ? b : a;
}

export { DEFAULT_PREFERENCES };
