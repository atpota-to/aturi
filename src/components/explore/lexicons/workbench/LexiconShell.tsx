'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Braces, ChevronDown, ChevronUp, Maximize2, Minimize2, PanelLeft, X } from 'lucide-react';
import { parsePeek } from '@/lib/explorerView';
import {
  DEFAULT_LEXICON_LIST,
  homeScopeFor,
  isLexiconPath,
  LEXICON_LIST_LABELS,
  lexiconAddress,
  lexiconTitle,
  parseLexiconLocation,
  sameScope,
  type LexiconLocation,
  type LexiconScope,
} from '@/lib/lexiconExplorer';
import { getSiteMenuSnapshot, setSiteMenuOpen, subscribeSiteMenu } from '@/lib/siteMenu';
import { useFillViewport } from '@/components/useFillViewport';
import type { Metric } from '@/utils/ufos/config';
import { WINDOWS, type Window } from '@/utils/ufos/windows';
import { useChromeBarPanel } from '../../ChromeBarContext';
import type { RecordPaneTab } from '../../RecordExplorer';
import ShareLinkChip from '../../ShareLinkChip';
import { useMediaQuery } from '../../useIsNarrow';
import { FileGlyph, FolderGlyph, fileKindOf } from '../../workbench/FileIcons';
import { PeekPane } from '../../workbench/LinksView';
import { useFilesLayout } from '../../workbench/useExplorerView';
import ViewSwitch, { FilesLayoutSwitch } from '../../workbench/ViewSwitch';
import { Segmented } from '../primitives';
import LexiconListPane from './LexiconLists';
import LexiconPane, { type LexiconTab } from './LexiconPane';
import LexiconRail, { type AddressFor } from './LexiconRail';
import LexiconRecordsView from './LexiconRecords';

/** Paired with the media queries in workbench.css, as ExplorerShell's are. */
const DRAWERS_QUERY = '(max-width: 1023px)';
const PHONE_QUERY = '(max-width: 640px)';

const RAIL_ID = 'fx-lx-rail';
const INSPECTOR_ID = 'fx-lx-inspector';

const WINDOW_OPTIONS = (Object.keys(WINDOWS) as Window[]).map((w) => ({ value: w, label: WINDOWS[w].label }));

/**
 * The lexicons explorer as one screen, in the account explorer's frame
 * (ExplorerShell): a toolbar with where you are and how it's shown, a rail
 * of places, a list in the main pane, and the open lexicon in an inspector
 * beside it. Below desktop width the rail and the inspector are drawers; on
 * a phone they are sheets that rise from the bottom toolbar.
 *
 * Places are lists of lexicons: the network-wide Trending, Top, New and All,
 * a namespace, or a search. Any of them can have a lexicon open beside it,
 * and an open lexicon's recent records can take the main pane, with one of
 * those open in the inspector in turn. All of it is in the address
 * (src/lib/lexiconExplorer.ts), and the three routes it can be are the
 * classic pages' own, so a link opens the same place in every view.
 *
 * Moving around rewrites the address with the History API rather than
 * navigating, for the reason ExplorerShell gives: the routes are separate
 * pages to Next, and going between them would unmount the shell and drop
 * every list it has loaded. `onClickCapture` turns any link to a lexicon
 * address into such a move, and a record marked `data-peek` into opening it
 * beside its list.
 */
