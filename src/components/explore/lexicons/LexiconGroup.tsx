'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, Folder, Layers, Search } from 'lucide-react';
import AppearIn from '../AppearIn';
import { Skeleton } from '@/components/SkeletonLoader';
import { Credit } from './primitives';
import { fetchPrefix, searchLexicons } from '@/utils/ufos/client';
import {
  type JustCount,
  type NsidCount,
  type PrefixChild,
} from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { groupPathFor, lexiconPathFor } from '@/utils/ufos/nsid';
import { CHROME_RESULTS_ID, useChromeBarField } from '../ChromeBarContext';

const PREFIX_LIMIT = 200;

/**
 * Namespace / prefix browse page (`/explore/lexicons/group/[prefix]`).
 *
 *   - A dotted prefix (e.g. `net.anisota`, `net.anisota.beta`) lists
 *     everything under it via `/prefix`: sub-namespaces (drill deeper) and
 *     concrete collections (open their detail page).
 *   - A single-segment term (e.g. `net`, `anisota`) can't use `/prefix`
 *     (the API requires 2+ segments), so it falls back to `/search`,
 *     acting as a results page for that term.
 */
export default function LexiconGroup({ prefix }: { prefix: string }) {
  return prefix.includes('.') ? <PrefixView prefix={prefix} /> : <SearchView term={prefix} />;
}

// ─── page frame (back link, breadcrumb header, credit) ───────────────────────

function Frame({
  prefix,
  eyebrow,
  icon,
  headerExtra,
  children,
}: {
  prefix: string;
  eyebrow: string;
  icon: React.ReactNode;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const segments = prefix.split('.');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <AppearIn rise>
        <Link
          href="/explore/lexicons"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            fontSize: '0.8125rem',
            color: 'var(--text-accent)',
            textDecoration: 'none',
            fontFamily: 'var(--font-serif)',
          }}
        >
          <ArrowLeft size={13} aria-hidden /> All lexicons
        </Link>
      </AppearIn>

      <AppearIn delay={0.04}>
        <div
          style={{
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          <div
            className="explore-small-caps"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <span style={{ color: 'var(--text-accent)', display: 'inline-flex' }}>{icon}</span>
            {eyebrow}
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: '1.35rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
              wordBreak: 'break-word',
              lineHeight: 1.2,
            }}
          >
            {segments.map((seg, i) => {
              const cumulative = segments.slice(0, i + 1).join('.');
              const last = i === segments.length - 1;
              return (
                <span key={cumulative}>
                  {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}>.</span>}
                  {last ? (
                    seg
                  ) : (
                    <Link
                      href={groupPathFor(cumulative)}
                      style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                    >
                      {seg}
                    </Link>
                  )}
                </span>
              );
            })}
          </h1>
          {headerExtra}
        </div>
      </AppearIn>

      {children}

      <AppearIn delay={0.12}>
        <div style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-secondary)' }}>
          <Credit />
        </div>
      </AppearIn>
    </div>
  );
}

/** Card wrapping a listing of rows. */
function ListCard({ children }: { children: React.ReactNode }) {
  return (
    // Both views that render this one publish a filter to the bottom chrome
    // bar, so this card is what typing down there scrolls to.
    <AppearIn delay={0.08} id={CHROME_RESULTS_ID}>
      <div
        style={{
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-secondary)',
          padding: '0.25rem 1rem',
        }}
      >
        {children}
      </div>
    </AppearIn>
  );
}

// ─── /prefix view ────────────────────────────────────────────────────────────

