import { describe, it, expect } from 'vitest';
import { buildBypassRule, BYPASS_RULE_PRIORITY } from '../bypass';
import { buildRules } from '../rules';
import { DEFAULT_PREFS, type Prefs } from '../prefs';

function prefs(partial: Partial<Prefs>): Prefs {
  return { ...DEFAULT_PREFS, ...partial };
}

describe('buildBypassRule', () => {
  it('produces a main_frame allow rule', () => {
    const rule = buildBypassRule('https://bsky.app/profile/alice/post/abc', 1);
    expect(rule.id).toBe(1);
    expect(rule.action.type).toBe('allow');
    expect(rule.condition.resourceTypes).toEqual(['main_frame']);
  });

  it('outranks generated redirect rules', () => {
    const redirectRules = buildRules(
      prefs({ autoRedirect: true, defaults: { bluesky: { post: 'blacksky' } } })
    );
    // Every redirect rule sits at priority 1; the bypass must win.
    expect(redirectRules.every(r => (r.priority ?? 0) < BYPASS_RULE_PRIORITY)).toBe(true);
  });

  it('anchors to the exact URL and escapes regex metacharacters', () => {
    const url = 'https://bsky.app/profile/alice.test/post/3k+a?x=1';
    const rule = buildBypassRule(url, 2);
    const filter = rule.condition.regexFilter!;
    expect(filter.startsWith('^https://bsky\\.app/')).toBe(true);
    // Metacharacters from the URL are escaped, not treated as regex syntax.
    expect(filter).toContain('alice\\.test');
    expect(filter).toContain('3k\\+a');
    expect(filter).toContain('\\?x=1');

    const re = new RegExp(filter);
    expect(re.test(url)).toBe(true);
    // A different post under the same profile must NOT be exempted.
    expect(re.test('https://bsky.app/profile/alice.test/post/other')).toBe(false);
  });

  it('still matches when DNR appends/keeps a trailing fragment', () => {
    const base = 'https://leaflet.pub/p/alice';
    const rule = buildBypassRule(`${base}#section`, 3);
    const re = new RegExp(rule.condition.regexFilter!);
    // DNR drops the fragment before matching, so the fragment-less URL must match.
    expect(re.test(base)).toBe(true);
    expect(re.test(`${base}#section`)).toBe(true);
  });
});
