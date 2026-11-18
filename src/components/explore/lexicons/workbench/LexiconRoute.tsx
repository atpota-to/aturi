'use client';

import { useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { parseLexiconLocation, type LexiconLocation } from '@/lib/lexiconExplorer';
import { SkeletonBar, SkeletonTreePane } from '../../skeletons/primitives';
import { useExplorerView } from '../../workbench/useExplorerView';
import ViewSwitch from '../../workbench/ViewSwitch';
import LexiconDetail from '../LexiconDetail';
import LexiconGroup from '../LexiconGroup';
import LexiconsExplorer from '../LexiconsExplorer';
import LexiconShell from './LexiconShell';

/** The route a page was mounted for, as an address with nothing in its query. */
function routePath({ nsid, group }: { nsid?: string; group?: string }): string {
  if (nsid) return `/explore/lexicons/${encodeURIComponent(nsid)}`;
  if (group) return `/explore/lexicons/group/${encodeURIComponent(group)}`;
  return '/explore/lexicons';
}

/**
 * What the three lexicon routes render, in whichever layout the visitor has
 * chosen for the explorer (src/lib/explorerView.ts): the account explorer's
 * Workbench, Files and Classic, one choice for both.
 *
 * As with the account routes (ExplorerRoute), where you are is read from
 * the address bar, since the shell moves without navigating; the route's
 * own params are the fallback, and what the server renders with. Classic is
 * the pages as they were, with the view switch above them, for wherever the
 * address says.
 */
export default function LexiconRoute(props: { nsid?: string; group?: string }) {
  const view = useExplorerView();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { nsid, group } = props;
  const fallback = useMemo<LexiconLocation>(
    () =>
      parseLexiconLocation(routePath({ nsid, group }), new URLSearchParams()) ??
      // A route param no lexicon address can spell: the landing, rather than nothing.
      (parseLexiconLocation('/explore/lexicons', new URLSearchParams()) as LexiconLocation),
    [nsid, group],
  );

  if (view !== 'classic') return <LexiconShell mode={view} fallback={fallback} />;

  const loc = parseLexiconLocation(pathname, searchParams) ?? fallback;
  return (
    <>
      <div className="fx-viewbar">
        <ViewSwitch />
      </div>
      {loc.nsid ? (
        <LexiconDetail nsid={loc.nsid} />
      ) : loc.scope.kind === 'namespace' ? (
        <LexiconGroup prefix={loc.scope.prefix} />
      ) : loc.scope.kind === 'search' ? (
        <LexiconGroup prefix={loc.scope.term} />
      ) : (
        <LexiconsExplorer />
      )}
    </>
  );
}

/**
 * The frame before the address has been read: the workbench's toolbar, rail
 * and a list's rows, in their own shapes. What the server sends, so a first
 * paint is the layout it settles into for most visitors.
 */
export function LexiconRouteSkeleton() {
  const widths = ['62%', '48%', '74%', '56%', '42%', '68%', '52%', '60%', '46%', '70%'];
  return (
    <div className="fx-wb fx-lx" data-mode="workbench" aria-hidden>
      <header className="fx-wb-toolbar">
        <span className="fx-wb-icon fx-wb-rail-toggle" />
        <div className="fx-wb-path">
          <SkeletonBar width="12rem" />
        </div>
        <div className="fx-wb-toolbar-end">
          <SkeletonBar width="7.5rem" height="28px" shape="control" />
          <SkeletonBar width="13rem" height="28px" shape="control" />
        </div>
      </header>
      <div className="fx-wb-body">
        <aside className="fx-wb-rail fx-side">
          <div className="fx-lx-railhead">
            <SkeletonBar width="32px" height="32px" shape="control" style={{ flex: 'none' }} />
            <div className="fx-wb-acct-names" style={{ gap: 7 }}>
              <SkeletonBar width="5rem" height="0.85rem" />
              <SkeletonBar width="9rem" height="0.6rem" />
            </div>
          </div>
          <div className="fx-lx-find">
            <SkeletonBar width="100%" height="32px" shape="control" />
          </div>
          <div className="fx-wb-views">
            {['4.5rem', '2rem', '2.25rem', '5.5rem'].map((width, i) => (
              <span key={i} className="fx-wb-view" data-skeleton>
                <SkeletonBar width="14px" height="14px" shape="control" style={{ flex: 'none' }} />
                <SkeletonBar width={width} height="0.6rem" />
              </span>
            ))}
          </div>
          <div className="fx-wb-tree">
            <h2 className="fx-wb-label">Active namespaces</h2>
            <SkeletonTreePane rows={10} sidebar />
          </div>
        </aside>
        <section className="fx-wb-main">
          <div className="fx-wb-pane">
            <div className="fx-wb-pane-head">
              <div className="fx-titlebar">
                <SkeletonBar width="13rem" height="1.35rem" />
                <SkeletonBar width="16rem" height="28px" shape="control" />
              </div>
              <SkeletonBar width="min(30rem, 90%)" height="0.65rem" />
            </div>
            <div className="fx-records fx-wb-records">
              <div className="fx-records-tools">
                <SkeletonBar width="min(320px, 100%)" height="32px" shape="control" />
              </div>
              <div className="fx-wb-scroll">
                <ul className="fx-lx-list" data-cols="ranked">
                  {widths.map((w, i) => (
                    <li key={i} className="fx-lx-item">
                      <div className="fx-lx-row" data-skeleton>
                        <span className="fx-lx-rank">
                          <SkeletonBar width="1rem" height="0.6rem" />
                        </span>
                        <span className="fx-lx-name">
                          <SkeletonBar width="14px" height="14px" shape="control" style={{ flex: 'none' }} />
                          <SkeletonBar width={w} height="0.65rem" />
                        </span>
                        <span className="fx-lx-spark">
                          <SkeletonBar width="84px" height="20px" shape="control" />
                        </span>
                        <span className="fx-lx-num">
                          <SkeletonBar width="2.5rem" height="0.6rem" />
                        </span>
                        <span className="fx-lx-change">
                          <SkeletonBar width="2.75rem" height="0.6rem" />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
