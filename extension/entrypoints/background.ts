import { browser, defineBackground } from '#imports';
import { loadPrefs, onPrefsChanged, type Prefs } from '../lib/prefs';
import { buildRules } from '../lib/rules';
import { setLogContext } from '../lib/debugLog';

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
 * (Chrome `action`). Both expose the same surface we need; the only
 * difference is the property name on the `browser` namespace.
 */
function getActionApi(): ActionApi | null {
  const b = browser as unknown as { action?: ActionApi; browserAction?: ActionApi };
  return b.action ?? b.browserAction ?? null;
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
 */
async function applyTabBadge(tabId: number, count: number): Promise<void> {
  const action = getActionApi();
  if (!action) return;
  const text = count > 0 ? String(count) : '';
  try {
    if (action.setBadgeText) await action.setBadgeText({ text, tabId });
  } catch {
    /* ignore */
  }
  try {
    if (count > 0 && action.setBadgeBackgroundColor) {
      await action.setBadgeBackgroundColor({ color: BADGE_BG, tabId });
    }
  } catch {
    /* ignore */
  }
  try {
    // Per-tab text color is supported on Chrome 110+ and Firefox 109+. If it
    // throws we leave the default (white in Chrome, black in some Firefox
    // builds) — the background color above is high enough contrast either way.
    if (count > 0 && action.setBadgeTextColor) {
      await action.setBadgeTextColor({ color: BADGE_FG, tabId });
    }
  } catch {
    /* ignore */
  }
  try {
    if (action.setIcon) {
      await action.setIcon({
        path: count > 0 ? ACTIVE_ICON : DEFAULT_ICON,
        tabId,
      });
    }
  } catch {
    /* ignore */
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

export default defineBackground(() => {
  const primeAndSync = async () => {
    const prefs = await loadPrefs();
    await syncRules(prefs);
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
  // trust the sender.tab.id so we always badge the right tab, even if the
  // popup or other code is also messaging us in parallel.
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'aturi:detected') return undefined;
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return undefined;
    const count = typeof message.count === 'number' ? message.count : 0;
    void applyTabBadge(tabId, count);
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
