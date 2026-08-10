import { describe, it, expect } from 'vitest';
import { buildRules } from '../rules';
import {
  DEFAULT_PREFS,
  REDIRECT_OFF,
  areRedirectCompatible,
  getRedirectCompatFor,
  resolveRedirectFor,
  type Prefs,
} from '../prefs';

function prefs(partial: Partial<Prefs>): Prefs {
  return { ...DEFAULT_PREFS, ...partial };
}

describe('buildRules', () => {
  it('returns no rules when autoRedirect is off', () => {
    const rules = buildRules(prefs({ autoRedirect: false, defaults: { bluesky: { post: 'blacksky' } } }));
    expect(rules).toEqual([]);
  });

  it('generates a bsky -> blacksky post rule (same compat family)', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { post: 'blacksky' } },
    }));
    expect(rules.length).toBe(1);
    const rule = rules[0];
    expect(rule.action.type).toBe('redirect');
    expect(rule.action.redirect?.regexSubstitution).toContain('blacksky.community');
    expect(rule.condition.regexFilter).toContain('bsky\\.app');
  });

  it('skips hidden destination waypoints', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { post: 'blacksky' } },
      // Hide blacksky by removing it from every group.
      waypointGroups: DEFAULT_PREFS.waypointGroups.map(g => ({
        ...g,
        waypointIds: g.waypointIds.filter(id => id !== 'blacksky'),
      })),
    }));
    expect(rules).toEqual([]);
  });

  it('skips DID-required destinations', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { post: 'pdsls' } },
    }));
    expect(rules).toEqual([]);
  });

  it('skips self-redirects', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { post: 'bluesky' } },
    }));
    expect(rules).toEqual([]);
  });

  it('generates profile-level rules', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { profile: 'anisota' } },
    }));
    expect(rules.length).toBe(1);
    expect(rules[0].action.redirect?.regexSubstitution).toContain('anisota.net');
  });

  it('uses per-family favorite for sources in that family', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'bluesky-social': 'anisota' },
    }));
    const bskyRules = rules.filter(r =>
      r.condition.regexFilter?.includes('bsky\\.app')
    );
    expect(bskyRules.length).toBeGreaterThan(0);
    expect(bskyRules.every(r =>
      r.action.redirect?.regexSubstitution?.includes('anisota.net')
    )).toBe(true);
  });

  it('per-cell overrides win over family favorite', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'bluesky-social': 'anisota' },
      defaults: { bluesky: { post: 'blacksky' } },
    }));
    const bskyPost = rules.find(r =>
      r.condition.regexFilter?.includes('bsky\\.app') &&
      r.condition.regexFilter?.includes('post')
    );
    expect(bskyPost?.action.redirect?.regexSubstitution).toContain('blacksky.community');
  });

  it('REDIRECT_OFF disables a single source/type even when a family favorite is set', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'bluesky-social': 'anisota' },
      defaults: { bluesky: { profile: REDIRECT_OFF } },
    }));
    const bskyProfile = rules.find(r =>
      r.condition.regexFilter?.includes('bsky\\.app') &&
      r.condition.regexFilter?.endsWith('/?$')
    );
    expect(bskyProfile).toBeUndefined();
  });

  it('does not emit a self-redirect when family favorite matches the source', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'bluesky-social': 'bluesky' },
    }));
    const bskyToBsky = rules.find(r =>
      r.condition.regexFilter?.includes('bsky\\.app') &&
      r.action.redirect?.regexSubstitution?.includes('bsky.app')
    );
    expect(bskyToBsky).toBeUndefined();
  });

  it('skips family favorites whose templates need a DID', () => {
    // Within the explorer family atp.tools is a valid *source* but a DID-only
    // *destination*, so a pdsls -> atp.tools favorite must not emit any rule.
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'atproto-explorer': 'atptools' },
    }));
    expect(rules).toEqual([]);
  });

  it('never cross-redirects between incompatible apps (e.g. bsky -> semble)', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { profile: 'semble' } },
    }));
    expect(rules).toEqual([]);
  });

  it('never cross-redirects from a standalone to a bluesky client', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { semble: { profile: 'bluesky' } },
    }));
    expect(rules).toEqual([]);
  });

  it('allows redirects inside the standard-site family', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { leaflet: { profile: 'anisotaReader' } },
    }));
    const leafletRule = rules.find(r =>
      r.condition.regexFilter?.includes('leaflet\\.pub')
    );
    expect(leafletRule).toBeDefined();
    expect(leafletRule?.action.redirect?.regexSubstitution).toContain('anisota.net');
  });

  // Regression: a list rule used to inherit the destination's profile URL when
  // that destination's getUrl had no `app.bsky.graph.list` branch, so
  // `bsky.app/profile/alice/lists/xyz` redirected to alice's profile instead of
  // to her list.
  it('carries the list rkey through to the destination', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'bluesky-social': 'blacksky' },
    }));
    const listRule = rules.find(r =>
      r.condition.regexFilter?.includes('bsky\\.app') &&
      r.condition.regexFilter?.includes('lists')
    );
    expect(listRule?.action.redirect?.regexSubstitution).toBe(
      'https://blacksky.community/profile/\\1/lists/\\2'
    );
  });

  it('emits no rule at all rather than one that drops the record', () => {
    // Red Dwarf has no list route, so a bsky list must stay on bsky.app.
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'bluesky-social': 'reddwarf' },
    }));
    const toProfile = rules.find(r =>
      r.condition.regexFilter?.includes('lists') &&
      r.action.redirect?.regexSubstitution === 'https://reddwarf.app/profile/\\1'
    );
    expect(toProfile).toBeUndefined();
    // The post rules for the same favorite are unaffected.
    expect(rules.some(r => r.condition.regexFilter?.includes('post'))).toBe(true);
  });

  it('drops a custom-waypoint rule whose template ignores the rkey', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { list: 'custom:x' } },
      customWaypoints: [{
        id: 'custom:x',
        name: 'Example',
        domain: 'example.app',
        category: 'custom',
        supportedTypes: ['list'],
        // No `{rkey}`: the destination can't address the list itself.
        templates: { list: '/u/{handle}' },
        redirectCompat: ['bluesky-social'],
      }],
    }));
    expect(rules).toEqual([]);
  });

  it('family favorite for standard-site does not leak into bluesky-social sources', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'standard-site': 'offprint' },
    }));
    const leaked = rules.find(r =>
      r.condition.regexFilter?.includes('bsky\\.app') &&
      r.action.redirect?.regexSubstitution?.includes('offprint.app')
    );
    expect(leaked).toBeUndefined();
  });
});

