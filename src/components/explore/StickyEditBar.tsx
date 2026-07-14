'use client';

import { type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { useEditBar, type EditBarSnapshot } from './EditBarContext';
import DeleteProgressBar from './DeleteProgressBar';

/**
 * Condensed bulk-edit toolbar that drops into the bottom of the floating nav
 * once the in-page edit bar has scrolled up behind it, so the selection
 * count and delete controls stay reachable while you scroll a long list.
 * Reads its state + handlers from EditBarContext and renders nothing until a
 * snapshot is registered (selection mode active), so it's inert elsewhere.
 *
 * Mirrors <StickyBreadcrumbBar>: same height/opacity reveal, same full-width
 * section with a border-top divider connecting it to the row above.
 */
export default function StickyEditBar() {
  const { bar, scrolledPast } = useEditBar();
  const show = scrolledPast && !!bar;

  return (
    <AnimatePresence initial={false}>
      {show && bar && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          style={{ overflow: 'hidden' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.4rem',
              padding: '0.5rem 1rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <BarControls bar={bar} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BarControls({ bar }: { bar: EditBarSnapshot }) {
  if (bar.deleting && bar.progress) {
    return (
      <>
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-serif)',
            whiteSpace: 'nowrap',
          }}
        >
          Deleting…
        </span>
        <DeleteProgressBar done={bar.progress.done} total={bar.progress.total} compact />
      </>
    );
  }
  if (bar.confirming) {
    return (
      <>
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-serif)',
          }}
        >
          Delete {bar.selectedCount} record{bar.selectedCount === 1 ? '' : 's'}? This
          can&rsquo;t be undone.
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={bar.onConfirmDelete}
          style={{
            ...miniButton,
            background: 'var(--danger)',
            color: 'var(--text-on-accent)',
            border: '1px solid var(--danger)',
            cursor: 'pointer',
          }}
        >
          Confirm delete
        </button>
        <button
          type="button"
          onClick={bar.onCancelDelete}
          style={{
            ...miniButton,
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-medium)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </>
    );
  }

  const selectAllDisabled = bar.totalCount === 0 || bar.allSelected;
  const nothingSelected = bar.selectedCount === 0;
  return (
    <>
      <button
        type="button"
        onClick={bar.onSelectAll}
        disabled={selectAllDisabled}
        style={neutralButton(selectAllDisabled)}
      >
        Select all
      </button>
      <button
        type="button"
        onClick={bar.onDeselectAll}
        disabled={nothingSelected}
        style={neutralButton(nothingSelected)}
      >
        Deselect all
      </button>
      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', marginLeft: '0.15rem' }}>
        {bar.selectedCount} selected
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={bar.onRequestDelete}
        disabled={nothingSelected}
        style={{
          ...miniButton,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          background: 'var(--danger-soft)',
          color: 'var(--danger)',
          border: '1px solid var(--danger-border)',
          cursor: nothingSelected ? 'not-allowed' : 'pointer',
          opacity: nothingSelected ? 0.5 : 1,
        }}
      >
        <Trash2 size={11} /> Delete{bar.selectedCount ? ` (${bar.selectedCount})` : ''}
      </button>
    </>
  );
}

// Compact button base — tighter than the in-page bar so the row fits inside
// the slim nav card.
const miniButton: CSSProperties = {
  padding: '0.3rem 0.6rem',
  fontFamily: 'var(--font-serif)',
  fontSize: '0.75rem',
};

function neutralButton(disabled: boolean): CSSProperties {
  return {
    ...miniButton,
    background: 'var(--bg-tertiary)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-medium)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
