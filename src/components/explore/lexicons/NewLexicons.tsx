'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sprout } from 'lucide-react';
import AppearIn from '../AppearIn';
import { Skeleton } from '@/components/SkeletonLoader';
import { Credit, Segmented } from './primitives';
import { formatCount } from '@/utils/ufos/format';
import { lexiconPathFor, splitNsid } from '@/utils/ufos/nsid';
import { WINDOWS, type Window } from '@/utils/ufos/windows';

/**
 * "New lexicons" on /explore/lexicons: NSIDs UFOs saw for the first time in
 * the window, used by three or more accounts. Finding them costs UFOs around
 * thirty requests, so /api/lexicons/new does it once per cache period rather
 * than every visitor's browser doing it here. The MCP list_new_lexicons tool
 * gives the same answer.
 */

export type NewLexicon = { nsid: string; creates: number; didsEstimate: number };
export type NewLexiconsAnswer = {
  minAccounts: number;
  historyBegins: string;
  count: number;
  lexicons: NewLexicon[];
};

export const NEW_RESULT_COUNT = 10;
/** Row count after "Show more". */
export const NEW_EXPANDED_COUNT = 25;

/**
 * Loads /api/lexicons/new for a window. As in the trending strip, the
 * previous answer stays up while a new window loads, so the skeleton only
 * shows on first load. Shared with the /explore landing's "New" card.
 */
export function useNewLexicons(window: Window) {
  const [answer, setAnswer] = useState<NewLexiconsAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/lexicons/new?window=${window}`);
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (!cancelled) setAnswer(body as NewLexiconsAnswer);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [window]);

  return { answer, error };
}

export default function NewLexicons() {
  const [window, setWindow] = useState<Window>('7d');
  const { answer, error } = useNewLexicons(window);
  const [expanded, setExpanded] = useState(false);

  const limit = expanded ? NEW_EXPANDED_COUNT : NEW_RESULT_COUNT;
  const visible = answer ? answer.lexicons.slice(0, limit) : null;

  return (
    <AppearIn delay={0.14}>
      <section id="new" className="fn-list-card" aria-labelledby="fn-new-lexicons-title">
        <div className="fn-list-card-head">
          <div className="fn-list-card-title-row">
            <span className="fn-list-card-icon" aria-hidden>
              <Sprout size={14} />
            </span>
            <h2 id="fn-new-lexicons-title" className="fn-list-card-title">
              New lexicons
            </h2>
            <span className="fn-list-card-via">via UFOs</span>
          </div>
          <p className="fn-list-card-sub">
            Record types seen for the first time in this window, with three or more accounts using them.
          </p>
          <div className="fn-list-card-controls">
            <Segmented
              ariaLabel="Time window"
              options={(Object.keys(WINDOWS) as Window[]).map((w) => ({ value: w, label: WINDOWS[w].label }))}
              value={window}
              onChange={(v) => setWindow(v as Window)}
            />
          </div>
        </div>
        <div className="fn-list-card-body">
          {error ? (
            <div className="explore-error fn-list-card-msg">
              Couldn&rsquo;t load new lexicons: {error}
            </div>
          ) : visible ? (
            visible.length === 0 ? (
              <p className="explore-placeholder fn-list-card-msg">
                Nothing new with three or more accounts in this window.
              </p>
            ) : (
              <>
                <ul className="fn-list-rows">
                  {visible.map((lexicon, i) => (
                    <Row key={lexicon.nsid} lexicon={lexicon} rank={i + 1} />
                  ))}
                </ul>
                {answer && answer.count > NEW_RESULT_COUNT && (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    aria-expanded={expanded}
                    className="fn-list-card-foot"
                  >
                    {expanded
                      ? `Show ${NEW_RESULT_COUNT}`
                      : `Show ${Math.min(answer.count, NEW_EXPANDED_COUNT)} of ${answer.count}`}
                  </button>
                )}
              </>
            )
          ) : (
            <SkeletonRows count={NEW_RESULT_COUNT} />
          )}
        </div>
        {answer && (
          <p className="fn-list-card-note">
            First seen means no activity UFOs recorded between {answer.historyBegins}, when its history begins,
            and the start of the window. Account counts are estimates, and a few accounts can still be one
            developer testing.
          </p>
        )}
        <Credit />
      </section>
    </AppearIn>
  );
}

function Row({ lexicon, rank }: { lexicon: NewLexicon; rank: number }) {
  const { head, tail } = splitNsid(lexicon.nsid);
  return (
    <li>
      <Link
        href={lexiconPathFor(lexicon.nsid)}
        prefetch={false}
        title={`Open ${lexicon.nsid} in the lexicons explorer`}
        className="lexicon-row-grid fn-row"
      >
        <span className="fn-row-rank">{rank}</span>
        <span className="lexicon-row-nsid" title={lexicon.nsid}>
          <span className="lexicon-nsid-head">{head}</span>
          {tail && <span className="lexicon-nsid-tail">{tail}</span>}
        </span>
        <Count value={lexicon.creates} unit="records" />
        <Count value={lexicon.didsEstimate} unit="accounts" />
      </Link>
    </li>
  );
}

function Count({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="fn-row-figures" title={`${value.toLocaleString()} ${unit}`}>
      <span className="fn-row-count">{formatCount(value)}</span>
      <span className="fn-row-unit">{unit}</span>
    </span>
  );
}

/** First-load placeholder with the loaded rows' grid, so the section does not resize. */
function SkeletonRows({ count }: { count: number }) {
  const nsidWidths = ['62%', '78%', '52%', '70%', '46%', '82%', '58%', '66%', '50%', '74%'];
  return (
    <ul aria-hidden className="fn-list-rows">
      {Array.from({ length: count }).map((_, i) => (
        <li key={i}>
          <div className="lexicon-row-grid">
            <Skeleton width="1.25rem" height="0.75rem" />
            <span className="lexicon-row-nsid-skel">
              <Skeleton width={nsidWidths[i % nsidWidths.length]} height="0.75rem" />
              <span className="lexicon-nsid-tail-skel">
                <Skeleton width={nsidWidths[(i + 4) % nsidWidths.length]} height="0.75rem" />
              </span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
              <Skeleton width="2rem" height="0.75rem" />
              <Skeleton width="2.5rem" height="0.5rem" />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem' }}>
              <Skeleton width="2rem" height="0.75rem" />
              <Skeleton width="2.75rem" height="0.5rem" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
