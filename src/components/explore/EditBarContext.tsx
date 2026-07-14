'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Snapshot of the collection explorer's bulk-edit toolbar, published while
 * selection mode is active. Carries both the live counts/flags (so the
 * condensed copy can mirror them) and stable action callbacks (so its buttons
 * drive the same handlers as the in-page bar).
 */
export type EditBarSnapshot = {
  selectedCount: number;
  totalCount: number;
  allSelected: boolean;
  /** True while showing the "are you sure?" confirm step. */
  confirming: boolean;
  deleting: boolean;
  /** Records settled / total during an in-flight delete, else null. */
  progress: { done: number; total: number } | null;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

type EditBarContextValue = {
  /** The active toolbar snapshot, or null when no selection mode is mounted. */
  bar: EditBarSnapshot | null;
  /** True once the in-page edit bar has scrolled up behind the nav. */
  scrolledPast: boolean;
  setBar: (bar: EditBarSnapshot | null) => void;
  setScrolledPast: (scrolledPast: boolean) => void;
};

const noop = () => {};

/**
 * Bridges the in-page bulk-edit toolbar (which publishes its state + handlers
 * and reports when it scrolls out of view) and the floating nav's
 * <StickyEditBar> (which re-renders a condensed copy once you've scrolled
 * past it). Mirrors BreadcrumbContext.
 *
 * The default value is inert, so <StickyEditBar> safely renders nothing on
 * routes that don't wrap their content in an <EditBarProvider>.
 */
const EditBarContext = createContext<EditBarContextValue>({
  bar: null,
  scrolledPast: false,
  setBar: noop,
  setScrolledPast: noop,
});

export function EditBarProvider({ children }: { children: ReactNode }) {
  const [bar, setBar] = useState<EditBarSnapshot | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);

  // setBar / setScrolledPast are stable useState setters, so the value only
  // changes identity when the snapshot or scroll state actually does.
  const value = useMemo<EditBarContextValue>(
    () => ({ bar, scrolledPast, setBar, setScrolledPast }),
    [bar, scrolledPast],
  );

  return (
    <EditBarContext.Provider value={value}>{children}</EditBarContext.Provider>
  );
}

export function useEditBar() {
  return useContext(EditBarContext);
}
