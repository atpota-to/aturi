import { describe, it, expect } from 'vitest';
import {
  UNIVERSAL_LINK_ORIGIN,
  buildUniversalLink,
  buildUniversalLinkTags,
  describeUniversalLink,
  isUniversalLink,
  parseUniversalLink,
} from '../universalLinks';
import { WAYPOINT_DESTINATIONS_DATA } from '../waypoints.data';

const POST = 'at://did:plc:abc/app.bsky.feed.post/3k7';
const LIST = 'at://alice.bsky.social/app.bsky.graph.list/abc';
const LEAFLET = 'at://did:plc:abc/pub.leaflet.document/xyz';

describe('buildUniversalLink', () => {
  it('builds from an AT URI', () => {
    expect(buildUniversalLink(POST)).toBe(
      'https://aturi.to/profile/did:plc:abc/post/3k7',
    );
    expect(buildUniversalLink(LIST)).toBe(
      'https://aturi.to/profile/alice.bsky.social/lists/abc',
    );
    expect(buildUniversalLink(LEAFLET)).toBe(
      'https://aturi.to/profile/did:plc:abc/pub.leaflet.document/xyz',
    );
    expect(buildUniversalLink('at://alice.bsky.social')).toBe(
      'https://aturi.to/profile/alice.bsky.social',
    );
  });

  it('builds from a bare handle, DID, or @handle', () => {
    const profile = 'https://aturi.to/profile/alice.bsky.social';
    expect(buildUniversalLink('alice.bsky.social')).toBe(profile);
    expect(buildUniversalLink('@alice.bsky.social')).toBe(profile);
    expect(buildUniversalLink('  alice.bsky.social  ')).toBe(profile);
    expect(buildUniversalLink('did:plc:abc')).toBe(
      'https://aturi.to/profile/did:plc:abc',
    );
    expect(buildUniversalLink('alice.bsky.social/app.bsky.feed.post/3k7')).toBe(
      'https://aturi.to/profile/alice.bsky.social/post/3k7',
    );
  });

  it('builds from another client’s page URL', () => {
    expect(
      buildUniversalLink('https://bsky.app/profile/alice.bsky.social/post/3k7'),
    ).toBe('https://aturi.to/profile/alice.bsky.social/post/3k7');
    expect(buildUniversalLink('https://tangled.org/@alice.bsky.social')).toBe(
      'https://aturi.to/profile/alice.bsky.social',
    );
  });

  it('accepts an AT URI embedded in any host’s path', () => {
    expect(
      buildUniversalLink('https://example.com/at://did:plc:abc/app.bsky.feed.post/3k7'),
    ).toBe('https://aturi.to/profile/did:plc:abc/post/3k7');
    // Single-slash spelling, which servers and browsers normalize paths to.
    expect(
      buildUniversalLink('https://example.com/at:/did:plc:abc/app.bsky.feed.post/3k7'),
    ).toBe('https://aturi.to/profile/did:plc:abc/post/3k7');
  });

  it('round-trips its own links', () => {
    const url = buildUniversalLink(POST)!;
    expect(buildUniversalLink(url)).toBe(url);
    expect(buildUniversalLink('https://aturi.to/explore/did:plc:abc')).toBe(
      'https://aturi.to/profile/did:plc:abc',
    );
  });

  it('takes a ParsedURI straight from the parser', () => {
    const parsed = parseUniversalLink('https://aturi.to/profile/did:plc:abc/post/3k7');
    expect(buildUniversalLink(parsed!)).toBe(
      'https://aturi.to/profile/did:plc:abc/post/3k7',
    );
  });

  it('honors origin, did, preferDid, and params', () => {
    expect(buildUniversalLink(POST, { origin: 'https://links.example.com/' })).toBe(
      'https://links.example.com/profile/did:plc:abc/post/3k7',
    );
    expect(
      buildUniversalLink('at://alice.bsky.social/app.bsky.feed.post/3k7', {
        did: 'did:plc:abc',
        preferDid: true,
      }),
    ).toBe('https://aturi.to/profile/did:plc:abc/post/3k7');
    // A DID is only substituted when asked for; the handle is otherwise kept.
    expect(
      buildUniversalLink('at://alice.bsky.social/app.bsky.feed.post/3k7', {
        did: 'did:plc:abc',
      }),
    ).toBe('https://aturi.to/profile/alice.bsky.social/post/3k7');
    expect(buildUniversalLink(POST, { params: { ref: 'my app', empty: '' } })).toBe(
      'https://aturi.to/profile/did:plc:abc/post/3k7?ref=my+app',
    );
  });

  it('escapes what needs escaping and nothing else', () => {
    // Colons survive: an encoded DID points at a URL the site doesn't serve.
    expect(buildUniversalLink('at://did:plc:abc/app.bsky.feed.post/a b')).toBe(
      'https://aturi.to/profile/did:plc:abc/post/a%20b',
    );
  });

  it('returns null for input that names nothing', () => {
    expect(buildUniversalLink('')).toBeNull();
    expect(buildUniversalLink('   ')).toBeNull();
    expect(buildUniversalLink('not-a-handle')).toBeNull();
    expect(buildUniversalLink('https://example.com/some/page')).toBeNull();
    expect(buildUniversalLink('ftp://example.com')).toBeNull();
  });

  it('agrees with the catalog’s own aturi waypoint', () => {
    // The "Open in Aturi" link and the copied universal link have to be the
    // same string. `waypoints.data.ts` is synced from the app, so this is the
    // guard against the two drifting apart.
    const cases: Array<[string, string | undefined, string | undefined, string | undefined]> = [
      ['alice.bsky.social', 'app.bsky.feed.post', '3k7', undefined],
      ['alice.bsky.social', 'app.bsky.graph.list', 'abc', undefined],
      ['alice.bsky.social', 'pub.leaflet.document', 'xyz', 'did:plc:abc'],
      ['did:plc:abc', 'pub.leaflet.document', 'xyz', 'did:plc:abc'],
      ['alice.bsky.social', undefined, undefined, undefined],
    ];
    for (const [handle, collection, rkey, did] of cases) {
      const uri = collection && rkey
        ? `at://${handle}/${collection}/${rkey}`
        : `at://${handle}`;
      expect(buildUniversalLink(uri, { did })).toBe(
        WAYPOINT_DESTINATIONS_DATA.aturi.getUrl(handle, collection, rkey, did),
      );
    }
  });
});

