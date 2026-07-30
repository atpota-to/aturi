import { describe, it, expect } from 'vitest';
import { resolveSearchTarget, resolveSearchPath } from '@aturi/atproto/searchRouting';

/**
 * `resolveSearchTarget` decides whether a pasted string is understood outright
 * or is only a guess. That distinction is what gates the AT Tags lookup: only
 * the `pds-guess` branch is worth spending a network round trip on, so these
 * tests pin down exactly which inputs land there.
 */
describe('resolveSearchTarget', () => {
  it('treats at:// URIs as confident matches', () => {
    expect(resolveSearchTarget('at://did:plc:abc/app.bsky.feed.post/xyz')).toEqual({
      kind: 'match',
      path: '/explore/did:plc:abc/app.bsky.feed.post/xyz',
    });
  });

  it('treats handles and DIDs as confident matches', () => {
    expect(resolveSearchTarget('alice.bsky.social')?.kind).toBe('match');
    expect(resolveSearchTarget('did:plc:abc123')?.kind).toBe('match');
  });

  it('treats a known waypoint URL as a confident match, not a guess', () => {
    const target = resolveSearchTarget('https://bsky.app/profile/alice.bsky.social');
    expect(target?.kind).toBe('match');
  });

  it('treats aturi.to links as confident matches', () => {
    expect(
      resolveSearchTarget('https://aturi.to/profile/alice.bsky.social/app.bsky.feed.post/xyz'),
    ).toEqual({
      kind: 'match',
      path: '/explore/alice.bsky.social/app.bsky.feed.post/xyz',
    });
  });

  it('flags an unrecognized http URL as a guess, carrying the original URL', () => {
    const target = resolveSearchTarget('https://someones-blog.example/posts/hello');
    expect(target?.kind).toBe('pds-guess');
    if (target?.kind === 'pds-guess') {
      // The full URL survives so the AT Tags lookup can fetch the actual page,
      // not just its host.
      expect(target.url).toBe('https://someones-blog.example/posts/hello');
      expect(target.path).toBe('/explore/pds/someones-blog.example');
    }
  });

  it('still routes bare pds.* hostnames straight to the PDS view', () => {
    expect(resolveSearchTarget('pds.atpota.to')).toEqual({
      kind: 'match',
      path: '/explore/pds/pds.atpota.to',
    });
  });

  it('returns null for empty input', () => {
    expect(resolveSearchTarget('')).toBeNull();
    expect(resolveSearchTarget('   ')).toBeNull();
  });
});

describe('resolveSearchPath (sync behaviour preserved)', () => {
  it('returns the same paths it always did', () => {
    expect(resolveSearchPath('at://did:plc:abc/app.bsky.feed.post/xyz')).toBe(
      '/explore/did:plc:abc/app.bsky.feed.post/xyz',
    );
    expect(resolveSearchPath('alice.bsky.social')).toBe('/explore/alice.bsky.social');
    expect(resolveSearchPath('https://someones-blog.example/posts/hello')).toBe(
      '/explore/pds/someones-blog.example',
    );
    expect(resolveSearchPath('')).toBeNull();
  });
});
