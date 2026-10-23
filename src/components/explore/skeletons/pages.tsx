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
  SkeletonSectionGroup,
  SkeletonStatTiles,
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
            <SkeletonBar width="min(320px, 100%)" height="32px" />
          </div>
          <SkeletonRecordRows />
        </SkeletonPanel>
      </div>
    </div>
  );
}

/**
 * The body of a record page: the field table and its switch, the raw-JSON
 * switch (raw JSON is collapsed by default), the copy row, and the lexicon
 * usage card. Used on its own once the breadcrumb is real and only the record
 * is still in flight.
 */
export function RecordBodySkeleton() {
  return (
    <div style={column('1rem')}>
      <SkeletonSectionGroup switchWidth="10.5rem">
        <SkeletonFieldCard />
      </SkeletonSectionGroup>
      <SkeletonViewSwitch width="7rem" />
      <SkeletonChipRow widths={['5.5rem', '4.5rem', '5rem', '7rem']} />
      <div style={column('0.75rem')}>
        <SkeletonHeading width="11rem" />
        <SkeletonRowList rows={3} />
      </div>
    </div>
  );
}

/** `/explore/{repo}/{collection}/{rkey}`. */
export function RecordSkeleton() {
  return (
    <div style={column('1rem')}>
      <SkeletonBreadcrumb widths={[PDS_CRUMB, REPO_CRUMB, NSID_CRUMB, RKEY_CRUMB]} />
      <RecordBodySkeleton />
    </div>
  );
}

/** The repo listing on `/explore/pds/{host}`. The header above it needs no
 *  skeleton: it renders the host and endpoint from the URL immediately. */
export function PdsReposSkeleton() {
  return <SkeletonRowList rows={8} trailingWidth="6rem" />;
}

/** The collections list under the repo page's Lexicons tab. */
export function CollectionsTabSkeleton() {
  return (
    <div style={column('1rem')}>
      <SkeletonBar width="min(24rem, 100%)" height="2.15rem" />
      <SkeletonRowList rows={7} />
    </div>
  );
}

/** The ID tab: also-known-as, services and verification methods. */
export function IdentityTabSkeleton() {
  return (
    <div style={column('1.5rem')}>
      {[2, 1, 2].map((rows, i) => (
        <div key={i} style={column('0.5rem')}>
          <SkeletonBar width="9rem" height="0.55rem" />
          <SkeletonRowList rows={rows} trailingWidth={null} />
        </div>
      ))}
    </div>
  );
}

/**
 * The Log tab: PLC operations as a stack of rounded cards, the same
 * `.fx-log-entry` box the loaded entries use.
 */
export function AuditTabSkeleton() {
  return (
    <div style={column('0.75rem')}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="fx-log-entry"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <SkeletonBar width="6.5rem" height="22px" style={{ borderRadius: '999px' }} />
            <span style={{ marginLeft: 'auto' }}>
              <SkeletonBar width="8rem" height="0.6rem" />
            </span>
          </div>
          <SkeletonBar
            width={['62%', '45%', '71%', '38%'][i % 4]}
            style={{ marginTop: '0.75rem' }}
          />
        </div>
      ))}
    </div>
  );
}

/** The Backlinks tab, and the backlinks section on a record page. */
export function BacklinksTabSkeleton() {
  return <SkeletonRowList rows={4} trailingWidth="3.5rem" />;
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
        <SkeletonBar width="9rem" height="1.85rem" />
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width="6rem" height="0.65rem" />
        </span>
      </div>
      <SkeletonJson lines={9} />
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <SkeletonBar width="5rem" height="1.85rem" />
        <SkeletonBar width="4.5rem" height="1.85rem" />
      </div>
    </SkeletonPanel>
  );
}
