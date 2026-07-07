import { describe, it, expect } from 'vitest';
import { buildRules } from '../rules';
import { DEFAULT_PREFS, type Prefs } from '../prefs';
import { WAYPOINT_DESTINATIONS_DATA } from '@aturi/waypoints.data';

function prefs(partial: Partial<Prefs>): Prefs {
  return { ...DEFAULT_PREFS, ...partial };
}

/**
 * Simulate how the browser applies a DNR regex-substitution rule: find the
 * first rule whose regexFilter matches the URL, then expand its `\1`-style
 * backrefs against the captured groups (JS RegExp uses `$1`).
 */
function applyRules(url: string, rules: ReturnType<typeof buildRules>): string | null {
  for (const rule of rules) {
    const filter = rule.condition.regexFilter;
    const sub = rule.action.redirect?.regexSubstitution;
    if (!filter || !sub) continue;
    const m = new RegExp(filter).exec(url);
    if (!m) continue;
    return sub.replace(/\\(\d+)/g, (_, d: string) => m[Number(d)] ?? '');
  }
  return null;
}

describe('pdsls -> Aturi Explore end-to-end rewrite', () => {
  const rules = buildRules(
    prefs({ autoRedirect: true, favoriteByFamily: { 'atproto-explorer': 'aturiExplore' } })
  );
  const explore = WAYPOINT_DESTINATIONS_DATA.aturiExplore;

  it('rewrites a real pdsls post URL (DID identifier)', () => {
    const out = applyRules(
      'https://pdsls.dev/at://did:plc:abc123/app.bsky.feed.post/3kxyz',
      rules
    );
    expect(out).toBe(explore.getUrl('did:plc:abc123', 'app.bsky.feed.post', '3kxyz', 'did:plc:abc123'));
    expect(out).toBe('https://aturi.to/explore/did:plc:abc123/app.bsky.feed.post/3kxyz');
  });

  it('rewrites a pdsls record URL with a handle identifier', () => {
    const out = applyRules(
      'https://pdsls.dev/at://alice.bsky.social/social.grain.gallery/abc',
      rules
    );
    expect(out).toBe('https://aturi.to/explore/alice.bsky.social/social.grain.gallery/abc');
  });

  it('rewrites a pdsls profile URL', () => {
    const out = applyRules('https://pdsls.dev/at://did:plc:abc123', rules);
    expect(out).toBe('https://aturi.to/explore/did:plc:abc123');
  });

  it('rewrites atp.tools single-slash AT URIs too', () => {
    const out = applyRules(
      'https://atp.tools/at:/did:plc:abc123/app.bsky.feed.post/3kxyz',
      rules
    );
    expect(out).toBe('https://aturi.to/explore/did:plc:abc123/app.bsky.feed.post/3kxyz');
  });

  it('leaves a pdsls home / non-AT URL untouched', () => {
    expect(applyRules('https://pdsls.dev/', rules)).toBeNull();
    expect(applyRules('https://pdsls.dev/settings', rules)).toBeNull();
  });

  it('does not rewrite when the URL is already on the explorer', () => {
    expect(
      applyRules('https://aturi.to/explore/did:plc:abc123/app.bsky.feed.post/3kxyz', rules)
    ).toBeNull();
  });
});
