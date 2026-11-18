/**
 * The phone search sheet's state, held outside React for the same reason as
 * the site menu (src/lib/siteMenu.ts): the field that opens the sheet, the
 * toolbar buttons that react to it and the host that draws it live in
 * different components. The jump field is in the header's toolbar on most
 * pages and in <ExploreChromeBar> on explorer routes; the sheet is drawn by
 * <PhoneSearchHost>, mounted once in the root layout so it outlives the
 * page it was opened on and can fade out over the next one.
 *
 * `owner` is the opening field's id rather than a flag. Both toolbars mount
 * a jump field, and during a page transition two copies of the explorer's
 * bar can be mounted at once, so a field only acts on the sheet while it
 * is the owner.
 *
 * While a field owns it, `data-phone-search` is set on <html>, which is what
 * chrome.css hides the page by (Phone search sheet).
 */

export type PhoneSearchState = {
  /** The field that opened the sheet; null once it's closed. */
  owner: string | null;
  /** What that field holds. Kept after closing, so the sheet's way out still shows it. */
  query: string;
};

/** What the sheet asks of the field that owns it. */
export type PhoneSearchActions = {
  /** Resolve a query and go there; false when it named nowhere. */
  jump: (query: string) => Promise<boolean>;
  /** Paste and go, where the browser can read the clipboard. */
  paste: (() => void) | null;
};

const CLOSED: PhoneSearchState = { owner: null, query: '' };

let state: PhoneSearchState = CLOSED;
let actions: PhoneSearchActions | null = null;
let primary: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit(next: PhoneSearchState): void {
  const wasOpen = state.owner !== null;
  state = next;
  const isOpen = next.owner !== null;
  if (isOpen !== wasOpen) {
    if (isOpen) document.documentElement.setAttribute('data-phone-search', '');
    else document.documentElement.removeAttribute('data-phone-search');
  }
  listeners.forEach((listener) => listener());
}

export function subscribePhoneSearch(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getPhoneSearchState(): PhoneSearchState {
  return state;
}

/** Closed: the sheet never renders open on the server. */
export function getPhoneSearchServerState(): PhoneSearchState {
  return CLOSED;
}

export function getPhoneSearchOwner(): string | null {
  return state.owner;
}

export function getPhoneSearchServerOwner(): string | null {
  return null;
}

/** Open the sheet for a field, or bring its query up to date if it's already open. */
export function openPhoneSearch(fieldId: string, query: string, fieldActions: PhoneSearchActions): void {
  actions = fieldActions;
  if (state.owner === fieldId && state.query === query) return;
  emit({ owner: fieldId, query });
}

export function setPhoneSearchQuery(fieldId: string, query: string): void {
  if (state.owner !== fieldId || state.query === query) return;
  emit({ owner: fieldId, query });
}

export function closePhoneSearch(): void {
  if (state.owner === null) return;
  emit({ owner: null, query: state.query });
}

export function getPhoneSearchActions(): PhoneSearchActions | null {
  return actions;
}

/** The sheet's primary row, which the field's Search key runs. */
export function setPhoneSearchPrimary(run: (() => void) | null): void {
  primary = run;
}

/** Run the primary row, if the sheet has one. */
export function runPhoneSearchPrimary(): boolean {
  if (!primary) return false;
  primary();
  return true;
}

/**
 * Whether `href` is the page already open. A jump there changes no path, so
 * nothing would close the sheet on landing; the caller closes it instead.
 */
export function isCurrentPath(href: string): boolean {
  try {
    return new URL(href, window.location.href).pathname === window.location.pathname;
  } catch {
    return false;
  }
}
