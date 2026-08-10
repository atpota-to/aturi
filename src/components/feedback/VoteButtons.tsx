'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import type { VoteDirection } from '@/utils/userinput/writes';

/**
 * The up / score / down control on a discussion or reply.
 *
 * The score shown is optimistic: `setVote` writes to the voter's own repo and
 * Constellation indexes it from the firehose a moment later, so re-reading the
 * count immediately would show the *old* number and read as a dropped click.
 * The caller applies the delta locally and lets the next full load reconcile.
 */
export default function VoteButtons({
  score,
  vote,
  onVote,
  disabled = false,
  disabledReason,
  orientation = 'vertical',
}: {
  score: number;
  vote: VoteDirection;
  onVote: (next: VoteDirection) => void;
  disabled?: boolean;
  disabledReason?: string;
  orientation?: 'vertical' | 'horizontal';
}) {
  const vertical = orientation === 'vertical';

  const button = (direction: Exclude<VoteDirection, null>) => {
    const active = vote === direction;
    const Icon = direction === 'up' ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={active}
        aria-label={direction === 'up' ? 'Upvote' : 'Downvote'}
        title={disabled ? disabledReason : undefined}
        onClick={() => onVote(active ? null : direction)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: vertical ? '1.75rem' : '1.5rem',
          height: vertical ? '1.5rem' : '1.5rem',
          padding: 0,
          background: active ? 'var(--glow-medium)' : 'transparent',
          border: `1px solid ${active ? 'var(--border-medium)' : 'transparent'}`,
          color: active ? 'var(--text-accent)' : 'var(--text-tertiary)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          transition: 'color 0.15s ease, background 0.15s ease',
        }}
      >
        <Icon size={vertical ? 16 : 14} />
      </button>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        alignItems: 'center',
        gap: vertical ? '0.1rem' : '0.25rem',
        flexShrink: 0,
      }}
    >
      {button('up')}
      <span
        aria-label={`Score ${score}`}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: vertical ? '0.875rem' : '0.8125rem',
          fontVariantNumeric: 'tabular-nums',
          color:
            vote || score !== 0 ? 'var(--text-primary)' : 'var(--text-tertiary)',
          minWidth: vertical ? '1.75rem' : '1.25rem',
          textAlign: 'center',
        }}
      >
        {score}
      </span>
      {button('down')}
    </div>
  );
}
