'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createJetstreamConnection } from '@/utils/atproto/jetstream';
import type { ApiRecord } from '@/utils/ufos/config';

/**
 * Records of one lexicon from Jetstream, written while the visitor waits,
 * to widen the few dozen UFOs keeps when field usage needs more to go on.
 *
 * A run listens for LIVE_SECONDS or until LIVE_MAX records arrive, whichever
 * comes first, and can be stopped sooner. Fifteen seconds is long enough for
 * a lexicon written every few seconds to add something and short enough to
 * watch; the cap ends a run on a busy lexicon (likes arrive by the hundred a
 * second) rather than measuring a flood. Creates and updates both carry the
 * whole record, so both count; a record seen twice is counted as it was last.
 *
 * What arrives is kept for the visit, like the rest of the workbench's reads,
 * so switching tabs or stepping away and back finds it, and another run adds
 * to it. A run ends when the pane that started it goes away.
 */

export const LIVE_SECONDS = 15;
export const LIVE_MAX = 1000;
/** How often arrivals are handed to the page, which re-measures on each. */
const FLUSH_MS = 500;

export type LivePhase = 'idle' | 'listening' | 'done';

export type LiveSample = {
  phase: LivePhase;
  /** Every record Jetstream has added for this lexicon, across runs, each once. */
  records: ApiRecord[];
  /** Seconds listened across runs. */
  seconds: number;
  /** What the last finished run added, and whether its socket ever failed. */
  last: { added: number; seconds: number; errored: boolean } | null;
  start: () => void;
  stop: () => void;
};

type Kept = { records: ApiRecord[]; seconds: number; last: LiveSample['last'] };

const kept = new Map<string, Kept>();
const EMPTY: Kept = { records: [], seconds: 0, last: null };

export function useLiveSample(nsid: string): LiveSample {
  const [snapshot, setSnapshot] = useState<{ nsid: string; kept: Kept }>(() => ({ nsid, kept: kept.get(nsid) ?? EMPTY }));
  const [listening, setListening] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSnapshot({ nsid, kept: kept.get(nsid) ?? EMPTY });
    return () => stopRef.current?.();
  }, [nsid]);

  const start = useCallback(() => {
    if (stopRef.current) return;
    const base = kept.get(nsid) ?? EMPTY;
    const byKey = new Map(base.records.map((r) => [`${r.did}/${r.rkey}`, r]));
    const startedAt = Date.now();
    let added = 0;
    let errored = false;
    let dirty = false;

    const publish = (last: Kept['last']) => {
      const next: Kept = { records: [...byKey.values()], seconds: base.seconds + (Date.now() - startedAt) / 1000, last };
      kept.set(nsid, next);
      setSnapshot({ nsid, kept: next });
    };

    const dispose = createJetstreamConnection(
      { wantedCollections: [nsid], wantedOps: ['create', 'update'] },
      (evt) => {
        if (evt.commit.collection !== nsid || !evt.commit.record) return;
        const key = `${evt.did}/${evt.commit.rkey}`;
        if (!byKey.has(key)) added++;
        // Delete first so a record seen again moves to the end, as the newest.
        byKey.delete(key);
        byKey.set(key, {
          did: evt.did,
          collection: nsid,
          rkey: evt.commit.rkey,
          record: evt.commit.record,
          time_us: evt.time_us,
        });
        dirty = true;
        if (added >= LIVE_MAX) finish();
      },
      () => {
        errored = true;
      },
    );
    const flush = window.setInterval(() => {
      if (!dirty) return;
      dirty = false;
      publish(base.last);
    }, FLUSH_MS);
    const timer = window.setTimeout(() => finish(), LIVE_SECONDS * 1000);

    function finish() {
      if (stopRef.current !== finish) return;
      stopRef.current = null;
      window.clearInterval(flush);
      window.clearTimeout(timer);
      dispose();
      publish({ added, seconds: (Date.now() - startedAt) / 1000, errored });
      setListening(null);
    }

    stopRef.current = finish;
    setListening(nsid);
  }, [nsid]);

  const stop = useCallback(() => stopRef.current?.(), []);

  const current = snapshot.nsid === nsid ? snapshot.kept : (kept.get(nsid) ?? EMPTY);
  return {
    phase: listening === nsid ? 'listening' : current.last ? 'done' : 'idle',
    records: current.records,
    seconds: current.seconds,
    last: current.last,
    start,
    stop,
  };
}
