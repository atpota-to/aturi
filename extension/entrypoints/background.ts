import { browser, defineBackground } from '#imports';
import { loadPrefs, onPrefsChanged, type Prefs } from '../lib/prefs';
import { buildRules } from '../lib/rules';

const RULE_ID_BASE = 1000;

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
  });

  void primeAndSync();
});
