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

import {
  CATEGORY_ORDER,
  WAYPOINT_CATEGORIES_DATA,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  type WaypointType,
} from './waypoints.data';

const LS_KEY = 'aturi.prefs.v1';

export type CustomWaypoint = {
  id: string;                                 // 'custom:<uuid>'
  name: string;
  domain?: string;                            // display hint, not used for routing
  description?: string;
  supportedTypes: WaypointType[];
  /** URL templates with `{handle}`, `{did}`, `{collection}`, `{rkey}` placeholders. */
  templates: Partial<Record<WaypointType, string>>;
};

/**
 * A user-defined waypoint group. Each group has an ordered list of
 * waypoint ids; the same waypoint may appear in multiple groups, and any
 * waypoint not in *any* group is hidden from the picker. Mirrors the
 * extension's `WaypointGroup` 1:1 so PDS records round-trip between the
 * two surfaces.
 */
export type WaypointGroup = {
  id: string;
  name: string;
  waypointIds: string[];
  collapsed?: boolean;
};

export type Preferences = {
  /**
   * User-defined groups. Order of the array is display order in the
   * picker; each group's `waypointIds` is the in-group order.
   *
   * The default value is derived from `WAYPOINT_CATEGORIES_DATA` so a
   * brand-new user sees the same categories the old hide/reorder UI
   * implied — but they can now rename them, split them, merge them, etc.
   */
  waypointGroups: WaypointGroup[];
  /**
   * @deprecated Replaced by `waypointGroups`. Kept on the type so legacy
   * payloads still typecheck during migration; new code should read from
   * `waypointGroups` instead. A waypoint is now hidden when it does not
   * appear in any group.
   */
  hiddenWaypoints: string[];
  /**
   * @deprecated Replaced by `waypointGroups`. Read for migration only.
   */
  waypointOrder: string[];
  /** User-defined waypoints. */
  customWaypoints: CustomWaypoint[];
  /**
   * NSIDs the user has pinned in the explorer's CollectionsTab. When the
   * repo being viewed has any of these collections, they bubble up into a
   * "Pinned" section at the top of the list. Pinning is a personal
   * cross-repo action — pinning `app.bsky.feed.post` while looking at
   * @alice's repo also pins it on every other repo that has that
   * collection (subject to `pinScope`).
   */
  pinnedLexicons: string[];
  /**
   * Where the Pinned section shows up:
   *   - `own`: only on the signed-in user's own repo page.
   *   - `all`: on every account's repo page (intersection with their
   *     collections so it's not empty noise).
   */
  pinScope: 'own' | 'all';
  /**
   * ISO timestamp of last local change. Used to break ties when local and
   * PDS prefs both exist on sign-in.
   */
  updatedAt: string;
};

export const CUSTOM_GROUP_ID = 'custom';
export const CUSTOM_GROUP_NAME = 'My Waypoints';

