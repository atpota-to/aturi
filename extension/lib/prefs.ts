import { browser } from '#imports';
import {
  CATEGORY_ORDER,
  WAYPOINT_CATEGORIES_DATA,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  type RedirectCompatFamily,
  type WaypointType,
} from '@aturi/waypoints.data';
import type { SourceApp } from '@aturi/reverseParsers';
import { debugLog } from './debugLog';

type StorageArea = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type CustomWaypoint = {
  id: string;
  name: string;
  domain: string;
  category: string;
  supportedTypes: WaypointType[];
  templates: Partial<Record<WaypointType, string>>;
  /**
   * Data families this custom waypoint participates in for auto-redirect. When
   * unset (or empty), the waypoint never acts as an auto-redirect source or
   * destination across apps. Users can opt in via the Custom tab.
   */
  redirectCompat?: RedirectCompatFamily[];
};

export type RecentEntry = {
  waypointId: string;
  lastUsed: number;
  count: number;
};

/**
 * A user-defined (or migrated) waypoint group. Each group has its own
 * ordered list of waypoint ids; waypoints can appear in multiple groups,
 * and waypoints not in any group are hidden from the popup.
 */
export type WaypointGroup = {
  id: string;
  name: string;
  waypointIds: string[];
  collapsed?: boolean;
};

/**
 * Sentinel value stored in `defaults[source][type]` to opt that specific
 * source/type combination *out* of redirection, even when a favorite is set.
 */
export const REDIRECT_OFF = '__off__';

/**
 * Persisted user preferences. A key inside `defaults` is either a known
 * `SourceApp` id or a custom waypoint id (`custom:<uuid>`), which also acts as
 * a source when the user is browsing that custom site. Cell values may be a
 * waypoint id, the `REDIRECT_OFF` sentinel, or absent (use favorite).
 */