export default function LexiconShell({ mode, fallback }: { mode: 'workbench' | 'files'; fallback: LexiconLocation }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const loc = useMemo(
    () => parseLexiconLocation(pathname, searchParams) ?? fallback,
    [pathname, searchParams, fallback],
  );
  const { nsid, records, peek } = loc;
  const peekKey = peek ? `${peek.did}/${peek.collection}/${peek.rkey}` : null;

  const files = mode === 'files';
  const layout = useFilesLayout();
  const drawers = useMediaQuery(DRAWERS_QUERY);
  const phone = useMediaQuery(PHONE_QUERY);

  const [railOpen, setRailOpen] = useState(false);
  const [railHidden, setRailHidden] = useState(false);
  const [wide, setWide] = useState(false);
  const [tab, setTab] = useState<LexiconTab>('overview');
  const [peekTab, setPeekTab] = useState<RecordPaneTab>('preview');
  // What the main pane lists, in order: lexicons for stepping through, and,
  // over them, a lexicon's records.
  const [listed, setListed] = useState<string[]>([]);
  const [recordKeys, setRecordKeys] = useState<string[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);
  useFillViewport(rootRef, '--fx-wb-top');

  // ── Moving around ───────────────────────────────────────────────────────

  const go = useCallback((to: string, replace = false) => {
    if (to === `${window.location.pathname}${window.location.search}`) return;
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
  }, []);

  const at = useCallback((patch: Partial<LexiconLocation>) => lexiconAddress({ ...loc, ...patch }), [loc]);

  const addressFor = useCallback<AddressFor>(
    ({ scope, nsid: to = null }) => lexiconAddress({ ...loc, scope, nsid: to, records: false, peek: null }),
    [loc],
  );

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
    // A record from the open lexicon's list (LexiconRecords) opens beside
    // it, with the records in the main pane.
    const peekTo = parsePeek(anchor.dataset.peek);
    if (peekTo && nsid) {
      event.preventDefault();
      go(at({ records: true, peek: peekTo }));
      return;
    }
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin || !isLexiconPath(url.pathname)) return;
    const to = parseLexiconLocation(url.pathname, url.searchParams);
    if (!to) return;
    event.preventDefault();
    // A link from a borrowed piece (a schema ref, a record's lexicon link)
    // doesn't know the window or the ranking; it keeps the ones in use.
    go(
      lexiconAddress({
        ...to,
        window: url.searchParams.has('window') ? to.window : loc.window,
        metric: url.searchParams.has('by') ? to.metric : loc.metric,
      }),
    );
  }

  const closeLexicon = useCallback(() => go(at({ nsid: null, records: false, peek: null })), [go, at]);
  const closeRecords = useCallback(() => go(at({ records: false, peek: null })), [go, at]);
  const closePeek = useCallback(() => go(at({ peek: null })), [go, at]);

  const onVisible = useCallback((nsids: string[]) => setListed(nsids), []);
  const onRecordItems = useCallback((keys: string[]) => setRecordKeys(keys), []);

  // Stepping replaces the address, so Back returns to the list rather than
  // through every lexicon looked at. Over the records, it's the records
  // being stepped through.
  const index = nsid ? listed.indexOf(nsid) : -1;
  const peekIndex = peekKey ? recordKeys.indexOf(peekKey) : -1;
  const step = useCallback(
    (dir: number) => {
      if (records && nsid) {
        const next = peekIndex < 0 ? recordKeys[0] : recordKeys[peekIndex + dir];
        const target = parsePeek(next);
        if (target) go(at({ peek: target }), Boolean(peekKey));
        return;
      }
      if (listed.length === 0) return;
      const next = index < 0 ? listed[0] : listed[index + dir];
      if (next) go(at({ nsid: next }), Boolean(nsid));
    },
    [records, nsid, peekIndex, recordKeys, go, at, peekKey, listed, index],
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
  const scopeKey = loc.scope.kind === 'list' ? loc.scope.list : loc.scope.kind === 'namespace' ? loc.scope.prefix : loc.scope.term;
  useEffect(() => {
    setRailOpen(false);
  }, [scopeKey, nsid]);

  useEffect(() => {
    if (!nsid) setWide(false);
  }, [nsid]);

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
    count: 0,
    open: railOpen,
    controls: RAIL_ID,
    onToggle: toggleRail,
  });

  // ── Keyboard ────────────────────────────────────────────────────────────

  // J and K step, Escape puts away the top layer: the rail's drawer, an
  // open record, the records list, then the lexicon. Typing, and keys the
  // site's shortcut engine has claimed, are left alone.
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
        if (peekKey) {
          closePeek();
          return true;
        }
        if (records && nsid) {
          closeRecords();
          return true;
        }
        if (nsid) {
          closeLexicon();
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
    document.title = lexiconTitle(loc);
  }, [loc]);

  // ── Render ──────────────────────────────────────────────────────────────

  const inspecting = Boolean(peek) || (Boolean(nsid) && !(records && drawers));
  const isWide = wide && !records;
  // The Files view's icons are for places with folders and files in them;
  // the ranked lists stay rows, with their rank, trend and change.
  const iconsApply = loc.scope.kind !== 'list' || loc.scope.list === 'all';
  const display = files && layout === 'icons' && iconsApply ? 'icons' : 'rows';
  const backLabel = scopeLabel(loc.scope);

  const controls = (
    <>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(-1)}
        disabled={index <= 0}
        aria-label="Previous lexicon"
        title="Previous (K)"
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(1)}
        disabled={index < 0 || index >= listed.length - 1}
        aria-label="Next lexicon"
        title="Next (J)"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon fx-wb-widen"
        onClick={() => setWide((v) => !v)}
        aria-pressed={wide}
        aria-label={wide ? 'Return the lexicon to the side' : 'Give the lexicon the full width'}
        title={wide ? 'Return to the side' : 'Full width'}
      >
        {wide ? <Minimize2 size={15} aria-hidden /> : <Maximize2 size={15} aria-hidden />}
      </button>
      <button type="button" className="fx-wb-icon" onClick={closeLexicon} aria-label="Close lexicon" title="Close (Esc)">
        <X size={17} aria-hidden />
      </button>
    </>
  );

  const peekControls = (
    <>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(-1)}
        disabled={peekIndex <= 0}
        aria-label="Newer record"
        title="Newer (K)"
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(1)}
        disabled={peekIndex < 0 || peekIndex >= recordKeys.length - 1}
        aria-label="Older record"
        title="Older (J)"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button type="button" className="fx-wb-icon" onClick={closePeek} aria-label="Close record" title="Close (Esc)">
        <X size={17} aria-hidden />
      </button>
    </>
  );

  return (
    <div
      ref={rootRef}
      className="fx-wb fx-lx"
      data-mode={mode}
      data-rail={railOpen || undefined}
      data-norail={railHidden || undefined}
      data-inspect={inspecting || undefined}
      data-wide={(inspecting && isWide) || undefined}
      onClickCapture={onClickCapture}
    >
      <header className="fx-wb-toolbar">
        <button
          type="button"
          className="fx-wb-icon fx-wb-rail-toggle"
          onClick={toggleRail}
          aria-expanded={drawers ? railOpen : !railHidden}
          aria-controls={RAIL_ID}
          aria-label="Places"
          title="Show or hide the places"
        >
          <PanelLeft size={17} aria-hidden />
        </button>
        <div className="fx-wb-path">
          <LexiconCrumbs loc={loc} addressFor={addressFor} phone={phone} />
        </div>
        <div className="fx-wb-toolbar-end">
          <Segmented
            ariaLabel="Count over"
            options={WINDOW_OPTIONS}
            value={loc.window}
            onChange={(w: Window) => go(at({ window: w }), true)}
          />
          {files && iconsApply && <FilesLayoutSwitch />}
          <ViewSwitch />
          <ShareLinkChip url={lexiconAddress(loc)} title="Copy a link to this view" iconOnly className="fx-title-share" />
        </div>
      </header>

      <div className="fx-wb-body">
        <aside
          id={RAIL_ID}
          className="fx-wb-rail fx-side"
          aria-label="Places"
          inert={drawers ? !railOpen : railHidden}
        >
          <span className="fx-wb-grab" aria-hidden />
          <LexiconRail loc={loc} addressFor={addressFor} navigate={go} files={files} onDone={() => setRailOpen(false)} />
        </aside>

        <section className="fx-wb-main" aria-label="Lexicons">
          {/* Two layers in one cell, as the account explorer's records and
              what links to one are: the list stays mounted under a
              lexicon's records, so the way back finds it as it was left. */}
          <div className="fx-wb-stack">
            <div className="fx-wb-layer" data-covered={(records && nsid) || undefined} inert={Boolean(records && nsid)}>
              <LexiconListPane
                loc={loc}
                addressFor={addressFor}
                display={display}
                onMetric={(metric: Metric) => go(at({ metric }), true)}
                onVisible={onVisible}
                covered={Boolean(records && nsid)}
              />
            </div>
            {records && nsid && (
              <div className="fx-wb-layer">
                <LexiconRecordsView
                  key={nsid}
                  nsid={nsid}
                  backHref={at({ records: false, peek: null })}
                  backLabel={nsid.slice(nsid.lastIndexOf('.') + 1)}
                  peekKey={peekKey}
                  onItems={onRecordItems}
                />
              </div>
            )}
          </div>
          {files && <LexiconPathBar loc={loc} addressFor={addressFor} />}
        </section>

        <aside
          id={INSPECTOR_ID}
          className="fx-wb-insp"
          aria-label={peek ? 'Record' : 'Lexicon'}
          inert={!inspecting}
        >
          {peek && peekKey ? (
            <PeekPane
              key={peekKey}
              peek={peek}
              own={null}
              controls={peekControls}
              tab={peekTab}
              onTab={setPeekTab}
              onClose={closePeek}
              label={
                <>
                  <Braces size={13} aria-hidden />
                  {fileKindOf(peek.collection)} by
                </>
              }
            />
          ) : (
            nsid && (
              <LexiconPane
                key={nsid}
                nsid={nsid}
                loc={loc}
                addressFor={addressFor}
                controls={controls}
                wide={isWide}
                tab={tab}
                onTab={setTab}
                recordsHref={at({ records: true, peek: null })}
              />
            )
          )}
        </aside>

        <div
          className="fx-wb-scrim"
          aria-hidden
          onClick={() => {
            if (railOpen) setRailOpen(false);
            else if (peekKey) closePeek();
            else if (drawers) closeLexicon();
          }}
        />
      </div>
      {/* Read by screen readers when stepping changes what's open. */}
      <span className="fx-sr" aria-live="polite">
        {nsid ? `${nsid} open${backLabel ? ` from ${backLabel}` : ''}` : ''}
      </span>
    </div>
  );
}

