'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The field the bottom chrome bar offers on the current route: either a live
 * filter over what's already on screen (a repo's lexicons, a collection's
 * records, a PDS's repos) or a search that navigates on Enter (the lexicons
 * explorer). Routes publish one via {@link useChromeBarField}; the bar falls
 * back to a global "jump anywhere" search when none is registered.
 */
export type ChromeBarField = {
  /** Placeholder text — names the action, e.g. "Filter lexicons…". */
  placeholder: string;
  /** Accessible name for the field. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Runs on Enter. Live filters leave this off (they've already applied by
   * the time you stop typing); fields that navigate on submit provide it.
   */
  onSubmit?: () => void;
  /** Terse readout beside the field, e.g. "12/340". */
  status?: string | null;
  /**
   * DOM id of the block this field narrows — normally
   * {@link CHROME_RESULTS_ID} on the list itself. Typing in the bar brings
   * that block into view, since a filter you can't see the results of is a
   * filter you're typing blind. Leave it off when the field navigates
   * instead of narrowing (a lexicon search), or when there's nothing on the
   * page it would scroll to.
   */
  resultsId?: string;
};

/**
 * The id every explorer list uses for the block above. One constant rather
 * than a per-route name because only one field is published at a time, so
 * only one such block is ever in the document.
 */
export const CHROME_RESULTS_ID = 'explore-chrome-results';

/**
 * A single button the route wants within reach — today the "Edit" affordance
 * on a collection or record page, published while the in-page one is off
 * screen. Sits between the field and the copy-link button.
 */
export type ChromeBarAction = {
  label: string;
  /** Accessible name / tooltip, when the label alone is too terse. */
  title?: string;
  onClick: () => void;
};

type ChromeBarContextValue = {
  /** The active field, or null when the route publishes none. */
  field: ChromeBarField | null;
  setField: (field: ChromeBarField | null) => void;
  /** The active action button, or null when the route publishes none. */
  action: ChromeBarAction | null;
  setAction: (action: ChromeBarAction | null) => void;
};

const noop = () => {};

/**
 * Bridges the explorer pages (which publish the filter/search that makes
 * sense where you are) and the fixed bottom <ExploreChromeBar> (which
 * renders it). Mirrors BreadcrumbContext / EditBarContext.
 *
 * The default value is inert, so the bar renders its fallback search on any
 * route that isn't wrapped in a <ChromeBarProvider>.
 */
const ChromeBarContext = createContext<ChromeBarContextValue>({
  field: null,
  setField: noop,
  action: null,
  setAction: noop,
});

export function ChromeBarProvider({ children }: { children: ReactNode }) {
  const [field, setField] = useState<ChromeBarField | null>(null);
  const [action, setAction] = useState<ChromeBarAction | null>(null);

  // The setters are stable useState setters, so the value only changes
  // identity when what's published actually does.
  const value = useMemo<ChromeBarContextValue>(
    () => ({ field, setField, action, setAction }),
    [field, action],
  );

  return <ChromeBarContext.Provider value={value}>{children}</ChromeBarContext.Provider>;
}

export function useChromeBar() {
  return useContext(ChromeBarContext);
}

/**
 * Publish this component's filter/search to the bottom chrome bar for as long
 * as it's mounted, and hand the bar back to its fallback on unmount. Pass
 * `null` to register nothing (so the hook can still be called
 * unconditionally, above a component's early returns).
 */
export function useChromeBarField(field: ChromeBarField | null): void {
  const { setField } = useChromeBar();

  // Callbacks go through a ref so a caller passing fresh closures every
  // render doesn't republish the snapshot on every keystroke — only the
  // primitives below drive that. Refreshed after every commit, which is
  // always before the bar could invoke them (they only run from an event).
  const handlers = useRef<{
    onChange?: (value: string) => void;
    onSubmit?: () => void;
  }>({});
  useEffect(() => {
    handlers.current = { onChange: field?.onChange, onSubmit: field?.onSubmit };
  });

  const active = field !== null;
  const placeholder = field?.placeholder ?? '';
  const label = field?.label ?? '';
  const value = field?.value ?? '';
  const status = field?.status ?? null;
  const resultsId = field?.resultsId;
  const submits = Boolean(field?.onSubmit);

  useEffect(() => {
    if (!active) {
      setField(null);
      return;
    }
    setField({
      placeholder,
      label,
      value,
      status,
      resultsId,
      onChange: (next) => handlers.current.onChange?.(next),
      onSubmit: submits ? () => handlers.current.onSubmit?.() : undefined,
    });
  }, [active, placeholder, label, value, status, resultsId, submits, setField]);

  useEffect(() => () => setField(null), [setField]);
}

/**
 * Publish a button into the chrome bar for as long as it's mounted. Pass
 * `null` when the route has nothing to offer (or while the in-page original
 * is on screen), so the hook can still be called unconditionally.
 */
export function useChromeBarAction(action: ChromeBarAction | null): void {
  const { setAction } = useChromeBar();

  const onClick = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    onClick.current = action?.onClick;
  });

  const active = action !== null;
  const label = action?.label ?? '';
  const title = action?.title;

  useEffect(() => {
    if (!active) {
      setAction(null);
      return;
    }
    setAction({ label, title, onClick: () => onClick.current?.() });
  }, [active, label, title, setAction]);

  useEffect(() => () => setAction(null), [setAction]);
}
