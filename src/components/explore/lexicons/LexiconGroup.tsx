'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileText, Folder, Layers, Search } from 'lucide-react';
import AppearIn from '../AppearIn';
import { Skeleton } from '@/components/SkeletonLoader';
import { AppSiteLink, Credit, Nsid } from './primitives';
import { fetchPrefix, searchLexicons } from '@/utils/ufos/client';
import {
  type JustCount,
  type NsidCount,
  type PrefixChild,
} from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { appDomainFor, groupPathFor, lexiconPathFor } from '@/utils/ufos/nsid';
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
    <div className="fn-lexdetail">
      <AppearIn rise>
        <Link href="/explore/lexicons" className="fn-backlink">
          <ArrowLeft size={14} aria-hidden /> All lexicons
        </Link>
      </AppearIn>

      <AppearIn delay={0.04}>
        <div className="fn-lexhead">
          <span className="fn-kicker fn-lexhead-kicker">
            {icon}
            {eyebrow}
          </span>
          <h1 className="fn-lexhead-title fn-lexhead-mono">
            {segments.map((seg, i) => {
              const cumulative = segments.slice(0, i + 1).join('.');
              const last = i === segments.length - 1;
              return (
                <span key={cumulative}>
                  {i > 0 && (
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      .<wbr />
                    </span>
                  )}
                  {last ? (
                    seg
                  ) : (
                    <Link
                      href={groupPathFor(cumulative)}
                      prefetch={false}
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
        <Credit standalone />
      </AppearIn>
    </div>
  );
}

/**
 * Card wrapping a listing of rows, headed by a column row that names the
 * figures: a bare number column read as a ranking before.
 */
function ListCard({ nameLabel, children }: { nameLabel: string; children: React.ReactNode }) {
  return (
    // Both views that render this one publish a filter to the bottom chrome
    // bar, so this card is what typing down there scrolls to.
    <AppearIn delay={0.08} id={CHROME_RESULTS_ID}>
      <div className="fn-list-card">
        <div className="fn-col-head fn-browse-grid">
          <span>{nameLabel}</span>
          <span style={{ textAlign: 'right' }}>Creates</span>
        </div>
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

  const appDomain = appDomainFor(prefix);
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
      headerExtra={
        <>
          <SummaryLine total={total} count={children?.length ?? null} />
          {appDomain && (
            <div style={{ display: 'flex', marginTop: '0.15rem' }}>
              <AppSiteLink domain={appDomain} />
            </div>
          )}
        </>
      }
    >
      <ListCard nameLabel="Entry">
        {children === null || visible === null ? (
          <ListSkeleton />
        ) : children.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem 16px' }}>
            <p className="explore-muted" style={{ margin: 0 }}>
              Nothing is published under <code>{prefix}</code>.
            </p>
            <Link
              href={lexiconPathFor(prefix)}
              prefetch={false}
              style={{ color: 'var(--text-accent)', textDecoration: 'none', fontSize: '0.85rem' }}
            >
              View {prefix} as a lexicon →
            </Link>
          </div>
        ) : visible.length === 0 ? (
          <p className="explore-muted" style={{ margin: 0, padding: '0.75rem 16px' }}>
            No entries under <code>{prefix}</code> match “{filter.trim()}”.
          </p>
        ) : (
          <>
            <ul className="fn-list-rows">
              {visible.map((c, i) => (
                <ChildRow key={`${childName(c)}-${i}`} child={c} />
              ))}
            </ul>
            {cursor && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="fn-list-card-foot"
                style={{ cursor: loadingMore ? 'default' : 'pointer' }}
              >
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
    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-tertiary)' }}>
      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatCount(total.creates)}</span> creates
      {' · '}
      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatCount(total.dids_estimate)}</span> repos
      {count != null && (
        <>
          {' · '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{count}</span> entries
        </>
      )}
    </p>
  );
}

function ChildRow({ child }: { child: PrefixChild }) {
  const isNamespace = child.type === 'prefix';
  const name = childName(child);
  const href = isNamespace ? groupPathFor(name) : lexiconPathFor(name);
  const Icon = isNamespace ? Folder : FileText;
  return (
    <li>
      <Link href={href} prefetch={false} className="fn-row fn-browse-grid">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <Icon
            size={13}
            aria-hidden
            style={{ color: isNamespace ? 'var(--text-accent)' : 'var(--text-tertiary)', flexShrink: 0 }}
          />
          <span className="fn-row-nsid" title={name}>
            <Nsid value={name} />
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
      <ListCard nameLabel="Lexicon">
        {results === null || visible === null ? (
          <ListSkeleton />
        ) : results.length === 0 ? (
          <p className="explore-muted" style={{ margin: 0, padding: '0.75rem 16px' }}>
            No lexicons matched “{term}”.
          </p>
        ) : visible.length === 0 ? (
          <p className="explore-muted" style={{ margin: 0, padding: '0.75rem 16px' }}>
            No results match “{filter.trim()}”.
          </p>
        ) : (
          <ul className="fn-list-rows">
            {visible.map((c) => (
              <li key={c.nsid}>
                <Link href={lexiconPathFor(c.nsid)} prefetch={false} className="fn-row fn-browse-grid">
                  <span className="fn-row-nsid" title={c.nsid}>
                    <Nsid value={c.nsid} />
                  </span>
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

function Count({ value }: { value: number }) {
  return (
    <span className="fn-row-count" title={`${value.toLocaleString()} creates`}>
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

function ListSkeleton() {
  const widths = ['58%', '72%', '46%', '64%', '52%'];
  return (
    <ul aria-hidden className="fn-list-rows">
      {widths.map((w, i) => (
        <li key={i} className="fn-browse-grid">
          <Skeleton width={w} height="0.75rem" />
          <Skeleton width="2.5rem" height="0.75rem" style={{ justifySelf: 'end' }} />
        </li>
      ))}
    </ul>
  );
}
