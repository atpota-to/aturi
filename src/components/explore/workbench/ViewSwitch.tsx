'use client';

import { Columns3, Folder, ScrollText, type LucideIcon } from 'lucide-react';
import {
  EXPLORER_VIEWS,
  EXPLORER_VIEW_LABELS,
  FILES_LAYOUTS,
  setExplorerView,
  setFilesLayout,
  type ExplorerView,
  type FilesLayout,
} from '@/lib/explorerView';
import { Segmented } from '../lexicons/primitives';
import { useExplorerView, useFilesLayout } from './useExplorerView';

/**
 * Marks rather than words: on a phone the switch shares its line with the
 * view's own controls (the lexicons' window, the Files view's Icons and
 * List), and with all three spelled out it took a line to itself. The
 * names stay as each mark's tooltip and accessible name. The workbench is
 * its three panes side by side, Files its folders, and Classic the pages
 * that scroll.
 */
const VIEW_ICONS: Record<ExplorerView, LucideIcon> = {
  workbench: Columns3,
  files: Folder,
  classic: ScrollText,
};

const VIEW_OPTIONS = EXPLORER_VIEWS.map((value) => ({
  value,
  label: EXPLORER_VIEW_LABELS[value],
  icon: VIEW_ICONS[value],
}));

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
