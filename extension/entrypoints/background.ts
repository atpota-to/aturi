import { browser, defineBackground } from '#imports';
import { loadPrefs, onPrefsChanged, type Prefs } from '../lib/prefs';
import { buildRules } from '../lib/rules';
import { debugLog, setLogContext } from '../lib/debugLog';

setLogContext('background');

const RULE_ID_BASE = 1000;

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

/**
 * Replace the dynamic DNR rule set with the rules derived from the given prefs.
 */
async function syncRules(prefs: Prefs): Promise<void> {
  const dnr = (browser as unknown as { declarativeNetRequest?: typeof chrome.declarativeNetRequest })
    .declarativeNetRequest;
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
    void primeAndSync();
  });

  browser.runtime.onStartup.addListener(() => {
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
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'aturi:detected') return undefined;
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return undefined;
    const count = typeof message.count === 'number' ? message.count : 0;
    debugLog('detected', { tabId, count });
    return applyTabBadge(tabId, count);
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
