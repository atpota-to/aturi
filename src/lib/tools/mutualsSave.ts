/**
 * Saving the mutuals' blocks tool's result as a moderation list: the writes,
 * in the signed-in account's own repository. The records themselves are
 * built in mutuals.ts.
 *
 * A list is one `app.bsky.graph.list` record, and each member a separate
 * `app.bsky.graph.listitem` beside it naming the list and the account. The
 * members go in `applyWrites` batches of 200, one commit each. Every create
 * costs a PDS three write points, so the batches are paced against the
 * account's hourly budget the way the explorer paces a bulk delete
 * (writeThrottle.ts); a list of a few thousand pauses rather than hitting
 * the limit. A batch that fails wrote nothing, so what is left is always a
 * whole number of batches and adding it again picks up where it stopped.
 */

import type { Agent } from '@atproto/api';
import { THROTTLE_TICK_MS, rateLimitResetMinutes, sleep } from '@/components/explore/collectionListHelpers';
import { msUntilBudget, recordSpend } from '@/utils/atproto/writeThrottle';
import {
  APPLY_WRITES_MAX,
  CREATE_POINTS,
  LISTBLOCK_COLLECTION,
  LIST_COLLECTION,
  chunk,
  listItemWrites,
  listRecord,
} from './mutuals';

type WriteAgent = Pick<Agent, 'com'>;

/** Create the list itself. Returns its at:// URI. */
export async function createModList(agent: WriteAgent, did: string, name: string, description: string): Promise<string> {
  const now = new Date().toISOString();
  recordSpend(did, CREATE_POINTS);
  const res = await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: LIST_COLLECTION,
    record: listRecord(name, description, now),
  });
  return res.data.uri;
}

/** Block everyone on a list, by writing a listblock record for it. */
export async function blockList(agent: WriteAgent, did: string, listUri: string): Promise<void> {
  recordSpend(did, CREATE_POINTS);
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: LISTBLOCK_COLLECTION,
    record: { $type: LISTBLOCK_COLLECTION, subject: listUri, createdAt: new Date().toISOString() },
  });
}

export type AddProgress = {
  done: number;
  total: number;
  /** Seconds until the write budget allows the next batch, while waiting for it. */
  waitingSec: number | null;
};

export type AddOutcome = {
  /** Accounts written to the list. */
  added: number;
  /** Accounts not written, in order, to add again. */
  remaining: string[];
  /** Why it ended short. Absent when everything was added. */
  endedBy?: 'stop' | 'rate-limit' | 'error';
  /** The first error's message, when `endedBy` is `error`. */
  error?: string;
  /** Minutes until the PDS's write budget resets, when it refused a batch. */
  resetMinutes?: number | null;
};

/**
 * Add accounts to a list, a batch at a time, pacing against the write
 * budget. `stopper.stop` ends it after the batch in flight.
 */
export async function addMembers(
  agent: WriteAgent,
  did: string,
  listUri: string,
  subjects: readonly string[],
  { onProgress, stopper }: { onProgress: (progress: AddProgress) => void; stopper: { stop: boolean } },
): Promise<AddOutcome> {
  const batches = chunk(subjects, APPLY_WRITES_MAX);
  let added = 0;
  onProgress({ done: 0, total: subjects.length, waitingSec: null });

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const points = batch.length * CREATE_POINTS;
    const remaining = () => batches.slice(i).flat();

    for (;;) {
      if (stopper.stop) break;
      const wait = msUntilBudget(did, points);
      if (wait <= 0) break;
      onProgress({ done: added, total: subjects.length, waitingSec: Math.ceil(wait / 1000) });
      await sleep(Math.min(wait, THROTTLE_TICK_MS));
    }
    if (stopper.stop) return { added, remaining: remaining(), endedBy: 'stop' };

    // Reserve the points before sending, and keep them on a failure:
    // under-counting is what would trip the limit.
    recordSpend(did, points);
    try {
      await agent.com.atproto.repo.applyWrites({
        repo: did,
        writes: listItemWrites(listUri, batch, new Date().toISOString()),
      });
    } catch (err) {
      if ((err as { status?: number } | null)?.status === 429) {
        return { added, remaining: remaining(), endedBy: 'rate-limit', resetMinutes: rateLimitResetMinutes(err) };
      }
      return {
        added,
        remaining: remaining(),
        endedBy: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    added += batch.length;
    onProgress({ done: added, total: subjects.length, waitingSec: null });
  }
  return { added, remaining: [] };
}
