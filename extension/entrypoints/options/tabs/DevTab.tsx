// Developer tooling: simulate the new-waypoints banner state, inspect
// preferences as raw JSON, and view the cross-context debug log. Intended for
// testing & repro work — most users won't need this, but it's cheap to ship.
import { useEffect, useMemo, useState } from 'react';
import { browser } from '#imports';
import { WAYPOINT_ORDER } from '@aturi/waypoints.data';
import {
  DEFAULT_PREFS,
  defaultWaypointGroups,
  savePrefs,
  type Prefs,
} from '../../../lib/prefs';
import {
  clearDebugLog,
  formatDebugLog,
  getDebugLog,
  subscribeDebugLog,
  type LogEntry,
} from '../../../lib/debugLog';

type Props = {
  prefs: Prefs;
  onChange: (partial: Partial<Prefs>) => void;
};

export default function DevTab({ prefs, onChange }: Props) {
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [forgetId, setForgetId] = useState<string>('');

  useEffect(() => {
    void getDebugLog().then(setLogEntries);
    return subscribeDebugLog(setLogEntries);
  }, []);

  const newIds = useMemo(
    () => WAYPOINT_ORDER.filter(id => !prefs.knownWaypointIds.includes(id)),
    [prefs.knownWaypointIds]
  );

  const forgetCandidates = useMemo(
    () => WAYPOINT_ORDER.filter(id => prefs.knownWaypointIds.includes(id)),
    [prefs.knownWaypointIds]
  );

  const prefsJson = useMemo(() => JSON.stringify(prefs, null, 2), [prefs]);

  const manifest = useMemo(() => {
    try {
      return browser?.runtime?.getManifest?.();
    } catch {
      return undefined;
    }
  }, []);

  function flashCopied(label: string) {
    setCopied(label);
    window.setTimeout(() => {
      setCopied(prev => (prev === label ? null : prev));
    }, 1400);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(label);
    } catch (err) {
      alert(`Copy failed: ${(err as Error).message}`);
    }
  }

  function markAllNew() {
    if (
      !confirm(
        `Mark all ${WAYPOINT_ORDER.length} built-in waypoints as "new"? This will surface the popup banner with every built-in.`
      )
    ) {
      return;
    }
    onChange({ knownWaypointIds: [] });
  }

  function markAllKnown() {
    onChange({ knownWaypointIds: [...WAYPOINT_ORDER] });
  }

  function forgetOne() {
    if (!forgetId) return;
    onChange({
      knownWaypointIds: prefs.knownWaypointIds.filter(id => id !== forgetId),
    });
    setForgetId('');
  }

  function resetAll() {
    if (
      !confirm(
        'Reset ALL preferences to defaults? This wipes everything: custom waypoints, groups, recents, and redirect favorites. Are you sure?'
      )
    ) {
      return;
    }
    void savePrefs({
      ...DEFAULT_PREFS,
      waypointGroups: defaultWaypointGroups(),
      knownWaypointIds: [...WAYPOINT_ORDER],
    });
  }

  return (
    <div>
      <h1 className="options-h1">Dev</h1>
      <p className="options-lede">
        Tools for testing the popup, prefs migrations, and the new-waypoints
        banner. Some actions wipe data, so be deliberate.
      </p>

      <div className="options-card">
        <div className="options-card-title">New-waypoints banner</div>
        <div className="options-card-sub">
          The popup banner is driven by <code>knownWaypointIds</code>: anything
          in <code>WAYPOINT_ORDER</code> but missing from that list shows up as
          "new". Currently <strong>{newIds.length}</strong>{' '}
          waypoint{newIds.length === 1 ? '' : 's'} flagged
          {newIds.length > 0 ? `: ${newIds.join(', ')}` : ''}.
        </div>

        <div className="dev-actions">
          <button className="aturi-btn" onClick={markAllNew}>
            Mark all built-ins as new
          </button>
          <button className="aturi-btn" onClick={markAllKnown}>
            Mark all built-ins as known
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="dev-card-subhead">Forget a specific waypoint</div>
        <div className="dev-card-sub">
          Removes one id from <code>knownWaypointIds</code> so just that
          waypoint shows up as "new" in the popup banner.
        </div>
        <div className="dev-actions">
          <select
            className="dev-select"
            value={forgetId}
            onChange={e => setForgetId(e.target.value)}
            aria-label="Waypoint to forget"
          >
            <option value="">Pick a waypoint…</option>
            {forgetCandidates.map(id => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <button
            className="aturi-btn"
            onClick={forgetOne}
            disabled={!forgetId}
          >
            Forget
          </button>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">Current preferences</div>
        <div className="options-card-sub">
          Raw JSON snapshot of what <code>loadPrefs()</code> returned. Copy this
          when filing bugs.
        </div>
        <pre className="dev-code">{prefsJson}</pre>
        <div className="dev-actions">
          <button
            className="aturi-btn"
            onClick={() => void copyText(prefsJson, 'prefs')}
          >
            {copied === 'prefs' ? 'Copied!' : 'Copy JSON'}
          </button>
          <button className="aturi-btn dev-btn-danger" onClick={resetAll}>
            Reset everything
          </button>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">Debug log</div>
        <div className="options-card-sub">
          In-memory ring buffer (last 200 entries) persisted to
          <code> chrome.storage.local</code> so popup, options, and background
          events all show up here. Refreshes live.
        </div>
        <pre className="dev-code dev-log">
          {logEntries.length === 0
            ? '(empty)'
            : formatDebugLog(logEntries)}
        </pre>
        <div className="dev-actions">
          <button
            className="aturi-btn"
            onClick={() =>
              void copyText(formatDebugLog(logEntries), 'log')
            }
            disabled={logEntries.length === 0}
          >
            {copied === 'log' ? 'Copied!' : 'Copy log'}
          </button>
          <button
            className="aturi-btn aturi-btn-ghost"
            onClick={() => void clearDebugLog()}
            disabled={logEntries.length === 0}
          >
            Clear log
          </button>
        </div>
      </div>

      <div className="options-card">
        <div className="options-card-title">Environment</div>
        <div className="dev-info">
          <div className="dev-info-row">
            <span className="dev-info-label">Extension</span>
            <code>
              {manifest?.name ?? '?'} {manifest?.version ?? '?'}
            </code>
          </div>
          <div className="dev-info-row">
            <span className="dev-info-label">Built-in waypoints</span>
            <code>{WAYPOINT_ORDER.length}</code>
          </div>
          <div className="dev-info-row">
            <span className="dev-info-label">Custom waypoints</span>
            <code>{prefs.customWaypoints.length}</code>
          </div>
          <div className="dev-info-row">
            <span className="dev-info-label">Known built-ins</span>
            <code>
              {prefs.knownWaypointIds.length} / {WAYPOINT_ORDER.length}
            </code>
          </div>
          <div className="dev-info-row">
            <span className="dev-info-label">User agent</span>
            <code className="dev-info-mono">
              {typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
