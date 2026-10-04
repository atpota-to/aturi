import { escapeRegExp } from './bypass';
import { redirectEdges, type RedirectRule } from './rules';
import type { Prefs } from './prefs';

/**
 * Tab-scoped `allow` rules sit above the auto-redirect rules (priority 1) and
 * below the popup's exact-URL bypass (priority 100). DNR already ranks `allow`
 * over `redirect` at equal priority, but an explicit number keeps the ordering
 * obvious when the three rule sets are read together.
 */
export const TAB_SCOPE_RULE_PRIORITY = 50;

/**
 * Session-rule id range reserved for tab-scoped exemptions. The popup's
 * bypass rules live below `BYPASS_ID_MAX`; keeping the two ranges disjoint is
 * what lets each sweep its own rules without clobbering the other's.
 */
export const TAB_SCOPE_ID_MIN = 100_000;
export const TAB_SCOPE_ID_MAX = 999_999;

export function isTabScopeRuleId(id: number): boolean {
  return id >= TAB_SCOPE_ID_MIN && id <= TAB_SCOPE_ID_MAX;
}

/**
 * URLs a browser parks an empty tab on. A tab that starts on one of these and
 * has no opener is a tab you opened yourself, so whatever URL lands in it next
 * is one you typed or pasted.
 */
const BLANK_TAB_URLS = new Set([
  '',
  'about:blank',
  'about:home',
  'about:newtab',
  'about:privatebrowsing',
  'chrome://newtab',
  'chrome://new-tab-page',
  'chrome://new-tab-page-third-party',
  'edge://newtab',
  'opera://startpage',
]);

export function isBlankTabUrl(url?: string | null): boolean {
  if (!url) return true;
  return BLANK_TAB_URLS.has(url.trim().toLowerCase().replace(/\/+$/, ''));
}

/**
 * The host a tab is showing, or null when it isn't on an http(s) page (a
 * settings page, a PDF viewer, a blank tab). Only http(s) hosts can be a
 * redirect source or destination, so null means "no tab context to reason
 * about".
 */
export function tabHostFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Hosts that should not be auto-redirected *inside a tab that is currently
 * showing `tabHost`*.
 *
 * Two cases, both resting on the same idea: the page a tab already has open
 * says something about what you are doing in it.
 *
 * 1. The tab is on a redirect source. You are on bsky.app and you edit the
 *    address bar, or reload, or go back. You went to bsky.app deliberately;
 *    bouncing you out of it now is the opposite of helpful. (In practice this
 *    mostly catches address-bar edits, because clients that route client-side
 *    never issue a main-frame request for their own internal links.)
 *
 * 2. The tab is on a redirect destination. You clicked a bsky.app link, we
 *    sent you to anisota.net, and now you are typing bsky.app back into the
 *    address bar to see the original. Redirecting that would land you on the
 *    page already open in this tab, which cannot be what any navigation is
 *    for, so we stand down and let it through.
 *
 * Case 2 needs no guess about how the navigation started: a redirect that
 * resolves to the page you are already looking at is a no-op worth skipping
 * however you got there.
 */
export function keepHostsFor(prefs: Prefs, tabHost: string | null): string[] {
  if (!tabHost) return [];

  const keep = new Set<string>();
  for (const edge of redirectEdges(prefs)) {
    if (edge.sourceHost === tabHost) keep.add(edge.sourceHost);
    if (edge.destinationHost === tabHost) keep.add(edge.sourceHost);
  }
  return [...keep].sort();
}

/**
 * Every host the active rules would redirect away from. Used by the blanket
 * exemptions (a paused tab, a tab you just opened) where the point is to leave
 * auto-redirect switched off entirely rather than to spare one host.
 */
export function allSourceHosts(prefs: Prefs): string[] {
  return [...new Set(redirectEdges(prefs).map(e => e.sourceHost))].sort();
}

/**
 * A session-scoped `allow` rule exempting `hosts` from auto-redirect, but only
 * inside `tabId`. Returns null when there is nothing to exempt, so callers can
 * skip the rule entirely rather than install one that matches nothing.
 *
 * The host alternation is anchored between `://` and the first character that
 * can legally follow a host, so `bsky.app` matches `bsky.app/x` and
 * `bsky.app:443` but never `evil-bsky.app` or `bsky.app.example.com`. That
 * mirrors the redirect rules, which are host-exact too.
 */
export function buildTabScopeRule(
  hosts: string[],
  tabId: number,
  id: number
): RedirectRule | null {
  if (hosts.length === 0) return null;
  const alternation = hosts.map(escapeRegExp).join('|');
  return {
    id,
    priority: TAB_SCOPE_RULE_PRIORITY,
    action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      regexFilter: `^https?://(?:${alternation})(?:[:/?#]|$)`,
      resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
      tabIds: [tabId],
    },
  };
}

/**
 * What the background tracks per open tab. `host` and `fresh` are re-derived
 * from tab events; `paused` is the user's explicit choice in the popup.
 */
export type TabScope = {
  /** Host the tab is showing, or null when it isn't on an http(s) page. */
  host: string | null;
  /**
   * True while a tab you opened yourself (no opener, parked on the new-tab
   * page) still hasn't gone anywhere. The first URL to land in such a tab is
   * one you typed or pasted, so it gets a pass. Cleared the moment the tab
   * commits a real page.
   */
  fresh: boolean;
  /** Auto-redirect explicitly paused for this tab from the popup. */
  paused: boolean;
};

/**
 * Resolve one tab's exemption to a host list, applying the prefs that gate
 * each rule. An explicit pause always wins; the two heuristics are opt-out.
 */
export function hostsForScope(prefs: Prefs, scope: TabScope): string[] {
  if (!prefs.autoRedirect) return [];
  if (scope.paused) return allSourceHosts(prefs);
  if (scope.fresh && prefs.redirectSkipNewTab) return allSourceHosts(prefs);
  if (prefs.redirectStayOnCurrentApp) return keepHostsFor(prefs, scope.host);
  return [];
}

/**
 * Compile the whole tab-scope rule set. Ids are handed out from
 * `TAB_SCOPE_ID_MIN` in iteration order; because the background replaces the
 * entire range on every change, ids only need to be unique within one batch.
 */
export function buildTabScopeRules(
  prefs: Prefs,
  scopes: Iterable<[number, TabScope]>
): RedirectRule[] {
  const rules: RedirectRule[] = [];
  let id = TAB_SCOPE_ID_MIN;

  for (const [tabId, scope] of scopes) {
    if (id > TAB_SCOPE_ID_MAX) break;
    const rule = buildTabScopeRule(hostsForScope(prefs, scope), tabId, id);
    if (!rule) continue;
    rules.push(rule);
    id++;
  }

  return rules;
}
