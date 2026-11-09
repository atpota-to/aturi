'use client';

import Link from 'next/link';
import type { AtRecord } from '@/utils/atproto/pdsClient';
import { rkeyFromAtUri } from '@/utils/atproto/urls';
import { tidToDate, formatTidRelative } from '@/utils/atproto/tid';
import { previewFor } from '@/utils/atproto/previewExtractors';
import { SkeletonBar } from '../skeletons/primitives';
import { FileGlyph, fileKindOf } from './FileIcons';

/** An ISO 8601 date-time and nothing else, as `createdAt` fields hold. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * One record as a file in the Files view's icon layout: its kind on the
 * icon, its record key as the name, then what it says and when it was made.
 * The icon-layout twin of <CollectionRecordRow>, and like it purely
 * presentational: <CollectionList> owns the selection state.
 *
 * Browsing, the tile is a link the shell opens beside the grid; a double
 * click gives the record the full width, as opening a file would. In
 * selection mode it is a checkbox label instead.
 */
export default function RecordFile({
  rec,
  editing,
  isSelected,
  repoSeg,
  collection,
  onToggleSelect,
  current,
  onOpenWide,
}: {
  rec: AtRecord;
  editing: boolean;
  isSelected: boolean;
  repoSeg: string;
  collection: string;
  onToggleSelect: (uri: string) => void;
  /** The record open in the preview pane. */
  current?: boolean;
  onOpenWide?: () => void;
}) {
  const rkey = rkeyFromAtUri(rec.uri) || '';
  const tidDate = tidToDate(rkey);
  // A record with nothing to say for itself previews as its timestamp, which
  // in a table fills the column; on a tile it only repeats the date below.
  const preview = previewFor(rec.value);
  const caption = TIMESTAMP.test(preview) ? '' : preview;
  const body = (
    <>
      <FileGlyph kind={fileKindOf(collection)} />
      <code className="fx-fd-name">{rkey}</code>
      <span className="fx-fd-cap">{caption}</span>
      {tidDate && (
        <time className="fx-fd-meta" dateTime={tidDate.toISOString()} title={tidDate.toISOString()}>
          {formatTidRelative(tidDate)}
        </time>
      )}
    </>
  );
  return (
    <li className="fx-fd-item">
      {editing ? (
        <label className="fx-fd-tile" data-editing data-selected={isSelected || undefined}>
          <input
            type="checkbox"
            className="fx-fd-check"
            checked={isSelected}
            onChange={() => onToggleSelect(rec.uri)}
            aria-label={`Select ${rkey}`}
          />
          {body}
        </label>
      ) : (
        // `prefetch={false}` + `rel="nofollow"`, per <CollectionRecordRow>.
        <Link
          href={`/explore/${repoSeg}/${collection}/${encodeURIComponent(rkey)}`}
          prefetch={false}
          rel="nofollow"
          className="fx-fd-tile"
          data-current={current || undefined}
          aria-current={current ? 'true' : undefined}
          onDoubleClick={onOpenWide}
        >
          {body}
        </Link>
      )}
    </li>
  );
}

/** A screenful of file tiles, while the first page of records is on its way. */
export function RecordFileSkeleton({ tiles = 18 }: { tiles?: number }) {
  return (
    <ul className="fx-fd-grid" aria-hidden>
      {Array.from({ length: tiles }, (_, i) => (
        <li key={i} className="fx-fd-item">
          <span className="fx-fd-tile" data-skeleton>
            <SkeletonBar width="44px" height="56px" shape="block" />
            <SkeletonBar width="6.5rem" />
            <SkeletonBar width="5rem" />
          </span>
        </li>
      ))}
    </ul>
  );
}
