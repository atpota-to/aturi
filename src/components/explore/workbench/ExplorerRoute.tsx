'use client';

import { usePathname } from 'next/navigation';
import { parseExplorerPath, type ExplorerLocation } from '@/lib/explorerView';
import CollectionExplorer from '../CollectionExplorer';
import RecordExplorer from '../RecordExplorer';
import RepoExplorer from '../RepoExplorer';
import ExplorerShell from './ExplorerShell';
import { useExplorerView } from './useExplorerView';
import ViewSwitch from './ViewSwitch';

/**
 * What the three account routes render: /explore/{repo}, its collections
 * and their records, in whichever layout the visitor has chosen
 * (src/lib/explorerView.ts).
 *
 * Workbench and Files draw the whole repository in one full-window shell and
 * move around inside it without navigating, so where they are is read from
 * the address bar, not from the route this component was mounted by. The
 * route's own params are the fallback, and what the server renders with.
 *
 * Classic is the explorer's three pages as they have always been, with the
 * view switch set above them. It reads the address bar the same way, so
 * switching to it from deep inside the shell opens the page for where you
 * are rather than the one you arrived on.
 */
export default function ExplorerRoute({
  repo,
  collection,
  rkey,
}: {
  repo: string;
  collection?: string;
  rkey?: string;
}) {
  const view = useExplorerView();
  const pathname = usePathname();
  const fromPath = parseExplorerPath(pathname);
  const at: ExplorerLocation =
    fromPath && fromPath.repo === repo
      ? fromPath
      : { repo, collection: collection ?? null, rkey: rkey ?? null };

  if (view !== 'classic') {
    return <ExplorerShell mode={view} repo={at.repo} collection={at.collection} rkey={at.rkey} />;
  }

  return (
    <>
      <div className="fx-viewbar">
        <ViewSwitch />
      </div>
      {at.collection && at.rkey ? (
        <RecordExplorer repo={at.repo} collection={at.collection} rkey={at.rkey} />
      ) : at.collection ? (
        <CollectionExplorer repo={at.repo} collection={at.collection} />
      ) : (
        <RepoExplorer repo={at.repo} />
      )}
    </>
  );
}
