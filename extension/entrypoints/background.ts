import { browser, defineBackground } from '#imports';
import { loadPrefs, onPrefsChanged, type Prefs } from '../lib/prefs';
import { buildRules } from '../lib/rules';
import { BYPASS_ID_MAX, BYPASS_ID_MIN, buildBypassRule, isBypassRuleId } from '../lib/bypass';
import {
  buildTabScopeRules,
  isBlankTabUrl,
  isTabScopeRuleId,
  tabHostFromUrl,
  type TabScope,
} from '../lib/tabScope';
import { debugLog, setLogContext } from '../lib/debugLog';

setLogContext('background');

const RULE_ID_BASE = 1000;

// How long to keep a redirect-bypass allow-rule armed if the navigation never
// reports as complete (tab closed instantly, service worker hiccup, etc.).
const BYPASS_TTL_MS = 20_000;

const DEFAULT_ICON = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  96: 'icon/96.png',
  128: 'icon/128.png',
};

const ACTIVE_ICON = {
  16: 'icon/active-16.png',
  32: 'icon/active-32.png',
  48: 'icon/active-48.png',
  96: 'icon/active-96.png',
  128: 'icon/active-128.png',
};

const BADGE_BG = '#4a5a3f'; // --accent-forest
const BADGE_FG = '#ffffff';

type ActionApi = {
  setBadgeText?: (details: { text: string; tabId?: number }) => unknown;
  setBadgeBackgroundColor?: (details: { color: string; tabId?: number }) => unknown;
  setBadgeTextColor?: (details: { color: string; tabId?: number }) => unknown;
  setIcon?: (details: { path: Record<string, string>; tabId?: number }) => unknown;
};

/**
 * Resolve the toolbar-icon API across MV2 (Firefox `browserAction`) and MV3
 * (Chrome `action`). WXT's `browser` shim is just `globalThis.chrome` on
 * Chrome and `globalThis.browser` on Firefox — both expose the right
 * namespace; we just have to pick the right name.
 */
function getActionApi(): ActionApi | null {
  const b = browser as unknown as { action?: ActionApi; browserAction?: ActionApi };
  if (b.action) return b.action;
  if (b.browserAction) return b.browserAction;
  // Last-resort: in case the `browser` shim is missing on some platform,
  // reach for chrome.* directly.
  const c =
    typeof chrome !== 'undefined'
      ? (chrome as unknown as { action?: ActionApi; browserAction?: ActionApi })
      : null;
  return c?.action ?? c?.browserAction ?? null;
}

function getDnr(): typeof chrome.declarativeNetRequest | undefined {
  return (
    browser as unknown as { declarativeNetRequest?: typeof chrome.declarativeNetRequest }
  ).declarativeNetRequest;
}

// Serialize DNR rule syncs. onInstalled, onStartup, onPrefsChanged, and the
// module-level prime all call syncRules; run concurrently they read the same
// existing-rule set and both call updateDynamicRules, so the second can reject
// on duplicate rule ids or leave stale rules live. Chaining guarantees each
// sync sees the previous one's committed state.
let syncQueue: Promise<void> = Promise.resolve();

function syncRules(prefs: Prefs): Promise<void> {
  syncQueue = syncQueue.then(
    () => doSyncRules(prefs),
    () => doSyncRules(prefs)
  );
  return syncQueue;
}

/**
 * Replace the dynamic DNR rule set with the rules derived from the given prefs.
 */
async function doSyncRules(prefs: Prefs): Promise<void> {
  const dnr = getDnr();
  if (!dnr?.updateDynamicRules) return;

  let removeRuleIds: number[] = [];
  try {
    const existing = (await dnr.getDynamicRules()) ?? [];
    removeRuleIds = existing.map(r => r.id);
  } catch (err) {
    console.warn('[aturi] getDynamicRules unavailable', err);
  }

  const addRules = buildRules(prefs, { baseId: RULE_ID_BASE });

  try {
    await dnr.updateDynamicRules({
      removeRuleIds,
      addRules,
    });
  } catch (err) {
    console.error('[aturi] failed to update DNR rules', err);
  }
}