function PrefixView({ prefix }: { prefix: string }) {
  const [children, setChildren] = useState<PrefixChild[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<JustCount | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setChildren(null);
    setCursor(null);
    setTotal(null);
    setFilter('');
    (async () => {
      const res = await fetchPrefix({ prefix, limit: PREFIX_LIMIT });
      if (cancelled) return;
      setChildren(sortChildren(res.children));
      setCursor(res.cursor);
      setTotal(res.total);
    })();
    return () => {
      cancelled = true;
    };
  }, [prefix]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchPrefix({ prefix, cursor, limit: PREFIX_LIMIT });
    setChildren((prev) => sortChildren([...(prev ?? []), ...res.children]));
    setCursor(res.cursor);
    setLoadingMore(false);
  }

  const query = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!children) return null;
    if (!query) return children;
    return children.filter((c) => childName(c).toLowerCase().includes(query));
  }, [children, query]);

  useChromeBarField({
    placeholder: 'Filter this namespace…',
    label: `Filter entries under ${prefix}`,
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    status: !children
      ? null
      : query
        ? `${visible?.length ?? 0}/${children.length}`
        : `${children.length}`,
  });

  return (
    <Frame
      prefix={prefix}
      eyebrow="Namespace"
      icon={<Layers size={13} aria-hidden />}
      headerExtra={<SummaryLine total={total} count={children?.length ?? null} />}
    >
      <ListCard>
        {children === null || visible === null ? (
          <ListSkeleton />
        ) : children.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem 0' }}>
            <p className="explore-muted" style={{ margin: 0 }}>
              Nothing is published under <code>{prefix}</code>.
            </p>
            <Link
              href={lexiconPathFor(prefix)}
              style={{ color: 'var(--text-accent)', textDecoration: 'none', fontSize: '0.85rem' }}
            >
              View {prefix} as a lexicon →
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <p className="explore-muted" style={{ margin: 0, padding: '0.75rem 0' }}>
            No entries under <code>{prefix}</code> match “{filter.trim()}”.
          </p>
        ) : (
          <>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {visible.map((c, i) => (
                <ChildRow key={`${childName(c)}-${i}`} child={c} isLast={i === visible.length - 1} />
              ))}
            </ul>
            {cursor && (
              <button type="button" onClick={loadMore} disabled={loadingMore} style={loadMoreStyle(loadingMore)}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </ListCard>
    </Frame>
  );
}

function SummaryLine({ total, count }: { total: JustCount | null; count: number | null }) {
  if (!total) return <Skeleton width="14rem" height="0.85rem" />;
  return (
    <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{formatCount(total.creates)}</span> creates
      {' · '}
      <span style={{ color: 'var(--text-secondary)' }}>{formatCount(total.dids_estimate)}</span> repos
      {count != null && (
        <>
          {' · '}
          <span style={{ color: 'var(--text-secondary)' }}>{count}</span> entries
        </>
      )}
    </p>
  );
}

function ChildRow({ child, isLast }: { child: PrefixChild; isLast: boolean }) {
  const isNamespace = child.type === 'prefix';
  const name = childName(child);
  const href = isNamespace ? groupPathFor(name) : lexiconPathFor(name);
  const Icon = isNamespace ? Folder : FileText;
  return (
    <li style={{ borderBottom: isLast ? undefined : '1px solid var(--border-subtle)' }}>
      <Link href={href} style={rowStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <Icon
            size={13}
            aria-hidden
            style={{ color: isNamespace ? 'var(--text-accent)' : 'var(--text-tertiary)', flexShrink: 0 }}
          />
          <span style={nameStyle}>
            {name}
            {isNamespace && <span style={{ color: 'var(--text-tertiary)' }}>.*</span>}
          </span>
        </span>
        <Count value={child.creates} />
      </Link>
    </li>
  );
}

// ─── /search fallback view (single-segment term) ─────────────────────────────

function SearchView({ term }: { term: string }) {
  const [results, setResults] = useState<NsidCount[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setFilter('');
    searchLexicons(term).then((r) => {
      if (cancelled) return;
      setResults([...r].sort((a, b) => b.creates - a.creates));
    });
    return () => {
      cancelled = true;
    };
  }, [term]);

  const query = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!results) return null;
    if (!query) return results;
    return results.filter((c) => c.nsid.toLowerCase().includes(query));
  }, [results, query]);

  useChromeBarField({
    placeholder: 'Filter these results…',
    label: `Filter lexicons matching ${term}`,
    value: filter,
    onChange: setFilter,
    resultsId: CHROME_RESULTS_ID,
    status: !results
      ? null
      : query
        ? `${visible?.length ?? 0}/${results.length}`
        : `${results.length}`,
  });

  return (
    <Frame prefix={term} eyebrow="Search results" icon={<Search size={13} aria-hidden />}>
      <ListCard>
        {results === null || visible === null ? (
          <ListSkeleton />
        ) : results.length === 0 ? (
          <p className="explore-muted" style={{ margin: 0, padding: '0.75rem 0' }}>
            No lexicons matched “{term}”.
          </p>
        ) : visible.length === 0 ? (
          <p className="explore-muted" style={{ margin: 0, padding: '0.75rem 0' }}>
            No results match “{filter.trim()}”.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visible.map((c, i) => (
              <li
                key={c.nsid}
                style={{ borderBottom: i === visible.length - 1 ? undefined : '1px solid var(--border-subtle)' }}
              >
                <Link href={lexiconPathFor(c.nsid)} style={rowStyle} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                  <span style={nameStyle}>{c.nsid}</span>
                  <Count value={c.creates} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ListCard>
    </Frame>
  );
}

// ─── shared bits ─────────────────────────────────────────────────────────────

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 5rem',
  gap: '0.875rem',
  alignItems: 'center',
  padding: '0.55rem 0',
  textDecoration: 'none',
  color: 'var(--text-primary)',
  transition: 'background 0.2s ease',
};

const nameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8125rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

function hoverOn(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = 'var(--bg-tertiary)';
}
function hoverOff(e: React.MouseEvent<HTMLElement>) {
  e.currentTarget.style.background = 'transparent';
}

function Count({ value }: { value: number }) {
  return (
    <span
      title={`${value.toLocaleString()} creates`}
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

function childName(c: PrefixChild): string {
  return c.type === 'prefix' ? c.prefix : c.nsid;
}

/** Sort children by creates desc; namespaces and collections interleaved. */
function sortChildren(children: PrefixChild[]): PrefixChild[] {
  return [...children].sort((a, b) => b.creates - a.creates);
}

function loadMoreStyle(loading: boolean): React.CSSProperties {
  return {
    margin: '0.5rem 0',
    width: '100%',
    padding: '0.5rem',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-medium)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8125rem',
    cursor: loading ? 'default' : 'pointer',
  };
}

function ListSkeleton() {
  const widths = ['58%', '72%', '46%', '64%', '52%'];
  return (
    <ul aria-hidden style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {widths.map((w, i) => (
        <li
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '0.55rem 0',
            borderBottom: i === widths.length - 1 ? undefined : '1px solid var(--border-subtle)',
          }}
        >
          <Skeleton width={w} height="0.75rem" />
          <Skeleton width="2.5rem" height="0.75rem" />
        </li>
      ))}
    </ul>
  );
}
