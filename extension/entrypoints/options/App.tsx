import { useEffect, useState } from 'react';
import { loadPrefs, onPrefsChanged, savePrefs, type Prefs } from '../../lib/prefs';
import DefaultsTab from './tabs/DefaultsTab';
import VisibilityTab from './tabs/VisibilityTab';
import CustomTab from './tabs/CustomTab';
import AboutTab from './tabs/AboutTab';

type TabId = 'defaults' | 'visibility' | 'custom' | 'about';

function AturiMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#8a9a7f"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  );
}

const TABS: { id: TabId; label: string; sub: string }[] = [
  { id: 'defaults', label: 'General', sub: 'Auto-redirect & popup' },
  { id: 'visibility', label: 'Waypoints', sub: 'Hide or show apps' },
  { id: 'custom', label: 'Custom waypoints', sub: 'Add your own sites' },
  { id: 'about', label: 'About', sub: 'Project, credits, feedback' },
];

export default function App() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [tab, setTab] = useState<TabId>('defaults');

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    const unsub = onPrefsChanged(setPrefs);
    return unsub;
  }, []);

  async function update(partial: Partial<Prefs>) {
    const next = await savePrefs(partial);
    setPrefs(next);
  }

  if (!prefs) {
    return (
      <div className="options-root">
        <div className="options-content">Loading...</div>
      </div>
    );
  }

  return (
    <div className="options-root">
      <aside className="options-sidebar">
        <div className="options-brand">
          <div className="options-brand-title">
            <AturiMark />
            <span>Aturi</span>
          </div>
          <div className="options-brand-sub">Settings</div>
        </div>
        <nav className="options-nav">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`options-nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="options-content">
        {tab === 'defaults' && <DefaultsTab prefs={prefs} onChange={update} />}
        {tab === 'visibility' && <VisibilityTab prefs={prefs} onChange={update} />}
        {tab === 'custom' && <CustomTab prefs={prefs} onChange={update} />}
        {tab === 'about' && <AboutTab />}
      </main>
    </div>
  );
}
