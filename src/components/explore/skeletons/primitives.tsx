import type { CSSProperties, ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Skeleton, type SkeletonShape } from '@/components/SkeletonLoader';

/**
 * Shared shapes for the explore route skeletons.
 *
 * Every piece here is a stand-in for something real on an explore page and
 * copies that thing's box: the same padding, borders, grid tracks and text
 * metrics. That is the whole point — the skeleton has to occupy the space the
 * content will occupy, or the cross-fade in <SkeletonSwap> turns into a jump.
 * When one of the real components changes shape, its stand-in here changes
 * with it.
 *
 * Bars are `<Skeleton>` from the site-wide loader, so they share its tone,
 * corners and pulse (and its reduced-motion behaviour) rather than inventing
 * a second one. A bar standing in for a control passes `shape="control"`;
 * text keeps the default pill.
 *
 * Static chrome that is known before anything loads (a field's outline and
 * search icon, a card's frame, a fixed heading) is drawn for real, with the
 * real classes, so only the data has to resolve.
 */

/** Text-line bar. The default height reads as a line of ~0.85rem body text. */
export function SkeletonBar({
  width,
  height = '0.7rem',
  shape,
  style,
}: {
  width: string;
  height?: string;
  shape?: SkeletonShape;
  style?: CSSProperties;
}) {
  return <Skeleton width={width} height={height} shape={shape} style={style} />;
}

