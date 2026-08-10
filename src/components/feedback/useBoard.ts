'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import {
  EMPTY_VOTES,
  loadDiscussions,
  loadSpaceContext,
  loadViewerVotes,
  resolveSpace,
  type Discussion,
  type ResolvedSpace,
  type SpaceContext,
  type ViewerVotes,
} from '@/utils/userinput/client';

export type BoardState = {
  /** True until the first load settles, including when there's no space. */
  loading: boolean;
  /** Null when no space exists yet — the setup panel handles that case. */
  space: ResolvedSpace | null;
  ctx: SpaceContext | null;
  discussions: Discussion[];
  votes: ViewerVotes;
  error: string | null;
  /** Whether the signed-in viewer may set statuses, pin, hide and lock. */
  isModerator: boolean;
  /** Re-read the board from the network. */
  refresh: () => void;
  /** Move one discussion's score without a round trip (optimistic voting). */
  bumpScore: (uri: string, delta: number) => void;
  setVotes: React.Dispatch<React.SetStateAction<ViewerVotes>>;
};

/**
 * Loads the whole board: the space, who's allowed to moderate it, every
 * discussion in it, and the viewer's own votes.
 *
 * Discussions and votes are fetched in parallel but tracked separately,
 * because they invalidate on different events — voting changes the viewer's
 * set without changing anyone else's board, and signing in changes the votes
 * without changing the board at all.
 */
export function useBoard(): BoardState {
  const { did } = useAtprotoSession();
  const [loading, setLoading] = useState(true);
  const [space, setSpace] = useState<ResolvedSpace | null>(null);
  const [ctx, setCtx] = useState<SpaceContext | null>(null);
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [votes, setVotes] = useState<ViewerVotes>(EMPTY_VOTES);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const resolved = await resolveSpace();
        if (cancelled) return;
        setSpace(resolved);
        if (!resolved) {
          setCtx(null);
          setDiscussions([]);
          return;
        }

        const context = await loadSpaceContext(resolved);
        if (cancelled) return;
        setCtx(context);

        const list = await loadDiscussions(context);
        if (cancelled) return;
        setDiscussions(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    let cancelled = false;
    if (!did) {
      setVotes(EMPTY_VOTES);
      return undefined;
    }
    loadViewerVotes(did).then((v) => {
      if (!cancelled) setVotes(v);
    });
    return () => {
      cancelled = true;
    };
  }, [did, nonce]);

  // Applied against the previous state rather than a captured list, so two
  // votes landing back-to-back (or a rollback racing a fresh click) both
  // compose instead of the second overwriting the first's result.
  const bumpScore = useCallback((uri: string, delta: number) => {
    setDiscussions((prev) =>
      prev.map((d) =>
        d.uri === uri
          ? { ...d, counts: { ...d.counts, score: d.counts.score + delta } }
          : d,
      ),
    );
  }, []);

  return {
    loading,
    space,
    ctx,
    discussions,
    votes,
    error,
    isModerator: Boolean(did && ctx?.moderatorDids.has(did)),
    refresh,
    bumpScore,
    setVotes,
  };
}
