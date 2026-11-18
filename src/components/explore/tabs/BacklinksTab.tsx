'use client';

import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AtSign,
  BadgeCheck,
  ChevronRight,
  FolderOpen,
  Handshake,
  Heart,
  Layers,
  Link2,
  List,
  MessageCircle,
  MessagesSquare,
  Quote,
  Repeat2,
  Rss,
  ShieldBan,
  Signpost,
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
  bucketRecordSources,
  bucketSources,
  type BacklinkRelation,
  type RecordBacklinkRelation,
  type RelationBucket,
} from '@/utils/atproto/backlinkRelations';
import { parseAtUri } from '@/utils/atproto/urls';
import { formatCount } from '@/utils/ufos/format';
import { BacklinkRelationsSkeleton, BacklinksTabSkeleton } from '../skeletons/pages';
import { AppMark, BacklinkRowList, useMergedBacklinks } from './BacklinkRows';

/**
 * Where a relationship's records are listed when this panel only names the
 * relationships: the workbench and the Files view list them in the main
 * pane, beside the record. `current` is the one listed there now, or null
 * when the main pane is showing something else.
 */
export type BacklinksLauncher = {
  href: (relation: string) => string;
  current: string | null;
};

type Props = {
  target: string;
  /** The record page's card: a count in the head, the relationships under it. */
  showSummary?: boolean;
  /** With `showSummary`: name the relationships and link each to its list. */
  launcher?: BacklinksLauncher | null;
  /**
   * A host that keeps the open relationship in its address gives both: the
   * one that is open, and where each tile goes. Without them the panel
   * keeps its own.
   */
  relation?: string | null;
  relationHref?: (relation: string) => string;
  /** The linking records as rows, or as file tiles (the Files view's icons). */
  display?: 'rows' | 'icons';
};

/**
 * Inbound-link panel. Used both as a repo-overview tab (target = DID) and
 * inside the record view (target = at:// URI).
 *
 *   undefined → still loading
 *   null      → constellation unavailable / failed
 *   []        → no inbound links found
 *
 * Either target gets the relationships view: a tile (or, in the record
 * page's card, a chip) per kind of link over one merged list of the records
 * behind it. An account's kinds are who follows, mentions and lists it; a
 * record's are what answers, quotes and likes it (backlinkRelations.ts).
 */
export default function BacklinksTab({
  target,
  showSummary,
  launcher,
  relation,
  relationHref,
  display,
}: Props) {
  const sources = useBacklinkSources(target);

  if (!showSummary) {
    if (sources === undefined) return <BacklinkRelationsSkeleton />;
    if (sources === null) return <BacklinksUnavailable />;
    if (sources.length === 0) {
      return <p className="explore-placeholder">No backlinks found.</p>;
    }
    // Keyed on the target so a new repo starts on its own first tile.
    return (
      <BacklinkRelations
        key={target}
        target={target}
        sources={sources}
        picker="tiles"
        relation={relation}
        relationHref={relationHref}
        display={display}
        credit
      />
    );
  }

  return (
    <BacklinksSummaryPanel sources={sources}>
      {sources &&
        sources.length > 0 &&
        (launcher ? (
          <RelationLauncher target={target} sources={sources} launcher={launcher} />
        ) : (
          <BacklinkRelations key={target} target={target} sources={sources} picker="chips" />
        ))}
    </BacklinksSummaryPanel>
  );
}

/**
 * One request per target, however many panels ask at once: the workbench
 * shows a record's relationships in its inspector and their records in the
 * main pane, off the same counts. The answer is only kept long enough for
 * that, since the counts move; a failure is not kept at all.
 */
const sourcesInFlight = new Map<string, Promise<BacklinkSource[] | null>>();
const SOURCES_SHARED_FOR = 30_000;

function loadSources(target: string): Promise<BacklinkSource[] | null> {
  let pending = sourcesInFlight.get(target);
  if (!pending) {
    pending = getBacklinkSources(target).then((raw) => {
      if (raw === null) {
        sourcesInFlight.delete(target);
        return null;
      }
      window.setTimeout(() => sourcesInFlight.delete(target), SOURCES_SHARED_FOR);
      // A source with no links behind it is not a source: listed, it read
      // as "0 backlinks · 0 accounts" and inflated "across N sources".
      return (flattenSources(raw) || []).filter((s) => s.count > 0);
    });
    sourcesInFlight.set(target, pending);
  }
  return pending;
}

function useBacklinkSources(target: string): BacklinkSource[] | null | undefined {
  const [loaded, setLoaded] = useState<{ target: string; sources: BacklinkSource[] | null } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    loadSources(target).then((sources) => {
      if (!cancelled) setLoaded({ target, sources });
    });
    return () => {
      cancelled = true;
    };
  }, [target]);
  // An answer for the last target is not this one's.
  return loaded && loaded.target === target ? loaded.sources : undefined;
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
type RelationMeta = { label: string; icon: LucideIcon; about: string };

