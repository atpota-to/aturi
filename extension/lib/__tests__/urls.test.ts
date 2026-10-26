import { describe, it, expect } from 'vitest';
import {
  explorePathFromAtUri,
  parseAtUri,
  rkeyFromAtUri,
  spaceExplorePathFromSegments,
} from '@aturi/atproto/urls';
import {
  formatSpaceAtUri,
  formatSpaceRef,
  isSpaceUri,
  isValidDid,
  isValidNsid,
  isValidRecordKey,
  parseSpaceAtUri,
} from '@aturi/atproto/spaceUri';

const SPACE_REF = 'at://did:plc:x/space/com.example.forum/skey1';
const SPACE_RECORD = `${SPACE_REF}/did:plc:y/app.bsky.feed.post/abc`;

describe('isSpaceUri', () => {
  it('matches the marker in the first path position', () => {
    expect(isSpaceUri(SPACE_REF)).toBe(true);
    expect(isSpaceUri(SPACE_RECORD)).toBe(true);
    expect(isSpaceUri('at://did:plc:x/space')).toBe(true);
  });

  it('is exact-segment, not a prefix test', () => {
    expect(isSpaceUri('at://did:plc:x/space.example.thing/abc')).toBe(false);
    expect(isSpaceUri('at://did:plc:x/spaces/com.example.forum/skey1')).toBe(false);
  });

  it('rejects non-AT input', () => {
    expect(isSpaceUri('https://aturi.to/explore/did:plc:x/space')).toBe(false);
    expect(isSpaceUri('at://did:plc:x')).toBe(false);
    expect(isSpaceUri(null)).toBe(false);
  });
});

describe('space syntax validators', () => {
  it('validates DIDs', () => {
    expect(isValidDid('did:plc:x')).toBe(true);
    expect(isValidDid('did:web:example.com')).toBe(true);
    expect(isValidDid('alice.bsky.social')).toBe(false);
    expect(isValidDid('did:plc:')).toBe(false);
  });

  it('validates NSIDs', () => {
    expect(isValidNsid('com.example.forum')).toBe(true);
    expect(isValidNsid('foo')).toBe(false);
    expect(isValidNsid('com.example')).toBe(false);
    expect(isValidNsid('com.example.1forum')).toBe(false);
    expect(isValidNsid('com.example.for-um')).toBe(false);
  });

  it('validates record keys', () => {
    expect(isValidRecordKey('self')).toBe(true);
    expect(isValidRecordKey('3k7abc')).toBe(true);
    expect(isValidRecordKey('.')).toBe(false);
    expect(isValidRecordKey('..')).toBe(false);
    expect(isValidRecordKey('a/b')).toBe(false);
    expect(isValidRecordKey('')).toBe(false);
  });
});

describe('parseSpaceAtUri', () => {
  it('parses a space ref', () => {
    expect(parseSpaceAtUri(SPACE_REF)).toEqual({
      authority: 'did:plc:x',
      spaceType: 'com.example.forum',
      skey: 'skey1',
    });
  });

  it('parses a record inside a space', () => {
    expect(parseSpaceAtUri(SPACE_RECORD)).toEqual({
      authority: 'did:plc:x',
      spaceType: 'com.example.forum',
      skey: 'skey1',
      author: 'did:plc:y',
      collection: 'app.bsky.feed.post',
      rkey: 'abc',
    });
  });

  it('rejects a handle authority', () => {
    expect(parseSpaceAtUri('at://alice.example.com/space/com.example.foo/self')).toBeNull();
  });

  it('rejects a non-NSID space type', () => {
    expect(parseSpaceAtUri('at://did:plc:x/space/foo/self')).toBeNull();
  });

  it('rejects a reserved record key as the space key', () => {
    expect(parseSpaceAtUri('at://did:plc:x/space/com.example.foo/..')).toBeNull();
  });

  it('rejects a query string, a fragment, and a trailing slash', () => {
    expect(parseSpaceAtUri('at://did:plc:x/space/com.example.foo/self?x=1')).toBeNull();
    expect(parseSpaceAtUri('at://did:plc:x/space/com.example.foo/self#/a')).toBeNull();
    expect(parseSpaceAtUri('at://did:plc:x/space/com.example.foo/self/')).toBeNull();
  });

  it('rejects a partial record tail', () => {
    expect(parseSpaceAtUri(`${SPACE_REF}/did:plc:y`)).toBeNull();
    expect(parseSpaceAtUri(`${SPACE_REF}/did:plc:y/app.bsky.feed.post`)).toBeNull();
  });

  it('rejects a handle author', () => {
    expect(parseSpaceAtUri(`${SPACE_REF}/bob.example.com/app.bsky.feed.post/abc`)).toBeNull();
  });

  it('round-trips through the formatters', () => {
    expect(formatSpaceAtUri(parseSpaceAtUri(SPACE_REF)!)).toBe(SPACE_REF);
    expect(formatSpaceAtUri(parseSpaceAtUri(SPACE_RECORD)!)).toBe(SPACE_RECORD);
    expect(formatSpaceRef(parseSpaceAtUri(SPACE_RECORD)!)).toBe(SPACE_REF);
  });
});

describe('explorePathFromAtUri - space addresses', () => {
  it('maps a space ref to the space route', () => {
    expect(explorePathFromAtUri(SPACE_REF)).toBe(
      '/explore/did:plc:x/space/com.example.forum/skey1',
    );
  });

  it('maps a space record to the full seven-segment route with raw colons', () => {
    expect(explorePathFromAtUri(SPACE_RECORD)).toBe(
      '/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
    );
  });

  it('returns null for a malformed space address rather than truncating it', () => {
    expect(explorePathFromAtUri('at://alice.example.com/space/com.example.foo/self')).toBeNull();
    expect(explorePathFromAtUri('at://did:plc:x/space')).toBeNull();
  });
});

