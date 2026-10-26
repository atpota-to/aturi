'use client';

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AtSign,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  Handshake,
  Layers,
  Link2,
  List,
  ShieldBan,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import {
  flattenSources,
  getBacklinkSources,
  type BacklinkSource,
} from '@/utils/atproto/constellation';
import {
  appForCollection,
  backlinkPathLabels,
  bucketSources,
  type BacklinkRelation,
  type RelationBucket,
} from '@/utils/atproto/backlinkRelations';
import { parseAtUri } from '@/utils/atproto/urls';
import { formatCount } from '@/utils/ufos/format';
import { BacklinkRelationsSkeleton, BacklinksTabSkeleton } from '../skeletons/pages';
import { AppMark, BacklinkRowList, useMergedBacklinks } from './BacklinkRows';

/**
 * Inbound-link panel. Used both as a repo-overview tab (target = DID) and
 * inside the record view (target = at:// URI).
 *
 *   undefined → still loading
 *   null      → constellation unavailable / failed
 *   []        → no inbound links found
 *
 * A DID target gets the relationships view: a tile per kind of link
 * (followers, mentions, lists…) over one merged list of the records behind
 * it. The classification rules are written for accounts, so a record
 * target keeps the per-source list, inside the summary card the record page
 * features it in (`showSummary`).
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
      // A source with no links behind it is not a source: listed, it read
      // as "0 backlinks · 0 accounts" and inflated "across N sources".
      setSources((flattenSources(raw) || []).filter((s) => s.count > 0));
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!showSummary) {
    if (sources === undefined) return <BacklinkRelationsSkeleton />;
    if (sources === null) return <BacklinksUnavailable />;
    if (sources.length === 0) {
      return <p className="explore-placeholder">No backlinks found.</p>;
    }
    // Keyed on the target so a new repo starts on its own first tile.
    return <BacklinkRelations key={target} target={target} sources={sources} />;
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

/** What each tile is called, its glyph, and the line under the list's heading. */
const RELATIONS: Record<BacklinkRelation, { label: string; icon: LucideIcon; about: string }> = {
  follow: { label: 'Followers', icon: UserPlus, about: 'Accounts that follow this one, in any app.' },
  mention: { label: 'Mentions', icon: AtSign, about: 'Posts, documents and lists that mention this account.' },
  list: { label: 'Lists', icon: List, about: 'Lists, starter packs and groups this account is in.' },
  block: { label: 'Blocks', icon: ShieldBan, about: 'Accounts that block this one.' },
  verify: {
    label: 'Verifications',
    icon: BadgeCheck,
    about: 'Verification records that name this account, by others or by itself.',
  },
  endorse: {
    label: 'Vouches',
    icon: Handshake,
    about: 'Endorsements, vouches, top-friends slots and contact cards.',
  },
  embed: {
    label: 'Embedded copies',
    icon: Layers,
    about: 'Records that keep a copy of this account’s details, like a starter pack showing a feed it made.',
  },
  other: { label: 'Other links', icon: Link2, about: 'Links from fields the groups above don’t cover.' },
};

/** Narrowing within a relationship: one app, or one raw source. */
type Narrow = { app: string | null; source: string | null };
const WHOLE: Narrow = { app: null, source: null };

