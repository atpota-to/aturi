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

/**
 * The at:// branch delegates to `explorePathFromAtUri` rather than re-deriving
 * the repo → collection → rkey ladder, so these pin both halves: public URIs
 * still route exactly where they used to, and permissioned space addresses
 * keep their full depth instead of being truncated to the space type.
 */
describe('resolveSearchTarget - space addresses', () => {
  it('routes a space ref to the space route', () => {
    expect(resolveSearchTarget('at://did:plc:x/space/com.example.forum/skey1')).toEqual({
      kind: 'match',
      path: '/explore/did:plc:x/space/com.example.forum/skey1',
    });
  });

  it('routes a space record to the full seven-segment route', () => {
    expect(
      resolveSearchTarget(
        'at://did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
      ),
    ).toEqual({
      kind: 'match',
      path: '/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
    });
  });

  it('round-trips an aturi.to space URL back to the same path', () => {
    expect(
      resolveSearchTarget('https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1'),
    ).toEqual({
      kind: 'match',
      path: '/explore/did:plc:x/space/com.example.forum/skey1',
    });
    expect(
      resolveSearchTarget(
        'https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
      ),
    ).toEqual({
      kind: 'match',
      path: '/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
    });
  });

  it('refuses a malformed space at:// address instead of truncating it', () => {
    expect(resolveSearchTarget('at://alice.example.com/space/com.example.foo/self')).toBeNull();
    expect(resolveSearchTarget('at://did:plc:x/space/foo/self')).toBeNull();
  });

  it('round-trips the two partial space pages, which are real pages', () => {
    // `/explore/<id>/space` lists which spaces an account writes to and
    // `/explore/<id>/space/<type>` narrows it. Both have their own share
    // links, so both have to route back to themselves rather than falling
    // through to the PDS guess.
    expect(resolveSearchTarget('https://aturi.to/explore/did:plc:x/space')).toEqual({
      kind: 'match',
      path: '/explore/did:plc:x/space',
    });
    expect(
      resolveSearchTarget('https://aturi.to/explore/did:plc:x/space/com.example.forum'),
    ).toEqual({
      kind: 'match',
      path: '/explore/did:plc:x/space/com.example.forum',
    });
  });

  it('round-trips the handle-form links the space pages actually emit', () => {
    // Every space page builds its share URL from `handle || did`, so the
    // authority position of an *explorer* path has to accept a handle even
    // though the at:// grammar is DID-only. A DID-only test here would mean a
    // link aturi.to copied to the clipboard doesn't route back into aturi.to.
    expect(resolveSearchTarget('https://aturi.to/explore/alice.bsky.social/space')).toEqual({
      kind: 'match',
      path: '/explore/alice.bsky.social/space',
    });
    expect(
      resolveSearchTarget(
        'https://aturi.to/explore/alice.bsky.social/space/com.example.forum/skey1',
      ),
    ).toEqual({
      kind: 'match',
      path: '/explore/alice.bsky.social/space/com.example.forum/skey1',
    });
    expect(
      resolveSearchTarget(
        'https://aturi.to/explore/alice.bsky.social/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
      ),
    ).toEqual({
      kind: 'match',
      path: '/explore/alice.bsky.social/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
    });
  });

  it('still refuses an aturi.to space path that names no addressable page', () => {
    // The author position stays DID-only, and a partial record tail is not a
    // page. Neither may be rewritten into `/explore/<did>/space/<type>`, which
    // would read as a record in a collection called `space`.
    expect(
      resolveSearchTarget(
        'https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/alice.example.com/app.bsky.feed.post/abc',
      )?.kind,
    ).not.toBe('match');
    expect(
      resolveSearchTarget(
        'https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y',
      )?.kind,
    ).not.toBe('match');
  });

  it('leaves a collection NSID that starts with "space" alone', () => {
    expect(resolveSearchTarget('at://did:plc:x/space.example.thing/abc')).toEqual({
      kind: 'match',
      path: '/explore/did:plc:x/space.example.thing/abc',
    });
  });
});

describe('resolveSearchTarget - at:// ladder unchanged by the delegation', () => {
  it('drills down as far as the URI allows', () => {
    expect(resolveSearchPath('at://did:plc:abc/app.bsky.feed.post/xyz')).toBe(
      '/explore/did:plc:abc/app.bsky.feed.post/xyz',
    );
    expect(resolveSearchPath('at://did:plc:abc/app.bsky.feed.post')).toBe(
      '/explore/did:plc:abc/app.bsky.feed.post',
    );
    expect(resolveSearchPath('at://did:plc:abc')).toBe('/explore/did:plc:abc');
    expect(resolveSearchPath('at://alice.bsky.social/app.bsky.feed.post/xyz')).toBe(
      '/explore/alice.bsky.social/app.bsky.feed.post/xyz',
    );
    expect(resolveSearchPath('at://')).toBeNull();
  });

  it('strips a query or fragment hung off the authority itself', () => {
    // The repo group stops at `?` and `#` exactly as the collection and rkey
    // groups always have; otherwise they get percent-escaped into the repo
    // segment and the user lands on a DID that doesn't exist.
    expect(resolveSearchPath('at://did:plc:abc123?x=1')).toBe('/explore/did:plc:abc123');
    expect(resolveSearchPath('at://did:plc:abc123#frag')).toBe('/explore/did:plc:abc123');
  });
});
