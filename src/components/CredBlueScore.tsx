'use client';

import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { fetchCachedCredBlueScore, type CredBlueScore } from '@/utils/credBlueScore';
import { CRED_BLUE_BASE } from '@/utils/atproto/config';

type State =
  | { status: 'loading' }
  | { status: 'ready'; score: CredBlueScore | null };

type Props = {
  /** Handle or DID — passed straight to api.cred.blue. */
  identifier: string;
  /** Optional handle used for the cred.blue profile link. Defaults to identifier. */
  linkHandle?: string;
};

export default function CredBlueScoreBadge({ identifier, linkHandle }: Props) {
  // Keyed by identifier: when the prop changes, the derived `state` below
  // falls back to loading on its own — no synchronous reset-setState in the
  // effect, so a stale score never flashes for the new identifier either.
  const [entry, setEntry] = useState<{ id: string; state: State } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCachedCredBlueScore(identifier).then((score) => {
      if (!cancelled) setEntry({ id: identifier, state: { status: 'ready', score } });
    });
    return () => {
      cancelled = true;
    };
  }, [identifier]);

  const state: State =
    entry && entry.id === identifier ? entry.state : { status: 'loading' };

  if (state.status === 'loading') return null;

  const handleForLink = (linkHandle || identifier).replace(/^@/, '');
  const credUrl = `${CRED_BLUE_BASE}/${encodeURIComponent(handleForLink)}`;

  if (!state.score) {
    return (
      <a
        href={credUrl}
        target="_blank"
        rel="noreferrer"
        title="This account hasn't been scored yet on cred.blue."
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: 'var(--text-tertiary)',
          textDecoration: 'none',
          fontSize: '0.8125rem',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-tertiary)';
        }}
      >
        <Gauge size={12} />
        Not yet scored on cred.blue →
      </a>
    );
  }

  const { combined } = state.score.scores;

  return (
    <a
      href={credUrl}
      target="_blank"
      rel="noreferrer"
      title={`Bluesky ${state.score.scores.bluesky} · ATProto ${state.score.scores.atproto}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.25rem 0.6rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-primary)',
        textDecoration: 'none',
        fontSize: '0.8125rem',
        transition: 'border-color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--text-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-medium)';
      }}
    >
      <Gauge size={12} />
      <span style={{ color: 'var(--text-tertiary)' }}>cred.blue</span>
      <strong style={{ fontWeight: 600 }}>{combined.toLocaleString()}</strong>
    </a>
  );
}