export type Prefs = {
  autoRedirect: boolean;
  historyEnabled: boolean;
  /**
   * @deprecated Replaced by `favoriteByFamily`. Kept on the type so legacy
   * payloads still typecheck during migration; new code should read from
   * `favoriteByFamily` instead.
   */
  favoriteWaypointId: string | null;
  /**
   * Per-compat-family favorite waypoints. When a source is browsed and no
   * explicit per-source override is set, the redirect target is looked up
   * here by walking the source's `redirectCompat` keys. A `null` value means
   * "explicitly no favorite set for this family".
   */
  favoriteByFamily: Partial<Record<RedirectCompatFamily, string | null>>;
  defaults: Record<string, Partial<Record<WaypointType, string>>>;
  /**
   * @deprecated Replaced by `waypointGroups`. Read for migration only.
   * A waypoint is now hidden when it does not appear in any group.
   */
  hiddenWaypoints: string[];
  customWaypoints: CustomWaypoint[];
  recents: RecentEntry[];
  /**
   * @deprecated Replaced by `waypointGroups`. Read for migration only.
   */
  waypointOrder: string[];
  /**
   * @deprecated Replaced by `waypointGroups`. Read for migration only.
   */
  categoryOverrides: Record<string, string>;
  /**
   * User-defined groups of waypoints. Order of groups = display order.
   * Each group's `waypointIds` is the order of waypoints inside it.
   * The same waypoint id may appear in multiple groups.
   */
  waypointGroups: WaypointGroup[];
  /**
   * When true (default), the popup surfaces a "Recommended" row tailored to
   * the current AT URI's collection (e.g. Standard Site collections suggest
   * Leaflet/Offprint/pckt). When false, the recommendation row is hidden and
   * the popup only shows the user's defined groups in their chosen order.
   */
  smartRecommendations: boolean;
  /**
   * @deprecated The popup now uses a single `historyEnabled` toggle to
   * control both tracking and display of the Recents row. Kept on the type
   * so existing storage payloads still typecheck during migration; new code
   * should read from `historyEnabled` instead.
   */
  showRecents: boolean;
  /**
   * When true (default), opening a waypoint from the popup creates a new
   * browser tab. When false, the current tab is navigated to the waypoint
   * URL instead.
   */
  openInNewTab: boolean;
  /**
   * When true, the popup renders waypoints in a denser layout: smaller
   * icons, tighter rows, and the secondary description line is hidden so
   * more entries fit on screen at once. Off by default.
   */
  compactMode: boolean;
  /**
   * Color theme for the popup and settings page. Dark by default.
   */
  theme: 'dark' | 'light';
  /**
   * Text size preset. Scales font sizes across the popup and settings page;
   * `medium` is the new default and slightly larger than the previous baseline.
   */
  fontSize: 'small' | 'medium' | 'large' | 'xlarge';
  /**
   * Built-in waypoint ids the user has been notified about. Used to surface
   * "New" badges in the popup and Settings → Waypoints when the extension
   * adds new built-ins via update. Custom waypoints are not tracked here.
   *
   * Seeded the first time prefs are read: for existing installs we mark
   * everything already in their groups (or previously hidden) as known, so
   * only genuinely new built-ins get flagged. Brand-new installs are seeded
   * with the full current built-in list — nothing is "new" on day one.
   */
  knownWaypointIds: string[];
  /**
   * The popup tab the user landed on last. The popup has two modes: the
   * existing Waypoints view (jump between Atmosphere apps) and the
   * Inspect view (surface AT URIs on the current page). Only honored
   * when `popupModeRemember` is true and `popupModeLastUsedAt` is within
   * the TTL window — otherwise the popup opens to `popupModeDefault`.
   */
  popupMode?: 'waypoints' | 'inspect';
  /**
   * The tab the popup opens to by default. Used when there's no
   * remembered last-used tab, when the remember-window has expired, or
   * when remember is turned off entirely.
   */
  popupModeDefault: 'waypoints' | 'inspect';
  /**
   * When true (default), the popup reopens to whichever tab the user was
   * last on, subject to `popupModeRememberMinutes`. When false, every
   * popup launch starts on `popupModeDefault`.
   */
  popupModeRemember: boolean;
  /**
   * How long (in minutes) the remembered last-used tab stays in effect
   * before the popup falls back to `popupModeDefault`. Default 30.
   * Valid range: 5–1440 minutes.
   */
  popupModeRememberMinutes: number;
  /**
   * Timestamp (ms since epoch) of the last time the user clicked a popup
   * tab. Used together with `popupModeRememberMinutes` to decide whether
   * `popupMode` is still fresh enough to honor on the next launch.
   */
  popupModeLastUsedAt: number;
  /**
   * When true (default), the popup calls describeRepo on the target DID
   * and uses the resulting collection list to (a) dim waypoints whose
   * expectedCollections aren't in the repo with a "no records found"
   * caption, and (b) sort confirmed-present waypoints to the top of
   * smart recommendations. Adds one PDS roundtrip per target repo
   * (cached for an hour); turn off to suppress that traffic.
   */
  pdsRecordScan: boolean;
  /**
   * When true (default), a content script scans every page you visit for
   * AT URIs (head/meta/link tags, plus URL pattern) and surfaces a count
   * badge on the toolbar icon. Turn off if you'd rather only scan when
   * you open the popup's Inspect tab.
   */
  passiveScanEnabled: boolean;
};

const CUSTOM_GROUP_ID = 'custom';
const CUSTOM_GROUP_NAME = 'Custom';

export const DEFAULT_PREFS: Prefs = {
  autoRedirect: false,
  historyEnabled: true,
  favoriteWaypointId: null,
  favoriteByFamily: {},
  defaults: {},
  hiddenWaypoints: [],
  customWaypoints: [],
  recents: [],
  waypointOrder: [],
  categoryOverrides: {},
  waypointGroups: defaultWaypointGroups(),
  smartRecommendations: true,
  showRecents: true,
  openInNewTab: false,
  compactMode: false,
  theme: 'dark',
  fontSize: 'medium',
  knownWaypointIds: [...WAYPOINT_ORDER],
  popupMode: 'waypoints',
  popupModeDefault: 'waypoints',
  popupModeRemember: true,
  popupModeRememberMinutes: 30,
  popupModeLastUsedAt: 0,
  pdsRecordScan: true,
  passiveScanEnabled: true,
};

/**
 * Build the default set of groups from the built-in category metadata,
 * mirroring what users used to see before the groups redesign.
 */