describe('parseUniversalLink', () => {
  it('parses every shape aturi.to serves', () => {
    expect(
      parseUniversalLink('https://aturi.to/profile/alice.bsky.social/post/3k7'),
    ).toMatchObject({
      type: 'post',
      handle: 'alice.bsky.social',
      collection: 'app.bsky.feed.post',
      rkey: '3k7',
    });
    expect(
      parseUniversalLink('https://aturi.to/profile/did:plc:abc/lists/abc'),
    ).toMatchObject({ type: 'list', collection: 'app.bsky.graph.list', did: 'did:plc:abc' });
    expect(
      parseUniversalLink('https://aturi.to/explore/did:plc:abc/pub.leaflet.document/xyz'),
    ).toMatchObject({ collection: 'pub.leaflet.document', rkey: 'xyz' });
    // Legacy bare path, still resolved by the site.
    expect(
      parseUniversalLink('https://aturi.to/alice.bsky.social/app.bsky.feed.post/3k7'),
    ).toMatchObject({ type: 'post', handle: 'alice.bsky.social', rkey: '3k7' });
    // at:// carried in the path.
    expect(
      parseUniversalLink('https://aturi.to/at://did:plc:abc/app.bsky.feed.post/3k7'),
    ).toMatchObject({ type: 'post', did: 'did:plc:abc', rkey: '3k7' });
    // www and http spellings of the same link.
    expect(
      parseUniversalLink('http://www.aturi.to/profile/alice.bsky.social'),
    ).toMatchObject({ type: 'profile', handle: 'alice.bsky.social' });
  });

  it('decodes escaped record keys', () => {
    expect(
      parseUniversalLink('https://aturi.to/alice.bsky.social/app.bsky.feed.post/a%20b'),
    ).toMatchObject({ rkey: 'a b', uri: 'at://alice.bsky.social/app.bsky.feed.post/a b' });
  });

  it('rejects other hosts and non-record paths', () => {
    expect(parseUniversalLink('https://bsky.app/profile/alice.bsky.social')).toBeNull();
    expect(parseUniversalLink('https://aturi.to/docs')).toBeNull();
    expect(parseUniversalLink('https://aturi.to/explore/lexicons')).toBeNull();
    expect(parseUniversalLink('https://aturi.to')).toBeNull();
    expect(parseUniversalLink('nonsense')).toBeNull();
  });

  it('follows a custom origin', () => {
    const origin = 'https://links.example.com';
    const url = buildUniversalLink(POST, { origin })!;
    expect(parseUniversalLink(url, { origin })).toMatchObject({ rkey: '3k7' });
    // Without being told about the fork, it isn't one of ours.
    expect(parseUniversalLink(url)).toBeNull();
    expect(isUniversalLink(url, { origin })).toBe(true);
    expect(isUniversalLink('https://bsky.app/profile/alice.bsky.social')).toBe(false);
  });
});

