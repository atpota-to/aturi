'use client';

import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { encodeRepo } from '@/utils/atproto/urls';

/**
 * Compact session indicator shown in the explorer header. When signed in,
 * renders the DID as a link to the user's own repo and offers a sign-out
 * button. When signed out, renders nothing — the per-page sign-in form
 * handles auth gating.
 */
export default function SessionBadge() {
  const { did, signOut, loading } = useAtprotoSession();

  if (loading || !did) return null;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.8125rem',
        color: 'var(--text-secondary)',
      }}
    >
      <Link
        href={`/explore/${encodeRepo(did)}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.375rem',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
          fontFamily: 'var(--font-mono)',
        }}
        title={did}
      >
        <User size={12} />
        <span>
          {did.length > 26 ? `${did.slice(0, 12)}…${did.slice(-8)}` : did}
        </span>
      </Link>
      <button
        type="button"
        onClick={() => void signOut()}
        title="Sign out"
        aria-label="Sign out"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '0.25rem',
          background: 'transparent',
          border: 0,
          color: 'var(--text-tertiary)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--danger)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-tertiary)';
        }}
      >
        <LogOut size={12} />
      </button>
    </div>
  );
}
