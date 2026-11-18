import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import { loadPrefs, onPrefsChanged, savePrefs, type Prefs } from '../../lib/prefs';
import { applyAppearance } from '../../lib/appearance';
import { newBuiltinWaypoints, visibleWaypointIds } from '../../lib/catalog';
import DefaultsTab from './tabs/DefaultsTab';
import VisibilityTab from './tabs/VisibilityTab';
import CustomTab from './tabs/CustomTab';
import AboutTab from './tabs/AboutTab';
import DevTab from './tabs/DevTab';

type TabId = 'defaults' | 'visibility' | 'custom' | 'about' | 'dev';

function AturiMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
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
  { id: 'custom', label: 'Custom waypoints' },
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

  // At narrow widths the tabs are one row that scrolls sideways, and a tab
  // opened from a link (#dev from the popup, say) can start out past the
  // edge. Bring the open one into the row, horizontally only, as the site's
  // settings page does. The row's 16px end padding is also where the edge
  // fade sits, so a tab counts as in view only inside that inset. On wider
  // screens the nav is a column that never overflows, so this does nothing.
  const navRef = useRef<HTMLElement>(null);
  const loaded = prefs !== null;
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!nav || !el) return;
    const inset = 16;
    const n = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const delta =
      r.left < n.left + inset
        ? r.left - n.left - inset
        : r.right > n.right - inset
          ? r.right - n.right + inset
          : 0;
    if (delta) {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      nav.scrollBy({ left: delta, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }, [tab, loaded]);

  async function update(partial: Partial<Prefs>) {
    const next = await savePrefs(partial);
    setPrefs(next);
  }

  // The WAI-ARIA tabs pattern, as on the site's settings page: the list is
  // one tab stop, and the arrow keys (either axis, since the list is a
  // column on wide windows and a row on narrow ones), Home and End move
  // between tabs, opening each as it takes focus.
  function onTabKeyDown(e: KeyboardEvent<HTMLElement>) {
    const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const at = TABS.findIndex(t => t.id === tab);
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
    setTab(TABS[next].id);
    document.getElementById(`options-tab-${TABS[next].id}`)?.focus();
  }

  // Same count the Waypoints tab's "new waypoints" card shows: built-ins
  // added since the user last looked that sit in no group yet.
  const newCount = prefs
    ? (() => {
        const visible = visibleWaypointIds(prefs);
        return newBuiltinWaypoints(prefs).filter(w => !visible.has(w.id)).length;
      })()
    : 0;
  const current = TABS.find(t => t.id === tab) ?? TABS[0];

  return (
    <div className="options-root">
      <header className="options-header">
        <div className="options-brand">
          <div className="options-brand-title">
            <AturiMark />
            <span>aturi</span>
          </div>
          <span className="options-brand-divider" aria-hidden="true" />
          <div className="options-brand-sub">Extension settings</div>
        </div>
        <nav className="options-header-links" aria-label="Elsewhere">
          <a href="https://aturi.to" target="_blank" rel="noreferrer">
            aturi.to <ExternalLink size={12} aria-hidden="true" />
          </a>
          <a href="https://github.com/atpota-to/aturi/issues" target="_blank" rel="noreferrer">
            Send feedback
          </a>
        </nav>
      </header>

      <div className="options-layout">
        {/* The site's folder tabs (options.css): a column of side tabs
            against the content's spine on wide windows, a row on a baseline
            below 821px. The open tab is the one with aria-selected. */}
        <nav
          ref={navRef}
          className="options-nav"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={onTabKeyDown}
        >
          {TABS.map(t => (
            <button
              key={t.id}
              id={`options-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="options-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className={`options-nav-item ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="options-nav-label" data-label={t.label}>
                {t.label}
              </span>
              {t.id === 'visibility' && newCount > 0 && (
                <span className="options-nav-badge">{newCount} new</span>
              )}
            </button>
          ))}
        </nav>

        {/* The landmark stays <main>; the tab panel is the box inside it.
            While prefs load it holds the page head only, so the header and
            the nav are on screen from the first paint and nothing jumps. */}
        <main className="options-content">
          <div
            id="options-panel"
            className="options-panel"
            role="tabpanel"
            aria-labelledby={`options-tab-${tab}`}
            aria-busy={prefs ? undefined : true}
          >
            {!prefs && (
              <div className="options-page">
                <div className="options-page-head">
                  <h1 className="options-h1">{current.label}</h1>
                </div>
              </div>
            )}
            {prefs && tab === 'defaults' && <DefaultsTab prefs={prefs} onChange={update} />}
            {prefs && tab === 'visibility' && <VisibilityTab prefs={prefs} onChange={update} />}
            {prefs && tab === 'custom' && <CustomTab prefs={prefs} onChange={update} />}
            {prefs && tab === 'about' && <AboutTab />}
            {prefs && tab === 'dev' && <DevTab prefs={prefs} onChange={update} />}
          </div>
        </main>
      </div>
    </div>
  );
}
