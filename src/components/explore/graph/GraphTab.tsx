'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { relationOf } from '@/lib/socialGraph';
import { loadNeighbourhood, STAGE_LABELS, STAGE_ORDER, type Neighbourhood } from '@/utils/atproto/graphData';
import { Segmented } from '../lexicons/primitives';
import { FlowAccount } from './FlowView';
import { LedgerAccount } from './LedgerView';
import { OrbitAccount } from './OrbitView';
import { GraphDetail, Legend, atName, fmt, type GraphFocus } from './shared';

export const GRAPH_LAYOUTS = ['orbit', 'ledger', 'flow'] as const;
export type GraphLayout = (typeof GRAPH_LAYOUTS)[number];

export const GRAPH_LAYOUT_OPTIONS: { value: GraphLayout; label: string }[] = [
  { value: 'orbit', label: 'Orbit' },
  { value: 'ledger', label: 'Ledger' },
  { value: 'flow', label: 'Flow' },
];

/**
 * The account's Graph tab: who sits around it, in three views of the same
 * read. Orbit shows where everyone sits at once, Ledger who engages with
 * whom, and Flow lets you walk outward from the account one relationship at
 * a time. The layout is kept in the address (`?layout=`), so Back and a
 * shared link land on the same view.
 *
 * Nothing is read until the tab is opened; the read is staged (see
 * graphData.ts). A progress bar names each stage as it runs, and the drawing
 * fills in underneath it as the data lands: dots appear as accounts are
 * found and move rings as follows are checked.
 */
export default function GraphTab({ identity }: { identity: IdentityBundle }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get('layout');
  const layout: GraphLayout = (GRAPH_LAYOUTS as readonly string[]).includes(param ?? '') ? (param as GraphLayout) : 'orbit';
  const [data, setData] = useState<Neighbourhood | null>(null);
  const [failed, setFailed] = useState(false);
  const [focus, setFocus] = useState<GraphFocus | null>({ kind: 'subject' });

  useEffect(() => {
    const ac = new AbortController();
    loadNeighbourhood({ did: identity.did, pds: identity.pds }, setData, ac.signal).then((done) => {
      if (!done && !ac.signal.aborted) setFailed(true);
    });
    return () => ac.abort();
  }, [identity.did, identity.pds]);

  function selectLayout(next: GraphLayout) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'orbit') params.delete('layout');
    else params.set('layout', next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
  }

  if (failed && !data) return <p className="explore-error">Couldn’t read this account’s graph. Try again in a moment.</p>;

  const subjectName = data ? atName(data.subject) : identity.handle ? `@${identity.handle}` : 'this account';
  const empty = data?.stage === 'done' && data.people.length === 0;
  const loading = !data || data.stage !== 'done';

  return (
    <div className="fx-graph">
      <div className="fx-graph-head">
        <Segmented ariaLabel="Graph layout" options={GRAPH_LAYOUT_OPTIONS} value={layout} onChange={selectLayout} />
        {!loading && <p className="fx-graph-status">{fmt(data.people.length)} accounts</p>}
      </div>
      {loading && <GraphProgress data={data} />}
      {empty ? (
        <p className="explore-placeholder">
          Nothing to draw: this account follows no one and nobody engaged either way in the last 30 days.
        </p>
      ) : data ? (
        <>
          {layout !== 'ledger' && <Legend subject={subjectName} />}
          <div className="fx-graph-body">
            <div className="fx-graph-main">
              {layout === 'orbit' && <OrbitAccount data={data} focus={focus} onFocus={setFocus} />}
              {layout === 'ledger' && <LedgerAccount data={data} focus={focus} onFocus={setFocus} />}
              {layout === 'flow' && <FlowAccount data={data} focus={focus} onFocus={setFocus} />}
            </div>
            <GraphDetail
              focus={focus}
              subject={data.subject}
              subjectName={subjectName}
              emptyText="Point at, tap or tab to someone in the drawing to see who they are."
            />
          </div>
        </>
      ) : (
        <div className="fx-graph-placeholder" aria-hidden />
      )}
    </div>
  );
}

/**
 * The read, as it happens: one segment per stage, filling as the stage runs,
 * and a line naming the stage with what has been found so far. The stage name
 * is the live region; the running counts change too often to announce.
 */
function GraphProgress({ data }: { data: Neighbourhood | null }) {
  const stage = data?.stage ?? 'follows';
  const at = Math.max(0, STAGE_ORDER.indexOf(stage));
  const done = data?.stageDone ?? 0;
  const found: string[] = [];
  if (data && at > 0) found.push(`${fmt(data.follows.length)} follows`);
  if (data && at > 1) found.push(`${fmt(data.people.filter((p) => relationOf(p) === 'mutual').length)} follow back`);
  if (data && at > 2) found.push(`${fmt(data.records)} of their likes, reposts and posts`);
  if (data && at > 3) found.push(`${fmt(data.people.filter((p) => p.in > 0).length)} accounts engaged with them`);
  return (
    <div className="fx-graph-progress">
      <div
        className="fx-graph-progress-track"
        role="progressbar"
        aria-label="Reading this account’s graph"
        aria-valuemin={0}
        aria-valuemax={STAGE_ORDER.length}
        aria-valuenow={at + done}
      >
        {STAGE_ORDER.map((s, i) => (
          <span key={s} className="fx-graph-progress-step" data-state={i < at ? 'done' : i === at ? 'active' : undefined}>
            <span style={{ width: `${i < at ? 100 : i === at ? Math.max(6, done * 100) : 0}%` }} />
          </span>
        ))}
      </div>
      <p className="fx-graph-progress-text">
        <span role="status">{STAGE_LABELS[stage]}…</span>
        {found.length > 0 && <span className="fx-graph-progress-found"> {found.join(' · ')}</span>}
      </p>
    </div>
  );
}
