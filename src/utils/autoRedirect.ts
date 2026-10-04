/**
 * Auto-redirect: deciding where a universal link should send someone.
 *
 * When a visitor has told Aturi "for Bluesky links, my client is deer.social",
 * landing on an aturi.to waypoint page should open deer.social's copy of that
 * record instead of drawing the picker. This module is the decision, and
 * nothing else — no DOM, no React, no navigation. Two callers act on it:
 *
 *   1. `buildAutoRedirectScript` (`src/lib/autoRedirectShim.ts`), which runs a
 *      cut-down copy of `resolveAutoRedirectTarget` in an inline <script>
 *      before the page paints, over candidates this module resolved on the
 *      server.
 *   2. `AutoRedirectGate`, the client component, which runs the full thing —
 *      custom waypoints included — once React mounts.
 *
 * The two must never disagree about a built-in, which is why the ordering
 * rules live here in one place and a test asserts the inline copy matches.
 *
 * The extension solves the same problem from the other direction: there the
 * site you're browsing names the compat family (bsky.app → `bluesky-social`).
 * A universal link has no source site, only a record, so we invert it — walk
 * the user's family favorites and take the first that can render this record.
 */

import {
  COMPAT_FAMILY_ORDER,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  waypointActivity,
  type RedirectCompatFamily,
  type WaypointType,
} from './waypoints.data';
import {
  customWaypointUrl,
  type CustomWaypoint,
  type Preferences,
} from './preferences';

/** The record a universal-link page is about. */
export type AutoRedirectContext = {
  type: WaypointType;
  handle: string;
  did?: string;
  collection?: string;
  rkey?: string;
};

/**
 * A waypoint that can render the current page, with its URL already resolved.
 * The server builds these for the built-in catalog and embeds them in the page
 * so the pre-paint script can pick a winner without the waypoint catalog —
 * or a second copy of every URL template — being available to it.
 */
export type AutoRedirectCandidate = {
  id: string;
  url: string;
  families: RedirectCompatFamily[];
};

export type AutoRedirectTarget = {
  waypointId: string;
  family: RedirectCompatFamily;
  url: string;
};

/** localStorage cache read before paint. Written by `AutoRedirectSync`. */
export const AUTO_REDIRECT_CACHE_KEY = 'aturi.autoRedirect.v1';

/** sessionStorage note that we already sent this tab away from a given path. */
export const AUTO_REDIRECT_BREADCRUMB_KEY = 'aturi.autoRedirect.from';

/** `?stay=1` on any waypoint URL shows the picker instead of redirecting. */
export const AUTO_REDIRECT_STAY_PARAM = 'stay';

/**
 * How long a breadcrumb suppresses a repeat redirect for the same path. Long
 * enough to cover reading a post and coming back, short enough that a link
 * opened again later in the same tab still behaves as configured.
 */
export const BREADCRUMB_TTL_MS = 60_000;

/**
 * How long after mount the gate will still act on a preference that arrives
 * late — which in practice means a signed-in visitor's PDS record landing on a
 * browser that had never seen it. Past this, or the moment they touch the
 * page, the picker they are already looking at stays put. Being sent somewhere
 * else mid-scroll is worse than not being sent at all.
 */
export const AUTO_REDIRECT_LATE_WINDOW_MS = 5_000;

export type AutoRedirectCache = {
  enabled: boolean;
  byFamily: Partial<Record<RedirectCompatFamily, string>>;
};

/**
 * Whether a resolved destination is safe to navigate to without a click.
 *
 * This is load-bearing. Custom waypoint templates come from the user's
 * `to.aturi.actor.preferences` record, which is writable by anything holding a
 * token for their PDS, and auto-redirect follows the result with no
 * interaction. Restricting the scheme to http/https is what keeps
 * `javascript:` and `data:` out of `location.replace`; refusing our own host
 * is what stops a template pointing back at aturi.to from looping forever.
 * Anything unparsable is unsafe.
 */
export function isSafeRedirectUrl(url: string, selfHost?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (selfHost && parsed.host.toLowerCase() === selfHost.toLowerCase()) return false;
  return true;
}

/**
 * Whether a waypoint claims the collection in play. A waypoint that declares
 * `expectedCollections` only handles those namespaces, so a Bluesky client is
 * not a candidate for an `sh.tangled.*` record even though it renders posts.
 * One that declares none has no opinion and passes: that's the generic
 * explorers (PDSls, atp.tools), which really can render any record, and it is
 * what makes an `atproto-explorer` favorite work on every kind of page.
 */