function BacklinkRelations({ target, sources }: { target: string; sources: BacklinkSource[] }) {
  const buckets = useMemo(() => bucketSources(sources), [sources]);
  const [relation, setRelation] = useState<BacklinkRelation>(buckets[0].relation);
  const [narrow, setNarrow] = useState<Narrow>(WHOLE);
  const bucket = buckets.find((b) => b.relation === relation) ?? buckets[0];

  const active = useMemo(
    () =>
      bucket.sources.filter((s) =>
        narrow.source
          ? s.source === narrow.source
          : narrow.app
            ? appForCollection(s.collection).key === narrow.app
            : true,
      ),
    [bucket, narrow],
  );
  const activeKeys = useMemo(() => active.map((s) => s.source), [active]);
  const merged = useMergedBacklinks(target, activeKeys);
  const total = active.reduce((sum, s) => sum + s.count, 0);
  const about = RELATIONS[bucket.relation];
  const narrowedTo = narrow.source ? active[0] : null;
  const showApps = bucket.apps.length > 1;

  function choose(next: BacklinkRelation) {
    setRelation(next);
    setNarrow(WHOLE);
  }

  return (
    <div className="fx-bl">
      <div className="fx-bl-tiles" role="group" aria-label="Kinds of backlink">
        {buckets.map((b) => (
          <RelationTile
            key={b.relation}
            bucket={b}
            pressed={b.relation === bucket.relation}
            onPress={() => choose(b.relation)}
          />
        ))}
      </div>

      <section className="fx-bl-detail" aria-labelledby="fx-bl-heading">
        <div className="fx-bl-detail-head">
          <h3 id="fx-bl-heading">{about.label}</h3>
          <p>{about.about}</p>
        </div>

        {showApps && (
          <div className="fx-bl-apps" role="group" aria-label="Filter by app">
            <button
              type="button"
              className="fx-chip"
              aria-pressed={!narrow.app && !narrow.source}
              onClick={() => setNarrow(WHOLE)}
            >
              All <span className="fx-bl-chip-count">{formatCount(bucket.count)}</span>
            </button>
            {bucket.apps.map(({ app, count }) => (
              <button
                key={app.key}
                type="button"
                className="fx-chip"
                aria-pressed={narrow.app === app.key}
                onClick={() => setNarrow({ app: app.key, source: null })}
              >
                <AppMark app={app} />
                {app.name} <span className="fx-bl-chip-count">{formatCount(count)}</span>
              </button>
            ))}
          </div>
        )}

        {narrowedTo && (
          <div className="fx-bl-narrow">
            <span>Only</span>
            <code>{withDotBreaks(`${narrowedTo.collection}${narrowedTo.path === '.' ? '' : narrowedTo.path}`)}</code>
            <button type="button" className="fx-btn fx-btn-sm" onClick={() => setNarrow(WHOLE)}>
              Show all {about.label.toLowerCase()}
            </button>
          </div>
        )}

        <BacklinkRowList
          merged={merged}
          total={total}
          selfDid={target}
          selfLabel="this account"
          showApp={showApps && !narrow.app && !narrow.source}
        />

        <RelationSources
          bucket={bucket}
          narrowed={narrow.source}
          onNarrow={(source) => setNarrow(source === narrow.source ? WHOLE : { app: null, source })}
        />
      </section>

      <p className="fx-bl-credit">
        Links indexed by{' '}
        <a href="https://constellation.microcosm.blue" target="_blank" rel="noreferrer noopener">
          Constellation
        </a>
        , via{' '}
        <a href="https://www.microcosm.blue" target="_blank" rel="noreferrer noopener">
          Microcosm
        </a>
        .
      </p>
    </div>
  );
}

function RelationTile({
  bucket,
  pressed,
  onPress,
}: {
  bucket: RelationBucket;
  pressed: boolean;
  onPress: () => void;
}) {
  const { label, icon: Icon } = RELATIONS[bucket.relation];
  const sourceCount = bucket.sources.length;
  const apps = bucket.apps.length;
  // Accounts are distinct per source, summed: say so wherever two sources
  // could share an account.
  const hint =
    `${bucket.count.toLocaleString()} ${bucket.count === 1 ? 'link' : 'links'} through ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}` +
    (sourceCount > 1 ? '. Accounts are counted per source, so one account linking through two counts twice.' : '.');
  const sub = bucket.accounts
    ? `${formatCount(bucket.accounts)} ${bucket.accounts === 1 ? 'account' : 'accounts'}`
    : `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`;
  return (
    <button type="button" className="fx-bl-tile" aria-pressed={pressed} onClick={onPress} title={hint}>
      <span className="fx-bl-tile-label">
        <Icon size={16} aria-hidden />
        {label}
      </span>
      <span className="fx-bl-tile-value">{bucket.count.toLocaleString()}</span>
      <span className="fx-bl-tile-sub">
        {sub}
        {apps > 1 ? ` · ${apps} apps` : ''}
      </span>
    </button>
  );
}

/**
 * The collection + path pairs behind a relationship, folded away by default.
 * Each one narrows the list to itself, which is how a reader gets back to
 * a single Constellation source.
 */
