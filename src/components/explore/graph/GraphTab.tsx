'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { relationOf, type GraphPerson } from '@/lib/socialGraph';
import { loadNeighbourhood, STAGE_LABELS, STAGE_ORDER, type Neighbourhood } from '@/utils/atproto/graphData';
import { Segmented } from '../lexicons/primitives';
import { FlowAccount } from './FlowView';
import { LedgerAccount } from './LedgerView';
import { OrbitAccount } from './OrbitView';
import {
  GraphDetail,
  Legend,
  atName,
  fmt,
  isPerson,
  nameOf,
  relationColor,
  relationSentence,
  type GraphFocus,
} from './shared';

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
 *
 * The drawing gets the full width until someone in it is clicked. Their
 * details then slide in beside it, and stay put while the pointer moves on,
 * so the ways onward from them can be reached across the drawing; a second
 * click, the close button or Esc puts them away. Pointing only marks what's
 * under the pointer, and on the Orbit, whose dots carry no names, a tooltip
 * says whose it is. The account itself isn't described: it is in the
 * explorer's left pane already.
 */
export default function GraphTab({ identity }: { identity: IdentityBundle }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const param = searchParams.get('layout');
  const layout: GraphLayout = (GRAPH_LAYOUTS as readonly string[]).includes(param ?? '') ? (param as GraphLayout) : 'orbit';
  const [data, setData] = useState<Neighbourhood | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<GraphFocus | null>(null);
  const [tip, setTip] = useState<{ person: GraphPerson; x: number; y: number; below: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // The mark under the pointer or keyboard focus, for placing the tooltip and
  // for handing focus back when the details close.
  const anchorRef = useRef<Element | null>(null);
  const openerRef = useRef<Element | null>(null);
  // A tap fires the same hover and focus events a mouse does; a tooltip from
  // one would stay up over the drawing.
  const inputRef = useRef<string>('mouse');

  const preview = useCallback(
    (f: GraphFocus | null) => {
      const root = rootRef.current;
      const el = anchorRef.current;
      if (layout !== 'orbit' || inputRef.current === 'touch' || f?.kind !== 'person' || !isPerson(f.person) || !root || !el) {
        setTip(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      const below = r.top - box.top < 90;
      setTip({
        person: f.person,
        x: Math.min(Math.max(r.left + r.width / 2 - box.left, 130), box.width - 130),
        y: below ? r.bottom - box.top : r.top - box.top,
        below,
      });
    },
    [layout],
  );

  const select = useCallback((f: GraphFocus | null) => {
    openerRef.current = anchorRef.current;
    setSelected((cur) => (f?.kind === 'person' && cur?.kind === 'person' && cur.person.did === f.person.did ? null : f));
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setSelected(null);
    const el = openerRef.current as HTMLElement | SVGElement | null;
    if (returnFocus && el?.isConnected) el.focus({ preventScroll: true });
  }, []);

  // The tooltip is placed once, where the mark was; scrolling moves the mark.
  useEffect(() => {
    if (!tip) return undefined;
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [tip]);

  // Under the drawing on a narrow screen, the details can open out of sight.
  const selectedKey = selected?.kind === 'person' ? selected.person.did : selected?.kind;
  useEffect(() => {
    if (!selectedKey) return;
    const pane = rootRef.current?.querySelector('.fx-graph-split > .fx-graph-detail');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    pane?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [selectedKey]);

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
  // The read keeps going after a click, so the details follow the latest
  // copy of whoever was clicked rather than the one the click caught.
  const latest = selected?.kind === 'person' ? data?.people.find((p) => p.did === selected.person.did) : undefined;
  const shown: GraphFocus | null = latest && selected?.kind === 'person' ? { ...selected, person: latest } : selected;

  const track = (e: React.SyntheticEvent) => {
    anchorRef.current = (e.target as Element).closest?.('[tabindex]') ?? null;
  };

  return (
    <div
      ref={rootRef}
      className="fx-graph fx-graph-account"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selected) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
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
          <div className="fx-graph-split" data-open={shown ? '' : undefined}>
            <div
              className="fx-graph-main"
              onPointerOverCapture={(e) => {
                inputRef.current = e.pointerType;
                track(e);
              }}
              onPointerDownCapture={(e) => {
                inputRef.current = e.pointerType;
              }}
              onKeyDownCapture={() => {
                inputRef.current = 'keyboard';
              }}
              onFocusCapture={track}
              onPointerOut={(e) => {
                const a = anchorRef.current;
                if (tip && a?.contains(e.target as Node) && !a.contains(e.relatedTarget as Node | null)) setTip(null);
              }}
              onBlurCapture={(e) => {
                if (tip && e.target === anchorRef.current) setTip(null);
              }}
            >
              {layout === 'orbit' && <OrbitAccount data={data} focus={shown} onFocus={preview} onSelect={select} />}
              {layout === 'ledger' && <LedgerAccount data={data} focus={shown} onFocus={preview} onSelect={select} />}
              {layout === 'flow' && <FlowAccount data={data} focus={shown} onFocus={preview} onSelect={select} />}
            </div>
            {shown && (
              <GraphDetail
                focus={shown}
                subjectName={subjectName}
                onClose={() => close(Boolean(document.activeElement?.matches(':focus-visible')))}
              />
            )}
          </div>
          {tip && (
            <div className="fx-graph-tip" data-below={tip.below || undefined} style={{ left: tip.x, top: tip.y }} aria-hidden>
              <span className="fx-graph-tip-name">{nameOf(tip.person)}</span>
              <span className="fx-graph-tip-rel">
                <span className="fx-graph-swatch" style={{ background: relationColor(relationOf(tip.person)) }} />
                {relationSentence(tip.person, subjectName)}
              </span>
              {shown?.kind === 'person' && shown.person.did === tip.person.did ? null : (
                <span className="fx-graph-tip-hint">Click for details</span>
              )}
            </div>
          )}
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