/** A list's name, for a way back to it. */
function scopeLabel(scope: LexiconScope): string {
  if (scope.kind === 'list') return LEXICON_LIST_LABELS[scope.list];
  if (scope.kind === 'namespace') return scope.prefix;
  return `“${scope.term}”`;
}

/** Namespaces from two segments down, each a place `/prefix` can list. */
function namespaceTrail(prefix: string): { prefix: string; label: string }[] {
  const parts = prefix.split('.');
  if (parts.length < 2) return [];
  const out = [{ prefix: parts.slice(0, 2).join('.'), label: parts.slice(0, 2).join('.') }];
  for (let i = 3; i <= parts.length; i++) out.push({ prefix: parts.slice(0, i).join('.'), label: parts[i - 1] });
  return out;
}

/**
 * Where you are: Lexicons, the list, and the open lexicon. A namespace is
 * its levels, each a place to go; on a phone the open lexicon steps aside,
 * since its sheet names it.
 */
function LexiconCrumbs({ loc, addressFor, phone }: { loc: LexiconLocation; addressFor: AddressFor; phone: boolean }) {
  const crumbs: { label: string; href: string | null; mono?: boolean }[] = [
    { label: 'Lexicons', href: addressFor({ scope: { kind: 'list', list: DEFAULT_LEXICON_LIST } }) },
  ];
  const { scope, nsid } = loc;
  const home = nsid ? homeScopeFor(nsid) : null;
  if (scope.kind === 'namespace') {
    for (const step of namespaceTrail(scope.prefix)) {
      crumbs.push({ label: step.label, href: addressFor({ scope: { kind: 'namespace', prefix: step.prefix } }), mono: true });
    }
  } else {
    crumbs.push({ label: scopeLabel(scope), href: addressFor({ scope }) });
  }
  if (nsid && !phone) {
    const inHome = home && sameScope(scope, home);
    crumbs.push({ label: inHome ? nsid.slice(nsid.lastIndexOf('.') + 1) : nsid, href: null, mono: true });
  }
  if (!nsid || phone) crumbs[crumbs.length - 1].href = null;

  return (
    <nav aria-label="Breadcrumb" className="fx-crumbs">
      {crumbs.map((crumb, i) => (
        <span key={`${i}-${crumb.label}`} className="fx-crumb" data-mono={crumb.mono || undefined}>
          {crumb.href ? (
            <Link href={crumb.href} prefetch={false}>
              {crumb.label}
            </Link>
          ) : (
            <span className="fx-crumb-here" aria-current="page">
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

/** The Files view's path bar: every folder from the top to what's open. */
function LexiconPathBar({ loc, addressFor }: { loc: LexiconLocation; addressFor: AddressFor }) {
  const prefix = loc.scope.kind === 'namespace' ? loc.scope.prefix : null;
  const trail = prefix ? namespaceTrail(prefix) : [];
  return (
    <nav className="fx-fd-path" aria-label="Path">
      <Link href={addressFor({ scope: { kind: 'list', list: DEFAULT_LEXICON_LIST } })} prefetch={false} className="fx-fd-crumb">
        <FolderGlyph />
        Lexicons
      </Link>
      {!prefix && (
        <>
          <span className="fx-fd-path-sep" aria-hidden>
            ›
          </span>
          <span className="fx-fd-crumb" aria-current={loc.nsid ? undefined : 'page'}>
            {scopeLabel(loc.scope)}
          </span>
        </>
      )}
      {trail.map((step, i) => (
        <span key={step.prefix} style={{ display: 'contents' }}>
          <span className="fx-fd-path-sep" aria-hidden>
            ›
          </span>
          <Link
            href={addressFor({ scope: { kind: 'namespace', prefix: step.prefix } })}
            prefetch={false}
            className="fx-fd-crumb"
            aria-current={!loc.nsid && i === trail.length - 1 ? 'page' : undefined}
          >
            <FolderGlyph prefix={i === 0 ? step.prefix : undefined} />
            {step.label}
          </Link>
        </span>
      ))}
      {loc.nsid && (
        <>
          <span className="fx-fd-path-sep" aria-hidden>
            ›
          </span>
          <span className="fx-fd-crumb" aria-current="page">
            <FileGlyph kind={fileKindOf(loc.nsid)} />
            {prefix && loc.nsid.startsWith(`${prefix}.`) ? loc.nsid.slice(prefix.length + 1) : loc.nsid}
          </span>
        </>
      )}
    </nav>
  );
}
