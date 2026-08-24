'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogOut, Monitor, Puzzle } from 'lucide-react';
import { bffOrigin } from '@/lib/oauth/bffSession';

/**
 * Every browser and extension holding a backend session for this account.
 *
 * Renders nothing at all unless the backend answers — which is how it stays
 * invisible on a deployment using the public browser client, where there is no
 * such list to show and no server to ask.
 *
 * Two separate actions, deliberately not one button. Ending one device is a
 * local delete; "sign out everywhere" additionally revokes the app's access at
 * the user's PDS, which is a different and much larger thing. Someone who has
 * granted a browser extension access to their repo should be able to take that
 * back without also having to re-authorize on their laptop.
 */

type DeviceSession = {
  id: string;
  client: 'web' | 'extension';
  label: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

type State =
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'ready'; sessions: DeviceSession[] };

export default function SignedInDevices() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${bffOrigin()}/api/oauth/sessions`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setState({ status: 'absent' });
        return;
      }
      const body = (await res.json()) as { sessions?: DeviceSession[] };
      setState({ status: 'ready', sessions: body.sessions ?? [] });
    } catch {
      setState({ status: 'absent' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        await fetch(`${bffOrigin()}/api/oauth/sessions?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
        await load();
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const signOutEverywhere = useCallback(async () => {
    setBusy('all');
    try {
      await fetch(`${bffOrigin()}/api/oauth/logout?scope=all`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      // Every session is gone, including this page's — a reload is the honest
      // way to show that rather than leaving stale UI behind.
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }, []);

  if (state.status !== 'ready' || state.sessions.length === 0) return null;

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Where you&rsquo;re signed in</h2>
        <p className="settings-card-sub">
          Each browser and extension holding a session. Ending one leaves the others
          alone; signing out everywhere also revokes this app&rsquo;s access at your PDS.
        </p>
      </div>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        }}
      >
        {state.sessions.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '0.625rem 0.75rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>
              {s.client === 'extension' ? <Puzzle size={15} /> : <Monitor size={15} />}
            </span>
            <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                {s.label ?? (s.client === 'extension' ? 'Aturi extension' : 'Browser')}
                {s.current && (
                  <span
                    style={{
                      marginLeft: '0.5rem',
                      fontSize: '0.7rem',
                      color: 'var(--text-accent)',
                    }}
                  >
                    this one
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                Last used {relativeTime(s.lastSeenAt)}
              </div>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void revoke(s.id)}
              style={rowButtonStyle()}
            >
              {busy === s.id ? <Loader2 size={12} className="explore-spin" /> : null}
              {s.current ? 'Sign out' : 'End session'}
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={busy !== null}
        onClick={() => void signOutEverywhere()}
        style={{ ...rowButtonStyle({ danger: true }), marginTop: '0.75rem' }}
      >
        {busy === 'all' ? (
          <Loader2 size={12} className="explore-spin" />
        ) : (
          <LogOut size={13} />
        )}
        Sign out everywhere
      </button>
    </section>
  );
}

/**
 * Computed during render, with no state and no effect.
 *
 * That is safe here only because of where this sits: the parent returns null
 * until its fetch resolves, so nothing in this subtree is ever server-rendered
 * and there is no hydration pass for a clock reading to mismatch on.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'at an unknown time';
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} hours ago`;
  return `${Math.round(minutes / (60 * 24))} days ago`;
}

function rowButtonStyle(opts?: { danger?: boolean }): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.3rem 0.6rem',
    fontSize: '0.75rem',
    background: 'transparent',
    border: `1px solid ${opts?.danger ? 'var(--danger-border)' : 'var(--border-medium)'}`,
    color: opts?.danger ? 'var(--danger)' : 'var(--text-secondary)',
    cursor: 'pointer',
  };
}
