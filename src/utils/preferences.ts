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
  DEFAULT_COLOR_SCHEME,
  isColorScheme,
  type ColorScheme,
} from '@/lib/colorScheme';
import {
  CATEGORY_ORDER,
  COMPAT_FAMILY_ORDER,
  WAYPOINT_CATEGORIES_DATA,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  type RedirectCompatFamily,
  type WaypointType,
} from './waypoints.data';
import { LATEST_RELEASE_ID } from './releaseNotes';
import {
  DEFAULT_RECORD_SECTIONS,
  DEFAULT_REPO_SECTIONS,
  countVisibleGuaranteed,
  defaultSectionsFor,
  isGuaranteedDataView,
  isValidSectionConfig,
  reconcileSections,
  sectionHidden,
  type ExplorePage,
  type SectionConfig,
} from './exploreSections';

export type { SectionConfig, ExplorePage } from './exploreSections';

const LS_KEY = 'aturi.prefs.v1';

export type CustomWaypoint = {
  id: string;                                 // 'custom:<uuid>'
  name: string;
  domain?: string;                            // display hint, not used for routing
  description?: string;
  supportedTypes: WaypointType[];
  /** URL templates with `{handle}`, `{did}`, `{collection}`, `{rkey}` placeholders. */
  templates: Partial<Record<WaypointType, string>>;
  /**
   * Data families this custom waypoint participates in for auto-redirect,
   * mirroring `redirectCompat` on the built-ins. Unset or empty means the
   * waypoint is never an auto-redirect destination — the right default, since
   * a personal bookmark usually isn't a client anyone wants links rewritten
   * to. Shares the field name with the extension's `CustomWaypoint` so the
   * PDS record round-trips between the two surfaces.
   */
  redirectCompat?: RedirectCompatFamily[];
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

/**
 * How the universal-link picker draws its waypoints.
 *
 *   - `dense`   — one line per waypoint: mark, name, host. The default.
 *   - `grid`    — icon tiles, names only, no descriptions or copy buttons.
 *   - `classic` — the original full-width cards with descriptions and
 *                 collapsible category headers (`CategoryCard`).
 *
 * A post page offers 29 destinations, and as full cards that is most of a
 * phone's scroll before the first tap; `dense` fits the same list in about
 * a third of the height. `classic` stays available for anyone who wants the
 * descriptions back.
 */
export type WaypointLayout = 'dense' | 'grid' | 'classic';

export const WAYPOINT_LAYOUTS: readonly WaypointLayout[] = ['dense', 'grid', 'classic'];

export const DEFAULT_WAYPOINT_LAYOUT: WaypointLayout = 'dense';

export function isWaypointLayout(v: unknown): v is WaypointLayout {
  return typeof v === 'string' && (WAYPOINT_LAYOUTS as readonly string[]).includes(v);
}

export type Preferences = {
  /**
   * The app-wide color palette — see `COLOR_SCHEMES` in
   * `src/lib/colorScheme.ts` for the full list. Each scheme has a dark and
   * a light variant; which of the two is showing is
   * the separate, browser-local `theme` choice (see `src/lib/theme.ts`).
   * This one lives in prefs so a user's palette follows them across
   * devices. `ColorSchemeSync` applies it to <html data-scheme> and keeps
   * the pre-paint localStorage cache current.
   */
  colorScheme: ColorScheme;
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
   * Master switch for auto-redirect on universal-link pages. When on, landing
   * on an aturi.to waypoint page sends the visitor straight to their preferred
   * client for that data family instead of showing the picker.
   *
   * Off by default, and deliberately so: turning it on makes aturi's own page —
   * the preview, the picker, the explorer links — invisible to the person who
   * set it. That's the point of the feature, and it's also why it's never on
   * without an explicit choice. `favoriteByFamily` decides where each link
   * actually goes; this only decides whether that choice is acted on.
   */
  autoRedirect: boolean;
  /**
   * Preferred waypoint per compat family (see `RedirectCompatFamily` in
   * `waypoints.data.ts`). A universal link is redirected to the first family
   * favorite that can actually render the record in question, walking
   * `COMPAT_FAMILY_ORDER`. `null` means "explicitly no favorite for this
   * family" and is treated the same as absent.
   *
   * The name and shape mirror the extension's `favoriteByFamily`
   * (`extension/lib/prefs.ts`) exactly, so the two surfaces agree about what a
   * stored preference means and the PDS record round-trips between them.
   */
  favoriteByFamily: Partial<Record<RedirectCompatFamily, string | null>>;
  /**
   * Which of the three picker layouts to draw — see `WaypointLayout`.
   * Anything unrecognised (an older/newer client, a hand-edited PDS record)
   * falls back to the default rather than rendering nothing.
   */
  waypointLayout: WaypointLayout;
  /**
   * Built-in waypoint ids the user has already been notified about. When a
   * new built-in ships, it won't be in this list, so the picker and settings
   * surface a "new waypoint" banner offering to add it. Mirrors the
   * extension's `knownWaypointIds`. Seeded from the user's existing groups on
   * first read after this field shipped, so an upgrade doesn't flag every
   * waypoint as new.
   */
  knownWaypointIds: string[];
  /**
   * Id of the newest release whose notes the user has seen, from
   * `releaseNotes.ts`. Anything newer surfaces in the header badge and — if
   * `announceReleases` is on — the "What's new" modal.
   *
   * Defaults to the newest shipped release, so a first-time visitor starts
   * caught up and is never greeted by a changelog. An existing user whose
   * stored preferences predate this field migrates to `''` instead, which
   * `unseenReleases` reads as "announce only the newest" — they hear about
   * the current release once rather than the whole history.
   */
  lastSeenReleaseId: string;
  /**
   * Whether to interrupt with the "What's new" modal on the first visit after
   * a release. The header badge is unaffected and always available; this only
   * controls the popup, which is what the modal's "Don't show these again"
   * button turns off.
   */
  announceReleases: boolean;
  /**
   * NSIDs the user has pinned in the explorer's CollectionsTab. Shown at
   * the top of the list whenever the current repo has a matching
   * collection. In `split` mode this list is shown only on the user's
   * own repo; in `own` and `all` modes it's the single list used wherever
   * pins apply.
   */
  pinnedLexicons: string[];
  /**
   * Additional NSIDs pinned only for other people's repos when `pinScope`
   * is `split`. Empty/unused otherwise.
   */
  pinnedLexiconsOthers: string[];
  /**
   * Where the Pinned section shows up and which list backs it:
   *   - `own`:   shows `pinnedLexicons` only on the user's own repo.
   *   - `all`:   shows `pinnedLexicons` on every repo (own + others).
   *   - `split`: shows `pinnedLexicons` on own; `pinnedLexiconsOthers`
   *              on everyone else's.
   */
  pinScope: 'own' | 'all' | 'split';
  /**
   * Whether lexicon groups in the explorer's Collections tab should
   * start collapsed. Per-group toggles still work and stick for the
   * duration of the session, but the initial fallback (and the
   * "expand/collapse all" target) flips with this.
   */
  collectionGroupsCollapsedByDefault: boolean;
  /**
   * Hide the "You + @them" relationship strip on other people's repo pages
   * in the explorer. When off (default) the strip shows whenever it has a
   * signal to surface.
   */
  hideRelationshipBar: boolean;
  /**
   * Hide the "Repo at a glance" stats section on explorer repo pages
   * entirely. When off (default) the section shows and can be collapsed in
   * place instead (see `repoGlanceCollapsedByDefault`).
   */
  hideRepoGlance: boolean;
  /**
   * When "Repo at a glance" is shown, start it collapsed. The inline header
   * toggle still flips it for the session; this only sets the initial state.
   */
  repoGlanceCollapsedByDefault: boolean;
  /**
   * Show a minimal profile on explorer repo pages — just the DID, handle,
   * and PDS identity row — instead of the rich profile card. The page also
   * offers an inline switch to flip back to the full profile.
   */
  minimalProfile: boolean;
  /**
   * @deprecated Folded into `hideRichPreview` — both mean "collapse the rich
   * card on a record page, leaving the structured field view". Read once on
   * migration to seed `hideRichPreview`; no longer written by the UI.
   */
  minimalPostPreview: boolean;
  /**
   * Collapse the rich preview *card* on explorer record pages — the Bluesky
   * post card or an at.margin.* card. The structured field table and raw JSON
   * are separate sections with their own toggles, so hiding the card just
   * drops the rendering, not the record's data. Flipped by the inline
   * "Hide rich preview" switch beneath the card.
   */
  hideRichPreview: boolean;
  /**
   * Collapse the rich JSON preview (the structured field table) on explorer
   * record pages. Constrained against `showRawRecordJson`: the field table and
   * the raw JSON are the record's two data views, and at least one always stays
   * visible — hiding this forces raw JSON on. Flipped by the inline
   * "Hide rich JSON preview" switch beneath the table.
   */
  hideRichJsonPreview: boolean;
  /**
   * Show the raw (linkified) record JSON on explorer record pages. Replaces
   * the old always-present "Raw record JSON" disclosure with a persisted
   * toggle, surfaced by the inline "Show raw JSON" switch. See
   * `hideRichJsonPreview` for the "at least one data view" constraint.
   */
  showRawRecordJson: boolean;
  /**
   * Ordered, per-section visibility for explorer record pages. Array order
   * is display order; each entry's `hidden` toggles the section. This is the
   * source of truth — the `hideRichPreview` / `hideRichJsonPreview` /
   * `showRawRecordJson` booleans above are derived from it on write (and
   * seed it on migration) for back-compat. See `exploreSections.ts`.
   */
  recordSections: SectionConfig[];
  /**
   * Ordered, per-section visibility for explorer repo / profile pages.
   * Source of truth for `minimalProfile` / `hideRelationshipBar` /
   * `hideRepoGlance` (derived on write, seed on migration).
   */
  repoSections: SectionConfig[];
  /**
   * ISO timestamp of last local change. Used to break ties when local and
   * PDS prefs both exist on sign-in.
   */
  updatedAt: string;
};

export const CUSTOM_GROUP_ID = 'custom';
export const CUSTOM_GROUP_NAME = 'My Waypoints';

export const DEFAULT_PREFERENCES: Preferences = {
  colorScheme: DEFAULT_COLOR_SCHEME,
  waypointGroups: defaultWaypointGroups(),
  hiddenWaypoints: [],
  waypointOrder: [],
  customWaypoints: [],
  autoRedirect: false,
  favoriteByFamily: {},
  waypointLayout: DEFAULT_WAYPOINT_LAYOUT,
  knownWaypointIds: [...WAYPOINT_ORDER],
  lastSeenReleaseId: LATEST_RELEASE_ID,
  announceReleases: true,
  pinnedLexicons: [],
  pinnedLexiconsOthers: [],
  pinScope: 'own',
  collectionGroupsCollapsedByDefault: false,
  hideRelationshipBar: false,
  hideRepoGlance: false,
  repoGlanceCollapsedByDefault: false,
  minimalProfile: false,
  minimalPostPreview: false,
  hideRichPreview: false,
  hideRichJsonPreview: false,
  showRawRecordJson: false,
  recordSections: DEFAULT_RECORD_SECTIONS.map((s) => ({ ...s })),
  repoSections: DEFAULT_REPO_SECTIONS.map((s) => ({ ...s })),
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
  // Anything unrecognised (a scheme from a newer build, a hand-edited PDS
  // record) falls back to the default rather than leaving <html> pointing at
  // a palette that has no tokens behind it.
  const colorScheme = isColorScheme(input.colorScheme)
    ? input.colorScheme
    : DEFAULT_COLOR_SCHEME;
  const customWaypoints = Array.isArray(input.customWaypoints)
    ? input.customWaypoints.filter(isValidCustomWaypoint)
    : [];
  const autoRedirect =
    typeof input.autoRedirect === 'boolean' ? input.autoRedirect : false;
  const favoriteByFamily = sanitizeFavoriteByFamily(input.favoriteByFamily);
  const hiddenWaypoints = Array.isArray(input.hiddenWaypoints) ? input.hiddenWaypoints : [];
  const waypointOrder = Array.isArray(input.waypointOrder) ? input.waypointOrder : [];
  const storedGroups = Array.isArray(input.waypointGroups)
    ? input.waypointGroups.filter(isValidWaypointGroup)
    : [];
  const waypointGroups =
    storedGroups.length > 0
      ? storedGroups
      : migrateToGroups({ customWaypoints, hiddenWaypoints, waypointOrder });
  // Absent means the stored blob predates the layout switch: fall through to
  // the default, so existing users land on the compact list alongside new ones.
  const waypointLayout = isWaypointLayout(input.waypointLayout)
    ? input.waypointLayout
    : DEFAULT_WAYPOINT_LAYOUT;
  const knownWaypointIds = migrateKnownWaypointIds(input, waypointGroups, hiddenWaypoints);
  // Absent means these preferences predate release notes: leave the cursor
  // empty so `unseenReleases` announces the newest release once, rather than
  // defaulting to LATEST and silently swallowing it. An explicit empty string
  // from storage is honored for the same reason.
  const lastSeenReleaseId =
    typeof input.lastSeenReleaseId === 'string' ? input.lastSeenReleaseId : '';
  const announceReleases =
    typeof input.announceReleases === 'boolean' ? input.announceReleases : true;
  const pinnedLexicons = Array.isArray(input.pinnedLexicons)
    ? input.pinnedLexicons.filter((s): s is string => typeof s === 'string')
    : [];
  const pinnedLexiconsOthers = Array.isArray(input.pinnedLexiconsOthers)
    ? input.pinnedLexiconsOthers.filter((s): s is string => typeof s === 'string')
    : [];
  const pinScope: Preferences['pinScope'] =
    input.pinScope === 'all' || input.pinScope === 'own' || input.pinScope === 'split'
      ? input.pinScope
      : 'own';
  const collectionGroupsCollapsedByDefault =
    typeof input.collectionGroupsCollapsedByDefault === 'boolean'
      ? input.collectionGroupsCollapsedByDefault
      : false;
  const hideRelationshipBar =
    typeof input.hideRelationshipBar === 'boolean' ? input.hideRelationshipBar : false;
  const hideRepoGlance =
    typeof input.hideRepoGlance === 'boolean' ? input.hideRepoGlance : false;
  const repoGlanceCollapsedByDefault =
    typeof input.repoGlanceCollapsedByDefault === 'boolean'
      ? input.repoGlanceCollapsedByDefault
      : false;
  const minimalProfile =
    typeof input.minimalProfile === 'boolean' ? input.minimalProfile : false;
  const minimalPostPreview =
    typeof input.minimalPostPreview === 'boolean' ? input.minimalPostPreview : false;
  // `hideRichPreview` superseded the post-only `minimalPostPreview`; when a
  // stored blob predates it, carry the old value over so the user's choice to
  // collapse the post card survives the rename.
  const hideRichPreview =
    typeof input.hideRichPreview === 'boolean'
      ? input.hideRichPreview
      : minimalPostPreview;
  const hideRichJsonPreview =
    typeof input.hideRichJsonPreview === 'boolean' ? input.hideRichJsonPreview : false;
  const showRawRecordJson =
    typeof input.showRawRecordJson === 'boolean' ? input.showRawRecordJson : false;
  // Section layout is the source of truth: reconcile a saved list against
  // the current defaults, or — for prefs that predate it — seed it from the
  // per-section booleans so an existing user keeps their chosen layout.
  const recordSections = Array.isArray(input.recordSections)
    ? reconcileSections(input.recordSections.filter(isValidSectionConfig), DEFAULT_RECORD_SECTIONS)
    : DEFAULT_RECORD_SECTIONS.map((s) => {
        if (s.id === 'richPreview') return { ...s, hidden: hideRichPreview };
        if (s.id === 'structuredJson') return { ...s, hidden: hideRichJsonPreview };
        if (s.id === 'rawJson') return { ...s, hidden: !showRawRecordJson };
        return { ...s };
      });
  const repoSections = Array.isArray(input.repoSections)
    ? reconcileSections(input.repoSections.filter(isValidSectionConfig), DEFAULT_REPO_SECTIONS)
    : DEFAULT_REPO_SECTIONS.map((s) => {
        if (s.id === 'relationship') return { ...s, hidden: hideRelationshipBar };
        if (s.id === 'profile') return { ...s, hidden: minimalProfile };
        if (s.id === 'repoGlance') return { ...s, hidden: hideRepoGlance };
        return { ...s };
      });
  return {
    colorScheme,
    waypointGroups,
    hiddenWaypoints,
    waypointOrder,
    customWaypoints,
    autoRedirect,
    favoriteByFamily,
    waypointLayout,
    knownWaypointIds,
    lastSeenReleaseId,
    announceReleases,
    pinnedLexicons,
    pinnedLexiconsOthers,
    pinScope,
    collectionGroupsCollapsedByDefault,
    hideRelationshipBar,
    hideRepoGlance,
    repoGlanceCollapsedByDefault,
    minimalProfile,
    minimalPostPreview,
    hideRichPreview,
    hideRichJsonPreview,
    showRawRecordJson,
    recordSections,
    repoSections,
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
    c.supportedTypes.every((t) => typeof t === 'string') &&
    c.templates !== null &&
    typeof c.templates === 'object' &&
    // The preferences record is user-writable in the PDS; a template value
    // that isn't a string would crash expandTemplate() (String.replace) and
    // take down the whole waypoint picker. Reject the waypoint instead.
    Object.values(c.templates as Record<string, unknown>).every(
      (t) => typeof t === 'string',
    ) &&
    // Optional, but when present it gates auto-redirect — a non-array (or an
    // array of objects) would sail through `.includes()` and silently never
    // match, so reject the waypoint rather than ship a dead preference.
    (c.redirectCompat === undefined ||
      (Array.isArray(c.redirectCompat) &&
        c.redirectCompat.every((f) => typeof f === 'string')))
  );
}

/**
 * Keep only entries keyed by a family this build knows about and pointing at a
 * string waypoint id. Anything else — a family retired since the record was
 * written, a hand-edited PDS record, a newer client's key — is dropped rather
 * than carried, because an unrecognised family can never resolve to a
 * destination anyway. `null` is dropped too: it and "absent" mean the same
 * thing to every reader, so storing both spellings would be noise.
 *
 * Keys are emitted in `COMPAT_FAMILY_ORDER`, not source order, so two equal
 * maps always serialize identically — `preferencesAreEqual` compares these by
 * JSON, and insertion order would otherwise read as a change and trigger a
 * pointless PDS write.
 */
function sanitizeFavoriteByFamily(
  input: unknown,
): Partial<Record<RedirectCompatFamily, string | null>> {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const out: Partial<Record<RedirectCompatFamily, string | null>> = {};
  for (const family of COMPAT_FAMILY_ORDER) {
    const id = source[family];
    if (typeof id !== 'string' || id === '') continue;
    out[family] = id;
  }
  return out;
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

/**
 * Which of a custom waypoint's templates renders a given target, and the URL
 * that comes out of it. A record with a collection and rkey prefers the
 * template matching that collection (post / list), falls back to the generic
 * `record` one, and finally to `post`; anything without both is a profile.
 * `record` and `profile` act as last-resort fallbacks so a waypoint that only
 * declared one template still produces something rather than nothing.
 *
 * Shared by the picker (via `customToWaypoint`) and auto-redirect resolution,
 * which must agree about where a custom waypoint sends a given record.
 */
export function customWaypointUrl(
  waypoint: CustomWaypoint,
  ctx: { handle?: string; did?: string; collection?: string; rkey?: string },
): string | null {
  const isRecord = Boolean(ctx.collection && ctx.rkey);
  let key: WaypointType = 'profile';
  if (isRecord) {
    if (
      waypoint.supportedTypes.includes('post') &&
      ctx.collection === 'app.bsky.feed.post'
    ) {
      key = 'post';
    } else if (
      waypoint.supportedTypes.includes('list') &&
      ctx.collection === 'app.bsky.graph.list'
    ) {
      key = 'list';
    } else if (waypoint.supportedTypes.includes('record')) {
      key = 'record';
    } else {
      key = 'post';
    }
  }
  const template =
    waypoint.templates[key] || waypoint.templates.record || waypoint.templates.profile;
  if (!template) return null;
  return expandTemplate(template, ctx);
}

export function preferencesAreEqual(a: Preferences, b: Preferences): boolean {
  return (
    a.updatedAt === b.updatedAt &&
    a.colorScheme === b.colorScheme &&
    a.waypointLayout === b.waypointLayout &&
    a.pinScope === b.pinScope &&
    a.collectionGroupsCollapsedByDefault === b.collectionGroupsCollapsedByDefault &&
    a.hideRelationshipBar === b.hideRelationshipBar &&
    a.hideRepoGlance === b.hideRepoGlance &&
    a.repoGlanceCollapsedByDefault === b.repoGlanceCollapsedByDefault &&
    a.minimalProfile === b.minimalProfile &&
    a.minimalPostPreview === b.minimalPostPreview &&
    a.hideRichPreview === b.hideRichPreview &&
    JSON.stringify(a.recordSections) === JSON.stringify(b.recordSections) &&
    JSON.stringify(a.repoSections) === JSON.stringify(b.repoSections) &&
    a.hideRichJsonPreview === b.hideRichJsonPreview &&
    a.showRawRecordJson === b.showRawRecordJson &&
    a.autoRedirect === b.autoRedirect &&
    JSON.stringify(a.favoriteByFamily) === JSON.stringify(b.favoriteByFamily) &&
    JSON.stringify(a.waypointGroups) === JSON.stringify(b.waypointGroups) &&
    JSON.stringify(a.customWaypoints) === JSON.stringify(b.customWaypoints) &&
    JSON.stringify(a.knownWaypointIds) === JSON.stringify(b.knownWaypointIds) &&
    a.lastSeenReleaseId === b.lastSeenReleaseId &&
    a.announceReleases === b.announceReleases &&
    JSON.stringify(a.pinnedLexicons) === JSON.stringify(b.pinnedLexicons) &&
    JSON.stringify(a.pinnedLexiconsOthers) === JSON.stringify(b.pinnedLexiconsOthers)
  );
}

// --- Pinned lexicons -------------------------------------------------------

/**
 * Which list ("mine" / "others") backs a pin click given the current
 * scope and whether the user is on their own repo. In non-split modes
 * everything maps to the primary `pinnedLexicons` list — the "others"
 * list only exists in `split` mode.
 */
export type PinTarget = 'mine' | 'others';

export function pinTargetFor(
  scope: Preferences['pinScope'],
  isOwnRepo: boolean,
): PinTarget {
  if (scope === 'split' && !isOwnRepo) return 'others';
  return 'mine';
}

function pinListFieldFor(target: PinTarget): 'pinnedLexicons' | 'pinnedLexiconsOthers' {
  return target === 'others' ? 'pinnedLexiconsOthers' : 'pinnedLexicons';
}

/**
 * Suffix that marks a pinned entry as an NSID *group* (prefix) pin rather
 * than a single lexicon. `app.bsky.feed.*` pins everything nested under
 * `app.bsky.feed`; `app.bsky.*` pins the whole `app.bsky` group. Stored in
 * the same `pinnedLexicons` arrays as exact NSIDs — older clients that
 * don't understand the wildcard simply won't match it to anything, so the
 * format stays backward compatible.
 */
export const PIN_GROUP_SUFFIX = '.*';

/** True when a pin entry targets an entire NSID group (ends with `.*`). */
export function isPinGroup(entry: string): boolean {
  return entry.endsWith(PIN_GROUP_SUFFIX);
}

/** The NSID prefix a group pin covers, e.g. `app.bsky.feed.*` → `app.bsky.feed`. */
export function pinGroupPrefix(entry: string): string {
  return isPinGroup(entry) ? entry.slice(0, -PIN_GROUP_SUFFIX.length) : entry;
}

/**
 * Whether a pin entry matches a concrete NSID. Exact entries match only
 * themselves; group entries (`prefix.*`) match the prefix itself and
 * anything nested beneath it.
 */
export function pinMatchesNsid(entry: string, nsid: string): boolean {
  if (!isPinGroup(entry)) return entry === nsid;
  const prefix = pinGroupPrefix(entry);
  return nsid === prefix || nsid.startsWith(`${prefix}.`);
}

/** True when some group pin in `list` covers `nsid`. */
export function nsidCoveredByGroupPin(list: string[], nsid: string): boolean {
  return list.some((e) => isPinGroup(e) && pinMatchesNsid(e, nsid));
}

export function togglePinnedLexicon(
  prefs: Preferences,
  nsid: string,
  target: PinTarget = 'mine',
): Preferences {
  const field = pinListFieldFor(target);
  const list = prefs[field];
  const has = list.includes(nsid);
  return {
    ...prefs,
    [field]: has ? list.filter((n) => n !== nsid) : [...list, nsid],
  };
}

export function addPinnedLexicon(
  prefs: Preferences,
  nsid: string,
  target: PinTarget = 'mine',
): Preferences {
  const field = pinListFieldFor(target);
  if (prefs[field].includes(nsid)) return prefs;
  return { ...prefs, [field]: [...prefs[field], nsid] };
}

export function removePinnedLexicon(
  prefs: Preferences,
  nsid: string,
  target: PinTarget = 'mine',
): Preferences {
  const field = pinListFieldFor(target);
  return { ...prefs, [field]: prefs[field].filter((n) => n !== nsid) };
}

export function setPinScope(
  prefs: Preferences,
  scope: Preferences['pinScope'],
): Preferences {
  return { ...prefs, pinScope: scope };
}

/**
 * Loose NSID validation — at least three lowercase segments separated by
 * dots. Good enough to catch typos in the settings input without
 * blocking unusual but valid NSIDs.
 */
export function isLikelyNsid(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (s.length > 253) return false;
  const segments = s.split('.');
  if (segments.length < 3) return false;
  const segRe = /^[a-zA-Z][a-zA-Z0-9-]*$/;
  return segments.every((seg) => segRe.test(seg));
}

/**
 * Validates anything pinnable from the settings input — a single NSID, or
 * an NSID-group wildcard (`prefix.*`) whose prefix is at least two
 * lowercase, dotted segments. Two segments matches the explorer's
 * major-group granularity (`app.bsky.*`); three matches a sub-group
 * (`app.bsky.feed.*`).
 */
export function isLikelyPinEntry(input: string): boolean {
  const s = input.trim();
  if (!isPinGroup(s)) return isLikelyNsid(s);
  const prefix = pinGroupPrefix(s);
  if (s.length > 253) return false;
  const segments = prefix.split('.');
  if (segments.length < 2) return false;
  const segRe = /^[a-zA-Z][a-zA-Z0-9-]*$/;
  return segments.every((seg) => segRe.test(seg));
}

// --- Picker layout ---------------------------------------------------------

export function setWaypointLayout(
  prefs: Preferences,
  layout: WaypointLayout,
): Preferences {
  return { ...prefs, waypointLayout: layout };
}

// --- Auto-redirect ---------------------------------------------------------

export function setAutoRedirect(prefs: Preferences, enabled: boolean): Preferences {
  return { ...prefs, autoRedirect: enabled };
}

/**
 * Set (or, with `null`, clear) the preferred waypoint for one compat family.
 * Clearing deletes the key rather than storing `null` — see
 * `sanitizeFavoriteByFamily`. Mirrors the extension's function of the same
 * name.
 */
export function setFavoriteForFamily(
  prefs: Preferences,
  family: RedirectCompatFamily,
  waypointId: string | null,
): Preferences {
  const next = { ...(prefs.favoriteByFamily ?? {}) };
  if (waypointId) {
    next[family] = waypointId;
  } else {
    delete next[family];
  }
  return { ...prefs, favoriteByFamily: sanitizeFavoriteByFamily(next) };
}

/**
 * Compat families a waypoint id belongs to, built-in or custom. An unknown id,
 * or one that declares no families, returns `[]` — meaning it can never be an
 * auto-redirect destination. Mirrors the extension's `getRedirectCompatFor`.
 */
export function getRedirectCompatFor(
  waypointId: string,
  customWaypoints: CustomWaypoint[],
): RedirectCompatFamily[] {
  if (waypointId.startsWith('custom:')) {
    const custom = customWaypoints.find((c) => c.id === waypointId);
    return custom?.redirectCompat ?? [];
  }
  return WAYPOINT_DESTINATIONS_DATA[waypointId]?.redirectCompat ?? [];
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

/**
 * Seed `knownWaypointIds` for payloads that predate the field. Anything
 * currently in a group or in the legacy `hiddenWaypoints` list counts as
 * already "seen"; the diff against the current built-in catalog is what
 * surfaces as new. Mirrors the extension's `migrateKnownWaypointIds`.
 *
 * Trust an explicit array from storage; only seed when the field is absent.
 */
function migrateKnownWaypointIds(
  input: Partial<Preferences>,
  waypointGroups: WaypointGroup[],
  hiddenWaypoints: string[],
): string[] {
  if (Array.isArray(input.knownWaypointIds)) {
    return input.knownWaypointIds.filter((id): id is string => typeof id === 'string');
  }

  const seed = new Set<string>();
  for (const group of waypointGroups) {
    for (const id of group.waypointIds) {
      if (!id.startsWith('custom:')) seed.add(id);
    }
  }
  for (const id of hiddenWaypoints) {
    if (typeof id === 'string' && !id.startsWith('custom:')) seed.add(id);
  }
  if (seed.size === 0) {
    // No signal in the stored prefs — treat as a fresh user and consider
    // every built-in already known, so the first post-upgrade load doesn't
    // flag the entire catalog as new.
    return [...WAYPOINT_ORDER];
  }
  return Array.from(seed);
}

/**
 * Built-in waypoint ids that have shipped since the user was last notified
 * (i.e. not present in `knownWaypointIds`). Order follows `WAYPOINT_ORDER`.
 * Custom waypoints are never returned.
 */
export function newBuiltinWaypointIds(prefs: Preferences): string[] {
  const known = new Set(prefs.knownWaypointIds ?? []);
  return WAYPOINT_ORDER.filter((id) => !known.has(id) && WAYPOINT_DESTINATIONS_DATA[id]);
}

/**
 * Mark the given built-in waypoint ids as seen so the "new waypoint" banner
 * stops surfacing them. Custom ids are ignored. Returns a new prefs object;
 * a no-op (same reference) when nothing changes.
 */
export function markWaypointsKnown(prefs: Preferences, ids: string[]): Preferences {
  const known = new Set(prefs.knownWaypointIds ?? []);
  let changed = false;
  for (const id of ids) {
    if (id.startsWith('custom:')) continue;
    if (!known.has(id)) {
      known.add(id);
      changed = true;
    }
  }
  if (!changed) return prefs;
  return { ...prefs, knownWaypointIds: Array.from(known) };
}

/**
 * Quick-add new built-in waypoints into their default category group,
 * creating that group if the user has since removed it, and mark them known.
 * This backs the "Add" action on the new-waypoint banner.
 */
export function addWaypointsToDefaultGroups(prefs: Preferences, ids: string[]): Preferences {
  const groups = prefs.waypointGroups.map((g) => ({ ...g, waypointIds: [...g.waypointIds] }));
  const byId = new Map(groups.map((g) => [g.id, g]));

  for (const id of ids) {
    const data = WAYPOINT_DESTINATIONS_DATA[id];
    if (!data) continue;
    const catId = data.category;
    let group = byId.get(catId);
    if (!group) {
      const meta = WAYPOINT_CATEGORIES_DATA[catId];
      group = { id: catId, name: meta?.name ?? prettyGroupName(catId), waypointIds: [] };
      byId.set(catId, group);
      groups.push(group);
    }
    if (!group.waypointIds.includes(id)) group.waypointIds.push(id);
  }

  return markWaypointsKnown({ ...prefs, waypointGroups: groups }, ids);
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

// --- Explore page sections -------------------------------------------------

/** Replace the ordered section list for a page (after a drag-reorder). */
export function setSections(
  prefs: Preferences,
  page: ExplorePage,
  sections: SectionConfig[],
): Preferences {
  return page === 'record'
    ? { ...prefs, recordSections: sections }
    : { ...prefs, repoSections: sections };
}

/**
 * Show/hide a single section. Hiding is a no-op when it would hide the last
 * visible *guaranteed data view* (field table / raw JSON on record pages;
 * profile / identity on repo pages) — the page must always show at least
 * one. Non-guaranteed sections (incl. the rich preview card) hide freely.
 */
export function setSectionHidden(
  prefs: Preferences,
  page: ExplorePage,
  id: string,
  hidden: boolean,
): Preferences {
  const current = page === 'record' ? prefs.recordSections : prefs.repoSections;
  if (hidden && isGuaranteedDataView(page, id)) {
    const currentlyVisible = current.some((s) => s.id === id && !s.hidden);
    if (currentlyVisible && countVisibleGuaranteed(current, page) <= 1) {
      return prefs;
    }
  }
  return setSections(
    prefs,
    page,
    current.map((s) => (s.id === id ? { ...s, hidden } : s)),
  );
}

/**
 * Toggle one of the two record-page data views (`structuredJson` /
 * `rawJson`), auto-showing the other when this one is hidden so at least one
 * stays visible. Used by the inline view switches, mirroring the previous
 * boolean-pair behaviour.
 */
export function toggleRecordDataView(
  prefs: Preferences,
  id: 'structuredJson' | 'rawJson',
): Preferences {
  const partner = id === 'structuredJson' ? 'rawJson' : 'structuredJson';
  const currentlyHidden = sectionHidden(prefs.recordSections, id);
  const next = prefs.recordSections.map((s) => {
    if (s.id === id) return { ...s, hidden: !currentlyHidden };
    if (s.id === partner && !currentlyHidden) return { ...s, hidden: false };
    return s;
  });
  return { ...prefs, recordSections: next };
}

/** Restore a page's section list to its defaults. */
export function resetSections(prefs: Preferences, page: ExplorePage): Preferences {
  return setSections(prefs, page, defaultSectionsFor(page));
}
