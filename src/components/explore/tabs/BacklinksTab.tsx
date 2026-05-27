'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  backlinksFromPage,
  flattenSources,
  getBacklinks,
  getBacklinkSources,
  type BacklinkRecord,
  type BacklinkSource,
} from '@/utils/atproto/constellation';
import { shortDid } from '@/utils/atproto/urls';
import AtUriLink from '../AtUriLink';

/**
 * Inbound-link panel. Used both as a repo-overview tab (target = DID) and
 * inside the record view (target = at:// URI).
 *
 *   undefined → still loading
 *   null      → constellation unavailable / failed
 *   []        → no inbound links found
 *
 * When `showSummary` is set, the panel wraps itself in a card with a
 * prominent count header — used on the record page where backlinks are
 * featured content rather than one tab among many.
 */
export default function BacklinksTab({
  target,
  showSummary,
}: {
  target: string;
  showSummary?: boolean;
}) {
  const [sources, setSources] = useState<BacklinkSource[] | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSources(undefined);
    setOpen(null);
    getBacklinkSources(target).then((raw) => {
      if (cancelled) return;
      if (raw === null) {
        setSources(null);
        return;
      }
      setSources(flattenSources(raw) || []);
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!showSummary) {
    if (sources === undefined) return <p className="explore-placeholder">Loading backlinks…</p>;
    if (sources === null) return <BacklinksUnavailable />;
    if (sources.length === 0) {
      return <p className="explore-placeholder">No inbound links found.</p>;
    }
    return <BacklinkSourceList sources={sources} open={open} setOpen={setOpen} target={target} />;
  }

  return (
    <BacklinksSummaryPanel sources={sources}>
      {sources && sources.length > 0 && (
        <BacklinkSourceList sources={sources} open={open} setOpen={setOpen} target={target} />
      )}
    </BacklinksSummaryPanel>
  );
}

function BacklinksUnavailable() {
  return (
    <p className="explore-muted" style={{ fontStyle: 'italic' }}>
      Backlinks unavailable (
      <a
        href="https://constellation.microcosm.blue"
        target="_blank"
        rel="noreferrer noopener"
        style={{ color: 'var(--text-accent)' }}
      >
        constellation
      </a>
      ).
    </p>
  );
}

/**
 * Card-shaped wrapper for the record-page backlinks section: header with
 * a prominent total count, followed by either the source list (children)
 * or a state-appropriate empty / loading / unavailable message in the
 * body slot.
 */
function BacklinksSummaryPanel({
  sources,
  children,
}: {
  sources: BacklinkSource[] | null | undefined;
  children: import('react').ReactNode;
}) {
  const ready = Array.isArray(sources);
  const totalCount = ready ? sources.reduce((sum, s) => sum + s.count, 0) : 0;
  const hasAccounts = ready ? sources.some((s) => s.distinctDids != null) : false;
  const totalAccounts = hasAccounts
    ? sources!.reduce((sum, s) => sum + (s.distinctDids ?? 0), 0)
    : 0;
  const sourceCount = ready ? sources.length : 0;

  return (
    <section
      style={{
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      <header
        style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-medium)',
          background:
            'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)',
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <span className="explore-small-caps">Inbound links</span>
        <span
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.875rem',
            fontWeight: 600,
            color: 'var(--text-accent)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {ready ? totalCount.toLocaleString() : '—'}
        </span>
        <span style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>
          {!ready
            ? sources === null
              ? 'unavailable'
              : 'loading…'
            : sourceCount === 0
              ? 'no records reference this yet'
              : `across ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}${
                  hasAccounts
                    ? ` · from ${totalAccounts.toLocaleString()} ${totalAccounts === 1 ? 'account' : 'accounts'}`
                    : ''
                }`}
        </span>
      </header>
      <div style={{ padding: '0.75rem' }}>
        {sources === undefined && (
          <p className="explore-placeholder" style={{ margin: 0 }}>
            Loading backlinks…
          </p>
        )}
        {sources === null && (
          <div style={{ padding: '0.5rem 0.25rem' }}>
            <BacklinksUnavailable />
          </div>
        )}
        {Array.isArray(sources) && sources.length === 0 && (
          <p className="explore-muted" style={{ margin: 0, padding: '0.5rem 0.25rem' }}>
            Nothing references this record yet.
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

function BacklinkSourceList({
  sources,
  open,
  setOpen,
  target,
}: {
  sources: BacklinkSource[];
  open: string | null;
  setOpen: (s: string | null) => void;
  target: string;
}) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.25rem',
      }}
    >
      {sources.map((s) => {
        const isOpen = open === s.source;
        return (
          <li
            key={s.source}
            style={{
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-secondary)',
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : s.source)}
              aria-expanded={isOpen}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr 1fr auto auto',
                gap: '0.5rem',
                alignItems: 'baseline',
                width: '100%',
                textAlign: 'left',
                padding: '0.625rem 1rem',
                background: 'transparent',
                border: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ color: 'var(--text-tertiary)', width: '1ch' }}>
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
              <code
                style={{
                  background: 'transparent',
                  padding: 0,
                  color: 'var(--text-accent)',
                  wordBreak: 'break-all',
                }}
              >
                {s.collection}
              </code>
              <code
                style={{
                  background: 'transparent',
                  padding: 0,
                  color: 'var(--text-tertiary)',
                  wordBreak: 'break-all',
                }}
              >
                {s.path}
              </code>
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                {s.count.toLocaleString()}
              </span>
              {s.distinctDids != null && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  {s.distinctDids.toLocaleString()} accounts
                </span>
              )}
            </button>
            {isOpen && <BacklinkRecords target={target} source={s.source} />}
          </li>
        );
      })}
    </ul>
  );
}