export const DEFAULT_PREFERENCES: Preferences = {
  waypointGroups: defaultWaypointGroups(),
  hiddenWaypoints: [],
  waypointOrder: [],
  customWaypoints: [],
  pinnedLexicons: [],
  pinScope: 'own',
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
 * If the stored object has the legacy hide/order shape but no groups,
 * runs `migrateToGroups` so the user's prior arrangement carries over.
 */
export function mergeWithDefaults(input: Partial<Preferences> | null | undefined): Preferences {
  if (!input || typeof input !== 'object') return DEFAULT_PREFERENCES;
  const customWaypoints = Array.isArray(input.customWaypoints)
    ? input.customWaypoints.filter(isValidCustomWaypoint)
    : [];
  const hiddenWaypoints = Array.isArray(input.hiddenWaypoints) ? input.hiddenWaypoints : [];
  const waypointOrder = Array.isArray(input.waypointOrder) ? input.waypointOrder : [];
  const storedGroups = Array.isArray(input.waypointGroups)
    ? input.waypointGroups.filter(isValidWaypointGroup)
    : [];
  const waypointGroups =
    storedGroups.length > 0
      ? storedGroups
      : migrateToGroups({ customWaypoints, hiddenWaypoints, waypointOrder });
  const pinnedLexicons = Array.isArray(input.pinnedLexicons)
    ? input.pinnedLexicons.filter((s): s is string => typeof s === 'string')
    : [];
  const pinScope: 'own' | 'all' =
    input.pinScope === 'all' || input.pinScope === 'own' ? input.pinScope : 'own';
  return {
    waypointGroups,
    hiddenWaypoints,
    waypointOrder,
    customWaypoints,
    pinnedLexicons,
    pinScope,
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

function isValidWaypointGroup(g: unknown): g is WaypointGroup {
  if (!g || typeof g !== 'object') return false;
  const v = g as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.waypointIds) &&
    v.waypointIds.every((id) => typeof id === 'string')
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
    a.pinScope === b.pinScope &&
    JSON.stringify(a.waypointGroups) === JSON.stringify(b.waypointGroups) &&
    JSON.stringify(a.customWaypoints) === JSON.stringify(b.customWaypoints) &&
    JSON.stringify(a.pinnedLexicons) === JSON.stringify(b.pinnedLexicons)
  );
}

// --- Pinned lexicons -------------------------------------------------------

export function togglePinnedLexicon(prefs: Preferences, nsid: string): Preferences {
  const has = prefs.pinnedLexicons.includes(nsid);
  return {
    ...prefs,
    pinnedLexicons: has
      ? prefs.pinnedLexicons.filter((n) => n !== nsid)
      : [...prefs.pinnedLexicons, nsid],
  };
}

export function setPinScope(prefs: Preferences, scope: 'own' | 'all'): Preferences {
  return { ...prefs, pinScope: scope };
}

// --- Group helpers ---------------------------------------------------------

/**
 * Build the default set of groups from the built-in category metadata.
 * This is what new users see; existing users get a one-time migration
 * via `migrateToGroups` instead so their hide/reorder state carries over.
 */
export function defaultWaypointGroups(
  customWaypoints: CustomWaypoint[] = [],
): WaypointGroup[] {
  const groups: WaypointGroup[] = [];
  for (const catId of CATEGORY_ORDER) {
    const meta = WAYPOINT_CATEGORIES_DATA[catId];
    const ids = WAYPOINT_ORDER.filter(
      (id) => WAYPOINT_DESTINATIONS_DATA[id]?.category === catId,
    );
    if (ids.length === 0) continue;
    groups.push({
      id: catId,
      name: meta?.name ?? catId,
      waypointIds: ids,
    });
  }
  if (customWaypoints.length > 0) {
    groups.push({
      id: CUSTOM_GROUP_ID,
      name: CUSTOM_GROUP_NAME,
      waypointIds: customWaypoints.map((c) => c.id),
    });
  }
  return groups;
}

/**
 * One-time migration from the legacy `hiddenWaypoints` + `waypointOrder`
 * shape to grouped layout. Honors the user's hidden set (skipped entirely)
 * and ordering (within the resulting buckets), keyed by each waypoint's
 * built-in category. Mirrors the extension's `migrateToGroups`.
 */
export function migrateToGroups(partial: {
  customWaypoints?: CustomWaypoint[];
  hiddenWaypoints?: string[];
  waypointOrder?: string[];
}): WaypointGroup[] {
  const customWaypoints = partial.customWaypoints ?? [];
  const hidden = new Set(partial.hiddenWaypoints ?? []);
  const order = partial.waypointOrder ?? [];

  const customIds = new Set(customWaypoints.map((c) => c.id));

  function effectiveCategoryFor(id: string): string {
    if (customIds.has(id)) return CUSTOM_GROUP_ID;
    return WAYPOINT_DESTINATIONS_DATA[id]?.category ?? CUSTOM_GROUP_ID;
  }

  const fallbackOrder = [...WAYPOINT_ORDER, ...customWaypoints.map((c) => c.id)];
  const seen = new Set<string>();
  const fullOrder: string[] = [];
  for (const id of order) {
    if (!seen.has(id)) {
      fullOrder.push(id);
      seen.add(id);
    }
  }
  for (const id of fallbackOrder) {
    if (!seen.has(id)) {
      fullOrder.push(id);
      seen.add(id);
    }
  }

  const buckets = new Map<string, string[]>();
  const bucketOrder: string[] = [];
  for (const id of fullOrder) {
    if (hidden.has(id)) continue;
    const cat = effectiveCategoryFor(id);
    if (!buckets.has(cat)) {
      buckets.set(cat, []);
      bucketOrder.push(cat);
    }
    buckets.get(cat)!.push(id);
  }

  const headerOrder: string[] = [];
  for (const c of CATEGORY_ORDER) {
    if (buckets.has(c)) headerOrder.push(c);
  }
  if (buckets.has(CUSTOM_GROUP_ID) && !headerOrder.includes(CUSTOM_GROUP_ID)) {
    headerOrder.push(CUSTOM_GROUP_ID);
  }
  for (const c of bucketOrder) {
    if (!headerOrder.includes(c)) headerOrder.push(c);
  }

  return headerOrder.map((catId) => {
    const meta = WAYPOINT_CATEGORIES_DATA[catId];
    const name =
      catId === CUSTOM_GROUP_ID ? CUSTOM_GROUP_NAME : meta?.name ?? prettyGroupName(catId);
    return {
      id: catId,
      name,
      waypointIds: buckets.get(catId) ?? [],
    };
  });
}

function prettyGroupName(id: string): string {
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

function newGroupId(): string {
  return `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function setWaypointGroups(prefs: Preferences, groups: WaypointGroup[]): Preferences {
  return { ...prefs, waypointGroups: groups };
}

export function addWaypointGroup(prefs: Preferences, name: string): Preferences {
  const id = newGroupId();
  return setWaypointGroups(prefs, [
    ...prefs.waypointGroups,
    { id, name: name.trim() || 'New group', waypointIds: [] },
  ]);
}

export function removeWaypointGroup(prefs: Preferences, groupId: string): Preferences {
  return setWaypointGroups(
    prefs,
    prefs.waypointGroups.filter((g) => g.id !== groupId),
  );
}

export function renameWaypointGroup(
  prefs: Preferences,
  groupId: string,
  name: string,
): Preferences {
  const trimmed = name.trim();
  if (!trimmed) return prefs;
  return setWaypointGroups(
    prefs,
    prefs.waypointGroups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
  );
}

export function setGroupCollapsed(
  prefs: Preferences,
  groupId: string,
  collapsed: boolean,
): Preferences {
  return setWaypointGroups(
    prefs,
    prefs.waypointGroups.map((g) => (g.id === groupId ? { ...g, collapsed } : g)),
  );
}

export function addWaypointToGroup(
  prefs: Preferences,
  groupId: string,
  waypointId: string,
): Preferences {
  return setWaypointGroups(
    prefs,
    prefs.waypointGroups.map((g) =>
      g.id === groupId && !g.waypointIds.includes(waypointId)
        ? { ...g, waypointIds: [...g.waypointIds, waypointId] }
        : g,
    ),
  );
}

export function removeWaypointFromGroup(
  prefs: Preferences,
  groupId: string,
  waypointId: string,
): Preferences {
  return setWaypointGroups(
    prefs,
    prefs.waypointGroups.map((g) =>
      g.id === groupId
        ? { ...g, waypointIds: g.waypointIds.filter((id) => id !== waypointId) }
        : g,
    ),
  );
}

export function setGroupWaypointOrder(
  prefs: Preferences,
  groupId: string,
  ids: string[],
): Preferences {
  return setWaypointGroups(
    prefs,
    prefs.waypointGroups.map((g) => (g.id === groupId ? { ...g, waypointIds: ids } : g)),
  );
}
