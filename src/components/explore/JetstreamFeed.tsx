'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, Pause, Play } from 'lucide-react';
import {
  createJetstreamConnection,
  type JetstreamCommit,
} from '@/utils/atproto/jetstream';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';
import { previewFor } from '@/utils/atproto/previewExtractors';
import AtUriLink from './AtUriLink';

type Row = {
  uri: string;
  did: string;
  collection: string;
  rkey: string;
  value: Record<string, unknown>;
  ts: number;
  receivedAt: number;
};

const MAX_VISIBLE = 50;
// Flush interval — slower than the firehose tempo on purpose. A faster flush
// makes the feed feel "live" but with thousands of events/sec the rendered
// list churns so fast that nothing is readable.
const FLUSH_INTERVAL_MS = 750;
// Hard cap on how many new rows we surface per flush. We deliberately *drop*
// events past this so the list reads as a sample of activity rather than a
// strobe of every commit. The rate counter below preserves the sense of
// scale.
const MAX_INSERTS_PER_FLUSH = 6;
// How long the "new" accent strip lingers on a row before fading out. Long
// enough to notice, short enough that the list doesn't look uniformly
// highlighted on a busy feed.
const NEW_ROW_ACCENT_MS = 1400;

/**
 * Live record feed from the Jetstream firehose.
 *
 * Two-layer throttle:
 *
 *   1. Buffer in a ref; flush to state on a fixed interval (FLUSH_INTERVAL_MS).
 *   2. Per-flush cap (MAX_INSERTS_PER_FLUSH) so the visible list doesn't
 *      churn even when the firehose dumps hundreds of events between flushes.
 *
 * Visual change cue is a brief left-edge accent on each newly-arrived row,
 * not a row-wide fade-in — at ~50 events/sec the row-wide flash reads as
 * a strobe.
 */
export default function JetstreamFeed({
  initialCollections,
}: {
  initialCollections?: string[];
}) {
  const [collections] = useState<string[] | undefined>(
    initialCollections && initialCollections.length ? initialCollections : undefined,
  );
  const [paused, setPaused] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  // Events per second over the last ~5s, computed from the buffer's arrival
  // rate (not just what we render). Lets users see the firehose volume even
  // though we only surface a sample of rows.
  const [eps, setEps] = useState(0);
  const buffer = useRef<Row[]>([]);
  const epsCounter = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dispose = createJetstreamConnection(
      { wantedCollections: collections },
      (evt: JetstreamCommit) => {
        const did = evt.did;
        const c = evt.commit.collection;
        const rkey = evt.commit.rkey;
        const value = (evt.commit.record as Record<string, unknown>) || {};
        const uri = `at://${did}/${c}/${rkey}`;
        const receivedAt = Date.now();
        buffer.current.push({
          uri,
          did,
          collection: c,
          rkey,
          value,
          ts: evt.time_us,
          receivedAt,
        });
        // Track arrival rate for the throughput indicator.
        epsCounter.current.push(receivedAt);
        // Bound buffer + counter so memory stays flat under steady load.
        if (buffer.current.length > 400) {
          buffer.current.splice(0, buffer.current.length - 400);
        }
      },
    );

    function tick() {
      const now = Date.now();
      // Throughput: events received in the last 5 seconds.
      epsCounter.current = epsCounter.current.filter((t) => now - t < 5_000);
      setEps(Math.round(epsCounter.current.length / 5));

      if (!paused && buffer.current.length > 0) {
        // Take only the most recent N from the buffer — older events drop.
        const buf = buffer.current;
        const take = buf.slice(-MAX_INSERTS_PER_FLUSH).reverse();
        buffer.current = [];
        setRows((prev) => {
          const seen = new Set(prev.map((r) => r.uri));
          const fresh = take.filter((r) => !seen.has(r.uri));
          if (fresh.length === 0) return prev;
          const next = [...fresh, ...prev];
          return next.slice(0, MAX_VISIBLE);
        });
      }

      timerRef.current = setTimeout(tick, FLUSH_INTERVAL_MS);
    }
    timerRef.current = setTimeout(tick, FLUSH_INTERVAL_MS);

    return () => {
      dispose();
      if (timerRef.current) clearTimeout(timerRef.current);
      buffer.current = [];
      epsCounter.current = [];
    };
  }, [collections, paused]);

  return (
    <section
      style={{
        marginTop: '2rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <Activity
          size={14}
          style={{ color: paused ? 'var(--text-tertiary)' : 'var(--text-accent)' }}
        />
        <span className="explore-small-caps" style={{ flex: 1 }}>
          Live across the Atmosphere
        </span>
        {eps > 0 && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              fontVariantNumeric: 'tabular-nums',
            }}
            title="Events per second across the firehose"
          >
            ~{eps.toLocaleString()}/s
          </span>
        )}
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.25rem 0.625rem',
            background: 'transparent',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          {paused ? <Play size={10} /> : <Pause size={10} />}
          {paused ? 'Resume' : 'Pause'}
        </button>
      </header>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          maxHeight: '32rem',
          overflowY: 'auto',
        }}
      >
        {rows.length === 0 && (
          <li
            style={{
              padding: '1.5rem 1rem',
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
              textAlign: 'center',
            }}
          >
            Waiting for records…
          </li>
        )}
        {rows.map((r) => {
          const explorerHref = explorePathFromAtUri(r.uri);
          const tail = r.collection.split('.').slice(-2).join('.');
          const age = Date.now() - r.receivedAt;
          const isFresh = age < NEW_ROW_ACCENT_MS;
          // Reusable inner grid that shows DID / collection / preview as
          // three columns. Used for both the linked and unlinked variants
          // so the row layout stays identical.
          const rowContents = (
            <>
              <code
                style={{
                  background: 'transparent',
                  padding: 0,
                  color: 'var(--text-tertiary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={r.did}
              >
                {shortDid(r.did)}
              </code>
              <code
                style={{
                  background: 'transparent',
                  padding: 0,
                  color: 'var(--text-accent)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={r.collection}
              >
                {tail}
              </code>
              <span
                style={{
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {previewFor(r.value) || r.rkey}
              </span>
            </>
          );
          const rowGridStyle: React.CSSProperties = {
            display: 'grid',
            gridTemplateColumns: 'minmax(14ch, 20ch) minmax(12ch, 18ch) 1fr',
            gap: '0.75rem',
            padding: '0.5rem 1rem',
            borderBottom: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            color: 'var(--text-primary)',
            textDecoration: 'none',
            alignItems: 'baseline',
          };
          return (
            <li
              key={r.uri}
              data-fresh={isFresh ? '' : undefined}
              className="explore-jetstream-row"
            >
              {explorerHref ? (
                <AtUriLink uri={r.uri} style={rowGridStyle}>
                  {rowContents}
                </AtUriLink>
              ) : (
                <div style={rowGridStyle}>{rowContents}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
