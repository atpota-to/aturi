'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight, ChevronUp, Clock, Maximize2, Minimize2, PanelLeft, Server, X } from 'lucide-react';
import {
  COMMIT_WINDOW_LABELS,
  isPdsPath,
  parsePdsLocation,
  PDS_TAB_LABELS,
  pdsAddress,
  pdsTitle,
  statusLabel,
  type PdsLocation,
  type PdsTab,
} from '@/lib/pdsExplorer';
import { getSiteMenuSnapshot, setSiteMenuOpen, subscribeSiteMenu } from '@/lib/siteMenu';
import { normalizePdsBase, pdsHostname } from '@/utils/atproto/pdsServer';
import { shortDid } from '@/utils/atproto/urls';
import { useRelayStatuses } from '@/components/tools/RelayStatusList';
import { useFillViewport } from '@/components/useFillViewport';
import { useChromeBarPanel } from '../ChromeBarContext';
import ShareLinkChip from '../ShareLinkChip';
import { useMediaQuery } from '../useIsNarrow';
import { FolderGlyph } from '../workbench/FileIcons';
import { useFilesLayout } from '../workbench/useExplorerView';
import ViewSwitch, { FilesLayoutSwitch } from '../workbench/ViewSwitch';
import AccountPane from './AccountPane';
import AccountsPane, { type AddressPatch } from './AccountsPane';
import { relayAccountCount } from './parts';
import PdsOverview, { PdsRelays } from './PdsOverview';
import PdsRail from './PdsRail';
import { nameOf, useAccountRows, useNamesVersion, usePdsRepos, usePdsServer } from './usePdsData';

/** Paired with the media queries in workbench.css, as ExplorerShell's are. */
const DRAWERS_QUERY = '(max-width: 1023px)';
const PHONE_QUERY = '(max-width: 640px)';

const RAIL_ID = 'fx-pd-rail';
const INSPECTOR_ID = 'fx-pd-inspector';

const ACCOUNT_KEYS = ['status', 'commit', 'sort', 'desc', 'account'] as const;

/**
 * A PDS as one screen, in the account explorer's frame (ExplorerShell): a
 * toolbar with where you are and how it's shown, a rail with the host and
 * the way around its accounts, a main pane, and the account open in an
 * inspector beside it. Below desktop width the rail and the inspector are
 * drawers; on a phone they are sheets that rise from the bottom toolbar.
 *
 * The host has three views: the overview (what it says about itself, and
 * what its listing and the relays say about its accounts), its accounts,
 * and its relays. The accounts can be filtered by how they stand and when
 * they last committed, and sorted; all of it is in the address
 * (src/lib/pdsExplorer.ts), which every view reads, Classic included.
 *
 *   - `workbench`: opens on the overview. An account opens beside the list,
 *     to step through with J and K, and its repository is a click away.
 *   - `files`: opens on the accounts, each a folder. Opening one goes into
 *     its repository, where the account explorer's path bar leads back.
 *
 * Moving around rewrites the address with the History API rather than
 * navigating, for the reason ExplorerShell gives: the listing is loaded
 * once and kept. `onClickCapture` turns any link to this host's page into
 * such a move.
 */