/** The bordered `--bg-secondary` box that most explore sections live in. */
export function SkeletonPanel({
  children,
  padding = '1rem',
  style,
}: {
  children: ReactNode;
  padding?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        padding,
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-secondary)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Stand-in for <Breadcrumb>. Takes the widths of the trail it is standing in
 * for so a repo page shows two crumbs and a space record shows eight — the
 * chevrons are the real ones, since those are known before anything resolves.
 * Carries the nav's own 1.5rem bottom margin so the block below lands where it
 * will land once the trail is real.
 */
export function SkeletonBreadcrumb({
  widths,
  share = true,
  titled = false,
}: {
  widths: string[];
  share?: boolean;
  /** Mirrors <Breadcrumb titled>: no bottom margin, trailing separator. */
  titled?: boolean;
}) {
  return (
    <div
      className="fx-crumbs"
      style={{ marginBottom: titled ? 0 : '1.5rem', minHeight: '1.5rem' }}
    >
      {widths.map((width, i) => (
        <span key={i} className="fx-crumb">
          {i > 0 && (
            <span aria-hidden className="fx-crumb-sep">
              /
            </span>
          )}
          <SkeletonBar width={width} />
        </span>
      ))}
      {titled && (
        <span aria-hidden className="fx-crumb-sep">
          /
        </span>
      )}
      {share && (
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width="5.5rem" height="1.6rem" shape="control" />
        </span>
      )}
    </div>
  );
}

/**
 * Stand-in for the explorer's account card (<ProfileHeader> with the identity
 * rows): round avatar, name and handle, two lines of bio, the three stats,
 * the DID / handle / PDS list and the "Open profile in…" row.
 */
export function SkeletonAccountCard() {
  return (
    <SkeletonPanel padding="16px" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Skeleton width="44px" height="44px" shape="circle" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SkeletonBar width="7rem" height="0.95rem" style={{ marginBottom: '0.45rem' }} />
          <SkeletonBar width="6rem" />
        </div>
      </div>
      <div>
        <SkeletonBar width="100%" style={{ marginBottom: '0.4rem' }} />
        <SkeletonBar width="72%" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <SkeletonBar width="3rem" height="0.85rem" style={{ marginBottom: '0.35rem' }} />
            <SkeletonBar width="3.5rem" height="0.55rem" />
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '56px 1fr',
          gap: '12px 10px',
          paddingTop: '14px',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {['78%', '60%', '66%'].map((w, i) => (
          <span key={i} style={{ display: 'contents' }}>
            <SkeletonBar width="2rem" height="0.6rem" />
            <SkeletonBar width={w} height="0.6rem" />
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Skeleton height="36px" shape="control" style={{ flex: 1 }} />
        <Skeleton width="36px" height="36px" shape="control" />
      </div>
    </SkeletonPanel>
  );
}

/**
 * Stand-in for the repository card: the folder tabs standing on a panel that
 * holds the collections tree. The tabs and the panel wear the real card's
 * classes (tabs.css, `.fx-tabs`), so they take its exact geometry at every
 * width and in the sidebar; each bar sits in a box one label-line tall (the
 * tab's 20px line box), so a tab is as high as it will be with its words in.
 */
export function SkeletonRepoCard({
  tabWidths,
  rows = 8,
  compact = false,
}: {
  tabWidths: string[];
  rows?: number;
  compact?: boolean;
}) {
  return (
    <div className="fx-repo" style={{ pointerEvents: 'none' }}>
      <div className="fx-tabs">
        {tabWidths.map((width, i) => (
          <span key={i} className="fx-tab" data-active={i === 0 || undefined}>
            <span style={{ display: 'flex', alignItems: 'center', height: '20px' }}>
              <SkeletonBar width={width} height="0.65rem" />
            </span>
          </span>
        ))}
      </div>
      <div className="fx-tabpanel">
        <SkeletonTreePane rows={rows} sidebar={compact} />
      </div>
    </div>
  );
}

/**
 * The tree's shape while it loads: two groups, each with a leaf straight
 * under it and a sub-group of leaves, at the depths the real rows use. The
 * widths are NSID-ish, so the run reads as names rather than as bars.
 */
const TREE_SHAPE: { kind: 'group' | 'leaf'; depth: 0 | 1 | 2; width: string }[] = [
  { kind: 'group', depth: 0, width: '5.5rem' },
  { kind: 'leaf', depth: 1, width: '15rem' },
  { kind: 'group', depth: 1, width: '8rem' },
  { kind: 'leaf', depth: 2, width: '10.5rem' },
  { kind: 'leaf', depth: 2, width: '9rem' },
  { kind: 'group', depth: 1, width: '7rem' },
  { kind: 'leaf', depth: 2, width: '11.5rem' },
  { kind: 'leaf', depth: 2, width: '8.5rem' },
  { kind: 'leaf', depth: 2, width: '10rem' },
  { kind: 'group', depth: 0, width: '5rem' },
  { kind: 'leaf', depth: 1, width: '13rem' },
  { kind: 'leaf', depth: 1, width: '11rem' },
];

/**
 * Stand-in for <CollectionsTab>'s pane: the filter field and collapse button,
 * then tree rows. Built from the tree's own classes (`.fx-tree-pane`,
 * `.fx-tree-tools`, `.fx-field`, `.fx-row`), so the tools row, the row pitch,
 * the indents and the phone layout (44px rows on hairlines, edge to edge)
 * are the tree's, at every width and in the sidebar. The field's outline and
 * search icon are drawn for real; only its count waits.
 */
export function SkeletonTreePane({
  rows = 8,
  sidebar = false,
}: {
  rows?: number;
  sidebar?: boolean;
}) {
  return (
    <div
      className="fx-tree-pane"
      aria-hidden
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: sidebar ? 0 : '12px',
        pointerEvents: 'none',
      }}
    >
      <div className="fx-tree-tools">
        <span className="fx-field">
          <Search size={14} aria-hidden />
          <SkeletonBar width="7.5rem" height="0.6rem" />
        </span>
        <span className="fx-btn fx-btn-icon" />
      </div>
      <div className="fx-tree">
        {Array.from({ length: rows }).map((_, i) => {
          const row = TREE_SHAPE[i % TREE_SHAPE.length];
          return (
            <div key={i} className="fx-row" data-kind={row.kind} data-depth={row.depth}>
              <span className="fx-row-main">
                {/* The group's chevron: its 12px, so the names line up. */}
                {row.kind === 'group' && <span style={{ width: 12, flex: 'none' }} />}
                <SkeletonBar width={row.width} height="0.6rem" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Stand-in for the handle / did / pds definition list. `labels` names the cells
 * so the small-caps bars keep the widths of the words they replace.
 */
export function SkeletonFieldGrid({
  labels,
  valueWidths,
}: {
  labels: string[];
  valueWidths: string[];
}) {
  return (
    <SkeletonPanel
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
        gap: '1rem',
      }}
    >
      {labels.map((label, i) => (
        <div key={label} style={{ minWidth: 0 }}>
          <SkeletonBar
            width={`${Math.max(3, label.length * 0.62)}rem`}
            height="0.55rem"
            style={{ marginBottom: '0.45rem' }}
          />
          {/* The loaded cell is a value beside a copy chip, so the row is
              chip-height rather than text-height. */}
          <div style={{ display: 'flex', alignItems: 'center', height: '1.6rem' }}>
            <SkeletonBar width={valueWidths[i] ?? '80%'} />
          </div>
        </div>
      ))}
    </SkeletonPanel>
  );
}

/**
 * Generic bordered list of single-line rows — the shape shared by the
 * collections list, the spaces tree, the PDS repo list and the space member
 * table. Widths cycle so the stack reads as distinct items rather than a
 * pattern.
 */
const ROW_WIDTHS = ['62%', '44%', '71%', '38%', '56%', '48%', '66%', '41%'];

export function SkeletonRowList({
  rows = 6,
  trailingWidth = '3rem',
}: {
  rows?: number;
  /** Right-hand column (a count, a timestamp). Pass null for none. */
  trailingWidth?: string | null;
}) {
  return (
    <ul
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
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: trailingWidth ? `minmax(0, 1fr) ${trailingWidth}` : '1fr',
            alignItems: 'center',
            gap: '0.875rem',
            padding: '0.625rem 1rem',
            borderBottom: i === rows - 1 ? undefined : '1px solid var(--border-subtle)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', height: '1.35rem' }}>
            <SkeletonBar width={ROW_WIDTHS[i % ROW_WIDTHS.length]} />
          </span>
          {trailingWidth && (
            <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <SkeletonBar width="100%" height="0.65rem" />
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Stand-in for a collection listing: the records card's column header and
 * rows (key, preview, created) on the same `.fx-rec-list` tracks the real list
 * uses, so the columns land where the records will put them. Unframed — it
 * sits inside the records card (wrap it in a panel elsewhere).
 */
export function SkeletonRecordRows({
  rows = 8,
  editing = false,
}: {
  rows?: number;
  editing?: boolean;
}) {
  const rkeyWidths = ['13ch', '13ch', '9ch', '13ch', '11ch', '13ch', '13ch', '7ch'];
  const previewWidths = ['68%', '41%', '77%', '52%', '35%', '61%', '44%', '70%'];
  return (
    <ul className="fx-rec-list" data-editing={editing || undefined} aria-hidden>
      <li className="fx-rec-head">
        {editing && <span />}
        <span>Record key</span>
        <span>Preview</span>
        <span>Created</span>
      </li>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="fx-rec-item">
          <div className="fx-rec-row fx-rec-skel" data-editing={editing || undefined}>
            {editing && (
              <span className="fx-rec-check">
                <SkeletonBar width="16px" height="16px" />
              </span>
            )}
            <span className="fx-rec-key">
              <SkeletonBar width={rkeyWidths[i % rkeyWidths.length]} />
            </span>
            <span className="fx-rec-text" style={{ overflow: 'visible' }}>
              <SkeletonBar width={previewWidths[i % previewWidths.length]} />
            </span>
            <span className="fx-rec-time">
              <SkeletonBar width="2rem" />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stand-in for a `<pre class="explore-json">` block. Indents cycle so the bars
 * read as nested object keys rather than as paragraph text.
 */
const JSON_INDENTS = [0, 1, 1, 2, 2, 1, 1, 2, 2, 2, 1, 0];
const JSON_WIDTHS = ['22%', '58%', '44%', '71%', '39%', '63%', '30%', '55%', '67%', '42%', '48%', '16%'];

export function SkeletonJson({ lines = 10 }: { lines?: number }) {
  return (
    <div
      style={{
        marginTop: '0.5rem',
        padding: '0.875rem 1rem',
        background: 'var(--surface-subtle)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-control)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45rem',
      }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ paddingLeft: `${JSON_INDENTS[i % JSON_INDENTS.length] * 1.25}rem` }}>
          <SkeletonBar width={JSON_WIDTHS[i % JSON_WIDTHS.length]} height="0.6rem" />
        </div>
      ))}
    </div>
  );
}

/**
 * Stand-in for <RecordPreview>'s structured field table: `LABEL  value` rows in
 * a card, over the mono CID footer strip. Matches the real card's 140px label
 * column and its rounded frame.
 */
export function SkeletonFieldCard({ rows = 5 }: { rows?: number }) {
  const valueWidths = ['64%', '88%', '41%', '73%', '52%', '80%'];
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '1.5rem' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: '1rem',
              alignItems: 'flex-start',
              padding: '0.875rem 0',
              borderBottom: i === rows - 1 ? undefined : '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ minWidth: 140, display: 'flex', alignItems: 'center', height: '1.5rem' }}>
              <SkeletonBar width="5.5rem" height="0.55rem" />
            </div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', height: '1.5rem' }}>
              <SkeletonBar width={valueWidths[i % valueWidths.length]} height="0.75rem" />
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: '0.875rem 1.5rem',
          background: 'var(--surface-subtle)',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <SkeletonBar width="min(20rem, 70%)" height="0.6rem" />
      </div>
    </div>
  );
}

/**
 * The quiet "Hide rich preview" style toggle that sits under each of the
 * record page's data views. Small, but leaving it out shortens every section
 * group by a line and the whole column drifts up mid-fade.
 */
export function SkeletonViewSwitch({ width = '8rem' }: { width?: string }) {
  return <SkeletonBar width={width} height="0.6rem" />;
}

/**
 * Stand-in for <AccountStats>' "Repo at a glance" tiles. Adopts the same
 * `.account-stats-grid` class the live tiles use, so the column count and the
 * mobile breakpoint come from one place.
 */
export function SkeletonStatTiles({ tiles = 8 }: { tiles?: number }) {
  return (
    <div className="account-stats-grid">
      {Array.from({ length: tiles }).map((_, i) => (
        <div
          key={i}
          style={{
            padding: '0.75rem 0.875rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <SkeletonBar width="1rem" height="1rem" />
            <SkeletonBar width={['4.5rem', '3.5rem', '6rem', '4rem'][i % 4]} height="0.55rem" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', height: '1.75rem' }}>
            <SkeletonBar width={['2rem', '2.5rem', '1.5rem', '5rem'][i % 4]} height="0.9rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Section heading — the serif `h2`s that label a page's blocks. */
export function SkeletonHeading({ width = '14rem' }: { width?: string }) {
  return <SkeletonBar width={width} height="0.85rem" />;
}

/** Row of chips: the Edit / Live / Fetch cluster and the copy-button rows. */
export function SkeletonChipRow({
  widths,
  trailingWidth,
}: {
  widths: string[];
  /** Right-aligned counter, e.g. the collection page's record count. */
  trailingWidth?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
      {widths.map((width, i) => (
        <SkeletonBar key={i} width={width} height="1.85rem" shape="control" />
      ))}
      {trailingWidth && (
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width={trailingWidth} height="0.65rem" />
        </span>
      )}
    </div>
  );
}
