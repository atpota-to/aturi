'use client';

import { Suspense, useCallback, useMemo, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { lexiconAddress, parseLexiconLocation, type LexiconLocation } from '@/lib/lexiconExplorer';
import { useBreadcrumbTrail } from '../BreadcrumbContext';
import { SkeletonBar, SkeletonTreePane } from '../skeletons/primitives';
import { useExplorerView } from '../workbench/useExplorerView';
import LexiconRail, { type AddressFor } from './workbench/LexiconRail';

/**
 * What the lexicon pages are drawn inside in Classic: a sidebar on the left
 * and the page beside it, as an account's pages are (AccountFrame), so the
 * explorer has one shape wherever you are in it.
 *
 * The sidebar is the lexicons workbench's rail (LexiconRail): finding a
 * lexicon, the visitor's pinned ones, and the busiest namespaces as a tree.
 * Its links are the classic pages' own addresses (a namespace's group page,
 * a lexicon's page), so it needs nothing of the workbench to work here. The
 * rail's four lists stay out: the landing page shows them together.
 *
 * It is the lexicon routes' layout, so it stays mounted from one lexicon
 * page to the next, with its tree opened as far as it was. The Workbench and
 * Files views draw their own full-window shell instead (LexiconShell).
 */
export default function LexiconFrame({ children }: { children: ReactNode }) {
  const view = useExplorerView();
  const { scrolledPast } = useBreadcrumbTrail();
  if (view !== 'classic') return <>{children}</>;
  return (
    <div className="fx-frame" data-crumbs={scrolledPast || undefined}>
      <aside className="fx-rail fx-side" aria-label="Lexicons" data-tree>
        {/* The rail reads the query (a search, the window), which a static
            page only has in the browser. */}
        <Suspense fallback={<RailSkeleton />}>
          <ClassicLexiconRail />
        </Suspense>
      </aside>
      <div className="fx-frame-main">{children}</div>
    </div>
  );
}

const LANDING = parseLexiconLocation('/explore/lexicons', new URLSearchParams()) as LexiconLocation;

function ClassicLexiconRail() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const loc = useMemo(
    () => parseLexiconLocation(pathname, searchParams) ?? LANDING,
    [pathname, searchParams],
  );
  const addressFor = useCallback<AddressFor>(
    ({ scope, nsid = null }) => lexiconAddress({ ...loc, scope, nsid, records: false, peek: null }),
    [loc],
  );
  const navigate = useCallback((to: string) => router.push(to), [router]);
  return (
    <LexiconRail loc={loc} addressFor={addressFor} navigate={navigate} files={false} onDone={() => {}} lists={false} />
  );
}

/** The rail's head, find field and tree, before the query has been read. */
function RailSkeleton() {
  return (
    <>
      <div className="fx-lx-railhead" aria-hidden>
        <SkeletonBar width="32px" height="32px" shape="control" style={{ flex: 'none' }} />
        <div className="fx-wb-acct-names" style={{ gap: 7 }}>
          <SkeletonBar width="5rem" height="0.85rem" />
          <SkeletonBar width="9rem" height="0.6rem" />
        </div>
      </div>
      <div className="fx-lx-find" aria-hidden>
        <SkeletonBar width="100%" height="32px" shape="control" />
      </div>
      <div className="fx-wb-tree" aria-hidden>
        <h2 className="fx-wb-label">Active namespaces</h2>
        <SkeletonTreePane rows={10} sidebar />
      </div>
    </>
  );
}