export default function PdsShell({ mode, host }: { mode: 'workbench' | 'files'; host: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fallback = useMemo(
    () => parsePdsLocation(`/explore/pds/${encodeURIComponent(host)}`, new URLSearchParams()) as PdsLocation,
    [host],
  );
  const loc = useMemo(() => {
    const read = parsePdsLocation(pathname, searchParams);
    return read && read.host.toLowerCase() === host.toLowerCase() ? read : fallback;
  }, [pathname, searchParams, host, fallback]);

  const files = mode === 'files';
  const defaultTab: PdsTab = files ? 'accounts' : 'overview';
  const tab = loc.tab ?? defaultTab;
  const base = normalizePdsBase(host);
  const hostname = pdsHostname(base);
  const layout = useFilesLayout();
  const drawers = useMediaQuery(DRAWERS_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);

  const server = usePdsServer(base);
  const listing = usePdsRepos(base);
  const rows = useAccountRows(listing.repos);
  const rowByDid = useMemo(() => new Map(rows.map((r) => [r.did, r])), [rows]);
  useNamesVersion();
  // What the relays know of the host, once it has answered as a PDS: a name
  // that isn't one would only collect four "not known"s.
  const relays = useRelayStatuses(server.info ? hostname : null);
  const relayCount = relayAccountCount(relays.results);

  const [railOpen, setRailOpen] = useState(false);
  const [railHidden, setRailHidden] = useState(false);
  const [wide, setWide] = useState(false);
  // The accounts the main pane lists, in order, for stepping through.
  const [listed, setListed] = useState<string[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);
  useFillViewport(rootRef, '--fx-wb-top');

  // ── Moving around ───────────────────────────────────────────────────────

  const go = useCallback((to: string, replace = false) => {
    if (to === `${window.location.pathname}${window.location.search}`) return;
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
  }, []);

  /**
   * The address of somewhere else on this host. Anything about the accounts
   * goes to the accounts view, unless the patch names another.
   */
  const addressFor = useCallback(
    (patch: AddressPatch) => {
      const touchesAccounts = ACCOUNT_KEYS.some((key) => key in patch);
      const next: PdsLocation = { ...loc, ...patch, tab: patch.tab ?? (touchesAccounts ? 'accounts' : loc.tab) };
      return pdsAddress(next, defaultTab);
    },
    [loc, defaultTab],
  );

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin || !isPdsPath(url.pathname)) return;
    const to = parsePdsLocation(url.pathname, url.searchParams);
    // Another host is another page.
    if (!to || to.host.toLowerCase() !== host.toLowerCase()) return;
    event.preventDefault();
    go(pdsAddress(to, defaultTab));
  }

  const closeAccount = useCallback(() => go(addressFor({ account: null })), [go, addressFor]);
  const onVisible = useCallback((dids: string[]) => setListed(dids), []);

  // Stepping replaces the address, so Back returns to the list rather than
  // through every account looked at.
  const account = tab === 'accounts' ? loc.account : null;
  const index = account ? listed.indexOf(account) : -1;
  const step = useCallback(
    (dir: number) => {
      if (tab !== 'accounts' || listed.length === 0) return;
      const next = index < 0 ? listed[0] : listed[index + dir];
      if (next) go(addressFor({ account: next }), Boolean(account));
    },
    [tab, listed, index, go, addressFor, account],
  );

  // ── Panels ──────────────────────────────────────────────────────────────

  function toggleRail() {
    if (drawers) {
      setSiteMenuOpen(false);
      setRailOpen((v) => !v);
    } else {
      setRailHidden((v) => !v);
    }
  }

  // Picking somewhere in the rail's drawer puts the drawer away.
  useEffect(() => {
    setRailOpen(false);
  }, [tab, loc.status, loc.commit]);

  useEffect(() => {
    if (!account) setWide(false);
  }, [account]);

  useEffect(
    () =>
      subscribeSiteMenu(() => {
        if (getSiteMenuSnapshot()) setRailOpen(false);
      }),
    [],
  );

  useChromeBarPanel({
    label: 'Browse',
    icon: 'tree',
    count: (loc.status !== 'all' ? 1 : 0) + (loc.commit ? 1 : 0),
    open: railOpen,
    controls: RAIL_ID,
    onToggle: toggleRail,
  });

  // ── Keyboard ────────────────────────────────────────────────────────────

  // J and K step through the accounts (opening the first if none is open),
  // Escape puts away the top layer: the rail's drawer, then the account.
  // Typing, and keys the site's shortcut engine has claimed, are left alone.
  const keys = useRef<{ step: (dir: number) => void; escape: () => boolean }>({
    step: () => {},
    escape: () => false,
  });
  useEffect(() => {
    keys.current = {
      step,
      escape: () => {
        if (drawers && railOpen) {
          setRailOpen(false);
          return true;
        }
        if (account) {
          closeAccount();
          return true;
        }
        return false;
      },
    };
  });
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]')) return;
      if (e.key === 'Escape') {
        if (keys.current.escape()) e.preventDefault();
      } else if (e.key === 'j' || e.key === 'J') {
        keys.current.step(1);
      } else if (e.key === 'k' || e.key === 'K') {
        keys.current.step(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Title ───────────────────────────────────────────────────────────────

  useEffect(() => {
    document.title = pdsTitle(host, tab);
  }, [host, tab]);

  // ── Render ──────────────────────────────────────────────────────────────

  const inspecting = Boolean(account);
  const display = files && layout === 'icons' ? 'icons' : 'rows';

  const controls = (
    <>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(-1)}
        disabled={index <= 0}
        aria-label="Previous account"
        title="Previous (K)"
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(1)}
        disabled={index < 0 || index >= listed.length - 1}
        aria-label="Next account"
        title="Next (J)"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon fx-wb-widen"
        onClick={() => setWide((v) => !v)}
        aria-pressed={wide}
        aria-label={wide ? 'Return the account to the side' : 'Give the account the full width'}
        title={wide ? 'Return to the side' : 'Full width'}
      >
        {wide ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
      </button>
      <button type="button" className="fx-wb-icon" onClick={closeAccount} aria-label="Close account" title="Close (Esc)">
        <X size={17} aria-hidden />
      </button>
    </>
  );

  return (
    <div
      ref={rootRef}
      className="fx-wb fx-pd"
      data-mode={mode}
      data-rail={railOpen || undefined}
      data-norail={railHidden || undefined}
      data-inspect={inspecting || undefined}
      data-wide={(inspecting && wide) || undefined}
      onClickCapture={onClickCapture}
    >
      <header className="fx-wb-toolbar">
        <button
          type="button"
          className="fx-wb-icon fx-wb-rail-toggle"
          onClick={toggleRail}
          aria-expanded={drawers ? railOpen : !railHidden}
          aria-controls={RAIL_ID}
          aria-label="Sidebar"
          title="Show or hide the sidebar"
        >
          <PanelLeft size={17} aria-hidden />
        </button>
        <div className="fx-wb-path">
          <PdsCrumbs host={host} loc={loc} tab={tab} addressFor={addressFor} phone={phone} />
        </div>
        <div className="fx-wb-toolbar-end">
          {files && tab === 'accounts' && <FilesLayoutSwitch />}
          <ViewSwitch />
          <ShareLinkChip
            url={pdsAddress(loc, defaultTab)}
            title="Copy a link to this view"
            iconOnly
            className="fx-title-share"
          />
        </div>
      </header>

      <div className="fx-wb-body">
        <aside
          id={RAIL_ID}
          className="fx-wb-rail fx-side"
          aria-label="The PDS and its accounts"
          inert={drawers ? !railOpen : railHidden}
        >
          <span className="fx-wb-grab" aria-hidden />
          <PdsRail
            base={base}
            host={host}
            loc={loc}
            tab={tab}
            addressFor={addressFor}
            files={files}
            onDone={() => setRailOpen(false)}
          />
        </aside>

        <section className="fx-wb-main" aria-label={PDS_TAB_LABELS[tab]}>
          {tab === 'overview' ? (
            <PdsOverview
              base={base}
              host={host}
              addressFor={addressFor}
              relays={server.info ? relays.results : []}
              relayCount={relayCount}
            />
          ) : tab === 'relays' ? (
            <PdsRelays base={base} relays={relays.results} loading={relays.loading} rerun={relays.rerun} />
          ) : (
            <AccountsPane
              base={base}
              loc={loc}
              addressFor={addressFor}
              go={go}
              display={display}
              files={files}
              onVisible={onVisible}
              relayCount={relayCount}
            />
          )}
          {files && <PdsPathBar host={host} loc={loc} tab={tab} addressFor={addressFor} />}
        </section>

        <aside id={INSPECTOR_ID} className="fx-wb-insp" aria-label="Account" inert={!inspecting}>
          {account && (
            <AccountPane
              key={account}
              base={base}
              did={account}
              row={rowByDid.get(account) ?? null}
              controls={controls}
              wide={wide}
            />
          )}
        </aside>

        <div
          className="fx-wb-scrim"
          aria-hidden
          onClick={() => {
            if (railOpen) setRailOpen(false);
            else if (drawers) closeAccount();
          }}
        />
      </div>
      {/* Read by screen readers when stepping changes what's open. */}
      <span className="fx-sr" aria-live="polite">
        {account ? `${accountLabel(account)} open` : ''}
      </span>
    </div>
  );
}

