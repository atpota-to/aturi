import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AppWindow,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  ExternalLink,
} from 'lucide-react';
import type { ReverseMatch } from '@aturi/reverseParsers';
import { pdsHostname } from '@aturi/atproto/pdsServer';
import { bareUrl, hiddenReferenceCount, joints, runReferences } from '../../lib/pageRecords';
import { closePopupSoon, writeToClipboard } from './actions';

/** The key of the pinned tab, the page's own. */
export const PAGE_KEY = 'page';

/** What the popup has looked up about one record. */
export type RecordDetails = {
  loading: boolean;
  did: string | null;
  handle: string | null;
  /** The PDS endpoint, e.g. `https://pds.atpota.to`. */
  pds: string | null;
  cid: string | null;
  preview: string;
};

/** One record as the card files it: a tab, and what its sheet shows. */
export type CardEntry = {
  key: string;
  pinned: boolean;
  /** Null for the pinned tab of a page with no record of its own. */
  match: ReverseMatch | null;
  /** The account, as the tab and title name it. */
  who: string;
  tabLabel: string;
  tabTitle: string;
  title: string;
  /** "Post", "Profile", … */
  kind: string;
  /** The collection NSID, or the kind in lowercase for a repo-level URI. */
  collectionLabel: string;
  /** "on Bluesky" for the page's record, "in structured data" for a reference. */
  provenance: string | null;
  initial: string;
  atUri: string;
  aturiLink: string | null;
  exploreUrl: string;
  rkey?: string;
  details?: RecordDetails;
};

type LedgerRow = {
  id: string;
  name: string;
  /** What a click copies; null while it is still being looked up. */
  value: string | null;
  display: string;
  rkey?: string;
};

/**
 * The six identifiers of a record, in the ledger's order. A row whose value is
 * still being looked up shows as pending; one that lookup could not supply is
 * left out. Web addresses show without their scheme and copy with it.
 */
function ledgerRows(entry: CardEntry): LedgerRow[] {
  const d = entry.details;
  const loading = d?.loading ?? true;
  const handle =
    d?.handle ?? (entry.match && !entry.match.parsed.handle.startsWith('did:')
      ? entry.match.parsed.handle
      : null);
  const did = d?.did ?? entry.match?.parsed.did ?? null;
  const rows: Array<LedgerRow | null> = [
    { id: 'uri', name: 'AT URI', value: entry.atUri, display: entry.atUri, rkey: entry.rkey },
    entry.aturiLink
      ? {
          id: 'link',
          name: 'Link',
          value: entry.aturiLink,
          display: bareUrl(entry.aturiLink),
          rkey: entry.rkey,
        }
      : null,
    did || loading ? { id: 'did', name: 'DID', value: did, display: did ?? '' } : null,
    handle || loading
      ? { id: 'handle', name: 'Handle', value: handle, display: handle ?? '' }
      : null,
    d?.pds || loading
      ? {
          id: 'pds',
          name: 'PDS',
          value: d?.pds ?? null,
          display: d?.pds ? pdsHostname(d.pds) : '',
        }
      : null,
    d?.cid || loading ? { id: 'cid', name: 'CID', value: d?.cid ?? null, display: d?.cid ?? '' } : null,
  ];
  return rows.filter((r): r is LedgerRow => r !== null);
}

/** A value with a `<wbr>` at each joint, and the record key in the primary weight. */
function LedgerValue({ row }: { row: LedgerRow }) {
  if (row.value === null) return <span className="popup-ledger-pending">Looking up…</span>;
  const rkey = row.rkey && row.display.endsWith(row.rkey) ? row.rkey : null;
  const head = rkey ? row.display.slice(0, -rkey.length) : row.display;
  const pieces = joints(head);
  return (
    <>
      {pieces.map((piece, i) => (
        <span key={i}>
          {piece}
          <wbr />
        </span>
      ))}
      {rkey && <b className="popup-rkey">{rkey}</b>}
    </>
  );
}

const COPIED_MS = 1500;