function RelationSources({
  bucket,
  narrowed,
  onNarrow,
}: {
  bucket: RelationBucket;
  narrowed: string | null;
  onNarrow: (source: string) => void;
}) {
  const labels = useMemo(() => {
    const byCollection = new Map<string, string[]>();
    for (const s of bucket.sources) {
      byCollection.set(s.collection, [...(byCollection.get(s.collection) ?? []), s.path]);
    }
    const out = new Map<string, string>();
    for (const [collection, paths] of byCollection) {
      for (const [path, label] of backlinkPathLabels(paths)) out.set(`${collection}:${path}`, label);
    }
    return out;
  }, [bucket]);
  const n = bucket.sources.length;
  return (
    <details className="fx-bl-sources">
      <summary>
        <ChevronRight size={12} aria-hidden />
        {n} {n === 1 ? 'source' : 'sources'} behind {RELATIONS[bucket.relation].label.toLowerCase()}
      </summary>
      <ul className="fx-bl-source-list">
        {bucket.sources.map((s) => (
          <li key={s.source}>
            <button
              type="button"
              className="fx-bl-source"
              aria-pressed={narrowed === s.source}
              onClick={() => onNarrow(s.source)}
              title={`${s.collection} ${s.path}`}
            >
              <AppMark app={appForCollection(s.collection)} />
              <code>
                {withDotBreaks(s.collection)} <span>{withDotBreaks(labels.get(`${s.collection}:${s.path}`) ?? s.path)}</span>
              </code>
              <span className="fx-bl-source-count">{formatCount(s.count)}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
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
  const empty = ready && sourceCount === 0;

  return (
    <section
      style={{
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
      }}
    >
      <header
        style={{
          padding: '1rem 1.25rem',
          borderBottom: empty ? undefined : '1px solid var(--border-medium)',
          background: 'var(--surface-subtle)',
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: '0.4rem',
            fontWeight: 700,
          }}
        >
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
          <span style={{ color: 'var(--text-primary)' }}>backlinks</span>
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
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
          }}
        >
          via{' '}
          <a
            href="https://www.microcosm.blue"
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: 'var(--text-accent)' }}
          >
            Microcosm
          </a>
        </span>
      </header>
      {/* With nothing to list, the header's "no records reference this
          yet" is the whole message; a body saying it again added a band. */}
      {!empty && (
        <div style={{ padding: '0.75rem' }}>
          {sources === undefined && <BacklinksTabSkeleton />}
          {sources === null && (
            <div style={{ padding: '0.5rem 0.25rem' }}>
              <BacklinksUnavailable />
            </div>
          )}
          {children}
        </div>
      )}
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
      }}
    >
      {sources.map((s) => {
        const isOpen = open === s.source;
        return (
          // Divided rows inside the panel's own card (fx-backlink-source in
          // explorer.css), with the row hover the other explorer lists use.
          <li key={s.source} className="fx-backlink-source">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : s.source)}
              aria-expanded={isOpen}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: '0.5rem',
                alignItems: 'start',
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
              {/* One line tall and centred in it, so the chevron sits level
                  with the NSID rather than on its baseline. */}
              <span
                style={{
                  color: 'var(--text-tertiary)',
                  width: '1ch',
                  height: '1lh',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
              {/* Collection NSID over its record path, stacked and
                  left-aligned (mirroring the right-hand metric stack). The
                  two used to sit in side-by-side 1fr columns, which starved
                  both into mid-word wraps on mobile — stacking gives each the
                  row's full width before it needs to break. */}
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '0.15rem',
                  minWidth: 0,
                }}
              >
                <code
                  style={{
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--text-accent)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {withDotBreaks(s.collection)}
                </code>
                <code
                  style={{
                    background: 'transparent',
                    padding: 0,
                    color: 'var(--text-tertiary)',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {withDotBreaks(s.path)}
                </code>
              </span>
              {/* Count over distinct-accounts, stacked and abbreviated
                  (2.4k) so the metrics take one narrow right-hand column
                  instead of two — leaving the NSID/path columns more room
                  before they wrap on mobile. */}
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: '0.15rem',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {formatCount(s.count)}{' '}
                  <span
                    style={{
                      fontWeight: 400,
                      fontSize: '0.75rem',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {s.count === 1 ? 'backlink' : 'backlinks'}
                  </span>
                </span>
                {s.distinctDids != null && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                    {formatCount(s.distinctDids)} {s.distinctDids === 1 ? 'account' : 'accounts'}
                  </span>
                )}
              </span>
            </button>
            {isOpen && <BacklinkRecords target={target} source={s} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * An open source on the record page: its linking records as people and
 * what they wrote. The record's own author is marked, since a self-reply or
 * a self-quote reads differently from someone else's.
 */
function BacklinkRecords({ target, source }: { target: string; source: BacklinkSource }) {
  const keys = useMemo(() => [source.source], [source.source]);
  const merged = useMergedBacklinks(target, keys, 25);
  const author = parseAtUri(target)?.repo ?? '';
  return (
    <div
      style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: '0.375rem 0.5rem 0.75rem',
      }}
    >
      <BacklinkRowList merged={merged} total={source.count} selfDid={author} selfLabel="author" />
    </div>
  );
}

/**
 * Lets an NSID or record path wrap after its dots rather than mid-segment,
 * the way the record page's fields do (RecordPreview). overflow-wrap still
 * breaks a single segment too long for the row.
 */
function withDotBreaks(text: string): ReactNode {
  const parts = text.split('.');
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          .<wbr />
        </>
      )}
    </Fragment>
  ));
}