function accountLabel(did: string): string {
  const handle = nameOf(did)?.handle;
  return handle ? `@${handle}` : shortDid(did);
}

/** The filters a list of accounts is under, as words for a crumb. */
function filterWords(loc: PdsLocation): string | null {
  const parts: string[] = [];
  if (loc.status !== 'all') parts.push(statusLabel(loc.status));
  if (loc.commit) parts.push(COMMIT_WINDOW_LABELS[loc.commit].toLowerCase());
  if (!parts.length) return null;
  return parts.join(', ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Where you are: the host, the view, the filters it's under, and the open
 * account. On a phone the account steps aside, since its sheet names it.
 */
function PdsCrumbs({
  host,
  loc,
  tab,
  addressFor,
  phone,
}: {
  host: string;
  loc: PdsLocation;
  tab: PdsTab;
  addressFor: (patch: AddressPatch) => string;
  phone: boolean;
}) {
  const crumbs: { label: string; href: string | null; mono?: boolean; server?: boolean }[] = [
    { label: host, href: addressFor({ tab: 'overview' }), mono: true, server: true },
  ];
  if (tab !== 'overview') {
    crumbs.push({ label: PDS_TAB_LABELS[tab], href: addressFor({ tab, status: 'all', commit: null, account: null }) });
  }
  const filters = tab === 'accounts' ? filterWords(loc) : null;
  if (filters) crumbs.push({ label: filters, href: addressFor({ account: null }) });
  if (tab === 'accounts' && loc.account && !phone) {
    crumbs.push({ label: accountLabel(loc.account), href: null, mono: true });
  }
  crumbs[crumbs.length - 1].href = null;

  return (
    <nav aria-label="Breadcrumb" className="fx-crumbs">
      {crumbs.map((crumb, i) => (
        <span key={`${i}-${crumb.label}`} className="fx-crumb" data-mono={crumb.mono || undefined}>
          {crumb.href ? (
            <Link href={crumb.href} prefetch={false}>
              {crumb.server && <Server size={12} aria-hidden />}
              {crumb.label}
            </Link>
          ) : (
            <span className="fx-crumb-here" aria-current="page">
              {crumb.server && <Server size={12} aria-hidden />}
              {crumb.label}
            </span>
          )}
          {i < crumbs.length - 1 && (
            <span aria-hidden className="fx-crumb-sep">
              /
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * The Files view's path bar: the host as the drive, its accounts as the
 * folder at the top, and the filters as folders inside it. An account's own
 * path bar (FilesBrowser.tsx) starts at the same host and leads back here.
 */
function PdsPathBar({
  host,
  loc,
  tab,
  addressFor,
}: {
  host: string;
  loc: PdsLocation;
  tab: PdsTab;
  addressFor: (patch: AddressPatch) => string;
}) {
  const sep = <ChevronRight size={12} aria-hidden className="fx-fd-path-sep" />;
  const status = tab === 'accounts' && loc.status !== 'all' ? loc.status : null;
  const commit = tab === 'accounts' ? loc.commit : null;
  return (
    <nav aria-label="Path" className="fx-fd-path">
      <Link
        href={addressFor({ tab: 'overview' })}
        prefetch={false}
        className="fx-fd-crumb"
        aria-current={tab === 'overview' ? 'page' : undefined}
      >
        <Server size={12} aria-hidden />
        {host}
      </Link>
      {tab !== 'overview' && (
        <>
          {sep}
          <Link
            href={addressFor({ tab, status: 'all', commit: null, account: null })}
            prefetch={false}
            className="fx-fd-crumb"
            aria-current={!status && !commit ? 'page' : undefined}
          >
            <FolderGlyph />
            {PDS_TAB_LABELS[tab]}
          </Link>
        </>
      )}
      {status && (
        <>
          {sep}
          <Link
            href={addressFor({ commit: null, account: null })}
            prefetch={false}
            className="fx-fd-crumb"
            aria-current={!commit ? 'page' : undefined}
          >
            <FolderGlyph />
            {statusLabel(status)}
          </Link>
        </>
      )}
      {commit && (
        <>
          {sep}
          <span className="fx-fd-crumb" aria-current="page">
            <Clock size={12} aria-hidden />
            {COMMIT_WINDOW_LABELS[commit]}
          </span>
        </>
      )}
    </nav>
  );
}
