'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogOut, Monitor, Puzzle } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
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
  const { signOut } = useAtprotoSession();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

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
    async (id: string, isCurrent: boolean) => {
      setBusy(id);
      setFailure(null);
      try {
        const res = await fetch(
          `${bffOrigin()}/api/oauth/sessions?id=${encodeURIComponent(id)}`,
          { method: 'DELETE', credentials: 'same-origin' },
        );
        if (!res.ok) {
          // Reporting a failure as success is worse here than almost anywhere
          // else: the row disappears and the user believes a device no longer
          // has access to their repository.
          setFailure('That session could not be ended. Try again.');
          return;
        }
        if (isCurrent) {
          // Ending your own session server-side leaves this tab holding a
          // cookie for a row that no longer exists — the app would keep
          // rendering as signed in until something happened to notice. Take
          // the app's own sign-out path so the UI matches the server.
          await signOut();
          return;
        }
        await load();
      } catch {
        setFailure('That session could not be ended. Try again.');
      } finally {
        setBusy(null);
      }
    },
    [load, signOut],
  );

  const signOutEverywhere = useCallback(async () => {
    if (
      !window.confirm(
        'Sign out everywhere and revoke this app\u2019s access at your PDS? ' +
          'Every browser and extension will be signed out, and you will need to ' +
          'authorize again next time.',
      )
    ) {
      return;
    }
    setBusy('all');
    setFailure(null);
    try {
      const res = await fetch(`${bffOrigin()}/api/oauth/logout?scope=all`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setFailure('Could not sign out everywhere. Try again.');
        return;
      }
      // Deliberately the app's own sign-out rather than a reload. A reload
      // would race the browser's cookie write, and — worse — the provider
      // honours a leftover browser-client session in IndexedDB, so reloading
      // could sign the user straight back in through the other client, which
      // is the opposite of what they just asked for.
      await signOut();
      setState({ status: 'ready', sessions: [] });
    } catch {
      setFailure('Could not sign out everywhere. Try again.');
    } finally {
      setBusy(null);
    }
  }, [signOut]);

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
              onClick={() => void revoke(s.id, s.current)}
              style={rowButtonStyle()}
            >
              {busy === s.id ? <Loader2 size={12} className="explore-spin" /> : null}
              {s.current ? 'Sign out' : 'End session'}
            </button>
          </li>
        ))}
      </ul>

      {failure && (
        <p
          role="alert"
          style={{
            margin: '0.75rem 0 0',
            fontSize: '0.78rem',
            color: 'var(--danger)',
          }}
        >
          {failure}
        </p>
      )}

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
  if (minutes < 60) return plural(minutes, 'minute');
  if (minutes < 60 * 24) return plural(Math.round(minutes / 60), 'hour');
  return plural(Math.round(minutes / (60 * 24)), 'day');
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
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