function BacklinkRecords({ target, source }: { target: string; source: string }) {
  const [records, setRecords] = useState<BacklinkRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const loadPage = useCallback(
    async (after: string | null) => {
      setLoading(true);
      const res = await getBacklinks(target, source, {
        limit: 25,
        cursor: after || undefined,
      });
      if (res === null) {
        setErrored(true);
        setLoading(false);
        setDone(true);
        return;
      }
      const batch = backlinksFromPage(res);
      setRecords((prev) => (after ? [...prev, ...batch] : batch));
      setCursor(res.cursor || null);
      if (!res.cursor || batch.length === 0) setDone(true);
      setLoading(false);
    },
    [target, source],
  );

  useEffect(() => {
    setRecords([]);
    setCursor(null);
    setDone(false);
    setErrored(false);
    loadPage(null);
  }, [loadPage]);

  if (errored) {
    return (
      <p
        className="explore-muted"
        style={{
          margin: 0,
          padding: '0.625rem 1rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        Couldn&rsquo;t load linking records.
      </p>
    );
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: '0.5rem 1rem 0.875rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      {records.length === 0 && loading && (
        <p className="explore-placeholder" style={{ margin: 0 }}>
          Loading…
        </p>
      )}
      {records.length === 0 && !loading && (
        <p className="explore-muted" style={{ margin: 0 }}>
          No linking records to show.
        </p>
      )}
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {records.map((r) => {
          const atUri = `at://${r.did}/${r.collection}/${r.rkey}`;
          return (
            <li
              key={atUri}
              style={{ borderBottom: '1px solid var(--border-subtle)' }}
            >
              <AtUriLink
                uri={atUri}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(14ch, 22ch) 1fr',
                  gap: '0.75rem',
                  padding: '0.4rem 0',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8125rem',
                  color: 'var(--text-primary)',
                  textDecoration: 'none',
                }}
              >
                <code
                  style={{
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--text-primary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {shortDid(r.did)}
                </code>
                <code
                  style={{
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--text-tertiary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {r.rkey}
                </code>
              </AtUriLink>
            </li>
          );
        })}
      </ul>
      {!done && records.length > 0 && (
        <button
          type="button"
          onClick={() => loadPage(cursor)}
          disabled={loading}
          style={{
            alignSelf: 'flex-start',
            background: 'transparent',
            border: 0,
            color: 'var(--text-accent)',
            fontSize: '0.8125rem',
            fontFamily: 'var(--font-serif)',
            cursor: loading ? 'wait' : 'pointer',
            padding: '0.25rem 0',
          }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
