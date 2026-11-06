'use client';

import { UI_STATE_META, type UiState } from '@/utils/userinput/lexicons';

/**
 * The official status on a discussion. "Open" is the absence of any status
 * record rather than a claim about the discussion, so it renders only where
 * the surrounding UI needs a slot filled (`showOpen`) — on a dense board it's
 * noise on every untouched row.
 *
 * Styled by .fn-fb-status in src/styles/fieldnotes/content.css; the tone
 * (neutral / active / positive / negative) picks the pill's colours.
 */
export default function StatusChip({
  state,
  showOpen = false,
  size = 'md',
}: {
  state: UiState;
  showOpen?: boolean;
  size?: 'sm' | 'md';
}) {
  if (state === 'open' && !showOpen) return null;
  const meta = UI_STATE_META[state];

  return (
    <span className="fn-fb-status" data-tone={meta.tone} data-size={size}>
      {meta.label}
    </span>
  );
}
