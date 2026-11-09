'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  Fingerprint,
  History,
  LayoutDashboard,
  Link2,
  Maximize2,
  Minimize2,
  PanelLeft,
  X,
  type LucideIcon,
} from 'lucide-react';
import { resolveIdentifier, type IdentityBundle } from '@/utils/atproto/identity';
import { getProfile, type AppViewProfile } from '@/utils/atproto/appview';
import type { AtRecord } from '@/utils/atproto/pdsClient';
import { rkeyFromAtUri, shortDid } from '@/utils/atproto/urls';
import { parseExplorerPath } from '@/lib/explorerView';
import { getSiteMenuSnapshot, setSiteMenuOpen, subscribeSiteMenu } from '@/lib/siteMenu';
import NotFoundPanel from '@/components/NotFoundPanel';
import { useFillViewport } from '@/components/useFillViewport';
import Breadcrumb from '../Breadcrumb';
import { useChromeBarPanel } from '../ChromeBarContext';
import { CollectionPane } from '../CollectionExplorer';
import CopyButton from '../CopyButton';
import { RecordPane, type RecordPaneTab } from '../RecordExplorer';
import ShareLinkChip from '../ShareLinkChip';
import {
  SkeletonBar,
  SkeletonRecordRows,
  SkeletonTreePane,
} from '../skeletons/primitives';
import CollectionsTab from '../tabs/CollectionsTab';
import { useMediaQuery } from '../useIsNarrow';
import { useRepoCollections } from '../useRepoCollections';
import AccountView, { ACCOUNT_TABS, ACCOUNT_TAB_LABELS, type AccountTab } from './AccountView';
import { FilesSidebar, FolderBrowser, PathBar, useNamespaces } from './FilesBrowser';
import { useFilesLayout } from './useExplorerView';
import ViewSwitch, { FilesLayoutSwitch } from './ViewSwitch';

/**
 * Paired with the media queries in workbench.css. Below desktop width the
 * rail and the open record become drawers over the list rather than columns
 * beside it; on a phone they are sheets that rise out of the bottom toolbar.
 */
const DRAWERS_QUERY = '(max-width: 1023px)';
const PHONE_QUERY = '(max-width: 640px)';

const RAIL_ID = 'fx-wb-rail';
const INSPECTOR_ID = 'fx-wb-inspector';

const ACCOUNT_TAB_ICONS: Record<AccountTab, LucideIcon> = {
  overview: LayoutDashboard,
  identity: Fingerprint,
  audit: History,
  backlinks: Link2,
};

type Props = {
  /** Which of the two full-window layouts to draw. */
  mode: 'workbench' | 'files';
  /** The repo segment as the URL spells it: a handle or a DID. */
  repo: string;
  collection: string | null;
  rkey: string | null;
};

/**
 * The account explorer as one screen: an account, its collections, one
 * collection's records and one record, all in view at once, where the
 * classic layout gives each a page of its own.
 *
 * Laid out as the stream monitor is: a dashboard that fills the window under
 * the site header, so the page never scrolls and the panes do. A toolbar
 * carries the breadcrumb and the view switch; a rail on the left holds the
 * account and the way around its repository; the main pane lists; the open
 * record shows in an inspector on the right.
 *
 * Two layouts share this frame and everything in it but the rail and what
 * the main pane lists:
 *
 *   - `workbench`: the rail is the collections tree, the main pane the
 *     record table.
 *   - `files`: the rail lists places, the main pane shows the open folder
 *     (namespaces, then collections, then records as files, in icons or a
 *     list), with a path bar under it.
 *
 * The URL is the classic explorer's, unchanged, so a link opens the same
 * place in any layout. Moving around inside the shell rewrites it with the
 * History API rather than navigating: the three routes are separate pages to
 * Next, and navigating between them would unmount the shell, throw away the
 * records already fetched and cost a server render for every record stepped
 * through. `onClickCapture` below turns every link to somewhere in this
 * repository into such a move, so the pieces borrowed from the classic pages
 * (the tree, the record rows, the breadcrumb, links inside a record) need no
 * knowledge of where they are hosted.
 */
