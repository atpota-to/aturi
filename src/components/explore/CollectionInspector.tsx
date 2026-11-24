'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, FileText, X } from 'lucide-react';
import type { IdentityBundle } from '@/utils/atproto/identity';
import type { AtRecord } from '@/utils/atproto/pdsClient';
import { RecordPane, type RecordPaneTab } from './RecordExplorer';
import { useMediaQuery } from './useIsNarrow';

/**
 * Wide enough for the sidebar, the list and a record side by side. Below
 * it a record opens on its own page, as it always has.
 */
export const INSPECT_QUERY = '(min-width: 1200px)';

/** Typing, or a dialog that is up, keeps the keys to itself. */
function keysBelongElsewhere(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  if (document.querySelector('dialog[open]')) return true;
  const target = e.target instanceof Element ? e.target : null;
  return Boolean(
    target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]'),
  );
}

/**
 * A record opened beside the collection's list on the collection page: the
 * workbench's inspector, in Classic. The open record is `?record=` on the
 * collection's address, written with the History API rather than navigated
 * to, so the list stays as it was (loaded as far, scrolled as far) and no
 * server render is spent on each record looked at. A record's own page is
 * a click away, and is where the record opens on a narrower screen.
 *
 * Opening one adds to the history and stepping through replaces it, so Back
 * returns to the list rather than through every record seen. J and K step
 * (the list is newest first, so J is older), Escape closes.
 */
export function useRecordInspector({
  enabled,
  collection,
  rkeys,
}: {
  /** The collection page; a pane's host has an inspector of its own. */
  enabled: boolean;
  collection: string;
  /** The records on screen, in order: what stepping walks. */
  rkeys: readonly string[];
}) {
  const wide = useMediaQuery(INSPECT_QUERY);
  const on = enabled && wide;
  const searchParams = useSearchParams();
  const open = on ? searchParams.get('record') || null : null;
  const at = open ? rkeys.indexOf(open) : -1;

  const go = useCallback((key: string | null, replace: boolean) => {
    const { pathname, search } = window.location;
    const to = key ? `${pathname}?record=${encodeURIComponent(key)}` : pathname;
    if (to === `${pathname}${search}`) return;
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
  }, []);

  const step = useCallback(
    (dir: number) => {
      if (!on || rkeys.length === 0) return;
      const next = at < 0 ? rkeys[0] : rkeys[at + dir];
      if (next) go(next, Boolean(open));
    },
    [on, rkeys, at, open, go],
  );
  const close = useCallback(() => go(null, false), [go]);

  // A record's row (or file) in the list opens beside it. The rows link to
  // the record's page, which a modified click, a middle click or a narrow
  // screen still follows.
  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!on) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== '_self')) return;
      let url: URL;
      try {
        url = new URL(anchor.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const parts = url.pathname.split('/');
      if (parts.length !== 5 || parts[1] !== 'explore') return;
      let linked: string;
      let key: string;
      try {
        linked = decodeURIComponent(parts[3]);
        key = decodeURIComponent(parts[4]);
      } catch {
        return;
      }
      if (linked !== collection || !key) return;
      event.preventDefault();
      go(key, Boolean(open));
    },
    [on, collection, open, go],
  );

  const keys = useRef({ step, close, open });
  useEffect(() => {
    keys.current = { step, close, open };
  });
  useEffect(() => {
    if (!on) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (keysBelongElsewhere(e)) return;
      if (e.key === 'Escape' && keys.current.open) {
        e.preventDefault();
        keys.current.close();
      } else if (e.key === 'j' || e.key === 'J') {
        keys.current.step(1);
      } else if (e.key === 'k' || e.key === 'K') {
        keys.current.step(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [on]);

  return { open, at, count: rkeys.length, step, close, onClickCapture };
}

/**
 * The open record, beside the list: the workbench inspector's record pane
 * (RecordPane), with its key, newer and older, the way to its own page, and
 * close. Held still under the site header while the page scrolls the list.
 */
export function RecordInspector({
  identity,
  collection,
  rkey,
  at,
  count,
  step,
  close,
  seed,
  onDeleted,
}: {
  identity: IdentityBundle;
  collection: string;
  rkey: string;
  /** Where the record sits in the list on screen, -1 when it isn't there. */
  at: number;
  count: number;
  step: (dir: number) => void;
  close: () => void;
  /** The record as the list holds it, shown while the fresh read lands. */
  seed: AtRecord | null;
  onDeleted: () => void;
}) {
  // The open tab carries across records, as it does in the workbench.
  const [tab, setTab] = useState<RecordPaneTab>('preview');
  const pathname = usePathname();
  const pagePath = `${pathname ?? ''}/${encodeURIComponent(rkey)}`;

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
        disabled={at < 0 || at >= count - 1}
        aria-label="Older record"
        title="Older (J)"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <Link
        href={pagePath}
        prefetch={false}
        rel="nofollow"
        className="fx-wb-icon"
        aria-label="Open the record's own page"
        title="Open as a page"
      >
        <FileText size={15} aria-hidden />
      </Link>
      <button type="button" className="fx-wb-icon" onClick={close} aria-label="Close record" title="Close (Esc)">
        <X size={17} aria-hidden />
      </button>
    </>
  );

  return (
    <aside className="fx-insp" aria-label="Record">
      {/* Keyed by record: each one is read, edited and animated in on its
          own, and only the open tab carries across. */}
      <RecordPane
        key={rkey}
        identity={identity}
        collection={collection}
        rkey={rkey}
        controls={controls}
        wide={false}
        tab={tab}
        onTab={setTab}
        seed={seed}
        onDeleted={onDeleted}
      />
    </aside>
  );
}
