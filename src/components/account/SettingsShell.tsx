'use client';

import { useEffect, useState } from 'react';
import AccountTab from './tabs/AccountTab';
import GeneralTab from './tabs/GeneralTab';
import WaypointsTab from './tabs/WaypointsTab';
import AboutTab from './tabs/AboutTab';

type TabId = 'account' | 'general' | 'waypoints' | 'about';

const TABS: { id: TabId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'general', label: 'General' },
  { id: 'waypoints', label: 'Waypoints' },
  { id: 'about', label: 'About' },
];

const HASH_TO_TAB: Record<string, TabId> = {
  account: 'account',
  general: 'general',
  waypoints: 'waypoints',
  about: 'about',
};

function tabFromHash(): TabId | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '').toLowerCase();
  return HASH_TO_TAB[hash] ?? null;
}

/**
 * Tabbed settings shell mirroring the extension's options UI.
 * Hash-based deep-linking lets us link straight to a tab (e.g.
 * /account#waypoints) from elsewhere in the app.
 */
export default function SettingsShell() {
  const [tab, setTab] = useState<TabId>(() => tabFromHash() ?? 'account');

  useEffect(() => {
    function onHashChange() {
      const next = tabFromHash();
      if (next) setTab(next);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function pick(id: TabId) {
    setTab(id);
    if (typeof window !== 'undefined') {
      // Update hash without scrolling — `replaceState` keeps the URL clean
      // and skips adding a history entry per tab click.
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState(null, '', url.toString());
    }
  }

  return (
    <div className="settings-shell">
      <header className="settings-header">
        <div className="settings-brand">
          <h1 className="settings-brand-title">Aturi</h1>
          <span className="settings-brand-sub">Settings</span>
        </div>
        <nav className="settings-nav" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`settings-nav-item ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => pick(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="settings-content">
        {tab === 'account' && <AccountTab />}
        {tab === 'general' && <GeneralTab />}
        {tab === 'waypoints' && <WaypointsTab />}
        {tab === 'about' && <AboutTab />}
      </main>
    </div>
  );
}