/**
 * The record card: one index card for the record the page is about, with a
 * folder tab on its top edge for each record the page carries. "This page"
 * is pinned first; the references scroll beside it in a run that fades at
 * its ends and rests on whole tabs; a +N tab counts what the strip is not
 * showing and opens "Records on this page" under the card. The open tab is
 * the card's own sheet, which carries two verbs: Copy, a ledger of the
 * record's identifiers that unfolds inside the card, and Open on aturi.to.
 */
export function RecordCard({
  page,
  refs,
  openKey,
  onOpen,
  lookup,
  band,
  drawerOpen,
}: {
  page: CardEntry;
  refs: CardEntry[];
  openKey: string;
  onOpen: (key: string) => void;
  /** The pinned sheet's content when the page has no record of its own. */
  lookup: ReactNode;
  /** The per-page auto-redirect band, when auto-redirect is on. */
  band: ReactNode;
  /** Esc belongs to the search drawer while it is open. */
  drawerOpen: boolean;
}) {
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [view, setView] = useState({ overflowing: false, scrolled: false, atEnd: true, hidden: 0 });
  const runRef = useRef<HTMLDivElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const ledgerRef = useRef<HTMLUListElement>(null);
  const focusFirstRow = useRef(false);
  const copiedTimer = useRef<number | undefined>(undefined);

  const open = (openKey === PAGE_KEY ? page : refs.find(r => r.key === openKey)) ?? page;
  const lone = refs.length === 0;
  const runEntries = runReferences(refs, openKey === PAGE_KEY ? null : openKey);
  const showMore = view.hidden > 0;

  // Switching records clears a copied row at once; the ledger stays open, so
  // copying the same identifier from several records is one click each.
  useEffect(() => {
    setCopied(null);
    window.clearTimeout(copiedTimer.current);
  }, [openKey]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // The fades, and the +N count: how many references are not fully in view,
  // recomputed whenever the run might have moved or changed width.
  const measure = useCallback(() => {
    const el = runRef.current;
    if (!el) {
      setView(v => (v.hidden === 0 && !v.overflowing ? v : { overflowing: false, scrolled: false, atEnd: true, hidden: 0 }));
      return;
    }
    const sl = el.scrollLeft;
    const w = el.clientWidth;
    const max = el.scrollWidth - w;
    const overflowing = max > 1;
    const scrolled = overflowing && sl > 1;
    const atEnd = !overflowing || sl >= max - 1;
    const tabs = Array.from(el.children as HTMLCollectionOf<HTMLElement>).map(t => ({
      left: t.offsetLeft,
      width: t.offsetWidth,
    }));
    const hidden = hiddenReferenceCount(tabs, { scrollLeft: sl, width: w, scrolled, atEnd }, refs.length);
    setView(v =>
      v.overflowing === overflowing && v.scrolled === scrolled && v.atEnd === atEnd && v.hidden === hidden
        ? v
        : { overflowing, scrolled, atEnd, hidden },
    );
  }, [refs.length]);

  useLayoutEffect(measure);

  useEffect(() => {
    const el = runRef.current;
    if (!el) return undefined;
    // A vertical wheel over the run moves it sideways; a trackpad's sideways
    // swipe and shift-wheel already do.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', measure);
    };
  }, [measure, lone]);

  // The list has nothing to add once every reference is in view.
  useEffect(() => {
    if (!showMore && listOpen) setListOpen(false);
  }, [showMore, listOpen]);

  // Bring the open tab into the run's view (sideways only, so picking a row
  // far down the records list does not scroll the popup back up).
  useEffect(() => {
    const el = runRef.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el && tab) revealInRun(el, tab);
  }, [openKey]);

  useEffect(() => {
    if (!ledgerOpen || !focusFirstRow.current) return;
    focusFirstRow.current = false;
    ledgerRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [ledgerOpen]);

  // Esc folds the ledger and hands focus back to Copy. While the search
  // drawer is open it is the mode on top, so the drawer takes Esc first.
  useEffect(() => {
    if (!ledgerOpen || drawerOpen) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setLedgerOpen(false);
      copyBtnRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ledgerOpen, drawerOpen]);

  async function copyRow(row: LedgerRow) {
    if (row.value === null) return;
    await writeToClipboard(row.value);
    setCopied(row.id);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), COPIED_MS);
  }

  function onTabsKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const next =
      e.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
  }

  function onLedgerKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    );
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
    rows[next].focus();
  }

  const tabId = (entry: CardEntry) =>
    entry.pinned ? 'popup-tab-page' : `popup-tab-${refs.indexOf(entry)}`;

  function tab(entry: CardEntry) {
    const isOpen = entry.key === open.key;
    return (
      <button
        key={entry.key}
        type="button"
        role="tab"
        id={tabId(entry)}
        aria-selected={isOpen}
        aria-controls="popup-record-panel"
        tabIndex={isOpen ? 0 : -1}
        className={`popup-mode-tab popup-record-tab${isOpen ? ' is-active' : ''}${entry.pinned ? ' is-pinned' : ''}${entry.match ? '' : ' is-empty'}`}
        title={entry.tabTitle}
        onClick={() => onOpen(entry.key)}
        onFocus={e => {
          if (!entry.pinned && runRef.current) revealInRun(runRef.current, e.currentTarget);
        }}
      >
        {entry.pinned && <AppWindow size={13} aria-hidden />}
        <span className="popup-mode-tab-label" data-label={entry.tabLabel}>
          {entry.tabLabel}
        </span>
      </button>
    );
  }

  const runClass = [
    'popup-tabs-run',
    view.overflowing ? 'is-overflowing' : '',
    view.scrolled ? 'is-scrolled' : '',
    view.atEnd ? 'is-at-end' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const moreLabel = `${view.hidden} more record${view.hidden === 1 ? '' : 's'} on this page`;
  const rows = open.match ? ledgerRows(open) : [];
  const copiedRow = rows.find(r => r.id === copied);

  return (
    <>
      <section className="popup-section popup-card-section">
        <div className={`popup-record-tabs${lone ? ' is-lone' : ''}`}>
          {lone ? (
            // A tab you cannot leave is noise to a screen reader: alone, the
            // page's tab is a label with the look of a tab.
            <span
              className={`popup-mode-tab popup-record-tab is-active is-pinned${page.match ? '' : ' is-empty'}`}
              title={page.tabTitle}
            >
              <AppWindow size={13} aria-hidden />
              <span className="popup-mode-tab-label" data-label={page.tabLabel}>
                {page.tabLabel}
              </span>
            </span>
          ) : (
            <div
              className="popup-record-tablist"
              role="tablist"
              aria-label="Records on this page"
              onKeyDown={onTabsKeyDown}
            >
              {tab(page)}
              <div ref={runRef} className={runClass}>
                {runEntries.map(tab)}
              </div>
            </div>
          )}
          {showMore && (
            <button
              type="button"
              className={`popup-mode-tab popup-record-tab popup-tab-more${listOpen ? ' is-expanded' : ''}`}
              aria-expanded={listOpen}
              aria-controls="popup-refs-list"
              aria-label={`${moreLabel}, list them all`}
              title={`${moreLabel} · list them all`}
              onClick={() => setListOpen(v => !v)}
            >
              <span className="popup-mode-tab-label" data-label={`+${view.hidden}`}>
                +{view.hidden}
              </span>
            </button>
          )}
        </div>

        <div
          id="popup-record-panel"
          className="popup-page popup-record"
          role={lone ? undefined : 'tabpanel'}
          aria-labelledby={lone ? undefined : tabId(open)}
        >
          {open.match ? (
            <>
              <div className="popup-page-head">
                <span className="popup-page-avatar" aria-hidden="true">
                  {open.initial}
                </span>
                <span className="popup-page-text">
                  <span className="popup-page-title">{open.title}</span>
                  <span className="popup-page-meta" title={open.atUri}>
                    <span className="popup-source-collection">{open.collectionLabel}</span>
                    {open.provenance && <> · {open.provenance}</>}
                  </span>
                </span>
              </div>
              {/* A reference keeps a short preview: it is what tells two
                  posts by one author apart. */}
              {!open.pinned && open.details?.preview && (
                <p className="popup-record-preview">{open.details.preview}</p>
              )}
              <div className="popup-page-actions">
                <button
                  ref={copyBtnRef}
                  type="button"
                  className={`popup-page-btn popup-copy-btn${ledgerOpen ? ' is-open' : ''}${copiedRow ? ' is-copied' : ''}`}
                  aria-expanded={ledgerOpen}
                  aria-controls="popup-ledger"
                  title={ledgerOpen ? 'Hide the identifiers' : "Copy one of this record's identifiers"}
                  onClick={e => {
                    const opening = !ledgerOpen;
                    // From the keyboard, unfolding lands on the first row,
                    // so the AT URI is Enter, Enter.
                    if (opening && e.detail === 0) focusFirstRow.current = true;
                    setLedgerOpen(opening);
                  }}
                >
                  {copiedRow ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  <span>{copiedRow ? 'Copied' : 'Copy'}</span>
                  {ledgerOpen ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
                </button>
                <a
                  className="popup-page-btn popup-open-btn"
                  href={open.exploreUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="The record, its raw JSON, its PDS and the links to it, on aturi.to"
                  onClick={closePopupSoon}
                >
                  <Compass size={14} aria-hidden />
                  <span>Open on aturi.to</span>
                  <ExternalLink size={12} aria-hidden />
                </a>
              </div>
              {ledgerOpen && (
                <ul
                  ref={ledgerRef}
                  id="popup-ledger"
                  className={`popup-ledger${band ? ' is-above-band' : ''}`}
                  role="list"
                  aria-label="Identifiers of this record"
                  onKeyDown={onLedgerKeyDown}
                >
                  {rows.map(row => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={`popup-ledger-row${copied === row.id ? ' is-copied' : ''}`}
                        disabled={row.value === null}
                        title={row.value ? `Copy the ${row.name}` : undefined}
                        onClick={() => void copyRow(row)}
                      >
                        <span className="popup-ledger-key">{row.name}</span>
                        <span className="popup-ledger-val">
                          <LedgerValue row={row} />
                        </span>
                        {copied === row.id && (
                          <span className="popup-ledger-tick" aria-hidden="true">
                            <Check size={13} />
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="sr-only" aria-live="polite">
                {copiedRow ? `${copiedRow.name} copied` : ''}
              </div>
            </>
          ) : (
            lookup
          )}
          {band}
        </div>
      </section>

      {showMore && listOpen && (
        <section className="popup-section is-sheet popup-refs" id="popup-refs-list">
          <h2 className="popup-section-label">Records on this page</h2>
          <div className="popup-waypoints" role="list">
            {refs.map(entry => {
              const isOpen = entry.key === open.key;
              return (
                <div className="popup-waypoint popup-ref" role="listitem" key={entry.key}>
                  <button
                    type="button"
                    className="popup-waypoint-main"
                    aria-current={isOpen ? 'true' : undefined}
                    title={entry.tabTitle}
                    onClick={() => onOpen(entry.key)}
                  >
                    <span className="popup-icon-letter" aria-hidden="true">
                      {entry.initial}
                    </span>
                    <span className="popup-waypoint-name">{entry.who}</span>
                    <span className="popup-waypoint-desc">
                      {entry.kind}
                      {entry.provenance && <> · {entry.provenance}</>}
                    </span>
                    {isOpen && (
                      <span className="popup-ref-current" aria-hidden="true">
                        <Check size={14} />
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

/**
 * Scroll the run sideways just enough to show `tab` whole and clear of the
 * 40px fades at either end.
 */
function revealInRun(run: HTMLElement, tab: HTMLElement) {
  const pad = 40;
  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left - pad < run.scrollLeft) {
    run.scrollLeft = Math.max(0, left - pad);
  } else if (right + pad > run.scrollLeft + run.clientWidth) {
    run.scrollLeft = right + pad - run.clientWidth;
  }
}