// Every session-rule writer (bypass arming, bypass teardown, tab-scope sync)
// goes through one queue. They each read the live rule set with
// getSessionRules before writing, so running two concurrently lets the second
// compute its removeRuleIds from a set the first already changed.
let sessionQueue: Promise<unknown> = Promise.resolve();

function queueSession<T>(task: () => Promise<T>): Promise<T> {
  const run = () => task();
  const next = sessionQueue.then(run, run);
  // Swallow rejections on the chain itself so one failure doesn't reject
  // every task queued behind it; the caller still sees its own error.
  sessionQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

// --- Tab-scoped redirect exemptions ------------------------------------------
//
// Auto-redirect is declarative: DNR matches a URL and rewrites it, with no
// idea whether you clicked a link or typed the address yourself. The browser
// only reports that (via webNavigation's transition types) after a navigation
// has committed, which is too late to act on without bouncing you off a page
// that already loaded.
//
// So instead of guessing at intent, we use something DNR *can* be told about
// ahead of the request: which tab it happens in. A tab that is already showing
// one of the apps involved, or that you just opened and haven't navigated yet,
// gets a session-scoped `allow` rule covering the relevant hosts. See
// `lib/tabScope.ts` for what each case means.

const tabScopes = new Map<number, TabScope>();

/** Latest prefs, kept here so tab events can rebuild rules without a reload. */
let latestPrefs: Prefs | null = null;

/**
 * Resolves once the initial prefs load and tab sweep have finished. Message
 * handlers await it so a popup opening against a just-woken service worker
 * doesn't read an empty `tabScopes`.
 */
let readyPromise: Promise<void> = Promise.resolve();

function syncTabScopeRules(): Promise<void> {
  return queueSession(doSyncTabScopeRules);
}

/**
 * Replace the whole tab-scope rule range in one write. Rebuilding every rule
 * rather than diffing keeps ids meaningful only within a single batch, which
 * removes the need for an allocator that could leak ids as tabs come and go.
 */
async function doSyncTabScopeRules(): Promise<void> {
  const dnr = getDnr();
  if (!dnr?.updateSessionRules) return;

  let removeRuleIds: number[] = [];
  try {
    const existing = (await dnr.getSessionRules?.()) ?? [];
    removeRuleIds = existing.map(r => r.id).filter(isTabScopeRuleId);
  } catch (err) {
    console.warn('[aturi] getSessionRules unavailable', err);
  }

  const addRules = latestPrefs ? buildTabScopeRules(latestPrefs, tabScopes) : [];

  try {
    await dnr.updateSessionRules({ removeRuleIds, addRules });
  } catch (err) {
    console.error('[aturi] failed to update tab-scope rules', err);
  }
}

/**
 * Record a tab's scope, resyncing only when something that affects the rules
 * actually changed. `tabs.onUpdated` fires several times per navigation (title,
 * favicon, status) and the rule set is identical across most of them.
 */
function recordScope(tabId: number, next: TabScope): void {
  const prev = tabScopes.get(tabId);
  if (
    prev &&
    prev.host === next.host &&
    prev.fresh === next.fresh &&
    prev.paused === next.paused
  ) {
    return;
  }
  tabScopes.set(tabId, next);
  void syncTabScopeRules();
}

// Per-tab pauses live in `storage.session`: in-memory, wiped when the browser
// closes, but survives the MV3 service worker being suspended. Without this a
// pause would silently lapse the first time the worker idled out.
const PAUSED_TABS_KEY = 'aturi:pausedTabs';

type SessionArea = {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

function getSessionArea(): SessionArea | null {
  const storage = (browser as unknown as { storage?: { session?: SessionArea } }).storage;
  return storage?.session ?? null;
}

async function loadPausedTabIds(): Promise<number[]> {
  const area = getSessionArea();
  if (!area) return [];
  try {
    const items = await area.get(PAUSED_TABS_KEY);
    const raw = items?.[PAUSED_TABS_KEY];
    return Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : [];
  } catch (err) {
    console.warn('[aturi] failed to read paused tabs', err);
    return [];
  }
}

async function savePausedTabIds(): Promise<void> {
  const area = getSessionArea();
  if (!area) return;
  const ids = [...tabScopes]
    .filter(([, scope]) => scope.paused)
    .map(([tabId]) => tabId);
  try {
    await area.set({ [PAUSED_TABS_KEY]: ids });
  } catch (err) {
    console.warn('[aturi] failed to persist paused tabs', err);
  }
}

/**
 * Rebuild `tabScopes` from the tabs that are actually open. Runs on every
 * service worker start, which is also what clears out rules for tabs closed
 * while the worker was suspended.
 */
async function primeTabScopes(): Promise<void> {
  const paused = new Set(await loadPausedTabIds());
  try {
    const tabs = (await browser.tabs.query({})) as Array<{ id?: number; url?: string }>;
    tabScopes.clear();
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      // `fresh` starts false: an untouched new tab is indistinguishable from
      // one the browser restored, and the safe default is the old behavior.
      tabScopes.set(tab.id, {
        host: tabHostFromUrl(tab.url),
        fresh: false,
        paused: paused.has(tab.id),
      });
    }
  } catch (err) {
    console.warn('[aturi] failed to prime tab scopes', err);
  }
  await syncTabScopeRules();
}

/** Reply shape for both popup messages about a tab's redirect state. */
type TabRedirectState = {
  /** False when this browser can't scope rules to a tab; popup hides the control. */
  supported: boolean;
  paused: boolean;
};

async function handleRedirectScopeQuery(message: { tabId?: unknown }): Promise<TabRedirectState> {
  await readyPromise;
  const supported = getDnr()?.updateSessionRules != null;
  const tabId = typeof message.tabId === 'number' ? message.tabId : null;
  if (tabId == null) return { supported, paused: false };
  return { supported, paused: tabScopes.get(tabId)?.paused === true };
}

async function handleSetTabPause(message: {
  tabId?: unknown;
  paused?: unknown;
}): Promise<TabRedirectState> {
  await readyPromise;
  const supported = getDnr()?.updateSessionRules != null;
  const tabId = typeof message.tabId === 'number' ? message.tabId : null;
  if (tabId == null || !supported) return { supported, paused: false };

  const paused = message.paused === true;
  const prev = tabScopes.get(tabId);
  tabScopes.set(tabId, {
    host: prev?.host ?? null,
    fresh: prev?.fresh ?? false,
    paused,
  });

  await savePausedTabIds();
  await syncTabScopeRules();
  return { supported, paused };
}

// --- Redirect bypass for explicit popup picks --------------------------------
//
// When the user picks a client in the popup we open it here (rather than from
// the popup itself) so we can briefly exempt that one navigation from
// auto-redirect. Without this, a standing redirect rule whose source pattern
// matches the chosen destination would hijack the pick and send the user to
// their default client instead — the exact opposite of what they just asked
// for. Ordinary link clicks are untouched; only this single URL is exempted,
// and only until it finishes loading.

let nextBypassId = BYPASS_ID_MIN;

function allocBypassId(): number {
  // Session rules live in their own id space (separate from the dynamic
  // redirect rules). We sweep stale ones before every open, so a small
  // wrapping counter is plenty to keep ids unique between concurrent opens.
  // Staying under BYPASS_ID_MAX keeps these clear of the tab-scope range.
  nextBypassId = nextBypassId >= BYPASS_ID_MAX ? BYPASS_ID_MIN : nextBypassId + 1;
  return nextBypassId;
}

/**
 * Remove every bypass rule. Called on startup (in case one leaked when the
 * service worker was suspended mid-flight) and before arming a fresh bypass.
 *
 * Scoped to the bypass id range: tab-scoped exemptions are session rules too,
 * and clearing the whole session set would drop them until the next tab event.
 */
async function clearBypassRules(): Promise<void> {
  const dnr = getDnr();
  if (!dnr?.getSessionRules || !dnr.updateSessionRules) return;
  await queueSession(async () => {
    try {
      const existing = (await dnr.getSessionRules!()) ?? [];
      const ids = existing.map(r => r.id).filter(isBypassRuleId);
      if (ids.length > 0) await dnr.updateSessionRules!({ removeRuleIds: ids });
    } catch (err) {
      console.warn('[aturi] failed to clear bypass rules', err);
    }
  });
}

async function removeBypassRule(ruleId: number): Promise<void> {
  const dnr = getDnr();
  if (!dnr?.updateSessionRules) return;
  await queueSession(async () => {
    try {
      await dnr.updateSessionRules!({ removeRuleIds: [ruleId] });
    } catch (err) {
      console.warn('[aturi] failed to remove bypass rule', err);
    }
  });
}

/**
 * Tear down a bypass rule once its navigation has committed. We listen for the
 * target tab reporting `complete` (or being closed) and fall back to a timer so
 * a missed event can never strand the exemption. As a further safety net, the
 * next popup open sweeps any leftovers via `clearBypassRules`.
 */
function scheduleBypassRemoval(ruleId: number, tabId: number | null): void {
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    try {
      browser.tabs.onUpdated.removeListener(onUpdated);
    } catch {
      /* ignore */
    }
    try {
      browser.tabs.onRemoved.removeListener(onRemoved);
    } catch {
      /* ignore */
    }
    clearTimeout(timer);
    void removeBypassRule(ruleId);
  };

  const onUpdated = (changedId: number, info: { status?: string }) => {
    if (tabId != null && changedId !== tabId) return;
    if (info.status === 'complete') finish();
  };
  const onRemoved = (closedId: number) => {
    if (tabId != null && closedId !== tabId) return;
    finish();
  };

  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onRemoved.addListener(onRemoved);
  const timer = setTimeout(finish, BYPASS_TTL_MS);
}

