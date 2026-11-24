'use client';

import { EXPLORER_VIEW_SWITCH } from '@/lib/explorerView';
import PdsExplorer from '../PdsExplorer';
import { useExplorerView } from '../workbench/useExplorerView';
import ViewSwitch from '../workbench/ViewSwitch';
import PdsShell from './PdsShell';

/**
 * What /explore/pds/{host} renders, in whichever layout the visitor has
 * chosen for the explorer (src/lib/explorerView.ts): Workbench, Files and
 * Classic, one choice for every level of it. Classic is the page as it was,
 * with the view switch above it; all three read the same address
 * (src/lib/pdsExplorer.ts).
 */
export default function PdsRoute({ host }: { host: string }) {
  const view = useExplorerView();
  // Keyed by host: another PDS starts with its own rail, list and inspector.
  if (view !== 'classic') return <PdsShell key={host} mode={view} host={host} />;
  if (!EXPLORER_VIEW_SWITCH) return <PdsExplorer key={host} host={host} />;
  return (
    <>
      <div className="fx-viewbar">
        <ViewSwitch />
      </div>
      <PdsExplorer key={host} host={host} />
    </>
  );
}
