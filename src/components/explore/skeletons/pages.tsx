import { Fragment } from 'react';
import PostPreviewSkeleton from '@/components/PostPreviewSkeleton';
import { SkeletonLine } from '@/components/SkeletonLoader';
import {
  SkeletonBar,
  SkeletonBreadcrumb,
  SkeletonChipRow,
  SkeletonFieldCard,
  SkeletonFieldGrid,
  SkeletonHeading,
  SkeletonJson,
  SkeletonPanel,
  SkeletonAccountCard,
  SkeletonRecordRows,
  SkeletonRepoCard,
  SkeletonRowList,
  SkeletonStatTiles,
  SkeletonTreePane,
  SkeletonViewSwitch,
} from './primitives';

/**
 * Page-shaped skeletons, one per explore route.
 *
 * Each is the page it stands in for with the text taken out: same column, same
 * gaps, same section order as the component that replaces it. They are handed
 * to <SkeletonSwap>, which cross-fades them into the real thing, so a skeleton
 * that guesses the layout wrong shows up as a jump at exactly the moment the
 * page is meant to settle.
 *
 * Crumb widths are passed per route because the trail's depth is known from the
 * URL before anything resolves — a record page has four crumbs whether or not
 * the handle has come back yet.
 */

// Explore pages stack their blocks in one column. Repo-ish pages breathe at
// 1.5rem; the record page (denser, more sections) runs at 1rem.
const column = (gap: string) =>
  ({ display: 'flex', flexDirection: 'column', gap }) as const;

const PDS_CRUMB = '7rem';
const REPO_CRUMB = '9rem';
const NSID_CRUMB = '11rem';
const RKEY_CRUMB = '7rem';
const SPACE_CRUMB = '3.25rem';

/** `/explore/{repo}` — account sidebar; breadcrumb, glance, repository card. */
export function RepoSkeleton() {
  return (
    <div className="fx-explorer" data-page="repo">
      <div className="fx-head">
        <SkeletonBreadcrumb widths={[PDS_CRUMB, REPO_CRUMB]} share={false} titled />
      </div>
      <div className="fx-side">
        <SkeletonAccountCard />
        <SkeletonViewSwitch width="7rem" />
      </div>
      <div className="fx-main">
        <div style={column('10px')}>
          <SkeletonHeading width="9rem" />
          <SkeletonStatTiles />
        </div>
        <SkeletonRepoCard tabWidths={['5rem', '3.5rem', '1.75rem', '4.25rem']} />
      </div>
    </div>
  );
}

/** `/explore/{repo}/{collection}` — title bar, records card, sidebar. */
export function CollectionSkeleton() {
  return (
    <div className="fx-explorer" data-page="collection">
      <div className="fx-head">
        <div className="fx-titlebar">
          <div className="fx-titlebar-text">
            <SkeletonBreadcrumb widths={[PDS_CRUMB, REPO_CRUMB]} share={false} titled />
            <SkeletonBar width="12rem" height="1.4rem" />
          </div>
          <SkeletonChipRow widths={['4.5rem', '5.75rem', '4.25rem', '2.25rem']} />
        </div>
      </div>
      <div className="fx-side">
        <SkeletonAccountCard />
        <SkeletonRepoCard tabWidths={['4.5rem', '3rem', '1.5rem', '4rem']} rows={10} compact />
      </div>
      <div className="fx-main">
        <SkeletonPanel padding="0" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-medium)' }}>
            <SkeletonBar width="min(320px, 100%)" height="32px" shape="control" />
          </div>
          <SkeletonRecordRows />
        </SkeletonPanel>
      </div>
    </div>
  );
}

/**
 * What a record page's skeleton can know from its URL alone: whether a rich
 * card (post, profile, margin) will lead the page, whether that card is a
 * post, and whether the title carries a kind pill. RecordExplorer works
 * these out from the collection and rkey before anything is fetched.
 */
export type RecordSkeletonShape = {
  richCard: boolean;
  isPost: boolean;
  isProfile: boolean;
  pill: boolean;
};

const PLAIN_RECORD: RecordSkeletonShape = {
  richCard: false,
  isPost: false,
  isProfile: false,
  pill: false,
};

