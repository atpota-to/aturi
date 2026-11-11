/**
 * The lexicons explorer's pins: lexicons (`app.bsky.feed.post`) and whole
 * namespaces (`app.bsky.*`, the account explorer's group-pin spelling) kept
 * at the top of its rail.
 *
 * Separate from the account explorer's pinned lexicons, which lift
 * collections to the top of every account's tree: pinning a lexicon to
 * watch its usage is a different wish from wanting it first in every
 * repository. Kept in the browser, like the explorer's view choice
 * (explorerView.ts), rather than in the synced preference record, which the
 * extension and the iOS app also read and the iOS app re-implements by hand.
 *
 * Read it with `useSyncExternalStore(subscribeLexiconPins, getLexiconPins,
 * getLexiconPinsOnServer)`.
 */

const KEY = 'aturi.lexiconPins';

/** More than anyone pins by hand; a cap on what a bad write can grow to. */
const MAX_PINS = 200;

const EMPTY: readonly string[] = Object.freeze([]);

/** A stored value as a list of pins: strings, each once, in their order. Anything else is no pins. */
export function parseLexiconPins(raw: string | null): readonly string[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const pins = Array.from(new Set(value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')));
    return pins.length ? pins.slice(0, MAX_PINS) : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The list with `entry` added at the end, or taken out if it was there. */
export function toggleLexiconPin(pins: readonly string[], entry: string): readonly string[] {
  return pins.includes(entry) ? pins.filter((p) => p !== entry) : [...pins, entry].slice(-MAX_PINS);
}

const listeners = new Set<() => void>();
// Held in memory once read, so a browser that refuses storage still pins
// for the life of the tab, and so the snapshot keeps one identity.
let pins: readonly string[] | null = null;

export function subscribeLexiconPins(onChange: () => void): () => void {
  listeners.add(onChange);
  // Pinning in another tab pins here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    pins = null;
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function getLexiconPins(): readonly string[] {
  if (pins === null) {
    try {
      pins = parseLexiconPins(window.localStorage.getItem(KEY));
    } catch {
      pins = EMPTY;
    }
  }
  return pins;
}

export function getLexiconPinsOnServer(): readonly string[] {
  return EMPTY;
}

export function setLexiconPins(next: readonly string[]): void {
  pins = next.length ? next : EMPTY;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(pins));
  } catch {
    // localStorage can throw in private modes; the pins then last the tab.
  }
  listeners.forEach((listener) => listener());
}
