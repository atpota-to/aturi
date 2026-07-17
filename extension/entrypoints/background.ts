import { browser, defineBackground } from '#imports';
import { loadPrefs, onPrefsChanged, type Prefs } from '../lib/prefs';
import { buildRules } from '../lib/rules';
import { buildBypassRule } from '../lib/bypass';
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

// --- Redirect bypass for explicit popup picks --------------------------------
//
// When the user picks a client in the popup we open it here (rather than from
// the popup itself) so we can briefly exempt that one navigation from
// auto-redirect. Without this, a standing redirect rule whose source pattern
// matches the chosen destination would hijack the pick and send the user to
// their default client instead — the exact opposite of what they just asked
// for. Ordinary link clicks are untouched; only this single URL is exempted,
// and only until it finishes loading.

let nextBypassId = 1;

function allocBypassId(): number {
  // Session rules live in their own id space (separate from the dynamic
  // redirect rules). We sweep stale ones before every open, so a small
  // wrapping counter is plenty to keep ids unique between concurrent opens.
  nextBypassId = nextBypassId >= 1_000_000 ? 1 : nextBypassId + 1;
  return nextBypassId;
}

/**
 * Remove every session-scoped rule. The only session rules we ever create are
 * transient redirect-bypass rules, so clearing them all is safe. Called on
 * startup (in case one leaked when the service worker was suspended mid-flight)
 * and before arming a fresh bypass.
 */
async function clearBypassRules(): Promise<void> {
  const dnr = getDnr();
  if (!dnr?.getSessionRules || !dnr.updateSessionRules) return;
  try {
    const existing = (await dnr.getSessionRules()) ?? [];
    const ids = existing.map(r => r.id);
    if (ids.length > 0) await dnr.updateSessionRules({ removeRuleIds: ids });
  } catch (err) {
    console.warn('[aturi] failed to clear bypass rules', err);
  }
}

async function removeBypassRule(ruleId: number): Promise<void> {
  const dnr = getDnr();
  if (!dnr?.updateSessionRules) return;
  try {
    await dnr.updateSessionRules({ removeRuleIds: [ruleId] });
  } catch (err) {
    console.warn('[aturi] failed to remove bypass rule', err);
  }
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
    try {
      // Sweep leftovers from earlier opens (a prior navigation may have
      // finished without our listener firing — e.g. the service worker was
      // suspended) so at most one bypass is ever live, then arm this one.
      const existing = (await dnr.getSessionRules?.()) ?? [];
      await dnr.updateSessionRules({
        removeRuleIds: existing.map(r => r.id),
        addRules: [buildBypassRule(url, ruleId)],
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
    await syncRules(prefs);
    await primeBadgeDefaults();
  };

  browser.runtime.onInstalled.addListener(() => {
    void clearBypassRules();
    void primeAndSync();
  });

  browser.runtime.onStartup.addListener(() => {
    void clearBypassRules();
    void primeAndSync();
  });

  onPrefsChanged(prefs => {
    void syncRules(prefs);
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
    return undefined;
  });

  // Reset before the new page's content script reports — keeps stale counts
  // from lingering across hard navigations.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      void applyTabBadge(tabId, 0);
    }
  });

  void primeAndSync();
});
