'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleAlert, Loader2, LogOut, Telescope, User } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import { encodeRepo } from '@/utils/atproto/urls';
import WaypointsManager from './WaypointsManager';

export default function AccountPage() {
  const { session, did, signIn, signOut, loading } = useAtprotoSession();
  const { pdsSync } = usePreferences();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<AppViewProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) {
    return <p className="explore-placeholder">Loading account…</p>;
  }

  if (!session) {
    return (
      <div style={{ maxWidth: '32rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 300, marginBottom: '0.75rem' }}>
          Sign in to customize Aturi
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: '1.5rem',
          }}
        >
          Reorder waypoints, hide ones you don&rsquo;t use, or add your own. Your
          preferences sync to your PDS so they follow you across devices.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const v = input.trim();
            if (!v) return;
            setBusy(true);
            setError(null);
            try {
              await signIn(v);
            } catch (err) {
              setBusy(false);
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}
        >
          <input
            type="text"
            autoComplete="username"
            spellCheck={false}
            placeholder="handle.bsky.social or did:plc:…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            style={{
              padding: '0.75rem 0.875rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--accent-moss)',
              color: 'var(--text-on-accent)',
              border: '1px solid var(--accent-moss)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.95rem',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy || !input.trim() ? 0.6 : 1,
            }}
          >
            {busy ? 'Redirecting…' : 'Continue with atproto OAuth →'}
          </button>
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', margin: 0 }}>
              {error}
            </p>
          )}
        </form>
        <p
          style={{
            marginTop: '1.5rem',
            color: 'var(--text-tertiary)',
            fontSize: '0.8125rem',
          }}
        >
          You&rsquo;ll be redirected to your PDS to authorize Aturi. We only request the
          permissions needed to read and write your preferences record.
        </p>
      </div>
    );
  }

  const handle = profile?.handle;
  const displayName = profile?.displayName?.trim() || handle || did;
  const avatar = profile?.avatar;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Account header */}
      <section
        style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          padding: '1rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          flexWrap: 'wrap',
        }}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            width={48}
            height={48}
            style={{
              width: 48,
              height: 48,
              objectFit: 'cover',
              flexShrink: 0,
              border: '1px solid var(--border-medium)',
              background: 'var(--bg-tertiary)',
            }}
          />
        ) : (
          <span
            style={{
              width: 48,
              height: 48,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-tertiary)',
              flexShrink: 0,
            }}
          >
            <User size={20} />
          </span>
        )}
        <div style={{ flex: '1 1 14rem', minWidth: 0 }}>
          <div style={{ fontSize: '1.1rem', color: 'var(--text-primary)' }}>
            {displayName}
          </div>
          {handle && (
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
                wordBreak: 'break-all',
              }}
            >
              @{handle}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {did && (
            <Link
              href={`/explore/${encodeRepo(did)}`}
              style={ghostLinkStyle()}
            >
              <Telescope size={13} /> My repo
            </Link>
          )}
          <button type="button" onClick={() => void signOut()} style={ghostLinkStyle({ danger: true })}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </section>

      {/* PDS sync status */}
      <SyncStatus pdsSync={pdsSync} />

      {/* The actual preference editor */}
      <WaypointsManager />
    </div>
  );
}

function SyncStatus({
  pdsSync,
}: {
  pdsSync: ReturnType<typeof usePreferences>['pdsSync'];
}) {
  if (pdsSync === null) return null;
  let icon: React.ReactNode;
  let label: string;
  let color: string;
  if (pdsSync === 'syncing') {
    icon = <Loader2 size={12} className="explore-spin" />;
    label = 'Syncing preferences to your PDS…';
    color = 'var(--text-tertiary)';
  } else if (pdsSync === 'idle') {
    icon = <CheckCircle2 size={12} />;
    label = 'Preferences synced to your PDS.';
    color = 'var(--text-accent)';
  } else {
    icon = <CircleAlert size={12} />;
    label = 'Preference sync to PDS failed — local changes are saved.';
    color = 'var(--danger)';
  }
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.4rem 0.625rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        fontSize: '0.75rem',
        color,
        alignSelf: 'flex-start',
      }}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function ghostLinkStyle({ danger }: { danger?: boolean } = {}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.4rem 0.75rem',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-medium)',
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    fontFamily: 'var(--font-serif)',
    fontSize: '0.8125rem',
    cursor: 'pointer',
    textDecoration: 'none',
  };
}