export function defaultWaypointGroups(
  customWaypoints: CustomWaypoint[] = []
): WaypointGroup[] {
  const groups: WaypointGroup[] = [];
  for (const catId of CATEGORY_ORDER) {
    const meta = WAYPOINT_CATEGORIES_DATA[catId];
    const ids = WAYPOINT_ORDER.filter(
      id => WAYPOINT_DESTINATIONS_DATA[id]?.category === catId
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
      waypointIds: customWaypoints.map(c => c.id),
    });
  }
  return groups;
}

/**
 * Migrate a legacy prefs object (with `waypointOrder` / `hiddenWaypoints` /
 * `categoryOverrides` but no `waypointGroups`) into a `waypointGroups` array
 * so the user's previous arrangement is preserved.
 */
export function migrateToGroups(partial: Partial<Prefs>): WaypointGroup[] {
  const customWaypoints = partial.customWaypoints ?? [];
  const hidden = new Set(partial.hiddenWaypoints ?? []);
  const overrides = partial.categoryOverrides ?? {};
  const order = partial.waypointOrder ?? [];

  const customIds = new Set(customWaypoints.map(c => c.id));

  function effectiveCategoryFor(id: string): string {
    if (overrides[id]) return overrides[id];
    if (customIds.has(id)) return CUSTOM_GROUP_ID;
    return WAYPOINT_DESTINATIONS_DATA[id]?.category ?? CUSTOM_GROUP_ID;
  }

  const fallbackOrder = [...WAYPOINT_ORDER, ...customWaypoints.map(c => c.id)];
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

  return headerOrder.map(catId => {
    const meta = WAYPOINT_CATEGORIES_DATA[catId];
    const name =
      catId === CUSTOM_GROUP_ID
        ? CUSTOM_GROUP_NAME
        : meta?.name ?? prettyGroupName(catId);
    return {
      id: catId,
      name,
      waypointIds: buckets.get(catId) ?? [],
    };
  });
}

function prettyGroupName(id: string): string {
  return id.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

const STORAGE_KEY = 'aturi.prefs.v1';
const RECENTS_CAP = 20;

function getSyncArea(): StorageArea | null {
  if (typeof browser !== 'undefined' && browser.storage?.sync) {
    return browser.storage.sync as unknown as StorageArea;
  }
  return null;
}

function getLocalArea(): StorageArea | null {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local as unknown as StorageArea;
  }
  return null;
}

function mergePrefs(partial: Partial<Prefs> | undefined): Prefs {
  if (!partial) {
    return {
      ...DEFAULT_PREFS,
      waypointGroups: defaultWaypointGroups(),
      // Brand-new install: everything is "already known", nothing is new.
      knownWaypointIds: [...WAYPOINT_ORDER],
    };
  }

  // Once `waypointGroups` exists in the saved payload, trust it (even if
  // empty -- that reflects an intentional user choice). Only fall back to
  // migration / defaults when the field has never been written.
  const hasGroupsField = Array.isArray(partial.waypointGroups);
  const hasLegacyData =
    (partial.waypointOrder && partial.waypointOrder.length > 0) ||
    (partial.hiddenWaypoints && partial.hiddenWaypoints.length > 0) ||
    (partial.categoryOverrides && Object.keys(partial.categoryOverrides).length > 0);

  let waypointGroups: WaypointGroup[];
  if (hasGroupsField) {
    waypointGroups = partial.waypointGroups!.map(g => ({
      id: g.id,
      name: g.name,
      waypointIds: Array.isArray(g.waypointIds) ? [...g.waypointIds] : [],
      collapsed: g.collapsed,
    }));
  } else if (hasLegacyData) {
    waypointGroups = migrateToGroups(partial);
  } else {
    waypointGroups = defaultWaypointGroups(partial.customWaypoints);
  }

  const favoriteByFamily = migrateFavoriteByFamily(partial);
  const knownWaypointIds = migrateKnownWaypointIds(partial, waypointGroups);

  return {
    ...DEFAULT_PREFS,
    ...partial,
    favoriteWaypointId: partial.favoriteWaypointId ?? DEFAULT_PREFS.favoriteWaypointId,
    favoriteByFamily,
    defaults: { ...DEFAULT_PREFS.defaults, ...(partial.defaults ?? {}) },
    hiddenWaypoints: partial.hiddenWaypoints ?? DEFAULT_PREFS.hiddenWaypoints,
    customWaypoints: partial.customWaypoints ?? DEFAULT_PREFS.customWaypoints,
    recents: partial.recents ?? DEFAULT_PREFS.recents,
    waypointOrder: partial.waypointOrder ?? DEFAULT_PREFS.waypointOrder,
    categoryOverrides: partial.categoryOverrides ?? DEFAULT_PREFS.categoryOverrides,
    waypointGroups,
    knownWaypointIds,
  };
}