export default function ExplorerShell({ mode, repo, collection, rkey }: Props) {
  const [identity, setIdentity] = useState<IdentityBundle | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setIdentityError(null);
    resolveIdentifier(repo)
      .then((id) => {
        if (!cancelled) setIdentity(id);
      })
      .catch((err) => {
        if (!cancelled) setIdentityError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  // "/explore/{repo}", with the repo spelled as the address bar has it, so
  // every move stays under the route this shell was mounted for.
  const base = (pathname ?? `/explore/${repo}`).split('/').slice(0, 3).join('/');

  const files = mode === 'files';
  const layout = useFilesLayout();
  const drawers = useMediaQuery(DRAWERS_QUERY);

  // Which account view the main pane shows when no collection is open. The
  // workbench opens on the overview; the Files view opens on the repo's
  // folders and keeps the overview behind `?tab=overview`.
  const tabParam = searchParams.get('tab');
  const accountTab: AccountTab | null = collection
    ? null
    : (ACCOUNT_TABS as readonly string[]).includes(tabParam ?? '')
      ? (tabParam as AccountTab)
      : files
        ? null
        : 'overview';
  const ns = !collection && !accountTab ? searchParams.get('ns') : null;

  const [railOpen, setRailOpen] = useState(false);
  const [railHidden, setRailHidden] = useState(false);
  const [wide, setWide] = useState(false);
  const [recordTab, setRecordTab] = useState<RecordPaneTab>('preview');
  const [removedUri, setRemovedUri] = useState<string | null>(null);
  // What the list beside the inspector is showing, by record key and in
  // order: for stepping, and for opening a record without reading it again.
  const [listed, setListed] = useState<Map<string, AtRecord>>(() => new Map());
  const rkeys = useMemo(() => Array.from(listed.keys()), [listed]);

  const rootRef = useRef<HTMLDivElement>(null);
  useFillViewport(rootRef, '--fx-wb-top');

  // ── Moving around ───────────────────────────────────────────────────────

  const go = useCallback((to: string, replace = false) => {
    if (to === `${window.location.pathname}${window.location.search}`) return;
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
  }, []);

  const recordPath = useCallback(
    (nsid: string, key: string) => `${base}/${nsid}/${encodeURIComponent(key)}`,
    [base],
  );

  // A link to somewhere in this repository moves the shell there instead of
  // leaving the page. Links spell the repo as a handle or a DID; either is
  // this repo, and the move keeps the spelling the address bar has.
  const handle = identity?.handle?.toLowerCase() ?? null;
  const did = identity?.did ?? null;
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
    if (url.origin !== window.location.origin) return;
    const to = parseExplorerPath(url.pathname);
    if (!to) return;
    const seg = to.repo.toLowerCase();
    if (seg !== repo.toLowerCase() && seg !== handle && to.repo !== did) return;
    event.preventDefault();
    const rest = url.pathname.split('/').slice(3).join('/');
    go(`${base}${rest ? `/${rest}` : ''}${url.search}`);
  }

  const closeRecord = useCallback(() => {
    if (collection) go(`${base}/${collection}`);
  }, [collection, base, go]);

  const onVisibleRecords = useCallback((records: AtRecord[]) => {
    const map = new Map<string, AtRecord>();
    for (const rec of records) {
      const key = rkeyFromAtUri(rec.uri);
      if (key) map.set(key, rec);
    }
    setListed(map);
  }, []);

  // Stepping replaces the address rather than adding to the history, so Back
  // returns to the list and not through every record looked at.
  const at = rkey ? rkeys.indexOf(rkey) : -1;
  const step = useCallback(
    (dir: number) => {
      if (!collection || rkeys.length === 0) return;
      const next = at < 0 ? rkeys[0] : rkeys[at + dir];
      if (next) go(recordPath(collection, next), Boolean(rkey));
    },
    [collection, rkeys, at, rkey, go, recordPath],
  );

  // A collection with one record opens it, as the collection page leaves for
  // the record's page. Replaced, so Back doesn't land on the bare list and
  // bounce forward again.
  const onSingleton = useCallback(
    (key: string) => {
      if (collection) go(recordPath(collection, key), true);
    },
    [collection, go, recordPath],
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
  }, [collection, accountTab, ns]);

  // A record only keeps the full width while it's open.
  useEffect(() => {
    if (!rkey) setWide(false);
  }, [rkey]);

  // The site menu is a sheet on the same toolbar: opening it puts the rail's
  // sheet away.
  useEffect(
    () =>
      subscribeSiteMenu(() => {
        if (getSiteMenuSnapshot()) setRailOpen(false);
      }),
    [],
  );

  // On a phone the rail opens from the bottom toolbar, as the stream
  // monitor's filters do.
  useChromeBarPanel({
    label: files ? 'Folders' : 'Collections',
    icon: 'tree',
    count: 0,
    open: railOpen,
    controls: RAIL_ID,
    onToggle: toggleRail,
  });

  // ── Keyboard ────────────────────────────────────────────────────────────

  // J and K step through the records (opening the newest if none is), Escape
  // puts away the top layer. Keys the site's shortcut engine has claimed (it
  // calls preventDefault, and listens first) are left to it, and so is
  // typing.
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
        if (rkey) {
          closeRecord();
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

  // The three routes each set their own title on the server; moving between
  // them here doesn't run that, so the tab's title follows by hand, in the
  // same words.
  useEffect(() => {
    document.title = rkey
      ? `${rkey} · ${collection} · Atmosphere Explorer`
      : collection
        ? `${collection} on ${repo} · Atmosphere Explorer`
        : `${repo} · Atmosphere Explorer`;
  }, [repo, collection, rkey]);

  // ── Files ───────────────────────────────────────────────────────────────

  // The Files view lists folders from the repo's collection names; the
  // workbench's tree reads them itself.
  const collections = useRepoCollections(files && identity ? identity.did : null, identity?.pds);
  const namespaces = useNamespaces(collections);

  // ── Render ──────────────────────────────────────────────────────────────

  if (identityError) {
    return (
      <NotFoundPanel
        eyebrow="Couldn’t resolve"
        headline="That handle didn’t resolve."
        body={`We couldn’t find an account for “${repo}”. Check the spelling, or try a DID or an at:// URI below.`}
        details={identityError}
        initialQuery={repo}
      />
    );
  }

  const inspecting = Boolean(collection && rkey);
  const sharePath = `${base}${collection ? `/${collection}` : ''}${
    collection && rkey ? `/${encodeURIComponent(rkey)}` : ''
  }${!collection && tabParam ? `?tab=${tabParam}` : ns ? `?ns=${encodeURIComponent(ns)}` : ''}`;

  const controls = (
    <>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(-1)}
        disabled={at <= 0}
        aria-label="Newer record"
        title="Newer (K)"
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(1)}
        disabled={at < 0 || at >= rkeys.length - 1}
        aria-label="Older record"
        title="Older (J)"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon fx-wb-widen"
        onClick={() => setWide((v) => !v)}
        aria-pressed={wide}
        aria-label={wide ? 'Return the record to the side' : 'Give the record the full width'}
        title={wide ? 'Return to the side' : 'Full width'}
      >
        {wide ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
      </button>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={closeRecord}
        aria-label="Close record"
        title="Close (Esc)"
      >
        <X size={17} aria-hidden />
      </button>
    </>
  );

  return (
    <div
      ref={rootRef}
      className="fx-wb"
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
          aria-label={files ? 'Sidebar' : 'Collections'}
          title={files ? 'Show or hide the sidebar' : 'Show or hide the collections'}
        >
          <PanelLeft size={17} aria-hidden />
        </button>
        <div className="fx-wb-path">
          {identity ? (
            <Breadcrumb
              handle={identity.handle}
              did={identity.did}
              pds={identity.pds}
              collection={collection ?? undefined}
              rkey={collection && rkey ? rkey : undefined}
              flush
            />
          ) : (
            <SkeletonBar width="16rem" />
          )}
        </div>
        <div className="fx-wb-toolbar-end">
          {files && <FilesLayoutSwitch />}
          <ViewSwitch />
          <ShareLinkChip
            url={sharePath}
            title="Copy a link to this view"
            iconOnly
            className="fx-title-share"
          />
        </div>
      </header>

      <div className="fx-wb-body">
        <aside
          id={RAIL_ID}
          // `fx-side` for the classic sidebar's own rules about the tree in
          // it (the compact rows, the segments a row leaves unsaid).
          className="fx-wb-rail fx-side"
          aria-label={files ? 'Places' : 'Account and collections'}
          inert={drawers ? !railOpen : railHidden}
        >
          <span className="fx-wb-grab" aria-hidden />
          {identity ? (
            <>
              <RailAccount identity={identity} base={base} onDone={() => setRailOpen(false)} />
              <nav aria-label="Account" className="fx-wb-views">
                {ACCOUNT_TABS.map((tab) => {
                  const Icon = ACCOUNT_TAB_ICONS[tab];
                  // The overview is the workbench's bare repo address; the
                  // Files view keeps that for the repo's folders.
                  const href = tab === 'overview' && !files ? base : `${base}?tab=${tab}`;
                  return (
                    <Link
                      key={tab}
                      href={href}
                      prefetch={false}
                      className="fx-wb-view"
                      aria-current={accountTab === tab ? 'page' : undefined}
                    >
                      <Icon size={14} aria-hidden />
                      {ACCOUNT_TAB_LABELS[tab]}
                    </Link>
                  );
                })}
              </nav>
              {files ? (
                <FilesSidebar
                  base={base}
                  namespaces={namespaces}
                  collections={collections}
                  ns={ns}
                  collection={collection}
                />
              ) : (
                <div className="fx-wb-tree">
                  <h2 className="fx-wb-label">Collections</h2>
                  <CollectionsTab
                    identity={identity}
                    variant="sidebar"
                    current={collection ?? undefined}
                    pinnable
                  />
                </div>
              )}
            </>
          ) : (
            <div className="fx-wb-rail-skeleton" aria-hidden>
              <SkeletonBar width="9rem" height="1rem" />
              <SkeletonBar width="6rem" />
              <SkeletonTreePane rows={10} sidebar />
            </div>
          )}
        </aside>

        <section className="fx-wb-main" aria-label={collection ? 'Records' : 'Account'}>
          {!identity ? (
            <div className="fx-wb-main-skeleton" aria-hidden>
              <SkeletonBar width="14rem" height="1.4rem" />
              <SkeletonRecordRows />
            </div>
          ) : collection ? (
            // Keyed, so a new collection starts with a clean list: no stale
            // rows, selection or Live left over from the last one.
            <CollectionPane
              key={collection}
              identity={identity}
              collection={collection}
              display={files && layout === 'icons' ? 'icons' : 'rows'}
              currentRkey={rkey}
              onSingleton={onSingleton}
              onVisibleRecords={onVisibleRecords}
              removedUri={removedUri}
              onOpenWide={() => setWide(true)}
            />
          ) : accountTab ? (
            <AccountView identity={identity} tab={accountTab} />
          ) : (
            <FolderBrowser
              key={ns ?? ''}
              identity={identity}
              base={base}
              namespaces={namespaces}
              loading={collections === null}
              ns={ns}
              layout={layout}
            />
          )}
          {files && identity && (
            <PathBar identity={identity} base={base} ns={ns} collection={collection} rkey={rkey} />
          )}
        </section>

        <aside id={INSPECTOR_ID} className="fx-wb-insp" aria-label="Record" inert={!inspecting}>
          {identity && collection && rkey && (
            // Keyed by record: each one is read, edited and animated in on
            // its own, and only the open tab carries across.
            <RecordPane
              key={`${collection}/${rkey}`}
              identity={identity}
              collection={collection}
              rkey={rkey}
              controls={controls}
              wide={wide}
              tab={recordTab}
              onTab={setRecordTab}
              seed={listed.get(rkey) ?? null}
              onDeleted={() => {
                setRemovedUri(`at://${identity.did}/${collection}/${rkey}`);
                closeRecord();
              }}
            />
          )}
        </aside>

        <div
          className="fx-wb-scrim"
          aria-hidden
          onClick={() => {
            if (railOpen) setRailOpen(false);
            else if (window.matchMedia(PHONE_QUERY).matches || drawers) closeRecord();
          }}
        />
      </div>
    </div>
  );
}

