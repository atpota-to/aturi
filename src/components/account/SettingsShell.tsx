'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { getReduceMotionSnapshot } from '@/lib/a11y';
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

  // On a phone the tabs are one row that scrolls sideways, and a tab opened
  // from a link (#waypoints) can start out past the edge. Bring the open one
  // into the row, horizontally only; on wider screens the list is a column
  // that never overflows, so this does nothing there.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!nav || !el) return;
    const n = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const delta = r.left < n.left ? r.left - n.left - 16 : r.right > n.right ? r.right - n.right + 16 : 0;
    if (delta) {
      nav.scrollBy({ left: delta, behavior: getReduceMotionSnapshot() ? 'auto' : 'smooth' });
    }
  }, [tab]);

  // The WAI-ARIA tabs pattern, as on the explorer's repository tabs: the
  // list is one tab stop, and the arrow keys (either axis, since the list is
  // a column on desktop and a row on phones), Home and End move between
  // tabs, opening each as it takes focus.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const at = TABS.findIndex((t) => t.id === tab);
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const next =
      e.key in step
        ? (at + step[e.key] + TABS.length) % TABS.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? TABS.length - 1
            : -1;
    if (next < 0) return;
    e.preventDefault();
    pick(TABS[next].id);
    document.getElementById(`settings-tab-${TABS[next].id}`)?.focus();
  }

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="settings-shell">
      <header className="settings-header">
        {/* The site's folder tabs (tabs.css): a row on a baseline on phones,
            a column of side tabs against the content's spine from 821px
            (account.css). The open tab is the one with aria-selected. */}
        <nav
          ref={navRef}
          className="fx-tabs settings-nav"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={onTabKeyDown}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`settings-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="settings-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className="fx-tab"
              onClick={() => pick(t.id)}
            >
              <span className="fx-tab-label" data-label={t.label}>
                {t.label}
              </span>
            </button>
          ))}
        </nav>
      </header>

      {/* The tab panel, not a second <main>: the layout already provides
          the page's main landmark, and this one sat nested inside it. */}
      <div
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        className="settings-content"
      >
        <div className="settings-page-head">
          <h1 className="settings-page-title">{current.label}</h1>
          <p className="settings-page-lede">{current.lede}</p>
        </div>
        {/* Not on the Account tab: there the sign-in card is the page, and
            the note's link would only re-select the tab it is on. */}
        {!did && tab !== 'account' && <LocalModeBanner onSignIn={() => pick('account')} />}
        {tab === 'account' && <AccountTab />}
        {tab === 'general' && <GeneralTab />}
        {tab === 'keyboard' && <KeyboardTab />}
        {tab === 'sections' && <SectionsTab />}
        {tab === 'waypoints' && <WaypointsTab />}
        {tab === 'redirects' && <RedirectsTab />}
        {tab === 'custom' && <CustomTab />}
        {tab === 'about' && <AboutTab />}
      </div>
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