/**
 * Seed `knownWaypointIds` for existing installs that predate the field.
 * Anything currently in a group or in the legacy `hiddenWaypoints` list is
 * treated as already "seen"; the diff against the current built-in list is
 * what shows up as new in the popup banner.
 *
 * Trust an explicit empty array from storage (the user dismissed and then
 * we somehow ended up with no built-ins added since — that's fine), but
 * fall back to seeding when the field is entirely absent.
 */
function migrateKnownWaypointIds(
  partial: Partial<Prefs>,
  waypointGroups: WaypointGroup[]
): string[] {
  if (Array.isArray(partial.knownWaypointIds)) {
    return partial.knownWaypointIds.filter(id => typeof id === 'string');
  }

  const seed = new Set<string>();
  for (const group of waypointGroups) {
    for (const id of group.waypointIds) {
      if (!id.startsWith('custom:')) seed.add(id);
    }
  }
  for (const id of partial.hiddenWaypoints ?? []) {
    if (typeof id === 'string' && !id.startsWith('custom:')) seed.add(id);
  }
  if (seed.size === 0) {
    // No signal in the stored prefs — treat as a fresh install and consider
    // every built-in already known, so we don't blast the user with a "25
    // new waypoints" banner the first time they open the popup post-upgrade.
    return [...WAYPOINT_ORDER];
  }
  return Array.from(seed);
}

/**
 * Migrate the legacy single `favoriteWaypointId` into a `favoriteByFamily`
 * map. If the user already has a `favoriteByFamily` entry we trust it. When
 * only the legacy field is present, seed every family that the chosen
 * waypoint belongs to with its id - this preserves the pre-compat behavior
 * for the user's existing favorite while letting them pick per-family
 * favorites going forward.
 */
function migrateFavoriteByFamily(
  partial: Partial<Prefs>
): Partial<Record<RedirectCompatFamily, string | null>> {
  const hasNewField =
    partial.favoriteByFamily && typeof partial.favoriteByFamily === 'object';
  if (hasNewField) {
    return { ...(partial.favoriteByFamily as Record<string, string | null>) };
  }

  const legacy = partial.favoriteWaypointId;
  if (!legacy) return {};

  const waypoint = WAYPOINT_DESTINATIONS_DATA[legacy];
  const compat = waypoint?.redirectCompat ?? [];
  if (compat.length === 0) return {};

  const next: Partial<Record<RedirectCompatFamily, string | null>> = {};
  for (const family of compat) next[family] = legacy;
  return next;
}

async function readFrom(
  area: StorageArea | null
): Promise<{ prefs: Prefs; savedAt: number } | null> {
  if (!area) return null;
  try {
    const items = (await area.get(STORAGE_KEY)) as Record<string, unknown> | undefined;
    const raw = items?.[STORAGE_KEY] as (Partial<Prefs> & { _savedAt?: number }) | undefined;
    if (!raw) return null;
    const savedAt = typeof raw._savedAt === 'number' ? raw._savedAt : 0;
    return { prefs: mergePrefs(raw), savedAt };
  } catch (err) {
    console.warn('[aturi:prefs] read failed', err);
    return null;
  }
}

async function writeTo(
  area: StorageArea | null,
  prefs: Prefs,
  savedAt: number
): Promise<boolean> {
  if (!area) return false;
  try {
    await area.set({ [STORAGE_KEY]: { ...prefs, _savedAt: savedAt } });
    return true;
  } catch (err) {
    console.warn('[aturi:prefs] write failed', err);
    return false;
  }
}

