'use client';

import { useCallback, useState } from 'react';
import type { Agent } from '@atproto/api';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { voteRkeyFor, type ViewerVotes } from '@/utils/userinput/client';
import type { StrongRef } from '@/utils/userinput/lexicons';
import { setVote, type VoteDirection } from '@/utils/userinput/writes';

export type Voting = {
  /** The viewer's current vote on a subject, or null. */
  directionFor: (subjectUri: string) => VoteDirection;
  /** Cast, switch or retract a vote. No-op when signed out. */
  cast: (subject: StrongRef, next: VoteDirection) => Promise<void>;
  /** Set while a write is in flight, keyed by subject URI. */
  pending: Set<string>;
  error: string | null;
};

/**
 * Vote writes, shared by the board and the thread view.
 *
 * A vote is a record in the voter's own repo, and the count it feeds is a
 * Constellation aggregate that trails the firehose by a moment. Waiting for
 * the index to catch up before repainting would make every click look dropped,
 * so the viewer's own state and the visible score both move immediately and
 * are rolled back if the write fails. The next full board load reconciles.
 */
export function useVoting({
  votes,
  setVotes,
  onDelta,
}: {
  votes: ViewerVotes;
  setVotes: React.Dispatch<React.SetStateAction<ViewerVotes>>;
  /** Apply the optimistic score change (+1, -1, +2, -2) to a subject. */
  onDelta: (subjectUri: string, delta: number) => void;
}): Voting {
  const { agent, did } = useAtprotoSession();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const directionFor = useCallback(
    (subjectUri: string): VoteDirection => {
      const rkey = voteRkeyFor(subjectUri);
      if (!rkey) return null;
      if (votes.up.has(rkey)) return 'up';
      if (votes.down.has(rkey)) return 'down';
      return null;
    },
    [votes],
  );

  const cast = useCallback(
    async (subject: StrongRef, next: VoteDirection) => {
      if (!agent || !did) return;
      const rkey = voteRkeyFor(subject.uri);
      if (!rkey) return;
      const current = directionFor(subject.uri);
      if (current === next) return;

      // Score of a direction as a number, so switching sides is a 2-point swing.
      const weight = (d: VoteDirection) => (d === 'up' ? 1 : d === 'down' ? -1 : 0);
      const delta = weight(next) - weight(current);

      const applyLocal = (direction: VoteDirection) => {
        setVotes((prev) => {
          const up = new Set(prev.up);
          const down = new Set(prev.down);
          up.delete(rkey);
          down.delete(rkey);
          if (direction === 'up') up.add(rkey);
          if (direction === 'down') down.add(rkey);
          return { up, down };
        });
      };

      setPending((prev) => new Set(prev).add(subject.uri));
      setError(null);
      applyLocal(next);
      onDelta(subject.uri, delta);

      try {
        await setVote(agent as unknown as Agent & { assertDid: string }, {
          subject,
          current,
          next,
        });
      } catch (err) {
        applyLocal(current);
        onDelta(subject.uri, -delta);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending((prev) => {
          const nextPending = new Set(prev);
          nextPending.delete(subject.uri);
          return nextPending;
        });
      }
    },
    [agent, did, directionFor, onDelta, setVotes],
  );

  return { directionFor, cast, pending, error };
}
