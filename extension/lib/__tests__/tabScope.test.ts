import { describe, it, expect } from 'vitest';
import { redirectEdges, waypointHost } from '../rules';
import {
  BYPASS_ID_MAX,
  BYPASS_ID_MIN,
  isBypassRuleId,
} from '../bypass';
import {
  TAB_SCOPE_ID_MIN,
  TAB_SCOPE_RULE_PRIORITY,
  allSourceHosts,
  buildTabScopeRule,
  buildTabScopeRules,
  hostsForScope,
  isBlankTabUrl,
  isTabScopeRuleId,
  keepHostsFor,
  tabHostFromUrl,
  type TabScope,
} from '../tabScope';
import { DEFAULT_PREFS, type Prefs } from '../prefs';

function prefs(partial: Partial<Prefs>): Prefs {
  return { ...DEFAULT_PREFS, ...partial };
}

/** bsky.app posts redirect to anisota.net; nothing else is configured. */
function bskyToAnisota(extra: Partial<Prefs> = {}): Prefs {
  return prefs({
    autoRedirect: true,
    defaults: { bluesky: { post: 'anisota' } },
    ...extra,
  });
}

function scope(partial: Partial<TabScope> = {}): TabScope {
  return { host: null, fresh: false, paused: false, ...partial };
}

describe('waypointHost', () => {
  it('reads hosts for waypoints that can act as a redirect source', () => {
    expect(waypointHost('bluesky')).toBe('bsky.app');
    expect(waypointHost('anisota')).toBe('anisota.net');
    expect(waypointHost('pdsls')).toBe('pdsls.dev');
  });

  it('falls back to the waypoint URL for destination-only waypoints', () => {
    // anisotaReader is not in HOST_BY_SOURCE, so the host has to come from
    // asking the waypoint to build a URL.
    expect(waypointHost('anisotaReader')).toBeTruthy();
    expect(waypointHost('anisotaReader')).not.toContain('/');
  });

  it('uses the declared domain for custom waypoints', () => {
    const custom = {
      id: 'custom:1',
      name: 'Mine',
      domain: 'Example.APP',
      category: 'custom',
      supportedTypes: ['post' as const],
      templates: { post: '/p/{handle}/{rkey}' },
      redirectCompat: ['bluesky-social' as const],
    };
    expect(waypointHost('custom:1', [custom])).toBe('example.app');
  });

  it('returns null for waypoints it has never heard of', () => {
    expect(waypointHost('nope')).toBeNull();
    expect(waypointHost('custom:missing', [])).toBeNull();
  });
});

describe('redirectEdges', () => {
  it('is empty when auto-redirect is off', () => {
    expect(redirectEdges(bskyToAnisota({ autoRedirect: false }))).toEqual([]);
  });

  it('reports the host pair a live redirect moves traffic between', () => {
    const edges = redirectEdges(bskyToAnisota());
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      sourceHost: 'bsky.app',
      destinationHost: 'anisota.net',
    });
  });

  it('deduplicates a host pair shared by several record types', () => {
    const edges = redirectEdges(
      prefs({
        autoRedirect: true,
        defaults: { bluesky: { post: 'anisota', list: 'anisota', profile: 'anisota' } },
      })
    );
    expect(edges).toHaveLength(1);
  });
});

