'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { loadNeighbourhood, LIMITS, STAGE_LABELS, type Neighbourhood } from '@/utils/atproto/graphData';
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
 * graphData.ts) and the drawing fills in as each stage lands.
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
        <p className="fx-graph-status" role="status">
          {loading
            ? `${data ? STAGE_LABELS[data.stage] : STAGE_LABELS.follows}…${data?.requests ? ` ${fmt(data.requests)} requests so far` : ''}`
            : `${fmt(data.people.length)} accounts`}
        </p>
      </div>
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
          {data.stage === 'done' && <Coverage data={data} subjectName={subjectName} />}
        </>
      ) : (
        <div className="fx-graph-placeholder" aria-hidden />
      )}
    </div>
  );
}

const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** What was read and what was left out, in plain words. */
function Coverage({ data, subjectName }: { data: Neighbourhood; subjectName: string }) {
  const c = data.coverage;
  const lines: string[] = [];
  lines.push(
    c.followsCapped
      ? `Follows: the newest ${fmt(c.followsRead)} of ${fmt(data.subject.followsCount ?? c.followsRead)}.`
      : `Follows: all ${fmt(c.followsRead)}.`,
  );
  if (c.mutualsFailed) lines.push('Constellation didn’t answer, so nobody is marked as following back.');
  if (c.outboundFailed) {
    lines.push(`${subjectName}’s PDS didn’t answer, so their own likes, reposts and posts weren’t read.`);
  } else {
    lines.push(
      `${subjectName}’s engagement: ${fmt(c.likesRead)} likes, ${fmt(c.repostsRead)} reposts and ${fmt(c.postsRead)} posts from their own repo` +
        (c.outboundReachedMs ? `, reaching back to ${day(c.outboundReachedMs)} rather than the full 30 days.` : ', the full 30 days.'),
    );
  }
  if (c.inboundPosts) {
    lines.push(
      `Engagement with them: who liked, reposted, replied to or quoted their ${fmt(c.inboundPosts)} most-engaged posts of the ${fmt(c.inboundPostsScanned)} most recent` +
        (c.inboundShare != null ? ` (${Math.round(c.inboundShare * 100)}% of the engagement on those)` : '') +
        `, plus mentions of them.` +
        (c.inboundTruncated ? ` ${fmt(c.inboundTruncated)} of those lists ran past one page of ${LIMITS.perList} and were read in part.` : ''),
    );
  } else {
    lines.push('Engagement with them: no posts with engagement in the last 30 days, so only mentions were read.');
  }
  lines.push(
    c.inCommonSkipped
      ? `2nd degree wasn’t counted: past ${fmt(LIMITS.inCommonMaxFollows)} follows, each count takes too many requests.`
      : `2nd degree: follows in common counted for the ${fmt(c.inCommonCounted)} most engaged accounts with no follow either way. Everyone else with no follow sits on the rim, unmeasured.`,
  );
  lines.push(
    `Followers are known for their follows and for everyone who engaged either way, not for every follower. ${fmt(data.requests)} requests to the Bluesky AppView, their PDS and Constellation, all public.`,
  );
  return (
    <details className="fx-graph-coverage">
      <summary>How this was read</summary>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </details>
  );
}