/**
 * Load preferences, trying `chrome.storage.sync` first and falling back to
 * `chrome.storage.local` (used when sync quota is exceeded, notably when the
 * user has many custom waypoints).
 */
export async function loadPrefs(): Promise<Prefs> {
  const [synced, local] = await Promise.all([
    readFrom(getSyncArea()),
    readFrom(getLocalArea()),
  ]);

  // Prefer whichever area was written most recently. This is what makes the
  // local fallback actually work: when a sync write fails on quota (the "many
  // custom waypoints" case) and falls back to local, the local copy is newer
  // and wins here — otherwise loadPrefs would keep returning the stale synced
  // copy and every later edit would silently revert on the next load.
  if (synced && local) {
    return (local.savedAt > synced.savedAt ? local : synced).prefs;
  }
  return (synced ?? local)?.prefs ?? { ...DEFAULT_PREFS };
}

/**
 * Persist a partial update on top of the existing prefs. Writes to
 * `chrome.storage.sync` when possible; falls back to `local` if the sync
 * quota is hit.
 */
// Serialize writes through a single promise chain. Callers fire savePrefs
// without awaiting from several places (popup + options, rapid toggles); run
// concurrently they would each read the same base via loadPrefs and the last
// write would clobber the others. Chaining guarantees each save re-reads the
// freshest prefs inside its own turn.
let saveQueue: Promise<Prefs> = Promise.resolve({ ...DEFAULT_PREFS });

export function savePrefs(update: Partial<Prefs>): Promise<Prefs> {
  const run = () => doSavePrefs(update);
  saveQueue = saveQueue.then(run, run);
  return saveQueue;
}

async function doSavePrefs(update: Partial<Prefs>): Promise<Prefs> {
  const current = await loadPrefs();
  const next: Prefs = {
    ...current,
    ...update,
    favoriteWaypointId:
      update.favoriteWaypointId !== undefined
        ? update.favoriteWaypointId
        : current.favoriteWaypointId,
    favoriteByFamily:
      update.favoriteByFamily !== undefined
        ? update.favoriteByFamily
        : current.favoriteByFamily,
    defaults: update.defaults ?? current.defaults,
    hiddenWaypoints: update.hiddenWaypoints ?? current.hiddenWaypoints,
    customWaypoints: update.customWaypoints ?? current.customWaypoints,
    recents: update.recents ?? current.recents,
    waypointOrder: update.waypointOrder ?? current.waypointOrder,
    categoryOverrides: update.categoryOverrides ?? current.categoryOverrides,
    waypointGroups: update.waypointGroups ?? current.waypointGroups,
    knownWaypointIds: update.knownWaypointIds ?? current.knownWaypointIds,
  };

  const savedAt = Date.now();
  const syncOk = await writeTo(getSyncArea(), next, savedAt);
  if (!syncOk) {
    await writeTo(getLocalArea(), next, savedAt);
  }

  debugLog('savePrefs', { keys: Object.keys(update), storedTo: syncOk ? 'sync' : 'local' });
  return next;
}

export type PrefsChangeListener = (prefs: Prefs) => void;

/**
 * Subscribe to preference changes across storage areas. Returns an unsubscribe
 * function.
 */
export function onPrefsChanged(listener: PrefsChangeListener): () => void {
  if (typeof browser === 'undefined' || !browser.storage?.onChanged) {
    return () => undefined;
  }

  const handler = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area: string
  ) => {
    if ((area === 'sync' || area === 'local') && changes[STORAGE_KEY]) {
      const next = changes[STORAGE_KEY].newValue as Partial<Prefs> | undefined;
      listener(mergePrefs(next));
    }
  };

  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}

/**
 * Record that the user chose `waypointId`, bumping its use count and moving it
 * to the top of the recents list (respecting RECENTS_CAP). No-ops when history
 * tracking is disabled.
 */
export async function bumpRecent(waypointId: string): Promise<void> {
  const current = await loadPrefs();
  if (!current.historyEnabled) return;

  const now = Date.now();
  const existing = current.recents.find(r => r.waypointId === waypointId);
  const nextEntry: RecentEntry = existing
    ? { waypointId, lastUsed: now, count: existing.count + 1 }
    : { waypointId, lastUsed: now, count: 1 };

  const without = current.recents.filter(r => r.waypointId !== waypointId);
  const recents = [nextEntry, ...without]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, RECENTS_CAP);

  await savePrefs({ recents });
}