/**
 * The body of a record page, on the loaded page's own frame (record.css,
 * `.fn-rec-body`): the rich card when one is coming, the "Open in" card,
 * the Record card and the Copy card, then the lexicon usage and backlinks
 * cards. A record with no rich card puts its Record card in the wide column,
 * as the page does. The `order` values are the slots RecordExplorer gives the
 * same pieces, which interleave them in one column under 920px. Used on its
 * own once the title bar is real and only the record is still in flight.
 */
export function RecordBodySkeleton({ shape = PLAIN_RECORD }: { shape?: RecordSkeletonShape }) {
  const record = <RecordDataCardSkeleton rows={shape.richCard ? 4 : 6} />;
  return (
    <div className="fn-rec-body">
      <div className="fn-rec-main">
        {shape.richCard && (
          <div className="fn-rec-slot" style={{ order: 0 }}>
            <div className="fn-rec-group">
              <div className="fn-rec-preview">
                {shape.isPost ? (
                  <PostPreviewSkeleton />
                ) : shape.isProfile ? (
                  <SkeletonAccountCard />
                ) : (
                  <SkeletonPanel padding="20px" style={column('0.75rem')}>
                    <SkeletonBar width="9rem" height="0.85rem" />
                    <SkeletonBar width="100%" />
                    <SkeletonBar width="72%" />
                  </SkeletonPanel>
                )}
              </div>
              <SkeletonViewSwitch width="7.5rem" />
            </div>
          </div>
        )}
        {!shape.richCard && (
          <div className="fn-rec-slot" style={{ order: 2 }}>
            {record}
          </div>
        )}
        <div className="fn-rec-slot" style={{ order: 3 }}>
          <LexiconUsageSkeleton />
        </div>
        <div className="fn-rec-slot" style={{ order: 3 }}>
          <BacklinksSummarySkeleton />
        </div>
      </div>
      <div className="fn-rec-aside">
        <div className="fn-rec-slot" style={{ order: 1 }}>
          <OpenInSkeleton isPost={shape.isPost} />
        </div>
        {shape.richCard && (
          <div className="fn-rec-slot" style={{ order: 2 }}>
            {record}
          </div>
        )}
        <div className="fn-rec-slot" style={{ order: 3 }}>
          <CopyCardSkeleton />
        </div>
      </div>
    </div>
  );
}

/** `/explore/{repo}/{collection}/{rkey}`. */
export function RecordSkeleton({ shape = PLAIN_RECORD }: { shape?: RecordSkeletonShape }) {
  return (
    <div className="fn-rec">
      {/* The title bar: the trail down to the collection, the rkey as the
          title with its kind pill, and the copy button. */}
      <div className="fn-rec-titlebar">
        <div className="fn-rec-titletext">
          <SkeletonBreadcrumb widths={[PDS_CRUMB, REPO_CRUMB, NSID_CRUMB]} share={false} titled />
          <div className="fn-rec-titlerow">
            <SkeletonLine className="fn-rec-h1" width="9.5rem" height="1.1rem" />
            {shape.pill && <SkeletonBar width="6.5rem" height="24px" />}
          </div>
        </div>
        <div className="fn-rec-actions">
          <SkeletonBar width="8.75rem" height="36px" shape="control" />
        </div>
      </div>
      <RecordBodySkeleton shape={shape} />
    </div>
  );
}

/** The aside's "Open this … in" card: the two recommended rows (the first
 *  filled), three more apps with their domains, and "More apps". */
function OpenInSkeleton({ isPost }: { isPost: boolean }) {
  return (
    <section className="fn-rec-card fn-open">
      <h2 className="fn-rec-h2">Open this {isPost ? 'post' : 'record'} in</h2>
      <SkeletonBar width="100%" height="44px" shape="control" />
      <div className="fn-open-row" data-rank="secondary">
        <SkeletonBar width="16px" height="16px" shape="circle" />
        <SkeletonBar width="5rem" height="0.7rem" />
      </div>
      <div className="fn-open-more">
        {['4.5rem', '5.5rem', '4rem'].map((width) => (
          <div key={width} className="fn-open-row">
            <SkeletonBar width="16px" height="16px" shape="circle" />
            <SkeletonBar width={width} height="0.7rem" />
            <span style={{ marginLeft: 'auto' }}>
              <SkeletonBar width="5.5rem" height="0.55rem" />
            </span>
          </div>
        ))}
      </div>
      <div className="fn-open-all">
        <SkeletonBar width="4.5rem" height="0.6rem" />
      </div>
    </section>
  );
}