/**
 * Open a URL the way the popup used to: reuse the active tab when the user
 * prefers in-place navigation, otherwise spawn a new tab. Returns the id of
 * the tab the navigation landed in (so we know which one to watch).
 */
async function openTab(
  url: string,
  tabId: number | null,
  openInNewTab: boolean
): Promise<number | null> {
  if (!openInNewTab && tabId != null) {
    try {
      const updated = (await browser.tabs.update(tabId, { url })) as
        | { id?: number }
        | undefined;
      return updated?.id ?? tabId;
    } catch (err) {
      console.warn('[aturi] tab update failed, falling back to new tab', err);
    }
  }
  const created = (await browser.tabs.create({ url })) as { id?: number } | undefined;
  return created?.id ?? null;
}

type OpenWaypointMessage = {
  type: 'aturi:open-waypoint';
  url?: unknown;
  tabId?: unknown;
  openInNewTab?: unknown;
  autoRedirect?: unknown;
};

/**
 * Handle a popup request to open a chosen waypoint. Arms a redirect bypass for
 * the exact URL (only when auto-redirect is on and DNR is available), opens the
 * tab, then schedules the bypass teardown. Resolves `{ ok: true }` once the tab
 * is open so the popup knows not to also open it itself.
 */
async function handlePopupOpen(message: OpenWaypointMessage): Promise<{ ok: boolean }> {
  const url = typeof message.url === 'string' ? message.url : null;
  if (!url) return { ok: false };
  const tabId = typeof message.tabId === 'number' ? message.tabId : null;
  const openInNewTab = message.openInNewTab !== false;
  const autoRedirect = message.autoRedirect === true;

  const dnr = getDnr();
  let ruleId: number | null = null;
  if (autoRedirect && dnr?.updateSessionRules) {
    ruleId = allocBypassId();
    const armId = ruleId;
    try {
      // Sweep leftovers from earlier opens (a prior navigation may have
      // finished without our listener firing — e.g. the service worker was
      // suspended) so at most one bypass is ever live, then arm this one.
      // Only bypass ids are swept; the tab-scope rules are left in place.
      await queueSession(async () => {
        const existing = (await dnr.getSessionRules?.()) ?? [];
        await dnr.updateSessionRules!({
          removeRuleIds: existing.map(r => r.id).filter(isBypassRuleId),
          addRules: [buildBypassRule(url, armId)],
        });
      });
    } catch (err) {
      console.warn('[aturi] failed to arm redirect bypass', err);
      ruleId = null;
    }
  }

  let targetTabId: number | null;
  try {
    targetTabId = await openTab(url, tabId, openInNewTab);
  } catch (err) {
    console.error('[aturi] failed to open waypoint tab', err);
    if (ruleId != null) void removeBypassRule(ruleId);
    return { ok: false };
  }

  if (ruleId != null) scheduleBypassRemoval(ruleId, targetTabId);
  return { ok: true };
}