export async function clearRecents(): Promise<void> {
  await savePrefs({ recents: [] });
}

export function getDefaultFor(
  prefs: Prefs,
  source: SourceApp | string,
  type: WaypointType
): string | null {
  const forSource = prefs.defaults[source];
  if (!forSource) return null;
  return forSource[type] ?? null;
}

/**
 * Resolve the effective destination waypoint id for a given source/type
 * combination, accounting for explicit overrides, the off-sentinel, and the
 * per-family favorite waypoints.
 *
 * Favorites are looked up *per compat family*: a source inherits a favorite
 * only for the families it belongs to. That's what keeps e.g. a global
 * favorite of "anisota" from trying to redirect leaflet → anisota. A source
 * with no compat families can only redirect via an explicit per-source
 * override.
 *
 * Returns:
 * - the waypoint id to redirect to, or
 * - `null` to mean "do not redirect" (no rule emitted, popup still works).
 */
export function resolveRedirectFor(
  prefs: Prefs,
  source: SourceApp | string,
  type: WaypointType
): string | null {
  const explicit = getDefaultFor(prefs, source, type);
  if (explicit === REDIRECT_OFF) return null;
  if (explicit && explicit !== '') return explicit;

  const sourceCompat = getRedirectCompatFor(source, prefs.customWaypoints);
  for (const family of sourceCompat) {
    const id = prefs.favoriteByFamily?.[family];
    if (id) return id;
  }
  return null;
}

/**
 * Get the compat families for a waypoint id (built-in or custom). Returns an
 * empty array when the waypoint doesn't exist or explicitly opts out of
 * cross-app redirects.
 */
export function getRedirectCompatFor(
  waypointId: string,
  customWaypoints: CustomWaypoint[]
): RedirectCompatFamily[] {
  if (waypointId.startsWith('custom:')) {
    const cw = customWaypoints.find(c => c.id === waypointId);
    return cw?.redirectCompat ?? [];
  }
  const waypoint = WAYPOINT_DESTINATIONS_DATA[waypointId];
  return waypoint?.redirectCompat ?? [];
}

/**
 * Two waypoints are redirect-compatible when they share at least one compat
 * family. A waypoint with no families is never compatible with anything.
 */
export function areRedirectCompatible(
  sourceId: string,
  destinationId: string,
  customWaypoints: CustomWaypoint[]
): boolean {
  const src = getRedirectCompatFor(sourceId, customWaypoints);
  if (src.length === 0) return false;
  const dst = getRedirectCompatFor(destinationId, customWaypoints);
  if (dst.length === 0) return false;
  for (const f of src) if (dst.includes(f)) return true;
  return false;
}

export function setFavoriteForFamily(
  prefs: Prefs,
  family: RedirectCompatFamily,
  waypointId: string | null
): Prefs {
  const next = { ...(prefs.favoriteByFamily ?? {}) };
  if (waypointId) {
    next[family] = waypointId;
  } else {
    delete next[family];
  }
  return { ...prefs, favoriteByFamily: next };
}

export function setDefaultFor(
  prefs: Prefs,
  source: SourceApp | string,
  type: WaypointType,
  waypointId: string | null
): Prefs {
  const next: Prefs = {
    ...prefs,
    defaults: { ...prefs.defaults },
  };
  const forSource = { ...(next.defaults[source] ?? {}) };
  if (waypointId) {
    forSource[type] = waypointId;
  } else {
    delete forSource[type];
  }
  if (Object.keys(forSource).length === 0) {
    delete next.defaults[source];
  } else {
    next.defaults[source] = forSource;
  }
  return next;
}

export function toggleHidden(prefs: Prefs, waypointId: string, hidden: boolean): Prefs {
  const set = new Set(prefs.hiddenWaypoints);
  if (hidden) set.add(waypointId); else set.delete(waypointId);
  return { ...prefs, hiddenWaypoints: Array.from(set) };
}

