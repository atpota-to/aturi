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
    // pdsls isn't in any compat family so it can never act as a family favorite,
    // but even if someone wires it in manually, the DID gate kicks in.
    const rules = buildRules(prefs({
      autoRedirect: true,
      defaults: { bluesky: { profile: 'pdsls' } },
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
      defaults: { leaflet: { profile: 'pckt' } },
    }));
    const leafletRule = rules.find(r =>
      r.condition.regexFilter?.includes('leaflet\\.pub')
    );
    expect(leafletRule).toBeDefined();
    // pckt currently proxies through pdsls in its getUrl, so just assert the
    // rule exists (compat filter allowed it through).
    expect(leafletRule?.action.redirect?.regexSubstitution).toBeTruthy();
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

describe('compat helpers', () => {
  it('bluesky and anisota are redirect-compatible', () => {
    expect(areRedirectCompatible('bluesky', 'anisota', [])).toBe(true);
  });

  it('bluesky and semble are not redirect-compatible', () => {
    expect(areRedirectCompatible('bluesky', 'semble', [])).toBe(false);
  });

  it('dev tools have no compat (never a redirect target)', () => {
    expect(getRedirectCompatFor('pdsls', [])).toEqual([]);
    expect(getRedirectCompatFor('atptools', [])).toEqual([]);
    expect(getRedirectCompatFor('anisotaExplorer', [])).toEqual([]);
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