/**
 * Apply the active / idle toolbar icon to a single tab. `count > 0` swaps to
 * the active icon and shows the count as a badge; otherwise we clear back
 * to the default icon with no badge.
 *
 * Each underlying API call is awaited individually with its own try/catch
 * so a single platform-specific failure (e.g. `setBadgeTextColor` not
 * supported on older Firefox) doesn't abort the whole update.
 */
async function applyTabBadge(tabId: number, count: number): Promise<void> {
  const action = getActionApi();
  if (!action) {
    console.warn('[aturi] no action API available — toolbar icon will not update');
    return;
  }
  const text = count > 0 ? String(count) : '';
  try {
    if (action.setBadgeText) await action.setBadgeText({ text, tabId });
  } catch (err) {
    console.warn('[aturi] setBadgeText failed', err);
  }
  try {
    if (count > 0 && action.setBadgeBackgroundColor) {
      await action.setBadgeBackgroundColor({ color: BADGE_BG, tabId });
    }
  } catch (err) {
    console.warn('[aturi] setBadgeBackgroundColor failed', err);
  }
  try {
    if (count > 0 && action.setBadgeTextColor) {
      await action.setBadgeTextColor({ color: BADGE_FG, tabId });
    }
  } catch {
    /* setBadgeTextColor isn't supported everywhere — silent fallback is fine */
  }
  try {
    if (action.setIcon) {
      await action.setIcon({
        path: count > 0 ? ACTIVE_ICON : DEFAULT_ICON,
        tabId,
      });
    }
  } catch (err) {
    console.warn('[aturi] setIcon failed', err);
  }
}

