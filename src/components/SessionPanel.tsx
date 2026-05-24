'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogIn, LogOut, Settings, Telescope, User } from 'lucide-react';
import { useAtprotoSession } from './AtprotoSessionProvider';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { encodeRepo } from '@/utils/atproto/urls';

type Props = {
  /** Called when the user clicks a nav link — lets the parent close the menu. */
  onNavigate?: () => void;
};

/**
 * Inline session UI for the compact header's expanding menu panel. Renders
 * as a stack of compact-nav-link rows, NOT a dropdown (the parent panel
 * is already a popover). When signed out: a "Sign in" link to /account.
 * When signed in: a small \"signed in as @handle\" header and quick
 * actions for the user's repo / settings / sign-out.
 */
export default function SessionPanel({ onNavigate }: Props) {
  const { session, did, signOut, loading } = useAtprotoSession();
  const [profile, setProfile] = useState<AppViewProfile | null>(null);

  useEffect(() => {
    if (!did) {
      setProfile(null);
      return undefined;
    }
    let cancelled = false;
    getProfile(did).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [did]);

  if (loading) return null;

  // ─── Signed out ─────────────────────────────────────────────────────────
  if (!session) {
    return (
      <Link
        href="/account"
        className="compact-nav-link"
        onClick={onNavigate}
      >
        <LogIn size={16} />
        <span>sign in</span>
      </Link>
    );
  }

  // ─── Signed in ──────────────────────────────────────────────────────────
  const handle = profile?.handle || (did ? did.slice(0, 24) : null);
  const displayName = profile?.displayName?.trim() || handle;
  const avatar = profile?.avatar;

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.625rem 1rem',
          marginBottom: '0.25rem',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            width={22}
            height={22}
            style={{
              width: 22,
              height: 22,
              objectFit: 'cover',
              flexShrink: 0,
              background: 'var(--bg-tertiary)',
            }}
          />
        ) : (
          <span
            style={{
              width: 22,
              height: 22,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-tertiary)',
              flexShrink: 0,
            }}
          >
            <User size={12} />
          </span>
        )}
        <div style={{ minWidth: 0, lineHeight: 1.2 }}>
          <div
            style={{
              fontSize: '0.8125rem',
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
          {handle && (
            <div
              style={{
                fontSize: '0.7rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              @{handle}
            </div>
          )}
        </div>
      </div>

      {did && (
        <Link
          href={`/explore/${encodeRepo(did)}`}
          className="compact-nav-link"
          onClick={onNavigate}
        >
          <Telescope size={16} />
          <span>my repo</span>
        </Link>
      )}
      <Link href="/account" className="compact-nav-link" onClick={onNavigate}>
        <Settings size={16} />
        <span>account</span>
      </Link>
      <button
        type="button"
        onClick={async () => {
          onNavigate?.();
          await signOut();
        }}
        className="compact-nav-link"
        style={{
          // The class styles a hover-translate which conflicts a bit with
          // a button; override font defaults so it matches the link rows.
          font: 'inherit',
          textAlign: 'left',
          color: 'var(--danger)',
          width: '100%',
        }}
      >
        <LogOut size={16} />
        <span>sign out</span>
      </button>
    </>
  );
}
