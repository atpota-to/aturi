import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/SkeletonLoader';
import { listColumns } from '../collectionListHelpers';

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
 * Bars are `<Skeleton>` from the site-wide loader, so they inherit the existing
 * shimmer sweep (and its reduced-motion behaviour) rather than inventing a
 * second one.
 */

/** Text-line bar. The default height reads as a line of ~0.85rem body text. */
export function SkeletonBar({
  width,
  height = '0.7rem',
  style,
}: {
  width: string;
  height?: string;
  style?: CSSProperties;
}) {
  return <Skeleton width={width} height={height} style={style} />;
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
}: {
  widths: string[];
  share?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '1.5rem',
        minHeight: '1.5rem',
      }}
    >
      {widths.map((width, i) => (
        <span
          key={i}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}
        >
          {i > 0 && (
            <ChevronRight
              size={14}
              aria-hidden
              style={{ color: 'var(--text-tertiary)', opacity: 0.4, flexShrink: 0 }}
            />
          )}
          <SkeletonBar width={width} />
        </span>
      ))}
      {share && (
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width="5.5rem" height="1.6rem" />
        </span>
      )}
    </div>
  );
}

/**
 * Stand-in for <ProfileHeader>: square avatar, name, handle, two lines of bio
 * and the follower/following/posts strip, over the universal-link footer.
 */
export function SkeletonProfileCard() {
  return (
    <SkeletonPanel
      padding="1.25rem"
      style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}
    >
      <Skeleton width="72px" height="72px" style={{ flexShrink: 0 }} />
      <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
        <SkeletonBar width="11rem" height="1.1rem" style={{ marginBottom: '0.6rem' }} />
        <SkeletonBar width="8rem" style={{ marginBottom: '0.9rem' }} />
        <SkeletonBar width="100%" style={{ marginBottom: '0.4rem' }} />
        <SkeletonBar width="72%" />
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            marginTop: '0.875rem',
          }}
        >
          <SkeletonBar width="5.5rem" height="0.65rem" />
          <SkeletonBar width="5.5rem" height="0.65rem" />
          <SkeletonBar width="4.5rem" height="0.65rem" />
        </div>
      </div>
      <div
        style={{
          flexBasis: '100%',
          paddingTop: '1rem',
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <SkeletonBar width="13rem" height="0.65rem" />
      </div>
    </SkeletonPanel>
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
 * Stand-in for the repo page's tab strip and whatever the open tab renders.
 * The bar under the tabs is the real border, so the strip reads as tabs rather
 * than as four loose blocks.
 */
export function SkeletonTabs({ tabWidths }: { tabWidths: string[] }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.25rem',
          borderBottom: '1px solid var(--border-medium)',
        }}
      >
        {tabWidths.map((width, i) => (
          <div key={i} style={{ padding: '0.625rem 0.875rem' }}>
            <SkeletonBar width={width} height="0.65rem" />
          </div>
        ))}
      </div>
      <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <SkeletonBar width="min(24rem, 100%)" height="2.15rem" />
        <SkeletonRowList rows={6} />
      </div>
    </div>
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
 * Stand-in for a collection listing. Adopts `listColumns()` — the same tracks
 * the real list uses — so the rkey and preview columns land where the records
 * will put them, and each row carries the TID timestamp's second line.
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
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        display: 'grid',
        gridTemplateColumns: listColumns(editing),
        columnGap: '1rem',
      }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li
          key={i}
          style={{
            gridColumn: '1 / -1',
            display: 'grid',
            gridTemplateColumns: 'subgrid',
            alignItems: 'center',
            padding: '0.625rem 1rem',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {editing && <SkeletonBar width="1rem" height="1rem" />}
          <div style={{ minWidth: 0 }}>
            <SkeletonBar width={rkeyWidths[i % rkeyWidths.length]} />
            <SkeletonBar
              width="6ch"
              height="0.55rem"
              style={{ marginTop: '0.3rem' }}
            />
          </div>
          <SkeletonBar width={previewWidths[i % previewWidths.length]} />
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
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
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
 * column and, like it, sits square, so the swap doesn't tilt the page.
 */
export function SkeletonFieldCard({ rows = 5 }: { rows?: number }) {
  const valueWidths = ['64%', '88%', '41%', '73%', '52%', '80%'];
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
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
          background: 'var(--bg-tertiary)',
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

/** A data view plus its view switch — the record page's repeating unit. */
export function SkeletonSectionGroup({
  children,
  switchWidth,
}: {
  children: ReactNode;
  switchWidth?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {children}
      <SkeletonViewSwitch width={switchWidth} />
    </div>
  );
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
        <SkeletonBar key={i} width={width} height="1.85rem" />
      ))}
      {trailingWidth && (
        <span style={{ marginLeft: 'auto' }}>
          <SkeletonBar width={trailingWidth} height="0.65rem" />
        </span>
      )}
    </div>
  );
}
