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
 * lays out its rkey, a data preview and the TID-derived timestamp across the
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
  const cells = (
    <>
      <code className="fx-rec-key">{rkey}</code>
      <span className="fx-rec-text">{previewFor(rec.value)}</span>
      <span className="fx-rec-time">
        {tidDate && (
          <time dateTime={tidDate.toISOString()} title={tidDate.toISOString()}>
            {formatTidRelative(tidDate)}
          </time>
        )}
      </span>
    </>
  );
  return (
    // Spans the list's grid and hands the shared tracks down to the row's
    // link/label, which lays out the actual cells.
    <li className="fx-rec-item">
      {editing ? (
        // Selection mode: the row becomes a checkbox label so clicking
        // anywhere toggles selection (native), and navigation is
        // suppressed while the visitor is choosing what to delete.
        <label
          className="fx-rec-row"
          data-editing
          data-selected={isSelected || undefined}
        >
          <span className="fx-rec-check">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(rec.uri)}
              aria-label={`Select ${rkey}`}
            />
          </span>
          {cells}
        </label>
      ) : (
        // `prefetch={false}` + `rel="nofollow"`, per <LinkifiedJson>. One row
        // per record in the collection — the deepest and highest-cardinality
        // tier of the tree, and the one a crawler reaches last and most often.
        <Link
          href={`/explore/${repoSeg}/${collection}/${encodeURIComponent(rkey)}`}
          prefetch={false}
          rel="nofollow"
          className="fx-rec-row"
        >
          {cells}
        </Link>
      )}
    </li>
  );
}
