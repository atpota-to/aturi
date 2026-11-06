/**
 * Which search field, if any, has the phone search sheet open, held outside
 * React for the same reason as the site menu (src/lib/siteMenu.ts): the field
 * that opens the sheet and the toolbar buttons that react to it live in
 * different components, the header's toolbar on most pages and
 * <ExploreChromeBar> on explorer routes.
 *
 * The value is the opening field's id rather than a flag. Both toolbars
 * mount a jump field, and during a page transition two copies of the
 * explorer's bar can be mounted at once, so each field draws the sheet only
 * while it is the owner.
 *
 * While a field owns it, `data-phone-search` is set on <html>, which is what
 * chrome.css hides the page by (Phone search sheet).
 */

let owner: string | null = null;
const listeners = new Set<() => void>();

export function subscribePhoneSearch(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getPhoneSearchOwner(): string | null {
  return owner;
}

/** Closed: the sheet never renders open on the server. */
export function getPhoneSearchServerOwner(): string | null {
  return null;
}

function setOwner(next: string | null): void {
  if (owner === next) return;
  owner = next;
  if (next) document.documentElement.setAttribute('data-phone-search', '');
  else document.documentElement.removeAttribute('data-phone-search');
  listeners.forEach((listener) => listener());
}

export function openPhoneSearch(fieldId: string): void {
  setOwner(fieldId);
}

export function closePhoneSearch(): void {
  setOwner(null);
}