describe('keepHostsFor', () => {
  it('leaves the source alone when the tab is already on it', () => {
    // On bsky.app, editing the address bar to another bsky.app URL should not
    // eject you from the app you deliberately went to.
    expect(keepHostsFor(bskyToAnisota(), 'bsky.app')).toEqual(['bsky.app']);
  });

  it('lets you get back to the source from the destination', () => {
    // Redirected to anisota.net, you retype bsky.app. Redirecting that would
    // land you on the page this tab is already showing.
    expect(keepHostsFor(bskyToAnisota(), 'anisota.net')).toEqual(['bsky.app']);
  });

  it('exempts nothing on an unrelated host', () => {
    expect(keepHostsFor(bskyToAnisota(), 'news.ycombinator.com')).toEqual([]);
  });

  it('exempts nothing when the tab is not on an http(s) page', () => {
    expect(keepHostsFor(bskyToAnisota(), null)).toEqual([]);
  });

  it('exempts nothing when auto-redirect is off', () => {
    expect(keepHostsFor(bskyToAnisota({ autoRedirect: false }), 'anisota.net')).toEqual([]);
  });

  it('covers every source pointed at the destination the tab is on', () => {
    const hosts = keepHostsFor(
      prefs({
        autoRedirect: true,
        defaults: { bluesky: { post: 'anisota' }, deer: { post: 'anisota' } },
      }),
      'anisota.net'
    );
    expect(hosts).toEqual(['bsky.app', 'deer.social']);
  });
});

describe('hostsForScope', () => {
  it('exempts nothing while auto-redirect is off, even for a paused tab', () => {
    const p = bskyToAnisota({ autoRedirect: false });
    expect(hostsForScope(p, scope({ paused: true }))).toEqual([]);
  });

  it('exempts every source host for a paused tab', () => {
    expect(hostsForScope(bskyToAnisota(), scope({ paused: true }))).toEqual(['bsky.app']);
  });

  it('exempts every source host for a tab you just opened', () => {
    expect(hostsForScope(bskyToAnisota(), scope({ fresh: true }))).toEqual(['bsky.app']);
  });

  it('honors the pref that turns the fresh-tab pass off', () => {
    const p = bskyToAnisota({ redirectSkipNewTab: false });
    expect(hostsForScope(p, scope({ fresh: true }))).toEqual([]);
  });

  it('honors the pref that turns the stay-put rule off', () => {
    const p = bskyToAnisota({ redirectStayOnCurrentApp: false });
    expect(hostsForScope(p, scope({ host: 'anisota.net' }))).toEqual([]);
  });

  it('still pauses a tab when both heuristics are off', () => {
    const p = bskyToAnisota({
      redirectStayOnCurrentApp: false,
      redirectSkipNewTab: false,
    });
    expect(hostsForScope(p, scope({ host: 'anisota.net', paused: true }))).toEqual([
      'bsky.app',
    ]);
  });
});

describe('buildTabScopeRule', () => {
  it('returns null when there is nothing to exempt', () => {
    expect(buildTabScopeRule([], 7, TAB_SCOPE_ID_MIN)).toBeNull();
  });

  it('allows the listed hosts, scoped to one tab and the main frame', () => {
    const rule = buildTabScopeRule(['bsky.app'], 7, TAB_SCOPE_ID_MIN)!;
    expect(rule.action.type).toBe('allow');
    expect(rule.priority).toBe(TAB_SCOPE_RULE_PRIORITY);
    expect(rule.condition.tabIds).toEqual([7]);
    expect(rule.condition.resourceTypes).toEqual(['main_frame']);
  });

  it('matches the host exactly, not lookalikes or subdomains', () => {
    const rule = buildTabScopeRule(['bsky.app'], 7, TAB_SCOPE_ID_MIN)!;
    const re = new RegExp(rule.condition.regexFilter!);

    expect(re.test('https://bsky.app/profile/alice')).toBe(true);
    expect(re.test('https://bsky.app')).toBe(true);
    expect(re.test('https://bsky.app:443/x')).toBe(true);
    expect(re.test('http://bsky.app/x')).toBe(true);

    expect(re.test('https://evil-bsky.app/x')).toBe(false);
    expect(re.test('https://bsky.app.example.com/x')).toBe(false);
    expect(re.test('https://staging.bsky.app/x')).toBe(false);
    // The dot is escaped, so it can't stand in for an arbitrary character.
    expect(re.test('https://bskyxapp/x')).toBe(false);
  });

  it('matches any of several hosts', () => {
    const rule = buildTabScopeRule(['bsky.app', 'deer.social'], 7, TAB_SCOPE_ID_MIN)!;
    const re = new RegExp(rule.condition.regexFilter!);
    expect(re.test('https://bsky.app/x')).toBe(true);
    expect(re.test('https://deer.social/x')).toBe(true);
    expect(re.test('https://anisota.net/x')).toBe(false);
  });
});

