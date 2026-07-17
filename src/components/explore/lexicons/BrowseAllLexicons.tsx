'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/SkeletonLoader';
import { Segmented } from './primitives';
import { fetchCollections } from '@/utils/ufos/client';
import { type CollectionOrder, type NsidCount } from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { lexiconPathFor, namespaceKey } from '@/utils/ufos/nsid';

type View = 'top' | 'all';

const TOP_FETCH = 200; // pull a deep pool so "one per group" has enough to dedupe
const TOP_DISPLAY = 50; // …but only show this many when not deduping
const PAGE_LIMIT = 100;

/**
 * Full-catalog browser for the lexicons explorer.
 *
 *   - Top:  a ranked list (by creates or repos/DID-estimate).
 *   - All:  the entire catalog, cursor-paginated with "Load more".
 *
 * The "One per group" filter collapses the list to a single row per
 * 2-segment namespace (the highest-ranked one), so a project with many
 * collections — e.g. hundreds of app.bsky.* — doesn't swamp the view.
 *
 * `order` and `cursor` are mutually exclusive in the API, so Top never
 * paginates and All never sorts.
 */
export default function BrowseAllLexicons() {
  const [view, setView] = useState<View>('top');
  const [order, setOrder] = useState<CollectionOrder>('records-created');
  const [dedupe, setDedupe] = useState(false);
  const [rows, setRows] = useState<NsidCount[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial / re-filter load. Keep previous rows visible on toggle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res =
        view === 'top'
          ? await fetchCollections({ order, limit: TOP_FETCH })
          : await fetchCollections({ limit: PAGE_LIMIT });
      if (cancelled) return;
      // Surface a real API failure instead of rendering it as "No lexicons
      // found." (an empty result the user would read as authoritative).
      if (res.failed) {
        setError('the UFOs API is unavailable');
        setRows((prev) => prev ?? []);
        return;
      }
      setError(null);
      setRows(res.collections);
      setCursor(view === 'all' ? res.cursor : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [view, order]);

  const displayed = useMemo(() => {
    if (!rows) return null;
    if (dedupe) return dedupeByNamespace(rows);
    return view === 'top' ? rows.slice(0, TOP_DISPLAY) : rows;
  }, [rows, dedupe, view]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchCollections({ cursor, limit: PAGE_LIMIT });
    setRows((prev) => [...(prev ?? []), ...res.collections]);
    setCursor(res.cursor);
    setLoadingMore(false);
  }

  return (
    <section
      style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem 0.75rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.875rem 1rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span
          className="explore-small-caps"
          style={{ display: 'inline-flex', alignItems: 'center' }}
        >
          Browse all lexicons
        </span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <Segmented
            ariaLabel="Browse view"
            options={[
              { value: 'top', label: 'Top' },
              { value: 'all', label: 'All' },
            ]}
            value={view}
            onChange={(v) => setView(v as View)}
          />
          {view === 'top' && (
            <Segmented
              ariaLabel="Rank by"
              options={[
                { value: 'records-created', label: 'Creates' },
                { value: 'dids-estimate', label: 'Repos' },
              ]}
              value={order}
              onChange={(v) => setOrder(v as CollectionOrder)}
            />
          )}
          <button
            type="button"
            onClick={() => setDedupe((v) => !v)}
            aria-pressed={dedupe}
            title="Show only the top lexicon from each namespace"
            style={{
              padding: '0.3rem 0.7rem',
              background: dedupe ? 'var(--accent-moss)' : 'var(--bg-tertiary)',
              color: dedupe ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              border: '1px solid var(--border-medium)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            One per group
          </button>
        </div>
      </div>

      {/* Column header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 5rem 5rem',
          gap: '0.875rem',
          padding: '0.4rem 1rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
        className="explore-small-caps"
      >
        <span>Lexicon</span>
        <span style={{ textAlign: 'right' }}>Creates</span>
        <span style={{ textAlign: 'right' }}>Repos</span>
      </div>

      {error && (displayed === null || displayed.length === 0) ? (
        <div className="explore-error" style={{ padding: '1rem' }}>
          Couldn&rsquo;t reach the UFOs API: {error}
        </div>
      ) : displayed === null ? (
        <BrowseSkeleton />
      ) : displayed.length === 0 ? (
        <p className="explore-placeholder" style={{ margin: 0 }}>
          No lexicons found.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {displayed.map((c, i) => (
            <li
              key={`${c.nsid}-${i}`}
              style={{
                borderBottom:
                  i === displayed.length - 1 ? undefined : '1px solid var(--border-subtle)',
              }}
            >
              <Link
                href={lexiconPathFor(c.nsid)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) 5rem 5rem',
                  gap: '0.875rem',
                  alignItems: 'center',
                  padding: '0.55rem 1rem',
                  textDecoration: 'none',
                  color: 'var(--text-primary)',
                  transition: 'background 0.2s ease',
                }}
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
                    fontSize: '0.8125rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.nsid}
                </span>
                <Count value={c.creates} />
                <Count value={c.dids_estimate} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {view === 'all' && cursor && displayed && displayed.length > 0 && (
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border-subtle)' }}>
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              width: '100%',
              padding: '0.5rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              cursor: loadingMore ? 'default' : 'pointer',
            }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </section>
  );
}

/** Keep the first (highest-ranked) collection per 2-segment namespace. */
function dedupeByNamespace(rows: NsidCount[]): NsidCount[] {
  const seen = new Set<string>();
  const out: NsidCount[] = [];
  for (const c of rows) {
    const key = namespaceKey(c.nsid);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function Count({ value }: { value: number }) {
  return (
    <span
      title={value.toLocaleString()}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.75rem',
        color: 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}
    >
      {formatCount(value)}
    </span>
  );
}

function BrowseSkeleton() {
  const widths = ['64%', '48%', '72%', '56%', '40%', '68%', '52%', '60%'];
  return (
    <ul aria-hidden style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {widths.map((w, i) => (
        <li
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 5rem 5rem',
            gap: '0.875rem',
            alignItems: 'center',
            padding: '0.55rem 1rem',
            borderBottom: i === widths.length - 1 ? undefined : '1px solid var(--border-subtle)',
          }}
        >
          <Skeleton width={w} height="0.75rem" />
          <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Skeleton width="2.5rem" height="0.75rem" />
          </span>
          <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Skeleton width="2.5rem" height="0.75rem" />
          </span>
        </li>
      ))}
    </ul>
  );
}
