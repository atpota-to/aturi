'use client';

import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { EXPLORER_VIEW_SWITCH } from '@/lib/explorerView';
import { parsePdsLocation, pdsAddress, type PdsLocation } from '@/lib/pdsExplorer';
import { normalizePdsBase } from '@/utils/atproto/pdsServer';
import { useBreadcrumbTrail } from '../BreadcrumbContext';
import PdsExplorer from '../PdsExplorer';
import { useExplorerView } from '../workbench/useExplorerView';
import ViewSwitch from '../workbench/ViewSwitch';
import type { AddressPatch } from './AccountsPane';
import PdsRail from './PdsRail';
import PdsShell from './PdsShell';

/**
 * What /explore/pds/{host} renders, in whichever layout the visitor has
 * chosen for the explorer (src/lib/explorerView.ts): Workbench, Files and
 * Classic, one choice for every level of it. All three read the same
 * address (src/lib/pdsExplorer.ts).
 *
 * Classic is the page as it was, beside a sidebar (ClassicPds).
 */
export default function PdsRoute({ host }: { host: string }) {
  const view = useExplorerView();
  // Keyed by host: another PDS starts with its own rail, list and inspector.
  if (view !== 'classic') return <PdsShell key={host} mode={view} host={host} />;
  if (!EXPLORER_VIEW_SWITCH) return <ClassicPds key={host} host={host} />;
  return (
    <>
      <div className="fx-viewbar">
        <ViewSwitch />
      </div>
      <ClassicPds key={host} host={host} />
    </>
  );
}

/**
 * The classic PDS page beside a sidebar, the shape an account's pages and
 * the lexicons' have in Classic (AccountFrame, LexiconFrame).
 *
 * The sidebar is the workbench's PDS rail (PdsRail): the host with its
 * address to copy, then its accounts by how they stand and when they last
 * committed, each with its count. Those groups narrow the page's account
 * list, which reads the same `status` and `commit` from the address; a pick
 * replaces the address as the list's own controls do, so no server render
 * is spent on it. The rail's three views stay out, since this page shows
 * the overview, the relays and the accounts one under another.
 */
function ClassicPds({ host }: { host: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const base = normalizePdsBase(host);
  const loc = useMemo(
    () =>
      parsePdsLocation(pathname, searchParams) ??
      (parsePdsLocation(`/explore/pds/${encodeURIComponent(host)}`, new URLSearchParams()) as PdsLocation),
    [pathname, searchParams, host],
  );
  const addressFor = useCallback(
    (patch: AddressPatch) => pdsAddress({ ...loc, ...patch, tab: 'accounts', account: null }, 'accounts'),
    [loc],
  );
  const { scrolledPast } = useBreadcrumbTrail();

  // A group in the sidebar narrows the list on this page: rewrite the query
  // in place. Links elsewhere (the tools) navigate as usual.
  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      return;
    }
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
    event.preventDefault();
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, []);

  return (
    <div className="fx-frame" data-crumbs={scrolledPast || undefined}>
      <aside className="fx-rail fx-side" aria-label="PDS" onClickCapture={onClickCapture}>
        <PdsRail
          base={base}
          host={host}
          loc={loc}
          tab="accounts"
          addressFor={addressFor}
          files={false}
          onDone={() => {}}
          views={false}
        />
      </aside>
      <div className="fx-frame-main">
        <PdsExplorer host={host} />
      </div>
    </div>
  );
}
