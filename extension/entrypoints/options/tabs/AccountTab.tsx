import { useCallback, useEffect, useState } from 'react';
import type { CustomWaypoint, Prefs, WaypointGroup } from '../../../lib/prefs';
import {
  SignInUnavailableError,
  getSession,
  onSessionChanged,
  signIn,
  signOut,
  xrpcGet,
  type StoredSession,
} from '../../../lib/session';

/**
 * Optional sign-in to aturi.to, and the one thing it currently buys: pulling
 * the waypoint groups and custom waypoints you already set up on the website.
 *
 * Sign-in lives HERE rather than in the popup, and that is not a layout
 * preference. `identity.launchWebAuthFlow` opens a separate window; the popup
 * loses focus, is torn down, and the promise it was waiting on is collected
 * with it. It appears to work in development, where devtools often keeps the
 * popup alive, and hangs in a real install.
 *
 * The grant is read-only. The extension asks for nothing that can write, which
 * is why the import below is one-directional: your settings come down from the
 * website, and nothing goes back up.
 */

const PREFERENCES_NSID = 'to.aturi.actor.preferences';

type PreferencesRecord = {
  value?: {
    waypointGroups?: unknown;
    customWaypoints?: unknown;
  };
};

/**
 * Everything below is a boundary check, not paranoia about the user.
 *
 * The record comes from the signed-in account's own repository, so this is not
 * defending against an attacker — it is defending against a record written by
 * a newer version of the website, a half-finished edit, or another client
 * writing the same collection. `mergePrefs` coerces shapes when prefs are READ
 * back from storage, but this import writes them, and a group whose
 * `waypointIds` is not an array would break the popup until the next load
 * quietly repaired it. Drop what does not fit and say how much was dropped.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function cleanGroups(raw: unknown): WaypointGroup[] {
  if (!Array.isArray(raw)) return [];
  const out: WaypointGroup[] = [];
  for (const g of raw) {
    if (!isRecord(g)) continue;
    const id = str(g.id);
    const name = str(g.name);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      waypointIds: Array.isArray(g.waypointIds)
        ? g.waypointIds.filter((w): w is string => typeof w === 'string')
        : [],
      ...(typeof g.collapsed === 'boolean' ? { collapsed: g.collapsed } : {}),
    });
  }
  return out;
}

function cleanCustom(raw: unknown): CustomWaypoint[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomWaypoint[] = [];
  for (const w of raw) {
    if (!isRecord(w)) continue;
    const id = str(w.id);
    const name = str(w.name);
    // `templates` is what the popup builds URLs from; a waypoint without one
    // is an entry that can never open anything.
    if (!id || !name || !isRecord(w.templates)) continue;
    const templates: CustomWaypoint['templates'] = {};
    for (const [type, tpl] of Object.entries(w.templates)) {
      if (typeof tpl === 'string' && tpl) {
        templates[type as keyof CustomWaypoint['templates']] = tpl;
      }
    }
    if (Object.keys(templates).length === 0) continue;
    out.push({
      id,
      name,
      domain: str(w.domain) ?? '',
      category: str(w.category) ?? 'other',
      supportedTypes: Array.isArray(w.supportedTypes)
        ? (w.supportedTypes.filter((t) => typeof t === 'string') as CustomWaypoint['supportedTypes'])
        : [],
      templates,
      ...(Array.isArray(w.redirectCompat)
        ? {
            redirectCompat: w.redirectCompat.filter(
              (f) => typeof f === 'string',
            ) as CustomWaypoint['redirectCompat'],
          }
        : {}),
    });
  }
  return out;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; what: 'signin' | 'import' }
  | { kind: 'error'; message: string }
  | { kind: 'imported'; groups: number; custom: number; skipped: number }
  | { kind: 'empty' };

export default function AccountTab({
  prefs,
  onUpdate,
}: {
  prefs: Prefs;
  onUpdate: (partial: Partial<Prefs>) => void | Promise<void>;
}) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [handle, setHandle] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    void getSession().then(setSession);
    return onSessionChanged(setSession);
  }, []);

  const doSignIn = useCallback(async () => {
    const value = handle.trim();
    if (!value) return;
    setStatus({ kind: 'busy', what: 'signin' });
    try {
      setSession(await signIn(value));
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof SignInUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Sign-in failed.',
      });
    }
  }, [handle]);

  const doImport = useCallback(async () => {
    setStatus({ kind: 'busy', what: 'import' });
    try {
      const current = await getSession();
      if (!current) throw new Error('Signed out.');
      const record = await xrpcGet<PreferencesRecord>('com.atproto.repo.getRecord', {
        repo: current.did,
        collection: PREFERENCES_NSID,
        rkey: 'self',
      });
      const rawGroups = Array.isArray(record.value?.waypointGroups)
        ? record.value.waypointGroups.length
        : 0;
      const rawCustom = Array.isArray(record.value?.customWaypoints)
        ? record.value.customWaypoints.length
        : 0;
      const groups = cleanGroups(record.value?.waypointGroups);
      const custom = cleanCustom(record.value?.customWaypoints);
      if (groups.length === 0 && custom.length === 0) {
        setStatus({ kind: 'empty' });
        return;
      }
      const skipped = rawGroups - groups.length + (rawCustom - custom.length);
      // Custom waypoints merge by id and the local copy wins: something you
      // edited here should not be silently replaced by an older version from
      // the website. Groups are the ordering, so they are taken wholesale —
      // partially merging two orderings produces one that is neither.
      const byId = new Map(custom.map((w) => [w.id, w]));
      for (const local of prefs.customWaypoints) byId.set(local.id, local);
      await onUpdate({
        ...(groups.length > 0 ? { waypointGroups: groups } : {}),
        customWaypoints: [...byId.values()],
      });
      setStatus({ kind: 'imported', groups: groups.length, custom: custom.length, skipped });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Import failed.',
      });
    }
  }, [onUpdate, prefs.customWaypoints]);

  const doSignOut = useCallback(async () => {
    await signOut();
    setSession(null);
    setStatus({ kind: 'idle' });
  }, []);

  const busy = status.kind === 'busy';

  return (
    <div>
      <h1 className="options-h1">Account</h1>
      <p className="options-lede">
        Optional. Everything else in this extension works signed out and contacts no
        Aturi server &mdash; signing in is only for pulling the waypoint setup you
        already have on the website. The extension asks for read-only access and can
        never write to your repository.
      </p>

      <div className="options-card">

      {session ? (
        <>
          <p className="aturi-muted">
            Signed in as <code>{session.did}</code>
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="aturi-btn"
              type="button"
              disabled={busy}
              onClick={() => void doImport()}
            >
              {status.kind === 'busy' && status.what === 'import'
                ? 'Importing…'
                : 'Import waypoint settings'}
            </button>
            <button
              className="aturi-btn"
              type="button"
              disabled={busy}
              onClick={() => void doSignOut()}
            >
              Sign out
            </button>
          </div>
        </>
      ) : (
        <form
          style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            void doSignIn();
          }}
        >
          <input
            className="aturi-input"
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.currentTarget.value)}
            placeholder="your.handle"
            autoComplete="username"
            spellCheck={false}
            disabled={busy}
            aria-label="Your handle"
          />
          <button className="aturi-btn" type="submit" disabled={busy || !handle.trim()}>
            {status.kind === 'busy' && status.what === 'signin' ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}

        {status.kind === 'error' && (
          <p className="aturi-muted" role="alert">
            {status.message}
          </p>
        )}
        {status.kind === 'imported' && (
          <p className="aturi-muted">
            Imported {status.groups} group{status.groups === 1 ? '' : 's'} and{' '}
            {status.custom} custom waypoint{status.custom === 1 ? '' : 's'}.
            {status.skipped > 0 &&
              ` Skipped ${status.skipped} entr${status.skipped === 1 ? 'y' : 'ies'} this version doesn't understand.`}
          </p>
        )}
        {status.kind === 'empty' && (
          <p className="aturi-muted">
            Nothing to import yet &mdash; set up waypoint groups on aturi.to first.
          </p>
        )}
      </div>
    </div>
  );
}
