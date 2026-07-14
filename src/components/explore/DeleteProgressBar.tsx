'use client';

/**
 * Determinate progress bar for the bulk-delete run. Records are deleted in
 * atomic applyWrites batches, so "done" advances a whole chunk at a time and
 * the fill reflects how far through the selection we are. Shared by the
 * in-page edit toolbar and the condensed nav bar so both read identically;
 * `compact` shrinks it to fit the slimmer nav card.
 */
export default function DeleteProgressBar({
  done,
  total,
  compact = false,
}: {
  done: number;
  total: number;
  compact?: boolean;
}) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? '0.4rem' : '0.5rem',
        flex: 1,
        minWidth: compact ? '7rem' : '9rem',
      }}
    >
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`Deleting ${done} of ${total} records`}
        style={{
          position: 'relative',
          flex: 1,
          height: compact ? '4px' : '6px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-medium)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            // scaleX keeps the fill on the compositor — no layout thrash as it
            // advances a chunk at a time.
            transformOrigin: 'left',
            transform: `scaleX(${ratio})`,
            background: 'var(--danger)',
            transition: 'transform 0.25s ease',
          }}
        />
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: compact ? '0.7rem' : '0.75rem',
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {done} / {total}
      </span>
    </div>
  );
}
