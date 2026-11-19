'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** One segment of the explorer breadcrumb trail. */
export type BreadcrumbCrumb = {
  label: string;
  /** Upstream segments link; the current (last) segment usually omits href. */
  href?: string;
  /** Optional leading glyph. Only the PDS segment uses one today. */
  icon?: 'server' | 'user';
};

type BreadcrumbContextValue = {
  /** The active trail, or null when no explorer breadcrumb is mounted. */
  trail: BreadcrumbCrumb[] | null;
  /** True once the in-page breadcrumb has scrolled up behind the nav. */
  scrolledPast: boolean;
  setTrail: (trail: BreadcrumbCrumb[] | null) => void;
  setScrolledPast: (scrolledPast: boolean) => void;
};

const noop = () => {};

/**
 * Bridges the in-page <Breadcrumb> (which registers its trail and reports
 * when it scrolls out of view) and the floating nav's <StickyBreadcrumbBar>
 * (which re-renders that trail in miniature once you've scrolled past it).
 *
 * The default value is inert, so the bar safely renders nothing on routes
 * that don't wrap their content in a <BreadcrumbProvider>.
 */
const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  trail: null,
  scrolledPast: false,
  setTrail: noop,
  setScrolledPast: noop,
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [trail, setTrail] = useState<BreadcrumbCrumb[] | null>(null);
  const [scrolledPast, setScrolledPast] = useState(false);

  // setTrail / setScrolledPast are stable useState setters, so the value
  // only changes identity when the trail or scroll state actually does.
  const value = useMemo<BreadcrumbContextValue>(
    () => ({ trail, scrolledPast, setTrail, setScrolledPast }),
    [trail, scrolledPast],
  );

  return (
    <BreadcrumbContext.Provider value={value}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbTrail() {
  return useContext(BreadcrumbContext);
}

/**
 * What the in-page breadcrumb carries on a line of its own under it, on a
 * phone: the classic account pages' view switch (workbench/ExplorerRoute).
 *
 * On a phone the Workbench and Files views open on their toolbar, the
 * breadcrumb and then the switch; the classic pages used to open on the
 * switch, with the breadcrumb under it. Handing the switch to the breadcrumb
 * puts every view's trail at the very top and its switch on the line below,
 * whichever page is showing and without each page placing it. Null (the
 * default) everywhere else, so the shell's toolbar and the space pages draw
 * their breadcrumb as they always have.
 */
const BreadcrumbBarContext = createContext<ReactNode>(null);

export const BreadcrumbBarProvider = BreadcrumbBarContext.Provider;

export function useBreadcrumbBar() {
  return useContext(BreadcrumbBarContext);
}