/**
 * The account, in the rail: who this is and their DID to copy. The whole
 * account card (bio, counts, where to open the profile) is the Overview.
 */
function RailAccount({
  identity,
  base,
  onDone,
}: {
  identity: IdentityBundle;
  base: string;
  /** Closes the rail when it is a drawer; the button is hidden when it isn't. */
  onDone: () => void;
}) {
  const [profile, setProfile] = useState<AppViewProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    getProfile(identity.did).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [identity.did]);

  const handle = identity.handle || profile?.handle || null;
  const name = profile?.displayName?.trim() || null;
  const title = name || (handle ? `@${handle}` : shortDid(identity.did));
  const initial = (name || handle || '?').replace(/^@/, '').charAt(0);

  return (
    <div className="fx-wb-acct">
      {profile?.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.avatar} alt="" width={36} height={36} className="fx-avatar" />
      ) : (
        <div aria-hidden className="fx-avatar">
          {initial}
        </div>
      )}
      <div className="fx-wb-acct-names">
        <Link href={base} prefetch={false} className="fx-wb-acct-name" title={title}>
          {title}
        </Link>
        {name && handle && <span className="fx-wb-acct-handle">@{handle}</span>}
      </div>
      <CopyButton value={identity.did} label="Copy DID" compact variant="subtle" iconOnly />
      <button type="button" className="fx-btn fx-btn-sm fx-wb-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