/** The Record card: its head with the Fields / JSON chips, the URI and CID
 *  strip, then field rows. */
function RecordDataCardSkeleton({ rows }: { rows: number }) {
  const valueWidths = ['78%', '52%', '64%', '40%', '70%', '46%'];
  return (
    <section className="fn-rec-card fn-rec-data">
      <div className="fn-rec-data-head">
        <h2 className="fn-rec-h2">Record</h2>
        <span className="fn-rec-seg">
          <SkeletonBar width="4.25rem" height="28px" shape="control" />
          <SkeletonBar width="3.5rem" height="28px" shape="control" />
        </span>
      </div>
      <dl className="fn-rec-ids">
        {['URI', 'CID'].map((label) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd style={{ height: '26px' }}>
              <SkeletonBar width="88%" height="0.6rem" />
            </dd>
          </Fragment>
        ))}
      </dl>
      <div style={{ padding: '4px 16px' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '5.5rem minmax(0, 1fr)',
              alignItems: 'center',
              gap: '12px',
              minHeight: '40px',
              borderTop: i === 0 ? undefined : '1px solid var(--border-subtle)',
            }}
          >
            <SkeletonBar width="3.5rem" height="0.55rem" />
            <SkeletonBar width={valueWidths[i % valueWidths.length]} height="0.65rem" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** The Copy card: five copy chips over the two links out. */
function CopyCardSkeleton() {
  return (
    <section className="fn-rec-card fn-rec-copy">
      <h2 className="fn-rec-h2">Copy</h2>
      <div className="fn-rec-copy-chips">
        {['4.75rem', '3.75rem', '3.75rem', '7.25rem', '4rem'].map((width, i) => (
          <SkeletonBar key={i} width={width} height="28px" shape="control" />
        ))}
      </div>
      <div className="fn-rec-copy-links">
        {['9.25rem', '7rem'].map((width) => (
          <SkeletonBar key={width} width={width} height="28px" shape="control" />
        ))}
      </div>
    </section>
  );
}

/** <LexiconUsageCard>: the eyebrow, the two counts, the sparkline and link. */
function LexiconUsageSkeleton() {
  return (
    <SkeletonPanel
      padding="14px 16px"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1.25rem' }}
    >
      <span style={{ flexBasis: '100%', display: 'flex', alignItems: 'center', height: '18px' }}>
        <SkeletonBar width="min(19rem, 90%)" height="0.55rem" />
      </span>
      <SkeletonBar width="6rem" height="0.75rem" />
      <SkeletonBar width="5rem" height="0.75rem" />
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', height: '24px' }}>
        <SkeletonBar width="8rem" height="0.65rem" />
      </span>
    </SkeletonPanel>
  );
}

/** The record page's backlinks card: the count header strip over the
 *  per-source rows (BacklinksTab with `showSummary`). */
function BacklinksSummarySkeleton() {
  return (
    <div
      style={{
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
      }}
    >
      <div
        style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-medium)',
          background: 'var(--surface-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          minHeight: '1.875rem',
          boxSizing: 'content-box',
        }}
      >
        <SkeletonBar width="7.5rem" height="1.25rem" />
        <SkeletonBar width="min(14rem, 40%)" height="0.6rem" />
      </div>
      <div style={{ padding: '0.75rem' }}>
        <BacklinksTabSkeleton />
      </div>
    </div>
  );
}

/** The repo listing on `/explore/pds/{host}`. The header above it needs no
 *  skeleton: it renders the host and endpoint from the URL immediately. Rows
 *  copy PdsExplorer's RepoRow: the handle over its "updated" line, then the
 *  DID, at the row's 50px. */
