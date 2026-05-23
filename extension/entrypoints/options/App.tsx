import { useEffect, useState } from 'react';
import { loadPrefs, onPrefsChanged, savePrefs, type Prefs } from '../../lib/prefs';
import { applyAppearance } from '../../lib/appearance';
import DefaultsTab from './tabs/DefaultsTab';
import VisibilityTab from './tabs/VisibilityTab';
import CustomTab from './tabs/CustomTab';
import AboutTab from './tabs/AboutTab';
import DevTab from './tabs/DevTab';

type TabId = 'defaults' | 'visibility' | 'custom' | 'about' | 'dev';

function AturiMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
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

const TABS: { id: TabId; label: string }[] = [
  { id: 'defaults', label: 'General' },
  { id: 'visibility', label: 'Waypoints' },
  { id: 'custom', label: 'Custom' },
  { id: 'about', label: 'About' },
  { id: 'dev', label: 'Dev' },
];

// Map URL hash → tab id. Lets the popup deep-link to Settings → Waypoints when
// the user clicks "Add" on the new-waypoints banner.
const HASH_TO_TAB: Record<string, TabId> = {
  general: 'defaults',
  defaults: 'defaults',
  waypoints: 'visibility',
  visibility: 'visibility',
  custom: 'custom',
  about: 'about',
  dev: 'dev',
};

function tabFromHash(): TabId | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '').toLowerCase();
  return HASH_TO_TAB[hash] ?? null;
}

export default function App() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [tab, setTab] = useState<TabId>(() => tabFromHash() ?? 'defaults');

  useEffect(() => {
    void loadPrefs().then(setPrefs);
    const unsub = onPrefsChanged(setPrefs);
    return unsub;
  }, []);

  useEffect(() => {
    function onHashChange() {
      const next = tabFromHash();
      if (next) setTab(next);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (prefs) applyAppearance(prefs);
  }, [prefs?.theme, prefs?.fontSize]);

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
      <header className="options-header">
        <div className="options-brand">
          <div className="options-brand-title">
            <AturiMark />
            <span>Aturi</span>
          </div>
          <div className="options-brand-sub">Settings</div>
        </div>
        <nav className="options-nav" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`options-nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="options-content">
        {tab === 'defaults' && <DefaultsTab prefs={prefs} onChange={update} />}
        {tab === 'visibility' && <VisibilityTab prefs={prefs} onChange={update} />}
        {tab === 'custom' && <CustomTab prefs={prefs} onChange={update} />}
        {tab === 'about' && <AboutTab />}
        {tab === 'dev' && <DevTab prefs={prefs} onChange={update} />}
      </main>
    </div>
  );
}
