/**
 * Whether the page before this one in the tab's history is a page of this
 * site, so the phone toolbar's back button knows whether going back stays on
 * aturi.to. When it wouldn't (a visit that started here from a link, or a
 * home-screen launch, which has no history at all) the button is Home
 * instead (SiteBackButton.tsx).
 *
 * Where the browser has the Navigation API, it answers exactly:
 * `navigation.canGoBack` counts only this origin's entries. Elsewhere this
 * keeps an estimate: a count of client-side moves, one up for each new page
 * and one down when the browser steps back onto a path (a popstate). Two
 * things throw it off. A forward step reads as a step back, so it undercounts
 * and errs toward Home. A client-side redirect to a new path
 * (`router.replace`, as a one-record collection does on its way to the
 * record) reads as a step, so on the page after one it can overcount by one,
 * and Back does what the browser's own back would.
 *
 * Read it with `useSyncExternalStore(subscribeSiteHistory,
 * getCanGoBackSnapshot, getCanGoBackServerSnapshot)`, and report every page
 * the app renders through `noteSitePath`.
 */

type NavigationLike = EventTarget & { canGoBack: boolean };

function nativeNavigation(): NavigationLike | null {
  const nav = (window as Window & { navigation?: NavigationLike }).navigation;
  return nav && typeof nav.canGoBack === 'boolean' ? nav : null;
}

let depth = 0;
let lastPath: string | null = null;
/** The path a popstate landed on, until the render of that path is noted. */
let poppedTo: string | null = null;
let wired = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function wire(): void {
  if (wired) return;
  wired = true;
  window.addEventListener('popstate', () => {
    poppedTo = window.location.pathname;
  });
  nativeNavigation()?.addEventListener('currententrychange', emit);
}

export function subscribeSiteHistory(onChange: () => void): () => void {
  wire();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getCanGoBackSnapshot(): boolean {
  const nav = nativeNavigation();
  return nav ? nav.canGoBack : depth > 0;
}

/** Nothing to go back to: the server never renders Back. */
export function getCanGoBackServerSnapshot(): boolean {
  return false;
}

/**
 * Records the path of a page the app has rendered. Safe to call from more
 * than one place for the same page (on explorer routes two toolbars are
 * mounted); only a change of path counts.
 */
export function noteSitePath(path: string): void {
  if (path === lastPath) return;
  if (lastPath !== null) {
    depth = poppedTo === path ? Math.max(0, depth - 1) : depth + 1;
  }
  poppedTo = null;
  lastPath = path;
  emit();
}
