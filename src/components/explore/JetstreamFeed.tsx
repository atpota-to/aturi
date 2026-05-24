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
};

const MAX_VISIBLE = 50;

/**
 * Live record feed from the Jetstream firehose. Buffers events in a ref
 * and flushes to React state at ~4Hz to avoid re-renders crushing the page
 * when high-volume collections (app.bsky.feed.post) are streaming.
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
  const buffer = useRef<Row[]>([]);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const dispose = createJetstreamConnection(
      { wantedCollections: collections },
      (evt: JetstreamCommit) => {
        const did = evt.did;
        const c = evt.commit.collection;
        const rkey = evt.commit.rkey;
        const value = (evt.commit.record as Record<string, unknown>) || {};
        const uri = `at://${did}/${c}/${rkey}`;
        buffer.current.push({
          uri,
          did,
          collection: c,
          rkey,
          value,
          ts: evt.time_us,
        });
      },
    );

    function tick() {
      if (!paused && buffer.current.length > 0) {
        const batch = buffer.current.splice(0, buffer.current.length);
        setRows((prev) => {
          const next = [...batch.reverse(), ...prev];
          return next.slice(0, MAX_VISIBLE);
        });
      }
      // Drop anything in the buffer when paused or beyond cap to keep memory bounded.
      if (buffer.current.length > 200) {
        buffer.current.splice(0, buffer.current.length - 200);
      }
      rafRef.current = window.setTimeout(tick, 250) as unknown as number;
    }
    rafRef.current = window.setTimeout(tick, 250) as unknown as number;

    return () => {
      dispose();
      if (rafRef.current) clearTimeout(rafRef.current);
      buffer.current = [];
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
          return (
            <li
              key={`${r.uri}-${r.ts}`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(14ch, 20ch) minmax(12ch, 18ch) 1fr',
                gap: '0.75rem',
                padding: '0.5rem 1rem',
                borderBottom: '1px solid var(--border-subtle)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8125rem',
                color: 'var(--text-primary)',
                animation: 'explore-row-fade-in 280ms ease',
              }}
            >
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
              {explorerHref ? (
                <AtUriLink
                  uri={r.uri}
                  style={{
                    color: 'var(--text-secondary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textDecoration: 'none',
                  }}
                >
                  {previewFor(r.value) || r.rkey}
                </AtUriLink>
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>{r.rkey}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
