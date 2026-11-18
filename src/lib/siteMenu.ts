/**
 * Whether the site menu is open, held outside React so the two things that
 * open it can share it.
 *
 * The header draws the menu, but on a phone the button that opens it lives in
 * a toolbar at the bottom of the screen, and on explorer routes that toolbar
 * is <ExploreChromeBar>, which the explore layout mounts as the header's
 * sibling. Neither is an ancestor of the other, so the state lives here and
 * both subscribe to it.
 *
 * Read it with `useSyncExternalStore(subscribeSiteMenu, getSiteMenuSnapshot,
 * getSiteMenuServerSnapshot)`, as the a11y and theme stores are read.
 */

let open = false;
const listeners = new Set<() => void>();

export function subscribeSiteMenu(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getSiteMenuSnapshot(): boolean {
  return open;
}

/** Closed: the menu never renders open on the server. */
export function getSiteMenuServerSnapshot(): boolean {
  return false;
}

export function setSiteMenuOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((listener) => listener());
}

export function toggleSiteMenu(): void {
  setSiteMenuOpen(!open);
}

/**
 * Marks a control that opens or closes the menu from outside the header.
 * The header closes its menu on any press outside itself, and without an
 * exemption a press on one of these would close the menu on pointer-down and
 * the click that follows would open it again.
 */
export const SITE_MENU_TOGGLE_ATTR = 'data-site-menu-toggle';
