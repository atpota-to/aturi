'use client';

import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import AccountTab from './tabs/AccountTab';
import GeneralTab from './tabs/GeneralTab';
import WaypointsTab from './tabs/WaypointsTab';
import CustomTab from './tabs/CustomTab';
import AboutTab from './tabs/AboutTab';

type TabId = 'account' | 'general' | 'waypoints' | 'custom' | 'about';

const TABS: { id: TabId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'general', label: 'General' },
  { id: 'waypoints', label: 'Waypoints' },
  { id: 'custom', label: 'Custom' },
  { id: 'about', label: 'About' },
];

const HASH_TO_TAB: Record<string, TabId> = {
  account: 'account',
  general: 'general',
  waypoints: 'waypoints',
  custom: 'custom',
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
 * /account#waypoints) from elsewhere in the app. Anonymous users land
 * on the General tab by default; the Account tab still works for them
 * but presents the sign-in flow rather than identity info.
 */
export default function SettingsShell() {
  const { did } = useAtprotoSession();
  const [tab, setTab] = useState<TabId>(
    () => tabFromHash() ?? (did ? 'account' : 'general'),
  );

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
      {!did && <LocalModeBanner onSignIn={() => pick('account')} />}
      <header className="settings-header">
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
        {tab === 'custom' && <CustomTab />}
        {tab === 'about' && <AboutTab />}
      </main>
    </div>
  );
}

/**
 * Inline banner at the top of the settings shell for anonymous users.
 * Makes it clear that changes are saved locally only, and points at the
 * Account tab as the place to upgrade to PDS sync.
 */
function LocalModeBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.625rem 0.875rem',
        marginBottom: '1rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        borderLeft: '3px solid var(--text-accent)',
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
        flexWrap: 'wrap',
      }}
    >
      <CloudOff size={14} aria-hidden style={{ color: 'var(--text-accent)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        Settings are saved in this browser only.{' '}
        <button
          type="button"
          onClick={onSignIn}
          style={{
            background: 'transparent',
            border: 0,
            color: 'var(--text-accent)',
            font: 'inherit',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Sign in
        </button>{' '}
        to sync them to your PDS and carry them across devices.
      </span>
    </div>
  );
}
