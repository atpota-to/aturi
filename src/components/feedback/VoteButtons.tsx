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
      >
        <Icon size={vertical ? 16 : 14} />
      </button>
    );
  };

  return (
    <div className="fn-fb-vote" data-orientation={orientation}>
      {button('up')}
      <span
        aria-label={`Score ${score}`}
        className="fn-fb-score"
        data-zero={vote || score !== 0 ? undefined : ''}
      >
        {score}
      </span>
      {button('down')}
    </div>
  );
}
