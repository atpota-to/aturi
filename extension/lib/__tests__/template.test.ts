import { describe, it, expect } from 'vitest';
import { fillTemplate, templateToRegex, matchCustomUrl, customWaypointToData } from '../template';
import type { CustomWaypoint } from '../prefs';

describe('fillTemplate', () => {
  it('substitutes known tokens', () => {
    const url = fillTemplate('/u/{handle}/p/{rkey}', {
      handle: 'alice',
      rkey: 'abc',
    });
    expect(url).toBe('/u/alice/p/abc');
  });

  it('replaces missing tokens with empty strings', () => {
    const url = fillTemplate('/u/{handle}/p/{rkey}', { handle: 'alice' });
    expect(url).toBe('/u/alice/p/');
  });

  it('leaves unknown tokens untouched', () => {
    const url = fillTemplate('/u/{unknown}', { handle: 'alice' });
    expect(url).toBe('/u/{unknown}');
  });
});

describe('templateToRegex', () => {
  it('captures tokens in order', () => {
    const { regex, tokenOrder, substitution } = templateToRegex('/u/{handle}/p/{rkey}');
    expect(tokenOrder).toEqual(['handle', 'rkey']);
    const match = regex.exec('/u/alice/p/abc');
    expect(match?.[1]).toBe('alice');
    expect(match?.[2]).toBe('abc');
    expect(substitution).toBe('/u/\\1/p/\\2');
  });

  it('escapes regex metacharacters in literal segments', () => {
    const { regex } = templateToRegex('/u.v/{handle}');
    expect(regex.test('/u.v/alice')).toBe(true);
    expect(regex.test('/uxv/alice')).toBe(false);
  });

  it('is agnostic about a trailing slash on the URL', () => {
    const { regex } = templateToRegex('/u/{handle}');
    expect(regex.test('/u/alice')).toBe(true);
    expect(regex.test('/u/alice/')).toBe(true);
  });

  it('is agnostic about a trailing slash on the template', () => {
    const { regex } = templateToRegex('/u/{handle}/');
    expect(regex.test('/u/alice')).toBe(true);
    expect(regex.test('/u/alice/')).toBe(true);
  });

  it('still anchors the end - extra path segments do not match', () => {
    const { regex } = templateToRegex('/u/{handle}');
    expect(regex.test('/u/alice/extra')).toBe(false);
  });
});

describe('matchCustomUrl', () => {
  const cw: CustomWaypoint = {
    id: 'custom:one',
    name: 'MyApp',
    domain: 'myapp.example',
    category: 'custom',
    supportedTypes: ['profile', 'post'],
    templates: {
      profile: '/u/{handle}',
      post: '/u/{handle}/p/{rkey}',
    },
  };

  it('matches a profile url', () => {
    const match = matchCustomUrl(new URL('https://myapp.example/u/alice'), [cw]);
    expect(match?.source).toBe('custom:one');
    expect(match?.parsed.type).toBe('profile');
    expect(match?.parsed.handle).toBe('alice');
  });

  it('matches a post url', () => {
    const match = matchCustomUrl(new URL('https://myapp.example/u/alice/p/xyz'), [cw]);
    expect(match?.parsed.type).toBe('post');
    expect(match?.parsed.rkey).toBe('xyz');
  });

  it('returns null for a different domain', () => {
    const match = matchCustomUrl(new URL('https://other.example/u/alice'), [cw]);
    expect(match).toBeNull();
  });

  it('handles www. prefix', () => {
    const match = matchCustomUrl(new URL('https://www.myapp.example/u/alice'), [cw]);
    expect(match?.parsed.handle).toBe('alice');
  });

  it('matches a profile url with a trailing slash', () => {
    const match = matchCustomUrl(new URL('https://myapp.example/u/alice/'), [cw]);
    expect(match?.parsed.type).toBe('profile');
    expect(match?.parsed.handle).toBe('alice');
  });

  it('matches when the template has a trailing slash but the url does not', () => {
    const trailing: CustomWaypoint = {
      ...cw,
      templates: { profile: '/u/{handle}/' },
      supportedTypes: ['profile'],
    };
    const match = matchCustomUrl(new URL('https://myapp.example/u/alice'), [trailing]);
    expect(match?.parsed.handle).toBe('alice');
  });
});

describe('customWaypointToData', () => {
  const cw: CustomWaypoint = {
    id: 'custom:one',
    name: 'MyApp',
    domain: 'myapp.example',
    category: 'custom',
    supportedTypes: ['profile', 'post'],
    templates: {
      profile: '/u/{handle}',
      post: '/u/{handle}/p/{rkey}',
    },
  };

  it('builds profile urls', () => {
    const data = customWaypointToData(cw);
    expect(data.getUrl('alice')).toBe('https://myapp.example/u/alice');
  });

  it('builds post urls', () => {
    const data = customWaypointToData(cw);
    expect(data.getUrl('alice', 'app.bsky.feed.post', 'rk')).toBe(
      'https://myapp.example/u/alice/p/rk'
    );
  });

  it('falls back to profile when type not supported', () => {
    const data = customWaypointToData(cw);
    expect(data.getUrl('alice', 'app.bsky.graph.list', 'lk')).toBe(
      'https://myapp.example/u/alice'
    );
  });
});
