import { describe, it, expect } from 'vitest';
import { buildBypassRule, BYPASS_RULE_PRIORITY } from '../bypass';
import { buildRules } from '../rules';
import { DEFAULT_PREFS, type Prefs } from '../prefs';
import { safariRegexStatus } from '../safariRegex';

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

describe('buildBypassRule on Safari', () => {
  // Safari rejects a whole `updateSessionRules` call when one `regexFilter`
  // has a non-ASCII character or falls outside WebKit's content-blocker
  // dialect, and it matches against the canonical URL (fragment included).
  const urls = [
    'https://bsky.app/profile/alice.test/post/3k+a?x=1&y=$2#frag',
    'https://leaflet.pub/p/alice/100%25 sure',
    'https://example.app/u/alice smith/{id}/(x)|[y]^*',
    'https://anisota.net/profile/jos\u00e9.example/post/3k',
    'https://b\u00fccher.example/caf\u00e9?q=\u65e5\u672c#\u00e9',
    'https://pdsls.dev/at://did:plc:abc/app.bsky.feed.post/3k?',
    'HTTPS://BSKY.APP/profile/alice',
  ];

  it.each(urls)('%j yields an ASCII filter Safari accepts', url => {
    const filter = buildBypassRule(url, 7).condition.regexFilter!;
    expect(/^[\x00-\x7f]*$/.test(filter)).toBe(true);
    expect(safariRegexStatus(filter)).toBe('Ok');
  });

  it.each(urls)('%j matches the URL as the browser reports it', url => {
    const re = new RegExp(buildBypassRule(url, 7).condition.regexFilter!);
    const canonical = new URL(url).href;
    const withoutFragment = canonical.split('#')[0];
    expect(re.test(withoutFragment)).toBe(true);
    expect(re.test(`${withoutFragment}#elsewhere`)).toBe(true);
    // Still exact: a longer path is not exempted.
    expect(re.test(`${withoutFragment}x`)).toBe(false);
  });

  it('canonicalises the host and percent-encodes the path', () => {
    const filter = buildBypassRule('https://B\u00fccher.example/caf\u00e9 x', 8).condition.regexFilter!;
    expect(filter).toBe('^https://xn--bcher-kva\\.example/caf%C3%A9%20x(?:#.*)?$');
  });

  it('uses a string the URL parser rejects as given', () => {
    const filter = buildBypassRule('not a url#frag', 9).condition.regexFilter!;
    expect(filter).toBe('^not a url(?:#.*)?$');
  });
});