export function PdsReposSkeleton() {
  const handles = ['11rem', '9rem', '12.5rem', '8.5rem', '10rem', '13rem', '9.5rem', '11.5rem'];
  return (
    <ul
      aria-hidden
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
      }}
    >
      {handles.map((handle, i) => (
        <li
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(14ch, 24ch) 1fr',
            gap: '0.75rem',
            alignItems: 'center',
            minHeight: '50px',
            boxSizing: 'border-box',
            padding: '7px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: '12.5px',
            borderBottom: i === handles.length - 1 ? undefined : '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 }}>
            <SkeletonLine width={handle} />
            <SkeletonLine width="6.5rem" height="0.5rem" style={{ fontSize: '12px' }} />
          </span>
          <SkeletonLine width="min(22rem, 100%)" />
        </li>
      ))}
    </ul>
  );
}

/** The collections tree under the repo page's Collections tab, in the
 *  main column or the sidebar copy. */
export function CollectionsTabSkeleton({ sidebar = false }: { sidebar?: boolean }) {
  return <SkeletonTreePane rows={sidebar ? 10 : 12} sidebar={sidebar} />;
}

/**
 * The Identity tab: also-known-as, then a service and a verification method
 * as hairline entries with their `type` / `endpoint` / `key` rows. On the
 * tab's own classes (explorer.css, `.fx-idsec`, `.explore-identity-*`); the
 * section titles and row labels are fixed, so they are drawn for real.
 */
export function IdentityTabSkeleton() {
  const entry = (id: string, rows: [string, string][]) => (
    <ul className="explore-identity-list">
      <li className="explore-identity-card">
        <SkeletonLine width={id} />
        {rows.map(([label, width]) => (
          <div key={label} className="explore-id-row">
            <span className="explore-small-caps">{label}</span>
            <SkeletonLine width={width} />
          </div>
        ))}
      </li>
    </ul>
  );
  return (
    <div style={column('1.5rem')} aria-hidden>
      <section className="fx-idsec">
        <h3 className="explore-small-caps" style={{ marginBottom: '0.5rem' }}>
          Also known as
        </h3>
        <ul className="explore-identity-list">
          <li>
            <SkeletonLine width="8rem" />
          </li>
        </ul>
      </section>
      <section className="fx-idsec">
        <h3 className="explore-small-caps" style={{ marginBottom: '0.5rem' }}>
          Services
        </h3>
        {entry('7.5rem', [
          ['type', '15rem'],
          ['endpoint', 'min(20rem, 100%)'],
        ])}
      </section>
      <section className="fx-idsec">
        <h3 className="explore-small-caps" style={{ marginBottom: '0.5rem' }}>
          Verification methods
        </h3>
        {entry('min(19rem, 100%)', [
          ['type', '5rem'],
          ['key', 'min(24rem, 100%)'],
        ])}
      </section>
      <SkeletonBar width="8.5rem" height="0.6rem" />
    </div>
  );
}

/**
 * The Log tab: PLC operations as hairline entries on the loaded list's own
 * classes (`.fx-log`, `.fx-log-entry`): the type pill beside its date, the
 * changed fields in mono, and the "Raw operation" toggle.
 */
const LOG_CHANGES = [['42%'], [], ['36%', '48%'], ['44%', '30%', '26%']];

