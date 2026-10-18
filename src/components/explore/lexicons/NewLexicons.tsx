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

type NewLexicon = { nsid: string; creates: number; didsEstimate: number };
type Answer = { minAccounts: number; historyBegins: string; count: number; lexicons: NewLexicon[] };

const RESULT_COUNT = 10;
/** Row count after "Show more". */
const EXPANDED_COUNT = 25;

export default function NewLexicons() {
  const [window, setWindow] = useState<Window>('7d');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // As in the trending strip, the previous rows stay up while a new
    // window loads; the skeleton only shows on first load.
    (async () => {
      try {
        const res = await fetch(`/api/lexicons/new?window=${window}`);
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        if (!cancelled) setAnswer(body as Answer);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [window]);

  const limit = expanded ? EXPANDED_COUNT : RESULT_COUNT;
  const visible = answer ? answer.lexicons.slice(0, limit) : null;

  return (
    <AppearIn delay={0.14}>
      <section
        style={{
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-secondary)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.625rem',
            padding: '0.875rem 1rem',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontFamily: 'var(--font-serif)',
              color: 'var(--text-primary)',
              fontSize: '0.9375rem',
            }}
          >
            <Sprout size={14} aria-hidden style={{ color: 'var(--text-accent)' }} />
            New lexicons
            <span
              style={{
                marginLeft: '0.25rem',
                fontSize: '0.7rem',
                color: 'var(--text-tertiary)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              via UFOs
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Record types seen for the first time in this window, with three or more accounts using them.
          </p>
          <div>
            <Segmented
              ariaLabel="Time window"
              options={(Object.keys(WINDOWS) as Window[]).map((w) => ({ value: w, label: WINDOWS[w].label }))}
              value={window}
              onChange={(v) => setWindow(v as Window)}
            />
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {error ? (
            <div className="explore-error" style={{ padding: '1rem' }}>
              Couldn&rsquo;t load new lexicons: {error}
            </div>
          ) : visible ? (
            visible.length === 0 ? (
              <p className="explore-placeholder" style={{ padding: '1rem', margin: 0 }}>
                Nothing new with three or more accounts in this window.
              </p>
            ) : (
              <>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {visible.map((lexicon, i) => (
                    <Row key={lexicon.nsid} lexicon={lexicon} rank={i + 1} isLast={i === visible.length - 1} />
                  ))}
                </ul>
                {answer && answer.count > RESULT_COUNT && (
                  <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-subtle)' }}>
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      aria-expanded={expanded}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-medium)',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-serif)',
                        fontSize: '0.8125rem',
                        cursor: 'pointer',
                      }}
                    >
                      {expanded ? `Show ${RESULT_COUNT}` : `Show ${Math.min(answer.count, EXPANDED_COUNT)} of ${answer.count}`}
                    </button>
                  </div>
                )}
              </>
            )
          ) : (
            <SkeletonRows count={RESULT_COUNT} />
          )}
        </div>
        {answer && (
          <p
            style={{
              margin: 0,
              padding: '0.625rem 1rem',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.75rem',
              lineHeight: 1.5,
              color: 'var(--text-tertiary)',
            }}
          >
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

function Row({ lexicon, rank, isLast }: { lexicon: NewLexicon; rank: number; isLast: boolean }) {
  const { head, tail } = splitNsid(lexicon.nsid);
  return (
    <li style={{ borderBottom: isLast ? undefined : '1px solid var(--border-subtle)' }}>
      <Link
        href={lexiconPathFor(lexicon.nsid)}
        prefetch={false}
        title={`Open ${lexicon.nsid} in the lexicons explorer`}
        className="lexicon-row-grid"
        style={{ textDecoration: 'none', color: 'var(--text-primary)', transition: 'background 0.2s ease' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-tertiary)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {rank.toString().padStart(2, '0')}
        </span>
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
    <span
      title={`${value.toLocaleString()} ${unit}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '0.1rem',
        fontFamily: 'var(--font-mono)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{formatCount(value)}</span>
      <span style={{ fontSize: '0.625rem', color: 'var(--text-tertiary)' }}>{unit}</span>
    </span>
  );
}

/** First-load placeholder with the loaded rows' grid, so the section does not resize. */
function SkeletonRows({ count }: { count: number }) {
  const nsidWidths = ['62%', '78%', '52%', '70%', '46%', '82%', '58%', '66%', '50%', '74%'];
  return (
    <ul aria-hidden style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} style={{ borderBottom: i === count - 1 ? undefined : '1px solid var(--border-subtle)' }}>
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
