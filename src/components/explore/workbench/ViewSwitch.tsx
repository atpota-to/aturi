'use client';

import {
  EXPLORER_VIEWS,
  EXPLORER_VIEW_LABELS,
  FILES_LAYOUTS,
  setExplorerView,
  setFilesLayout,
  type FilesLayout,
} from '@/lib/explorerView';
import { Segmented } from '../lexicons/primitives';
import { useExplorerView, useFilesLayout } from './useExplorerView';

const VIEW_OPTIONS = EXPLORER_VIEWS.map((value) => ({ value, label: EXPLORER_VIEW_LABELS[value] }));

const LAYOUT_LABELS: Record<FilesLayout, string> = { icons: 'Icons', list: 'List' };
const LAYOUT_OPTIONS = FILES_LAYOUTS.map((value) => ({ value, label: LAYOUT_LABELS[value] }));

/**
 * Workbench, Files or Classic: which layout the account explorer draws. The
 * same control sits in the workbench's and the Files view's toolbar and above
 * the classic pages, so the way back is always where the way in was.
 */
export default function ViewSwitch() {
  const view = useExplorerView();
  return (
    <Segmented
      ariaLabel="Explorer view"
      options={VIEW_OPTIONS}
      value={view}
      onChange={setExplorerView}
    />
  );
}

/** Icons or List, for the Files view. */
export function FilesLayoutSwitch() {
  const layout = useFilesLayout();
  return (
    <Segmented
      ariaLabel="Show items as"
      options={LAYOUT_OPTIONS}
      value={layout}
      onChange={setFilesLayout}
    />
  );
}