describe('buildTabScopeRules', () => {
  it('emits one rule per tab that needs one, and skips the rest', () => {
    const rules = buildTabScopeRules(
      bskyToAnisota(),
      new Map<number, TabScope>([
        [1, scope({ host: 'anisota.net' })],
        [2, scope({ host: 'news.ycombinator.com' })],
        [3, scope({ paused: true })],
      ])
    );
    expect(rules.map(r => r.condition.tabIds)).toEqual([[1], [3]]);
  });

  it('gives every rule in a batch a distinct id inside the reserved range', () => {
    const rules = buildTabScopeRules(
      bskyToAnisota(),
      new Map<number, TabScope>([
        [1, scope({ paused: true })],
        [2, scope({ paused: true })],
      ])
    );
    const ids = rules.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isTabScopeRuleId)).toBe(true);
  });

  it('emits nothing when auto-redirect is off', () => {
    const rules = buildTabScopeRules(
      bskyToAnisota({ autoRedirect: false }),
      new Map<number, TabScope>([[1, scope({ paused: true })]])
    );
    expect(rules).toEqual([]);
  });
});

describe('session rule id ranges', () => {
  it('does not overlap between bypass and tab-scope rules', () => {
    expect(BYPASS_ID_MAX).toBeLessThan(TAB_SCOPE_ID_MIN);
    expect(isBypassRuleId(BYPASS_ID_MIN)).toBe(true);
    expect(isBypassRuleId(BYPASS_ID_MAX)).toBe(true);
    expect(isBypassRuleId(TAB_SCOPE_ID_MIN)).toBe(false);
    expect(isTabScopeRuleId(BYPASS_ID_MAX)).toBe(false);
    expect(isTabScopeRuleId(TAB_SCOPE_ID_MIN)).toBe(true);
  });
});

describe('isBlankTabUrl', () => {
  it('recognizes the parked-tab URLs each browser uses', () => {
    for (const url of [
      undefined,
      null,
      '',
      'about:blank',
      'about:newtab',
      'chrome://newtab',
      'chrome://newtab/',
      'CHROME://NewTab/',
      'chrome://new-tab-page/',
      'edge://newtab/',
    ]) {
      expect(isBlankTabUrl(url)).toBe(true);
    }
  });

  it('does not treat a real page as blank', () => {
    expect(isBlankTabUrl('https://bsky.app/')).toBe(false);
    expect(isBlankTabUrl('https://example.com/about:blank')).toBe(false);
  });
});

describe('tabHostFromUrl', () => {
  it('lowercases the host of an http(s) page', () => {
    expect(tabHostFromUrl('https://BSKY.app/profile/alice')).toBe('bsky.app');
    expect(tabHostFromUrl('http://example.com')).toBe('example.com');
  });

  it('returns null for anything that is not a web page', () => {
    expect(tabHostFromUrl(undefined)).toBeNull();
    expect(tabHostFromUrl('about:blank')).toBeNull();
    expect(tabHostFromUrl('chrome://newtab/')).toBeNull();
    expect(tabHostFromUrl('not a url')).toBeNull();
  });
});

describe('allSourceHosts', () => {
  it('lists every host the active rules redirect away from', () => {
    const hosts = allSourceHosts(
      prefs({
        autoRedirect: true,
        defaults: { bluesky: { post: 'anisota' }, deer: { post: 'anisota' } },
      })
    );
    expect(hosts).toEqual(['bsky.app', 'deer.social']);
  });

  it('is empty when auto-redirect is off', () => {
    expect(allSourceHosts(bskyToAnisota({ autoRedirect: false }))).toEqual([]);
  });
});