/**
 * Clear the badge + restore the default icon for every open tab. Used when
 * the user toggles passive scanning off so existing badges disappear
 * immediately instead of lingering until each tab is reloaded.
 */
async function clearAllTabBadges(): Promise<void> {
  const action = getActionApi();
  if (!action) return;
  try {
    const tabs = (await browser.tabs.query({})) as Array<{ id?: number }>;
    await Promise.all(
      tabs
        .map(t => t.id)
        .filter((id): id is number => typeof id === 'number')
        .map(id => applyTabBadge(id, 0)),
    );
  } catch (err) {
    console.warn('[aturi] clearAllTabBadges failed', err);
  }
}

/**
 * Set the badge background color globally (default for all tabs that don't
 * have a per-tab override). This way even if the per-tab call below misses
 * for some reason, badges still render against the brand color instead of
 * the browser's default red.
 */
async function primeBadgeDefaults(): Promise<void> {
  const action = getActionApi();
  if (!action) return;
  try {
    if (action.setBadgeBackgroundColor) {
      await action.setBadgeBackgroundColor({ color: BADGE_BG });
    }
  } catch {
    /* ignore */
  }
  try {
    if (action.setBadgeTextColor) {
      await action.setBadgeTextColor({ color: BADGE_FG });
    }
  } catch {
    /* ignore */
  }
}

