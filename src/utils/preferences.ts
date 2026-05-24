/**
 * User preference schema and localStorage helpers.
 *
 * Preferences are persisted in two places, in priority order:
 *
 *   1. The signed-in user's PDS as a `to.aturi.actor.preferences/self`
 *      record. This is the cross-device source of truth — when the user
 *      signs in on a new browser, this is what gets loaded.
 *   2. localStorage (`aturi.prefs.v1`). Used for anonymous customization
 *      and as a fast-path / fallback when the PDS isn't reachable.
 *
 * On sign-in: if the PDS record exists, it overwrites local. If the PDS
 * record is missing but local has prefs, local is pushed to the PDS so
 * the user's existing customization carries over.
 *
 * Writes are local-first and instant; PDS writes are debounced (handled
 * by the PreferencesProvider).
 */

import type { WaypointType } from './waypoints.data';
import { LOCALES, type Locale } from '@/i18n/routing';

const LS_KEY = 'aturi.prefs.v1';

const SUPPORTED_LOCALES: readonly Locale[] = LOCALES;

export type CustomWaypoint = {
  id: string;                                 // 'custom:<uuid>'
  name: string;
  domain?: string;                            // display hint, not used for routing
  description?: string;
  supportedTypes: WaypointType[];
  /** URL templates with `{handle}`, `{did}`, `{collection}`, `{rkey}` placeholders. */
  templates: Partial<Record<WaypointType, string>>;
};

export type Preferences = {
  /** Built-in waypoint ids the user has explicitly hidden. */
  hiddenWaypoints: string[];
  /**
   * Explicit ordering for built-in + custom waypoints. ids not in this list
   * sort to the end in their default order. Empty array = use defaults.
   */
  waypointOrder: string[];
  /** User-defined waypoints. */
  customWaypoints: CustomWaypoint[];
  /**
   * UI language preference. `null` means "follow URL / browser /
   * Accept-Language"; when set, takes precedence and reroutes the app to
   * the matching locale prefix on load.
   */
  language: Locale | null;
  /**
   * ISO timestamp of last local change. Used to break ties when local and
   * PDS prefs both exist on sign-in.
   */
  updatedAt: string;
};

export const DEFAULT_PREFERENCES: Preferences = {
  hiddenWaypoints: [],
  waypointOrder: [],
  customWaypoints: [],
  language: null,
  updatedAt: new Date(0).toISOString(),
};

/**
 * Cheap UUID for custom waypoint ids. Doesn't need crypto-strength
 * uniqueness — collisions are O(local prefs size).
 */
export function newCustomWaypointId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `custom:${ts}${rand}`;
}

/**
 * Read preferences from localStorage. Returns DEFAULT_PREFERENCES if no
 * stored prefs exist or parsing fails.
 */
export function readLocalPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return mergeWithDefaults(parsed);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Persist preferences to localStorage. Auto-bumps `updatedAt` if the
 * caller didn't.
 */
export function writeLocalPreferences(prefs: Preferences): void {
  if (typeof window === 'undefined') return;
  try {
    const stamped: Preferences = {
      ...prefs,
      updatedAt: prefs.updatedAt || new Date().toISOString(),
    };
    window.localStorage.setItem(LS_KEY, JSON.stringify(stamped));
  } catch {
    // Quota exceeded or storage disabled — non-fatal.
  }
}

export function clearLocalPreferences(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Fill missing fields on a possibly-stale stored object with defaults.
 * Keeps the schema forward-compatible.
 */
export function mergeWithDefaults(input: Partial<Preferences> | null | undefined): Preferences {
  if (!input || typeof input !== 'object') return DEFAULT_PREFERENCES;
  return {
    hiddenWaypoints: Array.isArray(input.hiddenWaypoints) ? input.hiddenWaypoints : [],
    waypointOrder: Array.isArray(input.waypointOrder) ? input.waypointOrder : [],
    customWaypoints: Array.isArray(input.customWaypoints)
      ? input.customWaypoints.filter(isValidCustomWaypoint)
      : [],
    language:
      typeof input.language === 'string' &&
      SUPPORTED_LOCALES.includes(input.language as Locale)
        ? (input.language as Locale)
        : null,
    updatedAt:
      typeof input.updatedAt === 'string' ? input.updatedAt : new Date(0).toISOString(),
  };
}

function isValidCustomWaypoint(w: unknown): w is CustomWaypoint {
  if (!w || typeof w !== 'object') return false;
  const c = w as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    Array.isArray(c.supportedTypes) &&
    c.templates !== null &&
    typeof c.templates === 'object'
  );
}

/**
 * Expand a custom waypoint template into a URL, substituting placeholders.
 * Returns null if required values for the placeholders are missing.
 */
export function expandTemplate(
  template: string,
  ctx: { handle?: string; did?: string; collection?: string; rkey?: string },
): string | null {
  let out = template;
  // Replace identifier placeholders first so they don't get mangled when
  // the same template references both handle and DID. `{actor}` prefers DID,
  // falling back to handle, mirroring the built-in waypoint convention.
  const actor = ctx.did || ctx.handle;
  const replacements: Record<string, string | undefined> = {
    '{handle}': ctx.handle,
    '{did}': ctx.did,
    '{actor}': actor,
    '{collection}': ctx.collection,
    '{rkey}': ctx.rkey,
  };
  for (const [token, value] of Object.entries(replacements)) {
    if (out.includes(token)) {
      if (!value) return null;
      out = out.split(token).join(encodeURIComponent(value));
    }
  }
  // Undo the over-eager encoding of colons in DIDs — they're URL-safe.
  out = out.replace(/did%3A/g, 'did:');
  return out;
}

export function preferencesAreEqual(a: Preferences, b: Preferences): boolean {
  return (
    a.updatedAt === b.updatedAt &&
    a.language === b.language &&
    JSON.stringify(a.hiddenWaypoints) === JSON.stringify(b.hiddenWaypoints) &&
    JSON.stringify(a.waypointOrder) === JSON.stringify(b.waypointOrder) &&
    JSON.stringify(a.customWaypoints) === JSON.stringify(b.customWaypoints)
  );
}