function claimsCollection(
  waypoint: { expectedCollections?: string[] },
  collection: string | undefined,
): boolean {
  if (!collection) return true;
  if (!waypoint.expectedCollections || waypoint.expectedCollections.length === 0) {
    return true;
  }
  return waypointActivity(waypoint, new Set([collection])) === 'present';
}

/**
 * Every built-in waypoint that could open this page, in catalog order.
 *
 * A waypoint qualifies when it opts into redirects at all, handles this record
 * type, claims this collection, and produces a URL that survives
 * `isSafeRedirectUrl`. An empty `redirectCompat` is the catalog's way of
 * saying "never a redirect endpoint" — an explicit opt-out a waypoint has to
 * choose, not the default.
 *
 * `selfHost` matters more than it looks: Aturi Explore is a member of the
 * `atproto-explorer` family and lives on aturi.to, so without it the server
 * would offer a candidate the client then rejects, and the pre-paint script
 * and the gate would disagree. Both callers pass their view of the current
 * host — `getSiteUrl()` on the server, `location.host` in the browser — which
 * agree on production and on a preview deployment alike.
 */
export function buildAutoRedirectCandidates(
  ctx: AutoRedirectContext,
  selfHost?: string,
): AutoRedirectCandidate[] {
  const out: AutoRedirectCandidate[] = [];
  for (const id of WAYPOINT_ORDER) {
    const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
    if (!waypoint) continue;
    if (waypoint.redirectCompat.length === 0) continue;
    if (!waypoint.supportedTypes.includes(ctx.type)) continue;
    if (!claimsCollection(waypoint, ctx.collection)) continue;
    const url = waypoint.getUrl(ctx.handle, ctx.collection, ctx.rkey, ctx.did);
    if (!url) continue;
    if (!isSafeRedirectUrl(url, selfHost)) continue;
    out.push({ id, url, families: waypoint.redirectCompat });
  }
  return out;
}

/**
 * The host a built-in waypoint's links point at, or null when it can't build
 * one at all. Probed rather than declared, because the catalog stores URL
 * builders and not hosts.
 *
 * The settings UI uses this to drop waypoints served from aturi.to itself
 * (Aturi Explore) out of the destination lists — `isSafeRedirectUrl` would
 * refuse them at runtime, and offering a choice that quietly never fires is
 * worse than not offering it.
 */
export function waypointHost(waypointId: string): string | null {
  const waypoint = WAYPOINT_DESTINATIONS_DATA[waypointId];
  if (!waypoint) return null;
  const probes: Array<[string | undefined, string | undefined]> = [
    [undefined, undefined],
    ['app.bsky.feed.post', 'probe'],
    ['com.example.probe', 'probe'],
  ];
  for (const [collection, rkey] of probes) {
    const url = waypoint.getUrl('probe.example', collection, rkey, 'did:plc:probe');
    if (!url) continue;
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The winning destination, or null for "show the picker".
 *
 * `COMPAT_FAMILY_ORDER` is the tiebreak, and it does real work: an
 * `app.bsky.feed.post` is claimed by `bluesky-social` and by `pinksky` (which
 * declares `expectedCollections: ['app.bsky.']`), so someone with a favorite
 * in both gets their Bluesky client. A favorite is skipped when its waypoint
 * can't render this page, and when the waypoint no longer belongs to the
 * family it was saved under — the catalog can change under a stored
 * preference, and inheriting an unrelated redirect from a stale one would be
 * worse than showing the picker.
 */
export function resolveAutoRedirectTarget(
  favoriteByFamily: Partial<Record<RedirectCompatFamily, string | null>> | undefined,
  candidates: AutoRedirectCandidate[],
): AutoRedirectTarget | null {
  if (!favoriteByFamily) return null;
  for (const family of COMPAT_FAMILY_ORDER) {
    const waypointId = favoriteByFamily[family];
    if (!waypointId) continue;
    const candidate = candidates.find((c) => c.id === waypointId);
    if (!candidate) continue;
    if (!candidate.families.includes(family)) continue;
    return { waypointId, family, url: candidate.url };
  }
  return null;
}

/**
 * Candidates drawn from the user's own waypoints. Only the server-unknowable
 * half — built-ins are resolved by `buildAutoRedirectCandidates` — so these are
 * appended after them, which also means a built-in wins a tie within a family
 * and the pre-paint script can never pick differently from the gate.
 */
function buildCustomCandidates(
  customWaypoints: CustomWaypoint[],
  ctx: AutoRedirectContext,
  selfHost?: string,
): AutoRedirectCandidate[] {
  const out: AutoRedirectCandidate[] = [];
  for (const custom of customWaypoints) {
    const families = custom.redirectCompat ?? [];
    if (families.length === 0) continue;
    if (!custom.supportedTypes.includes(ctx.type)) continue;
    const url = customWaypointUrl(custom, {
      handle: ctx.handle,
      did: ctx.did,
      collection: ctx.collection,
      rkey: ctx.rkey,
    });
    if (!url) continue;
    if (!isSafeRedirectUrl(url, selfHost)) continue;
    out.push({ id: custom.id, url, families });
  }
  return out;
}

/**
 * The full client-side decision: master switch, then built-ins, then customs.
 * `selfHost` is the current `location.host`, so a waypoint pointing back at
 * whatever host is serving the app (including a preview deployment) is
 * rejected rather than looped.
 */
export function resolveAutoRedirect(
  prefs: Preferences,
  ctx: AutoRedirectContext,
  selfHost?: string,
): AutoRedirectTarget | null {
  if (!prefs.autoRedirect) return null;
  const candidates = buildAutoRedirectCandidates(ctx, selfHost);
  candidates.push(...buildCustomCandidates(prefs.customWaypoints, ctx, selfHost));
  return resolveAutoRedirectTarget(prefs.favoriteByFamily, candidates);
}

// --- Pre-paint cache -------------------------------------------------------

/**
 * The slice of preferences the pre-paint script needs. Custom waypoint ids are
 * included even though the script can't resolve their URLs: seeing one tells
 * it to leave the page hidden for the gate to finish the job, instead of
 * flashing the picker on its way to a redirect.
 */
export function autoRedirectCacheFor(prefs: Preferences): AutoRedirectCache {
  const byFamily: Partial<Record<RedirectCompatFamily, string>> = {};
  for (const family of COMPAT_FAMILY_ORDER) {
    const id = prefs.favoriteByFamily?.[family];
    if (id) byFamily[family] = id;
  }
  return { enabled: prefs.autoRedirect, byFamily };
}

export function readAutoRedirectCache(): AutoRedirectCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTO_REDIRECT_CACHE_KEY);
    if (!raw) return null;
    return parseAutoRedirectCache(raw);
  } catch {
    return null;
  }
}