export function AuditTabSkeleton() {
  return (
    <ol className="fx-log" aria-hidden>
      {LOG_CHANGES.map((changes, i) => (
        <li key={i} className="fx-log-entry">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <SkeletonBar width="6.5rem" height="22px" />
            <SkeletonBar width="9.5rem" height="0.6rem" />
          </div>
          {changes.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                margin: '0.5rem 0 0',
                padding: 0,
                fontFamily: 'var(--font-mono)',
                fontSize: '12.5px',
              }}
            >
              {changes.map((width, j) => (
                <li key={j} className="fx-log-change">
                  <SkeletonLine width={width} />
                </li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: '0.5rem', padding: '4px 0', fontSize: '12.5px' }}>
            <SkeletonLine width="7rem" />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * The backlinks section on a record page: its per-source rows, each the
 * linking collection over its path with the counts stacked at the right, on
 * the loaded rows' own padding and hairlines (`.fx-backlink-source`).
 */
export function BacklinksTabSkeleton() {
  const widths = [
    ['10rem', '7rem'],
    ['11rem', '9rem'],
    ['9.5rem', '8rem'],
    ['10.5rem', '9.5rem'],
  ];
  return (
    <ul aria-hidden style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {widths.map(([collection, path], i) => (
        <li key={i} className="fx-backlink-source">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1ch minmax(0, 1fr) auto',
              gap: '0.5rem',
              alignItems: 'start',
              padding: '0.625rem 1rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
            }}
          >
            <span />
            <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: 0 }}>
              <SkeletonLine width={collection} />
              <SkeletonLine width={path} />
            </span>
            <span
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem' }}
            >
              <SkeletonLine width="6rem" />
              <SkeletonLine width="5rem" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Linking-record rows (BacklinkRow): avatar, a name-length bar, a time. On
 * the real `.fx-bl-row` tracks, so the rows land where the people will.
 */
export function BacklinkRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="fx-bl-list" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="fx-bl-row">
          <span className="fx-bl-row-link" style={{ alignItems: 'center' }}>
            <span className="fx-bl-avatar" data-empty />
            <span className="fx-bl-row-body">
              <SkeletonBar width={['9rem', '12rem', '7rem', '10rem', '8rem'][i % 5]} />
            </span>
            <SkeletonBar width="2.5rem" height="0.6rem" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Backlinks tab on a repo page: a row of relationship tiles, the open
 * relationship's heading, its first rows. Four tiles, the most accounts
 * show; more wrap to a second row once the counts arrive.
 */
export function BacklinkRelationsSkeleton() {
  return (
    <div className="fx-bl" aria-hidden>
      <div className="fx-bl-tiles">
        {['4.5rem', '4rem', '3rem', '3.5rem'].map((width, i) => (
          <div key={i} className="fx-bl-tile" style={{ cursor: 'default' }}>
            <SkeletonBar width={width} height="0.55rem" />
            <div style={{ display: 'flex', alignItems: 'center', height: '1.45rem' }}>
              <SkeletonBar width={['5rem', '3.5rem', '3rem', '2.5rem'][i]} height="0.9rem" />
            </div>
            <SkeletonBar width="6rem" height="0.5rem" />
          </div>
        ))}
      </div>
      <div className="fx-bl-detail">
        <SkeletonHeading width="10rem" />
        <BacklinkRowsSkeleton />
      </div>
    </div>
  );
}

// ─── Spaces ────────────────────────────────────────────────────────────────
//
// The space tree's six levels share a trail that grows one crumb at a time, so
// each skeleton below adds exactly the crumb its level adds.

const SPACE_TRAIL = [PDS_CRUMB, REPO_CRUMB, SPACE_CRUMB];
const TYPE_TRAIL = [...SPACE_TRAIL, NSID_CRUMB];
const SKEY_TRAIL = [...TYPE_TRAIL, '5.5rem'];
const MEMBER_TRAIL = [...SKEY_TRAIL, '8rem'];
const SPACE_COLLECTION_TRAIL = [...MEMBER_TRAIL, NSID_CRUMB];
const SPACE_RECORD_TRAIL = [...SPACE_COLLECTION_TRAIL, RKEY_CRUMB];

/** L1 — `/explore/{repo}/space`. */
export function SpaceListSkeleton() {
  return (
    <div style={column('1.5rem')}>
      <SkeletonBreadcrumb widths={SPACE_TRAIL} />
      <div style={column('0.75rem')}>
        <SkeletonHeading width="17rem" />
        <SkeletonRowList rows={5} trailingWidth="5rem" />
      </div>
    </div>
  );
}

/** L2 — `/explore/{repo}/space/{spaceType}`. */
export function SpaceTypeSkeleton() {
  return (
    <div style={column('1.5rem')}>
      <SkeletonBreadcrumb widths={TYPE_TRAIL} />
      <SpaceTypeCardSkeleton />
      <div style={column('0.75rem')}>
        <SkeletonHeading width="17rem" />
        <SkeletonRowList rows={4} trailingWidth="5rem" />
      </div>
    </div>
  );
}

/** L3 — `/explore/{repo}/space/{spaceType}/{skey}`: the space itself. */
export function SpaceSkeleton() {
  return (
    <div style={column('1.5rem')}>
      <SkeletonBreadcrumb widths={SKEY_TRAIL} />
      {/* The space address strip, with its copy button pinned right. */}
      <SkeletonPanel
        padding="0.75rem 1rem"
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
      >
        <SkeletonBar width="min(28rem, 70%)" />
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width="1.1rem" height="1.1rem" />
        </span>
      </SkeletonPanel>
      <div style={column('0.75rem')}>
        <SkeletonHeading width="8rem" />
        <SkeletonRowList rows={4} trailingWidth="5rem" />
      </div>
      <div style={column('0.75rem')}>
        <SkeletonHeading width="10rem" />
        <SkeletonPanel>
          <SkeletonBar width="7rem" height="0.85rem" style={{ marginBottom: '0.75rem' }} />
          <SkeletonBar width="min(30rem, 90%)" />
        </SkeletonPanel>
        <SpaceTypeCardSkeleton />
      </div>
    </div>
  );
}

/** L4 — one member's permissioned repository. */
export function SpaceRepoSkeleton() {
  return (
    <div style={column('1.5rem')}>
      <SkeletonBreadcrumb widths={MEMBER_TRAIL} />
      <SkeletonFieldGrid
        labels={['member', 'repo host', 'rev']}
        valueWidths={['8rem', '11rem', '9rem']}
      />
      <div style={column('0.75rem')}>
        <SkeletonHeading width="7rem" />
        <SkeletonRowList rows={4} trailingWidth="4rem" />
      </div>
    </div>
  );
}

/** L5 — one collection inside a member's permissioned repository. */
export function SpaceCollectionSkeleton() {
  return (
    <div style={column('1.5rem')}>
      <SkeletonBreadcrumb widths={SPACE_COLLECTION_TRAIL} />
      <SkeletonChipRow widths={['4.5rem']} trailingWidth="5rem" />
      <SkeletonPanel padding="0" style={{ overflow: 'hidden' }}>
        <SkeletonRecordRows rows={6} />
      </SkeletonPanel>
    </div>
  );
}

/** L6 — one permissioned record. */
export function SpaceRecordSkeleton() {
  return (
    <div style={column('1rem')}>
      <SkeletonBreadcrumb widths={SPACE_RECORD_TRAIL} />
      <SpaceRecordBodySkeleton />
    </div>
  );
}

/** The body of a permissioned record page: the field table, then the raw
 *  toggle. Shown on its own while the record loads behind a real breadcrumb. */
export function SpaceRecordBodySkeleton() {
  return (
    <div style={column('0.5rem')}>
      <SkeletonFieldCard rows={4} />
      <SkeletonViewSwitch width="7.5rem" />
    </div>
  );
}

/**
 * A space type declaration's body: a line of description, then the key type /
 * collections / declared-at grid. Rendered inside <SpaceTypeCard> itself while
 * the declaration resolves — the card's heading row is known from the NSID in
 * the URL, so only what the lexicon says has to wait.
 */
export function SpaceTypeFieldsSkeleton() {
  return (
    <div style={column('0.75rem')}>
      <SkeletonBar width="min(34rem, 100%)" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
          gap: '1rem',
        }}
      >
        {['key type', 'collections', 'declared at'].map((label, i) => (
          <div key={label} style={{ minWidth: 0 }}>
            <SkeletonBar
              width={`${Math.max(3, label.length * 0.62)}rem`}
              height="0.55rem"
              style={{ marginBottom: '0.45rem' }}
            />
            <SkeletonBar width={['5rem', '12rem', '14rem'][i]} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** <SpaceTypeCard>'s whole box, for the pages that render it below a skeleton
 *  breadcrumb: the declaration's name beside its NSID, then the body above. */
function SpaceTypeCardSkeleton() {
  return (
    <SkeletonPanel style={column('0.75rem')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <SkeletonBar width="7rem" height="0.85rem" />
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width="10rem" />
        </span>
      </div>
      <SpaceTypeFieldsSkeleton />
    </SkeletonPanel>
  );
}

/** <RecordEditor> while it reads the record it is about to edit: the mode
 *  toggle, the JSON pane, and the save/cancel row. */
export function RecordEditorSkeleton() {
  return (
    <SkeletonPanel style={column('1rem')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <SkeletonBar width="9rem" height="1.85rem" shape="control" />
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width="6rem" height="0.65rem" />
        </span>
      </div>
      <SkeletonJson lines={9} />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <SkeletonBar width="5rem" height="1.85rem" shape="control" />
        <SkeletonBar width="4.5rem" height="1.85rem" shape="control" />
      </div>
    </SkeletonPanel>
  );
}
