'use client';

import { UI_STATE_META, type UiState } from '@/utils/userinput/lexicons';

const TONE: Record<
  (typeof UI_STATE_META)[UiState]['tone'],
  { fg: string; bg: string; border: string }
> = {
  neutral: {
    fg: 'var(--text-tertiary)',
    bg: 'var(--bg-tertiary)',
    border: 'var(--border-subtle)',
  },
  active: {
    fg: 'var(--text-accent)',
    bg: 'var(--glow-subtle)',
    border: 'var(--border-medium)',
  },
  positive: {
    fg: 'var(--margin-collection-fg)',
    bg: 'var(--margin-collection-tint)',
    border: 'var(--margin-collection-border)',
  },
  negative: {
    fg: 'var(--danger)',
    bg: 'var(--danger-soft)',
    border: 'var(--danger-border)',
  },
};

/**
 * The official status on a discussion. "Open" is the absence of any status
 * record rather than a claim about the discussion, so it renders only where
 * the surrounding UI needs a slot filled (`showOpen`) — on a dense board it's
 * noise on every untouched row.
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
  const tone = TONE[meta.tone];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: size === 'sm' ? '0.1rem 0.4rem' : '0.15rem 0.5rem',
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.fg,
        fontFamily: 'var(--font-serif)',
        fontSize: size === 'sm' ? '0.6875rem' : '0.75rem',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
}