/**
 * Reorder waypoints. `nextOrder` should be the full ordered list of waypoint
 * ids; ids not in the list will fall back to the default order behind them.
 */
export function setWaypointOrder(prefs: Prefs, nextOrder: string[]): Prefs {
  return { ...prefs, waypointOrder: [...nextOrder] };
}

/**
 * Override the category for a waypoint. Pass `null` to clear the override.
 */
export function setCategoryOverride(
  prefs: Prefs,
  waypointId: string,
  category: string | null
): Prefs {
  const next = { ...prefs.categoryOverrides };
  if (category === null || category === '') {
    delete next[waypointId];
  } else {
    next[waypointId] = category;
  }
  return { ...prefs, categoryOverrides: next };
}

// --- Group helpers (the new model) -----------------------------------------

export function setWaypointGroups(prefs: Prefs, groups: WaypointGroup[]): Prefs {
  return { ...prefs, waypointGroups: groups.map(g => ({ ...g, waypointIds: [...g.waypointIds] })) };
}

export function addWaypointGroup(prefs: Prefs, name: string): Prefs {
  const id = `group:${(globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36))}`;
  const group: WaypointGroup = {
    id,
    name: name.trim() || 'New group',
    waypointIds: [],
  };
  return { ...prefs, waypointGroups: [...prefs.waypointGroups, group] };
}

export function removeWaypointGroup(prefs: Prefs, groupId: string): Prefs {
  return {
    ...prefs,
    waypointGroups: prefs.waypointGroups.filter(g => g.id !== groupId),
  };
}

export function renameWaypointGroup(
  prefs: Prefs,
  groupId: string,
  name: string
): Prefs {
  return {
    ...prefs,
    waypointGroups: prefs.waypointGroups.map(g =>
      g.id === groupId ? { ...g, name: name.trim() || g.name } : g
    ),
  };
}

export function setGroupCollapsed(
  prefs: Prefs,
  groupId: string,
  collapsed: boolean
): Prefs {
  return {
    ...prefs,
    waypointGroups: prefs.waypointGroups.map(g =>
      g.id === groupId ? { ...g, collapsed } : g
    ),
  };
}

export function addWaypointToGroup(
  prefs: Prefs,
  groupId: string,
  waypointId: string
): Prefs {
  const isBuiltin = !waypointId.startsWith('custom:');
  const knownWaypointIds =
    isBuiltin && !prefs.knownWaypointIds.includes(waypointId)
      ? [...prefs.knownWaypointIds, waypointId]
      : prefs.knownWaypointIds;
  return {
    ...prefs,
    knownWaypointIds,
    waypointGroups: prefs.waypointGroups.map(g => {
      if (g.id !== groupId) return g;
      if (g.waypointIds.includes(waypointId)) return g;
      return { ...g, waypointIds: [...g.waypointIds, waypointId] };
    }),
  };
}

/**
 * Persist that the user has been notified about the given built-in waypoint
 * ids — typically called when they dismiss the "new waypoints" banner in the
 * popup, or after they add a new waypoint to a group via Settings.
 */
export async function markWaypointsKnown(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const current = await loadPrefs();
  const set = new Set(current.knownWaypointIds);
  const newlyMarked: string[] = [];
  for (const id of ids) {
    if (id.startsWith('custom:')) continue;
    if (!set.has(id)) {
      set.add(id);
      newlyMarked.push(id);
    }
  }
  if (newlyMarked.length === 0) return;
  debugLog('markWaypointsKnown', { ids: newlyMarked });
  await savePrefs({ knownWaypointIds: Array.from(set) });
}

export function removeWaypointFromGroup(
  prefs: Prefs,
  groupId: string,
  waypointId: string
): Prefs {
  return {
    ...prefs,
    waypointGroups: prefs.waypointGroups.map(g =>
      g.id === groupId
        ? { ...g, waypointIds: g.waypointIds.filter(id => id !== waypointId) }
        : g
    ),
  };
}

export function setGroupWaypointOrder(
  prefs: Prefs,
  groupId: string,
  ids: string[]
): Prefs {
  return {
    ...prefs,
    waypointGroups: prefs.waypointGroups.map(g =>
      g.id === groupId ? { ...g, waypointIds: [...ids] } : g
    ),
  };
}