describe('describeUniversalLink', () => {
  it('describes a post', () => {
    const link = describeUniversalLink(
      'at://alice.bsky.social/app.bsky.feed.post/3k7',
    )!;
    expect(link).toMatchObject({
      url: 'https://aturi.to/profile/alice.bsky.social/post/3k7',
      atUri: 'at://alice.bsky.social/app.bsky.feed.post/3k7',
      type: 'post',
      handle: 'alice.bsky.social',
      did: null,
      label: 'Post by @alice.bsky.social',
    });
    expect(link.share).toEqual({
      title: 'Post by @alice.bsky.social',
      text: 'Post by @alice.bsky.social',
      url: link.url,
    });
    expect(link.snippets.markdown).toBe(`[${link.label}](${link.url})`);
    expect(link.snippets.html).toBe(
      '<a href="https://aturi.to/profile/alice.bsky.social/post/3k7">Post by @alice.bsky.social</a>',
    );
    expect(link.oembedUrl).toBe(
      `${UNIVERSAL_LINK_ORIGIN}/api/oembed?url=${encodeURIComponent(link.url)}`,
    );
  });

  it('labels each kind of target', () => {
    expect(describeUniversalLink(LIST)!.label).toBe('List by @alice.bsky.social');
    expect(describeUniversalLink(LEAFLET)!.label).toBe(
      'pub.leaflet.document record by did:plc:abc',
    );
    expect(describeUniversalLink('alice.bsky.social')!.label).toBe(
      '@alice.bsky.social',
    );
  });

  it('addresses AT URIs by DID when one is supplied', () => {
    const link = describeUniversalLink(
      'at://alice.bsky.social/app.bsky.feed.post/3k7',
      { did: 'did:plc:abc' },
    )!;
    expect(link.atUri).toBe('at://did:plc:abc/app.bsky.feed.post/3k7');
    // …without moving the shareable link off the handle unless asked.
    expect(link.url).toBe('https://aturi.to/profile/alice.bsky.social/post/3k7');
  });

  it('omits the oEmbed pointer for anything but a post', () => {
    expect(describeUniversalLink(LEAFLET)!.oembedUrl).toBeNull();
    expect(describeUniversalLink('alice.bsky.social')!.oembedUrl).toBeNull();
  });

  it('takes title and text overrides for the share sheet', () => {
    const link = describeUniversalLink(POST, {
      title: 'Look at this',
      text: 'Worth a read',
    })!;
    expect(link.share).toEqual({
      title: 'Look at this',
      text: 'Worth a read',
      url: link.url,
    });
  });
});

describe('buildUniversalLinkTags', () => {
  it('declares the record and points unfurlers at oEmbed', () => {
    const tags = buildUniversalLinkTags(POST)!;
    expect(tags.meta).toEqual([
      { name: 'at:canonical', content: POST },
      { name: 'at:author', content: 'at://did:plc:abc' },
    ]);
    expect(tags.link).toEqual([
      { rel: 'alternate', href: POST },
      {
        rel: 'alternate',
        type: 'application/json+oembed',
        href: 'https://aturi.to/api/oembed?url=https%3A%2F%2Faturi.to%2Fprofile%2Fdid%3Aplc%3Aabc%2Fpost%2F3k7',
      },
    ]);
    expect(tags.html).toContain('<meta name="at:canonical" content="at://did:plc:abc/app.bsky.feed.post/3k7" />');
    expect(tags.html).toContain('<link rel="alternate" href="at://did:plc:abc/app.bsky.feed.post/3k7" />');
    expect(tags.html).toContain('type="application/json+oembed"');
  });

  it('leaves out the author tag on a profile and oEmbed on a non-post', () => {
    const profile = buildUniversalLinkTags('alice.bsky.social')!;
    expect(profile.meta).toEqual([
      { name: 'at:canonical', content: 'at://alice.bsky.social' },
    ]);
    expect(profile.link).toEqual([
      { rel: 'alternate', href: 'at://alice.bsky.social' },
    ]);
    expect(buildUniversalLinkTags(LEAFLET)!.link).toHaveLength(1);
  });

  it('returns null for input that names nothing', () => {
    expect(buildUniversalLinkTags('not-a-handle')).toBeNull();
  });
});