describe('parseAtUri - space addresses', () => {
  it('reports the space parts and leaves collection/rkey undefined', () => {
    const parsed = parseAtUri(SPACE_RECORD);
    expect(parsed?.repo).toBe('did:plc:x');
    expect(parsed?.collection).toBeUndefined();
    expect(parsed?.rkey).toBeUndefined();
    expect(parsed?.space?.spaceType).toBe('com.example.forum');
    expect(parsed?.space?.author).toBe('did:plc:y');
    expect(parsed?.space?.rkey).toBe('abc');
  });

  it('returns null for a malformed space address', () => {
    expect(parseAtUri('at://did:plc:x/space/foo/self')).toBeNull();
  });
});

describe('rkeyFromAtUri', () => {
  it('returns the record key of a space record, not the space type', () => {
    expect(rkeyFromAtUri(SPACE_RECORD)).toBe('abc');
  });

  it('returns null for a space ref, which names no record', () => {
    expect(rkeyFromAtUri(SPACE_REF)).toBeNull();
  });
});

/**
 * The reverse of `spaceExplorePath`, which is a different rule from the at://
 * grammar in exactly two places: the authority may be a handle (the route
 * resolves it), and the two partial depths are real pages.
 */
describe('spaceExplorePathFromSegments', () => {
  const split = (path: string) => path.split('/').filter(Boolean).slice(1);

  it('accepts every depth the route tree serves', () => {
    for (const path of [
      '/explore/did:plc:x/space',
      '/explore/did:plc:x/space/com.example.forum',
      '/explore/did:plc:x/space/com.example.forum/skey1',
      '/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
    ]) {
      expect(spaceExplorePathFromSegments(split(path))).toBe(path);
    }
  });

  it('accepts a handle in the authority position', () => {
    expect(spaceExplorePathFromSegments(split('/explore/alice.example.com/space'))).toBe(
      '/explore/alice.example.com/space',
    );
    expect(
      spaceExplorePathFromSegments(
        split('/explore/alice.example.com/space/com.example.forum/skey1'),
      ),
    ).toBe('/explore/alice.example.com/space/com.example.forum/skey1');
  });

  it('keeps the author position DID-only', () => {
    expect(
      spaceExplorePathFromSegments(
        split(
          '/explore/did:plc:x/space/com.example.forum/skey1/alice.example.com/app.bsky.feed.post/abc',
        ),
      ),
    ).toBeNull();
  });

  it('rejects a bare word authority, a bad type or key, and a partial record tail', () => {
    expect(spaceExplorePathFromSegments(split('/explore/notahandle/space'))).toBeNull();
    expect(spaceExplorePathFromSegments(split('/explore/did:plc:x/space/foo'))).toBeNull();
    expect(
      spaceExplorePathFromSegments(split('/explore/did:plc:x/space/com.example.forum/..')),
    ).toBeNull();
    expect(
      spaceExplorePathFromSegments(
        split('/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y'),
      ),
    ).toBeNull();
  });

  it('ignores segments that aren\'t a space address at all', () => {
    expect(spaceExplorePathFromSegments(split('/explore/did:plc:x/app.bsky.feed.post'))).toBeNull();
    expect(spaceExplorePathFromSegments([])).toBeNull();
  });
});

describe('public AT URIs are unaffected', () => {
  it('parses a public record', () => {
    expect(parseAtUri('at://did:plc:x/app.bsky.feed.post/abc')).toEqual({
      repo: 'did:plc:x',
      collection: 'app.bsky.feed.post',
      rkey: 'abc',
    });
  });

  it('maps public URIs to explorer paths', () => {
    expect(explorePathFromAtUri('at://did:plc:x/app.bsky.feed.post/abc')).toBe(
      '/explore/did:plc:x/app.bsky.feed.post/abc',
    );
    expect(explorePathFromAtUri('at://did:plc:x/app.bsky.feed.post')).toBe(
      '/explore/did:plc:x/app.bsky.feed.post',
    );
    expect(explorePathFromAtUri('at://did:plc:x')).toBe('/explore/did:plc:x');
    expect(explorePathFromAtUri('did:plc:x')).toBe('/explore/did:plc:x');
    expect(explorePathFromAtUri('')).toBeNull();
  });

  it('reads rkeys off public URIs', () => {
    expect(rkeyFromAtUri('at://did:plc:x/app.bsky.feed.post/abc')).toBe('abc');
    expect(rkeyFromAtUri('at://did:plc:x/app.bsky.feed.post')).toBeNull();
  });

  it('stops the repo segment at a query or fragment', () => {
    expect(parseAtUri('at://did:plc:x?y=1')).toEqual({
      repo: 'did:plc:x',
      collection: undefined,
      rkey: undefined,
    });
    expect(explorePathFromAtUri('at://did:plc:x?y=1')).toBe('/explore/did:plc:x');
    expect(explorePathFromAtUri('at://did:plc:x#frag')).toBe('/explore/did:plc:x');
  });

  it('leaves an NSID that starts with "space" alone', () => {
    expect(explorePathFromAtUri('at://did:plc:x/space.example.thing/abc')).toBe(
      '/explore/did:plc:x/space.example.thing/abc',
    );
    expect(rkeyFromAtUri('at://did:plc:x/space.example.thing/abc')).toBe('abc');
  });
});
