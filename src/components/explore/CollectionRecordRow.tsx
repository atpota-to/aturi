'use client';

import Link from 'next/link';
import type { AtRecord } from '@/utils/atproto/pdsClient';
import { rkeyFromAtUri } from '@/utils/atproto/urls';
import { tidToDate, formatTidRelative } from '@/utils/atproto/tid';
import { previewFor } from '@/utils/atproto/previewExtractors';

/**
 * One record row in a collection listing. Browsing mode renders a <Link> to the
 * record page; selection mode swaps it for a checkbox <label> so clicking
 * anywhere on the row toggles selection and navigation is suppressed. The row
 * lays out its rkey (+ TID-derived timestamp) and a data preview across the
 * list's shared subgrid tracks. Purely presentational — <CollectionList> owns
 * the selection state and passes the toggle handler in.
 */
export default function CollectionRecordRow({
  rec,
  editing,
  isSelected,
  repoSeg,
  collection,
  onToggleSelect,
}: {
  rec: AtRecord;
  editing: boolean;
  isSelected: boolean;
  repoSeg: string;
  collection: string;
  onToggleSelect: (uri: string) => void;
}) {
  const rkey = rkeyFromAtUri(rec.uri) || '';
  // TID-derived timestamps are decoded client-side from the rkey
  // itself — no extra PDS call. Non-TID rkeys (custom strings,
  // singletons like "self") return null and we just hide the chip.
  const tidDate = tidToDate(rkey);
  const rowInner = (
    <>
      <div style={{ minWidth: 0 }}>
        <code
          style={{
            background: 'transparent',
            padding: 0,
            color: 'var(--text-primary)',
            display: 'block',
            // Long rkeys wrap within the column instead of being cut
            // off — the rkey is the record's identity, so losing the
            // tail to an ellipsis is worse than a two-line row.
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {rkey}
        </code>
        {tidDate && (
          <time
            dateTime={tidDate.toISOString()}
            title={tidDate.toISOString()}
            style={{
              display: 'block',
              marginTop: '0.125rem',
              fontSize: '0.7rem',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {formatTidRelative(tidDate)}
          </time>
        )}
      </div>
      <span
        style={{
          color: 'var(--text-tertiary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {previewFor(rec.value)}
      </span>
    </>
  );
  return (
    <li
      style={{
        // Span the full grid and hand the shared tracks down to the
        // row's link/label, which lays out the actual cells.
        gridColumn: '1 / -1',
        display: 'grid',
        gridTemplateColumns: 'subgrid',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {editing ? (
        // Selection mode: the row becomes a checkbox label so clicking
        // anywhere toggles selection (native), and navigation is
        // suppressed while the visitor is choosing what to delete.
        <label
          style={{
            display: 'grid',
            gridColumn: '1 / -1',
            gridTemplateColumns: 'subgrid',
            alignItems: 'center',
            padding: '0.625rem 1rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
            transition: 'background 0.2s ease',
          }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(rec.uri)}
            aria-label={`Select ${rkey}`}
            style={{
              width: '1rem',
              height: '1rem',
              cursor: 'pointer',
              accentColor: 'var(--accent-moss)',
            }}
          />
          {rowInner}
        </label>
      ) : (
        <Link
          href={`/explore/${repoSeg}/${collection}/${encodeURIComponent(rkey)}`}
          style={{
            display: 'grid',
            gridColumn: '1 / -1',
            gridTemplateColumns: 'subgrid',
            padding: '0.625rem 1rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
            textDecoration: 'none',
            transition: 'background 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {rowInner}
        </Link>
      )}
    </li>
  );
}