const ACCOUNT_RELATIONS: Record<BacklinkRelation, RelationMeta> = {
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

const RECORD_RELATIONS: Record<RecordBacklinkRelation, RelationMeta> = {
  reply: { label: 'Replies', icon: MessageCircle, about: 'Replies and comments that answer this record directly.' },
  thread: {
    label: 'In thread',
    icon: MessagesSquare,
    about: 'Every reply in the thread this record started, at any depth.',
  },
  quote: { label: 'Quotes', icon: Quote, about: 'Posts that quote or embed this record.' },
  repost: { label: 'Reposts', icon: Repeat2, about: 'Accounts that reposted this record.' },
  like: { label: 'Likes', icon: Heart, about: 'Likes, stars, votes and recommendations.' },
  mention: { label: 'Mentions', icon: AtSign, about: 'Records that link to this one in their text.' },
  item: {
    label: 'Items',
    icon: FolderOpen,
    about: 'Records filed under this one, like a list’s members or a publication’s documents.',
  },
  subscribe: { label: 'Subscribers', icon: Rss, about: 'Subscriptions to this record.' },
  via: { label: 'Came via', icon: Signpost, about: 'Follows and sign-ups made through this record.' },
  other: { label: 'Other links', icon: Link2, about: 'Links from fields the groups above don’t cover.' },
};

/**
 * What a relationship is called, for a host that names it outside the panel
 * (the Files view's path bar). Null for a key the target's kind doesn't have.
 */
export function backlinkRelationLabel(kind: 'account' | 'record', relation: string | null): string | null {
  if (!relation) return null;
  const meta: Record<string, RelationMeta> = kind === 'record' ? RECORD_RELATIONS : ACCOUNT_RELATIONS;
  return Object.hasOwn(meta, relation) ? meta[relation].label : null;
}

/**
 * A target's sources as relationships, with what its own account is called
 * in the rows: an account's set for a DID, a record's for an AT URI.
 */
function relationshipsFor(target: string, sources: BacklinkSource[]) {
  const record = target.startsWith('at://') ? parseAtUri(target) : null;
  if (record?.collection) {
    return {
      buckets: bucketRecordSources(sources, record.collection) as RelationBucket<string>[],
      meta: RECORD_RELATIONS as Record<string, RelationMeta>,
      selfDid: record.repo,
      selfLabel: 'author',
    };
  }
  return {
    buckets: bucketSources(sources) as RelationBucket<string>[],
    meta: ACCOUNT_RELATIONS as Record<string, RelationMeta>,
    selfDid: target,
    selfLabel: 'this account',
  };
}

/** Narrowing within a relationship: one app, or one raw source. */
type Narrow = { relation: string; app: string | null; source: string | null };

function BacklinkRelations({
  target,
  sources,
  picker,
  relation,
  relationHref,
  display,
  credit,
}: {
  target: string;
  sources: BacklinkSource[];
  /** Tiles where the panel has the page's width, chips in the record card. */
  picker: 'tiles' | 'chips';
  relation?: string | null;
  relationHref?: (relation: string) => string;
  display?: 'rows' | 'icons';
  /** Credit Constellation under the list; the record card does it in its head. */
  credit?: boolean;
}) {
  const { buckets, meta, selfDid, selfLabel } = useMemo(
    () => relationshipsFor(target, sources),
    [target, sources],
  );
  const [own, setOwn] = useState(buckets[0].relation);
  const bucket = buckets.find((b) => b.relation === (relationHref ? relation : own)) ?? buckets[0];
  // A narrowing belongs to the relationship it was made in: moving to
  // another starts whole, whoever moved it (a tile here, the host's address).
  const [narrowing, setNarrowing] = useState<Narrow>({ relation: bucket.relation, app: null, source: null });
  const whole: Narrow = { relation: bucket.relation, app: null, source: null };
  const narrow = narrowing.relation === bucket.relation ? narrowing : whole;
  const headingId = useId();

  const active = useMemo(
    () =>
      bucket.sources.filter((s) =>
        narrow.source
          ? s.source === narrow.source
          : narrow.app
            ? appForCollection(s.collection).key === narrow.app
            : true,
      ),
    [bucket, narrow.source, narrow.app],
  );
  const activeKeys = useMemo(() => active.map((s) => s.source), [active]);
  const merged = useMergedBacklinks(target, activeKeys);
  const total = active.reduce((sum, s) => sum + s.count, 0);
  const about = meta[bucket.relation];
  const narrowedTo = narrow.source ? active[0] : null;
  const showApps = bucket.apps.length > 1;

  return (
    <div className="fx-bl" data-picker={picker}>
      {picker === 'tiles' ? (
        <div className="fx-bl-tiles" role="group" aria-label="Kinds of backlink">
          {buckets.map((b) => (
            <RelationTile
              key={b.relation}
              bucket={b}
              meta={meta[b.relation]}
              pressed={b.relation === bucket.relation}
              href={relationHref?.(b.relation)}
              onPress={() => setOwn(b.relation)}
            />
          ))}
        </div>
      ) : (
        <div className="fx-bl-apps" role="group" aria-label="Kinds of backlink">
          {buckets.map((b) => {
            const { label, icon: Icon } = meta[b.relation];
            return (
              <button
                key={b.relation}
                type="button"
                className="fx-chip"
                aria-pressed={b.relation === bucket.relation}
                onClick={() => setOwn(b.relation)}
              >
                <Icon size={13} aria-hidden />
                {label} <span className="fx-bl-chip-count">{formatCount(b.count)}</span>
              </button>
            );
          })}
        </div>
      )}

      <section className="fx-bl-detail" aria-labelledby={headingId}>
        <div className="fx-bl-detail-head">
          <h3 id={headingId}>{about.label}</h3>
          <p>{about.about}</p>
        </div>

        {showApps && (
          <div className="fx-bl-apps" role="group" aria-label="Filter by app">
            <button
              type="button"
              className="fx-chip"
              aria-pressed={!narrow.app && !narrow.source}
              onClick={() => setNarrowing(whole)}
            >
              All <span className="fx-bl-chip-count">{formatCount(bucket.count)}</span>
            </button>
            {bucket.apps.map(({ app, count }) => (
              <button
                key={app.key}
                type="button"
                className="fx-chip"
                aria-pressed={narrow.app === app.key}
                onClick={() => setNarrowing({ ...whole, app: app.key })}
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
            <button type="button" className="fx-btn fx-btn-sm" onClick={() => setNarrowing(whole)}>
              Show all {about.label.toLowerCase()}
            </button>
          </div>
        )}

        <BacklinkRowList
          merged={merged}
          target={target}
          total={total}
          selfDid={selfDid}
          selfLabel={selfLabel}
          showApp={showApps && !narrow.app && !narrow.source}
          display={display}
        />

        <RelationSources
          bucket={bucket}
          label={about.label}
          narrowed={narrow.source}
          onNarrow={(source) => setNarrowing(source === narrow.source ? whole : { ...whole, source })}
        />
      </section>

      {credit && (
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
      )}
    </div>
  );
}

/**
 * One relationship's tile. A button where the panel keeps the open one
 * itself; a link where the host keeps it in the address (`href`), so it can
 * be opened in a new tab and Back returns to the last one.
 */
function RelationTile({
  bucket,
  meta,
  pressed,
  href,
  onPress,
}: {
  bucket: RelationBucket<string>;
  meta: RelationMeta;
  pressed: boolean;
  href?: string;
  onPress: () => void;
}) {
  const { label, icon: Icon } = meta;
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
  const body = (
    <>
      <span className="fx-bl-tile-label">
        <Icon size={16} aria-hidden />
        {label}
      </span>
      <span className="fx-bl-tile-value">{bucket.count.toLocaleString()}</span>
      <span className="fx-bl-tile-sub">
        {sub}
        {apps > 1 ? ` · ${apps} apps` : ''}
      </span>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        prefetch={false}
        rel="nofollow"
        className="fx-bl-tile"
        aria-current={pressed ? 'true' : undefined}
        title={hint}
      >
        {body}
      </Link>
    );
  }
  return (
    <button type="button" className="fx-bl-tile" aria-pressed={pressed} onClick={onPress} title={hint}>
      {body}
    </button>
  );
}

/**
 * The relationships alone, each a link to its list: what the record card
 * shows in a pane, where the main pane beside it has the room for the
 * records and the card only has to say what there is.
 */
function RelationLauncher({
  target,
  sources,
  launcher,
}: {
  target: string;
  sources: BacklinkSource[];
  launcher: BacklinksLauncher;
}) {
  const { buckets, meta } = useMemo(() => relationshipsFor(target, sources), [target, sources]);
  // The host lists the first relationship when its address names none.
  const listed =
    launcher.current === null
      ? null
      : (buckets.find((b) => b.relation === launcher.current) ?? buckets[0]).relation;
  return (
    <ul className="fx-bl-nav">
      {buckets.map((b) => {
        const { label, icon: Icon, about } = meta[b.relation];
        return (
          <li key={b.relation}>
            <Link
              href={launcher.href(b.relation)}
              prefetch={false}
              rel="nofollow"
              className="fx-bl-nav-row"
              aria-current={listed === b.relation ? 'true' : undefined}
              title={about}
            >
              <Icon size={15} aria-hidden />
              <span className="fx-bl-nav-label">{label}</span>
              <span className="fx-bl-nav-count">{b.count.toLocaleString()}</span>
              <ChevronRight size={14} aria-hidden className="fx-bl-nav-go" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The collection + path pairs behind a relationship, folded away by default.
 * Each one narrows the list to itself, which is how a reader gets back to
 * a single Constellation source.
 */
function RelationSources({
  bucket,
  label,
  narrowed,
  onNarrow,
}: {
  bucket: RelationBucket<string>;
  label: string;
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
        {n} {n === 1 ? 'source' : 'sources'} behind {label.toLowerCase()}
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
