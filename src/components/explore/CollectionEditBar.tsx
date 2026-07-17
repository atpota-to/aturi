'use client';

import { type RefObject } from 'react';
import { Trash2 } from 'lucide-react';
import { HOURLY_POINT_BUDGET } from '@/utils/atproto/writeThrottle';
import DeleteProgressBar from './DeleteProgressBar';
import { selectionButtonStyle } from './collectionListHelpers';

/**
 * The in-page bulk-edit toolbar shown while selection mode is active on a
 * collection: Select/Deselect chips, a running "N selected" count, and the
 * delete affordance, which walks through delete → confirm → in-flight
 * (progress bar + Stop) states. Purely presentational — every count, flag, and
 * handler is supplied by <CollectionList>, which owns the selection and the
 * delete engine. Its condensed twin lives in <StickyEditBar>, driven from the
 * same published snapshot.
 */
export default function CollectionEditBar({
  editBarRef,
  recordsLength,
  selectedSize,
  allSelected,
  deleting,
  confirmingDelete,
  deleteProgress,
  deleteWaitSec,
  willPace,
  onSelectAll,
  onDeselectAll,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onStop,
}: {
  editBarRef: RefObject<HTMLDivElement | null>;
  recordsLength: number;
  selectedSize: number;
  allSelected: boolean;
  deleting: boolean;
  confirmingDelete: boolean;
  deleteProgress: { done: number; total: number } | null;
  deleteWaitSec: number | null;
  willPace: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onStop: () => void;
}) {
  return (
    <div
      ref={editBarRef}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        flexWrap: 'wrap',
        padding: '0.625rem 0.75rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      <button
        type="button"
        onClick={onSelectAll}
        disabled={recordsLength === 0 || allSelected || deleting}
        style={selectionButtonStyle(recordsLength === 0 || allSelected || deleting)}
      >
        Select
      </button>
      <button
        type="button"
        onClick={onDeselectAll}
        disabled={selectedSize === 0 || deleting}
        style={selectionButtonStyle(selectedSize === 0 || deleting)}
      >
        Deselect
      </button>
      <span
        style={{
          color: 'var(--text-tertiary)',
          fontSize: '0.8125rem',
          marginLeft: '0.25rem',
        }}
      >
        {selectedSize} selected
      </span>
      <span style={{ flex: 1 }} />
      {!confirmingDelete ? (
        <button
          type="button"
          onClick={onRequestDelete}
          disabled={selectedSize === 0}
          aria-label={
            selectedSize
              ? `Delete ${selectedSize} selected record${selectedSize === 1 ? '' : 's'}`
              : 'Delete selected records'
          }
          title={
            selectedSize
              ? `Delete ${selectedSize} selected record${selectedSize === 1 ? '' : 's'}`
              : 'Delete selected records'
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            // Icon-only now, so square the horizontal padding up rather
            // than leaving the old icon+label width.
            padding: '0.4rem 0.6rem',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger-border)',
            fontFamily: 'var(--font-serif)',
            fontSize: '0.8125rem',
            cursor: selectedSize === 0 ? 'not-allowed' : 'pointer',
            opacity: selectedSize === 0 ? 0.5 : 1,
          }}
        >
          <Trash2 size={14} />
        </button>
      ) : deleting && deleteProgress ? (
        <>
          <span
            style={{
              fontSize: '0.8125rem',
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            {deleteWaitSec != null
              ? `Paced under the rate limit, resuming in ${deleteWaitSec}s`
              : 'Deleting…'}
          </span>
          <DeleteProgressBar done={deleteProgress.done} total={deleteProgress.total} />
          <button
            type="button"
            onClick={onStop}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-medium)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Stop
          </button>
        </>
      ) : (
        <>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Delete {selectedSize} record{selectedSize === 1 ? '' : 's'}? This cannot be
            undone.
            {willPace &&
              ` Aturi will pace this under Bluesky's ~${HOURLY_POINT_BUDGET.toLocaleString()}/hour write limit, so it may pause partway.`}
          </span>
          <button
            type="button"
            onClick={onConfirmDelete}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'var(--danger)',
              color: 'var(--text-on-accent)',
              border: '1px solid var(--danger)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            Confirm delete
          </button>
          <button
            type="button"
            onClick={onCancelDelete}
            style={{
              padding: '0.4rem 0.75rem',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-medium)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
