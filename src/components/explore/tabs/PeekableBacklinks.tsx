'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { IdentityBundle } from '@/utils/atproto/identity';
import type { MergedBacklink } from '@/utils/atproto/backlinkMerge';
import { parsePeek, peekValue } from '@/lib/explorerView';
import type { RecordPaneTab } from '../RecordExplorer';
import { INSPECT_QUERY, useMediaQuery } from '../useIsNarrow';
import { PeekPane } from '../workbench/LinksView';
import BacklinksTab from './BacklinksTab';
import { BacklinkPeekContext, type BacklinkPeek } from './BacklinkRows';

/** Rewrites `?peek=` on the address, keeping the rest of the query (the tab). */
function goPeek(peekTo: string | null, replace: boolean) {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);
  if (peekTo) params.set('peek', peekTo);
  else params.delete('peek');
  const query = params.toString();
  const to = `${pathname}${query ? `?${query}` : ''}`;
  if (to === `${pathname}${search}`) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
}

/**
 * The repo page's Backlinks tab, where a linking record opens beside the
 * list rather than on its own page: the workbench's peek, in Classic. The
 * linking record usually lives in someone else's repository, and leaving
 * for it would lose the list and its place in it.
 *
 * The open record is `?peek={did}/{collection}/{rkey}` on the address,
 * written with the History API like the collection page's open record
 * (CollectionInspector), with the same keys: J and K step through the
 * list, Escape closes. Below 1200px there is no room beside the list, and
 * the rows lead to the records' pages as they always have.
 */
export default function PeekableBacklinks({ target, own }: { target: string; own: IdentityBundle }) {
  const wide = useMediaQuery(INSPECT_QUERY);
  const searchParams = useSearchParams();
  const peek = wide ? parsePeek(searchParams.get('peek')) : null;
  const peekKey = peek ? `${peek.did}/${peek.collection}/${peek.rkey}` : null;

  // The linking records on screen, as `?peek=` spells them: what J and K
  // walk through.
  const [linked, setLinked] = useState<string[]>([]);
  const onItems = useCallback((items: readonly MergedBacklink[]) => {
    setLinked(items.flatMap((item) => peekValue(item.uri) ?? []));
  }, []);
  const context = useMemo<BacklinkPeek>(
    () => ({ current: peekKey ? `at://${peekKey}` : null, onItems }),
    [peekKey, onItems],
  );

  const at = peekKey ? linked.indexOf(peekKey) : -1;
  const step = useCallback(
    (dir: number) => {
      const next = at < 0 ? linked[0] : linked[at + dir];
      if (next) goPeek(next, Boolean(peekKey));
    },
    [at, linked, peekKey],
  );
  const close = useCallback(() => goPeek(null, false), []);

  // A row marked by the context (`data-peek`) opens beside the list; its
  // link still goes to the record's page for a modified or middle click.
  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const peekTo = anchor?.dataset.peek;
      if (!peekTo) return;
      event.preventDefault();
      goPeek(peekTo, Boolean(peekKey));
    },
    [peekKey],
  );

  const keys = useRef({ step, close, peekKey });
  useEffect(() => {
    keys.current = { step, close, peekKey };
  });
  useEffect(() => {
    if (!wide) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]')) return;
      if (e.key === 'Escape' && keys.current.peekKey) {
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
  }, [wide]);

  // The open tab carries across linking records.
  const [tab, setTab] = useState<RecordPaneTab>('preview');

  if (!wide) return <BacklinksTab target={target} />;

  const controls = (
    <>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(-1)}
        disabled={at <= 0}
        aria-label="Previous linking record"
        title="Previous (K)"
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="fx-wb-icon"
        onClick={() => step(1)}
        disabled={at < 0 || at >= linked.length - 1}
        aria-label="Next linking record"
        title="Next (J)"
      >
        <ChevronDown size={16} aria-hidden />
      </button>
      <button type="button" className="fx-wb-icon" onClick={close} aria-label="Close linking record" title="Close (Esc)">
        <X size={17} aria-hidden />
      </button>
    </>
  );

  return (
    <div className="fx-peekable" data-peek={peek ? '' : undefined}>
      <div className="fx-peekable-list" onClickCapture={onClickCapture}>
        <BacklinkPeekContext.Provider value={context}>
          <BacklinksTab target={target} />
        </BacklinkPeekContext.Provider>
      </div>
      {peek && peekKey && (
        <aside className="fx-insp" aria-label="Linking record">
          <PeekPane
            key={peekKey}
            peek={peek}
            own={own}
            controls={controls}
            tab={tab}
            onTab={setTab}
            onClose={close}
          />
        </aside>
      )}
    </div>
  );
}