/** Exported for the equivalence test; `readAutoRedirectCache` is the DOM half. */
export function parseAutoRedirectCache(raw: string): AutoRedirectCache | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AutoRedirectCache> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const byFamily: Partial<Record<RedirectCompatFamily, string>> = {};
    const source = (parsed.byFamily ?? {}) as Record<string, unknown>;
    for (const family of COMPAT_FAMILY_ORDER) {
      const id = source[family];
      if (typeof id === 'string' && id) byFamily[family] = id;
    }
    return { enabled: parsed.enabled === true, byFamily };
  } catch {
    return null;
  }
}

export function writeAutoRedirectCache(cache: AutoRedirectCache): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTO_REDIRECT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded or storage disabled — the gate still works, it just
    // can't beat the first paint next time.
  }
}

// --- Suppression -----------------------------------------------------------

/** `?stay=1` — the one-off escape hatch, documented in the settings tab. */
export function hasStayParam(search: string): boolean {
  try {
    return new URLSearchParams(search).get(AUTO_REDIRECT_STAY_PARAM) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether this page load is a back/forward navigation. Without this check the
 * back button is a trap: leaving the client would land on the waypoint page,
 * which would immediately send you out again.
 */
export function isBackForwardNavigation(
  entries: ReadonlyArray<{ type?: string }> | undefined,
): boolean {
  if (!entries || entries.length === 0) return false;
  return entries[0]?.type === 'back_forward';
}

export function writeBreadcrumb(pathname: string, now: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      AUTO_REDIRECT_BREADCRUMB_KEY,
      JSON.stringify({ p: pathname, t: now }),
    );
  } catch {
    // Private mode or storage disabled — the back/forward check still covers
    // the common case on its own.
  }
}

export function readBreadcrumb(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(AUTO_REDIRECT_BREADCRUMB_KEY);
  } catch {
    return null;
  }
}

/**
 * Whether a stored breadcrumb blocks redirecting from `pathname` again. Belt
 * and braces with `isBackForwardNavigation`: a browser that restores the page
 * without a `back_forward` navigation entry (bfcache quirks, a restored
 * session) would otherwise bounce the visitor straight back out.
 */
export function breadcrumbSuppresses(
  raw: string | null,
  pathname: string,
  now: number,
): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { p?: unknown; t?: unknown };
    if (parsed?.p !== pathname) return false;
    if (typeof parsed.t !== 'number') return false;
    return now - parsed.t < BREADCRUMB_TTL_MS;
  } catch {
    return false;
  }
}