describe('explorer redirects (pdsls / atp.tools -> Aturi Explore)', () => {
  it('rewrites a pdsls record and profile to the aturi explorer', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'atproto-explorer': 'aturiExplore' },
    }));
    const pdslsRules = rules.filter(r =>
      r.condition.regexFilter?.includes('pdsls\\.dev')
    );
    // One record rule (identifier/collection/rkey) + one profile rule.
    expect(pdslsRules.length).toBe(2);

    const record = pdslsRules.find(r =>
      r.action.redirect?.regexSubstitution?.endsWith('/\\1/\\2/\\3')
    );
    const profile = pdslsRules.find(r =>
      r.action.redirect?.regexSubstitution?.endsWith('/explore/\\1')
    );

    expect(record?.action.redirect?.regexSubstitution).toBe(
      'https://aturi.to/explore/\\1/\\2/\\3'
    );
    // The record recipe accepts `at://` (double slash) or `at:/` (single).
    expect(record?.condition.regexFilter).toBe(
      '^https://pdsls\\.dev/at:/+([^/?#]+)/([^/?#]+)/([^/?#]+).*'
    );
    expect(profile?.action.redirect?.regexSubstitution).toBe(
      'https://aturi.to/explore/\\1'
    );
    expect(profile?.condition.regexFilter).toBe(
      '^https://pdsls\\.dev/at:/+([^/?#]+)/?$'
    );
  });

  it('also rewrites atp.tools under the same explorer favorite', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'atproto-explorer': 'aturiExplore' },
    }));
    const atpRules = rules.filter(r =>
      r.condition.regexFilter?.includes('atp\\.tools')
    );
    expect(atpRules.length).toBe(2);
    expect(
      atpRules.every(r =>
        r.action.redirect?.regexSubstitution?.includes('aturi.to/explore')
      )
    ).toBe(true);
  });

  it('emits no explorer rules until an explorer favorite is chosen', () => {
    const rules = buildRules(prefs({ autoRedirect: true }));
    const explorerRules = rules.filter(r =>
      r.condition.regexFilter?.includes('pdsls\\.dev') ||
      r.condition.regexFilter?.includes('atp\\.tools')
    );
    expect(explorerRules).toEqual([]);
  });

  it('never turns the destination explorer into a source (no aturi.to rules)', () => {
    const rules = buildRules(prefs({
      autoRedirect: true,
      favoriteByFamily: { 'atproto-explorer': 'aturiExplore' },
    }));
    const fromAturi = rules.filter(r =>
      r.condition.regexFilter?.includes('aturi\\.to')
    );
    expect(fromAturi).toEqual([]);
  });
});

describe('compat helpers', () => {
  it('bluesky and anisota are redirect-compatible', () => {
    expect(areRedirectCompatible('bluesky', 'anisota', [])).toBe(true);
  });

  it('bluesky and semble are not redirect-compatible', () => {
    expect(areRedirectCompatible('bluesky', 'semble', [])).toBe(false);
  });

  it('record explorers share the explorer compat family', () => {
    expect(getRedirectCompatFor('pdsls', [])).toEqual(['atproto-explorer']);
    expect(getRedirectCompatFor('atptools', [])).toEqual(['atproto-explorer']);
    expect(getRedirectCompatFor('aturiExplore', [])).toEqual(['atproto-explorer']);
    expect(areRedirectCompatible('pdsls', 'aturiExplore', [])).toBe(true);
    // pdsls stays incompatible with bluesky clients — different families.
    expect(areRedirectCompatible('pdsls', 'bluesky', [])).toBe(false);
  });

  it('pinksky is in its own family (not bluesky-social)', () => {
    expect(areRedirectCompatible('pinksky', 'bluesky', [])).toBe(false);
    expect(getRedirectCompatFor('pinksky', [])).toEqual(['pinksky']);
  });

  it('resolveRedirectFor walks families in order and picks the first match', () => {
    const p = prefs({
      favoriteByFamily: {
        'bluesky-social': 'anisota',
        'standard-site': 'offprint',
      },
    });
    expect(resolveRedirectFor(p, 'bluesky', 'post')).toBe('anisota');
    expect(resolveRedirectFor(p, 'leaflet', 'profile')).toBe('offprint');
    expect(resolveRedirectFor(p, 'semble', 'profile')).toBe(null);
  });
});
