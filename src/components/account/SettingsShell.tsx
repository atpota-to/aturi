'use client';

import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import AccountTab from './tabs/AccountTab';
import GeneralTab from './tabs/GeneralTab';
import KeyboardTab from './tabs/KeyboardTab';
import SectionsTab from './tabs/SectionsTab';
import WaypointsTab from './tabs/WaypointsTab';
import RedirectsTab from './tabs/RedirectsTab';
import CustomTab from './tabs/CustomTab';
import AboutTab from './tabs/AboutTab';

type TabId =
  | 'account'
  | 'general'
  | 'keyboard'
  | 'sections'
  | 'waypoints'
  | 'redirects'
  | 'custom'
  | 'about';

const TABS: { id: TabId; label: string; lede: string }[] = [
  { id: 'account', label: 'Account', lede: 'Your identity, your repo and where your settings are kept.' },
  { id: 'general', label: 'General', lede: 'How Aturi looks, what it tells you about, and how the explorer behaves.' },
  { id: 'keyboard', label: 'Keyboard', lede: 'Shortcuts, chords and the command palette.' },
  { id: 'sections', label: 'Sections', lede: 'Which sections the explorer pages show, and in what order.' },
  { id: 'waypoints', label: 'Waypoints', lede: 'The groups and layout of the universal-link picker.' },
  { id: 'redirects', label: 'Redirects', lede: 'Open links straight in the client you prefer.' },
  { id: 'custom', label: 'Custom', lede: 'Your own waypoints, written as URL templates.' },
  { id: 'about', label: 'About', lede: 'What Aturi is, and where to read more.' },
];

const HASH_TO_TAB: Record<string, TabId> = {
  account: 'account',
  general: 'general',
  keyboard: 'keyboard',
  sections: 'sections',
  waypoints: 'waypoints',
  redirects: 'redirects',
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

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="settings-shell">
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
        <div className="settings-page-head">
          <h1 className="settings-page-title">{current.label}</h1>
          <p className="settings-page-lede">{current.lede}</p>
        </div>
        {!did && <LocalModeBanner onSignIn={() => pick('account')} />}
        {tab === 'account' && <AccountTab />}
        {tab === 'general' && <GeneralTab />}
        {tab === 'keyboard' && <KeyboardTab />}
        {tab === 'sections' && <SectionsTab />}
        {tab === 'waypoints' && <WaypointsTab />}
        {tab === 'redirects' && <RedirectsTab />}
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
    <div className="settings-local-banner">
      <CloudOff size={15} aria-hidden className="settings-local-banner-icon" />
      <span className="settings-local-banner-text">
        Settings are saved in this browser only.{' '}
        <button type="button" onClick={onSignIn} className="settings-local-banner-link">
          Sign in
        </button>{' '}
        to sync them to your PDS and carry them across devices.
      </span>
    </div>
  );
}
