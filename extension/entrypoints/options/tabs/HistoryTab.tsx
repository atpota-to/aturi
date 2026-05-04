import type { Prefs } from '../../../lib/prefs';
import { clearRecents } from '../../../lib/prefs';
import { findWaypoint } from '../../../lib/catalog';

type Props = {
  prefs: Prefs;
  onChange: (partial: Partial<Prefs>) => void;
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function HistoryTab({ prefs, onChange }: Props) {
  async function handleClear() {
    if (!confirm('Clear all history? This only affects recents ordering in the popup.')) return;
    await clearRecents();
  }

  return (
    <div>
      <h1 className="options-h1">History</h1>
      <p className="options-lede">
        The popup uses this list to surface your most-reached-for waypoints first. Everything
        stays on-device and syncs via your browser&apos;s settings sync.
      </p>

      <div className="options-card">
        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">Track recents</div>
            <div className="options-card-sub">
              Off means the popup won&apos;t show a &quot;Recently used&quot; row and existing history
              stops growing.
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.historyEnabled ? 'on' : ''}`}
            onClick={() => onChange({ historyEnabled: !prefs.historyEnabled })}
            aria-pressed={prefs.historyEnabled}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.historyEnabled ? 'On' : 'Off'}</span>
          </button>
        </div>
      </div>

      <div className="options-card">
        <div className="options-toggle-row" style={{ marginBottom: 14 }}>
          <div>
            <div className="options-card-title">Recents</div>
            <div className="options-card-sub">
              {prefs.recents.length === 0
                ? 'No activity yet.'
                : `${prefs.recents.length} ${prefs.recents.length === 1 ? 'entry' : 'entries'}`}
            </div>
          </div>
          {prefs.recents.length > 0 && (
            <button className="aturi-btn aturi-btn-danger" onClick={handleClear}>
              Clear history
            </button>
          )}
        </div>

        {prefs.recents.length > 0 && (
          <div className="history-list">
            {prefs.recents.map(entry => {
              const w = findWaypoint(prefs, entry.waypointId);
              return (
                <div key={entry.waypointId} className="history-row">
                  <div className="history-name">
                    {w?.name ?? entry.waypointId}
                    {!w && <span className="aturi-subtle"> (removed)</span>}
                  </div>
                  <div className="history-count">
                    {entry.count}x
                  </div>
                  <div className="history-date">{formatDate(entry.lastUsed)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
