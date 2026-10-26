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
 * selection mode is active AND the in-page toolbar is off screen. Carries
 * both the live counts/flags (so the condensed copy can mirror them) and
 * stable action callbacks (so its buttons drive the same handlers as the
 * in-page bar).
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
  /** Seconds until the throttle resumes while paced-paused, else null. */
  waitingSec: number | null;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** Stop an in-flight delete after the current batch. */
  onStop: () => void;
  /** Leave selection mode entirely. */
  onDone: () => void;
};

type EditBarContextValue = {
  /** The active toolbar snapshot, or null when no selection mode is mounted. */
  bar: EditBarSnapshot | null;
  setBar: (bar: EditBarSnapshot | null) => void;
};

const noop = () => {};

/**
 * Bridges the in-page bulk-edit toolbar (which publishes its state + handlers
 * while it's off screen) and the bottom <ExploreChromeBar> (which renders a
 * condensed copy in its place). Mirrors BreadcrumbContext.
 *
 * The default value is inert, so the chrome bar safely renders nothing on
 * routes that don't wrap their content in an <EditBarProvider>.
 */
const EditBarContext = createContext<EditBarContextValue>({
  bar: null,
  setBar: noop,
});

export function EditBarProvider({ children }: { children: ReactNode }) {
  const [bar, setBar] = useState<EditBarSnapshot | null>(null);

  // setBar is a stable useState setter, so the value only changes identity
  // when the snapshot actually does.
  const value = useMemo<EditBarContextValue>(() => ({ bar, setBar }), [bar]);

  return (
    <EditBarContext.Provider value={value}>{children}</EditBarContext.Provider>
  );
}

export function useEditBar() {
  return useContext(EditBarContext);
}
