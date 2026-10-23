'use client';

import { Trash2 } from 'lucide-react';
import { HOURLY_POINT_BUDGET } from '@/utils/atproto/writeThrottle';
import DeleteProgressBar from './DeleteProgressBar';

/**
 * The in-page bulk-edit toolbar shown while selection mode is active on a
 * collection: Select/Deselect chips, a running "N selected" count, and the
 * delete affordance, which walks through delete → confirm → in-flight
 * (progress bar + Stop) states. Purely presentational — every count, flag, and
 * handler is supplied by <CollectionList>, which owns the selection and the
 * delete engine. Its condensed twin lives in the bottom <ExploreChromeBar>,
 * driven from the same published snapshot and shown only while this one is
 * scrolled out of view.
 */
export default function CollectionEditBar({
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
  const plural = selectedSize === 1 ? '' : 's';
  return (
    <div className="fx-card fx-editbar">
      <button
        type="button"
        onClick={onSelectAll}
        disabled={recordsLength === 0 || allSelected || deleting}
        className="fx-btn fx-btn-sm"
      >
        Select
      </button>
      <button
        type="button"
        onClick={onDeselectAll}
        disabled={selectedSize === 0 || deleting}
        className="fx-btn fx-btn-sm"
      >
        Deselect
      </button>
      <span className="fx-editbar-count">{selectedSize} selected</span>
      <span className="fx-editbar-spacer" />
      {!confirmingDelete ? (
        <button
          type="button"
          onClick={onRequestDelete}
          disabled={selectedSize === 0}
          aria-label={
            selectedSize
              ? `Delete ${selectedSize} selected record${plural}`
              : 'Delete selected records'
          }
          title={
            selectedSize
              ? `Delete ${selectedSize} selected record${plural}`
              : 'Delete selected records'
          }
          className="fx-btn fx-btn-sm fx-btn-danger"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      ) : deleting && deleteProgress ? (
        <>
          <span className="fx-editbar-prompt" style={{ whiteSpace: 'nowrap' }}>
            {deleteWaitSec != null
              ? `Paced under the rate limit, resuming in ${deleteWaitSec}s`
              : 'Deleting…'}
          </span>
          <DeleteProgressBar done={deleteProgress.done} total={deleteProgress.total} />
          <button type="button" onClick={onStop} className="fx-btn fx-btn-sm">
            Stop
          </button>
        </>
      ) : (
        <>
          <span className="fx-editbar-prompt">
            Delete {selectedSize} record{plural}? This cannot be undone.
            {willPace &&
              ` Aturi will pace this under Bluesky's ~${HOURLY_POINT_BUDGET.toLocaleString()}/hour write limit, so it may pause partway.`}
          </span>
          <button type="button" onClick={onConfirmDelete} className="fx-btn fx-btn-sm fx-btn-danger-solid">
            Confirm delete
          </button>
          <button type="button" onClick={onCancelDelete} className="fx-btn fx-btn-sm">
            Cancel
          </button>
        </>
      )}
    </div>
  );
}
