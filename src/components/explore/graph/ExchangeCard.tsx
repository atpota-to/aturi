'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, ArrowRight } from 'lucide-react';
import { exchangeTotals } from '@/lib/socialGraph';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { encodeRepo } from '@/utils/atproto/urls';
import {
  STAGE_LABELS,
  STAGE_ORDER,
  loadNeighbourhood,
  watchNeighbourhood,
  type Neighbourhood,
} from '@/utils/atproto/graphData';
import { ExchangeSummary } from './ExchangeView';

/**
 * The account card's relationships: who engaged with the account in the last
 * 30 days, whom it engaged with, and both, from the same read as the Graph
 * tab. That read is a few hundred requests, so the card never starts it on
 * its own: it shows a read already done or under way (from the Graph tab,
 * or this card earlier), and otherwise offers one.
 */
export default function ExchangeCard({ identity }: { identity: IdentityBundle }) {
  const [data, setData] = useState<Neighbourhood | null>(null);
  const [asked, setAsked] = useState(false);
  const readRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setData(null);
    setAsked(false);
    const stop = watchNeighbourhood(identity.did, setData);
    return () => {
      stop();
      readRef.current?.abort();
      readRef.current = null;
    };
  }, [identity.did]);

  const totals = useMemo(() => (data ? exchangeTotals(data.people) : null), [data]);

  function read() {
    readRef.current?.abort();
    const ac = new AbortController();
    readRef.current = ac;
    setAsked(true);
    // Updates arrive through the watcher above, which also hears reads
    // started elsewhere; this call only starts (or joins) one.
    loadNeighbourhood({ did: identity.did, pds: identity.pds }, () => {}, ac.signal).then((done) => {
      if (!done && !ac.signal.aborted) setAsked(false);
    });
  }

  const graphHref = `/explore/${encodeRepo(identity.handle || identity.did)}?tab=graph&layout=exchange`;

  if (!data && !asked) {
    return (
      <div className="fx-acct-x">
        <button type="button" className="fx-acct-x-read" onClick={read}>
          <ArrowLeftRight size={14} aria-hidden />
          <span>Relationships, last 30 days</span>
          <span className="fx-acct-x-go">Read</span>
        </button>
      </div>
    );
  }

  if (!data || data.stage !== 'done' || !totals) {
    const stage = data?.stage ?? 'follows';
    const at = Math.max(0, STAGE_ORDER.indexOf(stage));
    const done = (at + (data?.stageDone ?? 0)) / STAGE_ORDER.length;
    return (
      <div className="fx-acct-x">
        <div className="fx-acct-x-head">
          <span>Relationships</span>
          <span className="fx-acct-x-sub">last 30 days</span>
        </div>
        <div
          className="fx-acct-x-progress"
          role="progressbar"
          aria-label="Reading relationships"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(done * 100)}
        >
          <span style={{ width: `${Math.max(4, done * 100)}%` }} />
        </div>
        <p className="fx-acct-x-sub" role="status">
          {STAGE_LABELS[stage]}…
        </p>
      </div>
    );
  }

  return (
    <div className="fx-acct-x">
      <div className="fx-acct-x-head">
        <span>
          Relationships <span className="fx-acct-x-sub">last 30 days</span>
        </span>
        <Link href={graphHref} prefetch={false} className="fx-acct-x-link">
          Exchange
          <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
      {totals.reach ? (
        <ExchangeSummary totals={totals} compact />
      ) : (
        <p className="fx-acct-x-sub">No engagement either way.</p>
      )}
    </div>
  );
}