export default defineBackground(() => {
  const primeAndSync = async () => {
    const prefs = await loadPrefs();
    latestPrefs = prefs;
    await syncRules(prefs);
    await primeTabScopes();
    await primeBadgeDefaults();
  };

  browser.runtime.onInstalled.addListener(() => {
    void clearBypassRules();
    readyPromise = primeAndSync();
    void readyPromise;
  });

  browser.runtime.onStartup.addListener(() => {
    void clearBypassRules();
    readyPromise = primeAndSync();
    void readyPromise;
  });

  onPrefsChanged(prefs => {
    latestPrefs = prefs;
    void syncRules(prefs);
    // The exemptions are derived from the same prefs as the redirect rules,
    // so a favorite change has to rebuild both.
    void syncTabScopeRules();
    // When the user disables passive scanning, sweep every tab's badge so
    // they don't have to reload anything to see the toggle take effect.
    if (!prefs.passiveScanEnabled) {
      void clearAllTabBadges();
    }
  });

  // Content scripts on every page report their detection count here. We
  // *return* the badge-update promise so the MV3 service worker stays
  // alive until the action APIs actually fire — returning undefined
  // synchronously would let Chrome terminate the worker mid-update and
  // the icon/badge would never visibly change.
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'aturi:detected') {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') return undefined;
      const count = typeof message.count === 'number' ? message.count : 0;
      debugLog('detected', { tabId, count });
      return applyTabBadge(tabId, count);
    }
    // The popup hands explicit picks here so we can suppress auto-redirect for
    // that one navigation. We reply via sendResponse + `return true` (the
    // Chrome-compatible async pattern this codebase already uses) so the popup
    // knows the tab is open and doesn't open a duplicate as a fallback.
    if (message?.type === 'aturi:open-waypoint') {
      handlePopupOpen(message)
        .catch(err => {
          console.error('[aturi] open-waypoint failed', err);
          return { ok: false };
        })
        .then(sendResponse);
      return true;
    }
    // The popup asks whether auto-redirect is paused for the tab it's over,
    // and toggles it. Both are answered from `tabScopes`, which is the same
    // state the DNR exemptions are compiled from.
    if (message?.type === 'aturi:redirect-scope') {
      handleRedirectScopeQuery(message)
        .catch(err => {
          console.error('[aturi] redirect-scope query failed', err);
          return { supported: false, paused: false };
        })
        .then(sendResponse);
      return true;
    }
    if (message?.type === 'aturi:set-tab-pause') {
      handleSetTabPause(message)
        .catch(err => {
          console.error('[aturi] set-tab-pause failed', err);
          return { supported: false, paused: false };
        })
        .then(sendResponse);
      return true;
    }
    return undefined;
  });

  // Reset before the new page's content script reports — keeps stale counts
  // from lingering across hard navigations.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void applyTabBadge(tabId, 0);
    }
  });

  browser.tabs.onCreated.addListener(tab => {
    const tabId = tab.id;
    if (typeof tabId !== 'number') return;
    const startUrl = (tab as { pendingUrl?: string }).pendingUrl ?? tab.url;
    // A tab you opened yourself has no opener and parks on the new-tab page.
    // A link opened in a new tab carries `openerTabId`, and a link handed over
    // by another application arrives with its target URL already set — so only
    // the first of the three means "whatever lands here next, I typed".
    const fresh = tab.openerTabId === undefined && isBlankTabUrl(startUrl);
    recordScope(tabId, { host: tabHostFromUrl(startUrl), fresh, paused: false });
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url ?? tab?.url;
    const prev = tabScopes.get(tabId);
    recordScope(tabId, {
      host: tabHostFromUrl(url),
      // A fresh tab's pass covers one navigation. Once it has committed a real
      // page, anything after that is an ordinary click on a loaded document.
      fresh: prev?.fresh === true && isBlankTabUrl(url),
      paused: prev?.paused ?? false,
    });
  });

  browser.tabs.onRemoved.addListener(tabId => {
    if (!tabScopes.delete(tabId)) return;
    void savePausedTabIds();
    void syncTabScopeRules();
  });

  readyPromise = primeAndSync();
  void readyPromise;
});
