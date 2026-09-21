import { describe, it, expect } from 'vitest';
import { matchSupportedUrl, parseAtUri, isSupportedHost } from '../reverseParsers';

function match(url: string) {
  return matchSupportedUrl(new URL(url));
}

describe('matchSupportedUrl - Bluesky family', () => {
  it('parses a bsky.app profile', () => {
    const m = match('https://bsky.app/profile/alice.bsky.social');
    expect(m?.source).toBe('bluesky');
    expect(m?.parsed.type).toBe('profile');
    expect(m?.parsed.handle).toBe('alice.bsky.social');
  });

  it('parses a bsky.app post', () => {
    const m = match('https://bsky.app/profile/alice.bsky.social/post/abc');
    expect(m?.source).toBe('bluesky');
    expect(m?.parsed.type).toBe('post');
    expect(m?.parsed.rkey).toBe('abc');
    expect(m?.parsed.collection).toBe('app.bsky.feed.post');
  });

  it('parses a bsky.app list', () => {
    const m = match('https://bsky.app/profile/alice.bsky.social/lists/abc');
    expect(m?.parsed.type).toBe('list');
    expect(m?.parsed.collection).toBe('app.bsky.graph.list');
  });

  it('parses an anisota subdomain the same as anisota.net', () => {
    const m = match('https://eclose.anisota.net/profile/alice.bsky.social/post/abc');
    expect(m?.source).toBe('anisota');
    expect(m?.parsed.type).toBe('post');
    expect(m?.parsed.rkey).toBe('abc');
    expect(m?.parsed.collection).toBe('app.bsky.feed.post');
  });

  it('does not treat a lookalike host as an anisota subdomain', () => {
    // Must be a real subdomain of anisota.net, not just a suffix match.
    expect(match('https://notanisota.net/profile/alice.bsky.social')).toBeNull();
    expect(match('https://anisota.net.evil.com/profile/alice')).toBeNull();
  });

  it('parses blacksky', () => {
    const m = match('https://blacksky.community/profile/alice.bsky.social/post/abc');
    expect(m?.source).toBe('blacksky');
    expect(m?.parsed.type).toBe('post');
  });

  it.each([
    ['reddwarf.app', 'reddwarf'],
    ['impro.social', 'impro'],
    ['lea.ac', 'lea'],
    ['witchsky.app', 'witchsky'],
    ['deer.social', 'deer'],
    ['northsky.app', 'northsky'],
    ['anisota.net', 'anisota'],
  ])('parses %s profile', (host, sourceId) => {
    const m = match(`https://${host}/profile/alice.bsky.social`);
    expect(m?.source).toBe(sourceId);
    expect(m?.parsed.type).toBe('profile');
  });
});

describe('matchSupportedUrl - other apps', () => {
  it('parses pdsls.dev at-uri', () => {
    const m = match('https://pdsls.dev/at://did:plc:xyz/app.bsky.feed.post/rk123');
    expect(m?.source).toBe('pdsls');
    expect(m?.parsed.type).toBe('post');
    expect(m?.parsed.did).toBe('did:plc:xyz');
  });

  it('parses atp.tools at:/ form', () => {
    const m = match('https://atp.tools/at:/did:plc:xyz/app.bsky.feed.post/rk');
    expect(m?.source).toBe('atptools');
    expect(m?.parsed.type).toBe('post');
  });

  it('parses pinkleap feed url', () => {
    const uri = encodeURIComponent('at://did:plc:x/app.bsky.feed.post/r');
    const m = match(`https://pinkleap.app/feed?uri=${uri}&src=profile`);
    expect(m?.source).toBe('pinksky');
    expect(m?.parsed.type).toBe('post');
  });

  it('parses leaflet profile', () => {
    const m = match('https://leaflet.pub/p/alice.bsky.social');
    expect(m?.source).toBe('leaflet');
  });

  it('parses tangled profile', () => {
    const m = match('https://tangled.org/alice.bsky.social');
    expect(m?.source).toBe('tangled');
  });

  it('parses margin annotation', () => {
    const m = match('https://margin.at/alice.bsky.social/annotation/abc');
    expect(m?.source).toBe('margin');
    expect(m?.parsed.collection).toBe('at.margin.annotation');
  });

  it('parses semble profile', () => {
    const m = match('https://semble.so/profile/alice.bsky.social');
    expect(m?.source).toBe('semble');
  });

  it('parses a standard-reader document into a site.standard.document uri', () => {
    const m = match('https://standard-reader.app/a/did:plc:ofrbh253gwicbkc5nktqepol/3mnzim6jkqs24');
    expect(m?.source).toBe('standardReader');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('site.standard.document');
    expect(m?.parsed.rkey).toBe('3mnzim6jkqs24');
    expect(m?.parsed.uri).toBe(
      'at://did:plc:ofrbh253gwicbkc5nktqepol/site.standard.document/3mnzim6jkqs24',
    );
  });

  it('parses a standard-reader profile', () => {
    const m = match('https://standard-reader.app/u/did:plc:ofrbh253gwicbkc5nktqepol');
    expect(m?.source).toBe('standardReader');
    expect(m?.parsed.type).toBe('profile');
  });

  it('parses an anisota reader document into a site.standard.document uri', () => {
    const m = match('https://anisota.net/profile/did:plc:xyz/document/rk123');
    expect(m?.source).toBe('anisota');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('site.standard.document');
    expect(m?.parsed.rkey).toBe('rk123');
    expect(m?.parsed.did).toBe('did:plc:xyz');
  });

  it('parses an offprint record', () => {
    const m = match('https://offprint.app/did:plc:xyz/site.standard.document/rk123');
    expect(m?.source).toBe('offprint');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('site.standard.document');
    expect(m?.parsed.rkey).toBe('rk123');
    expect(m?.parsed.did).toBe('did:plc:xyz');
  });

  it('parses a pckt record', () => {
    const m = match('https://pckt.blog/did:plc:xyz/pub.leaflet.document/rk123');
    expect(m?.source).toBe('pckt');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('pub.leaflet.document');
    expect(m?.parsed.rkey).toBe('rk123');
  });

  it('does not treat non-record offprint/pckt paths as records', () => {
    // No NSID collection segment -> not a record link.
    expect(match('https://offprint.app/settings')).toBeNull();
    expect(match('https://pckt.blog/alice.bsky.social/notacollection/rk')).toBeNull();
  });

  it('parses a kimbia activity', () => {
    const m = match('https://kimbia.app/alice.bsky.social/activity/3mq4vxtxqncje');
    expect(m?.source).toBe('kimbia');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('app.kimbia.activity');
    expect(m?.parsed.uri).toBe('at://alice.bsky.social/app.kimbia.activity/3mq4vxtxqncje');
  });

  it('parses a kimbia adventure', () => {
    const m = match('https://kimbia.app/alice.bsky.social/adventure/3mo7r2rfg5c2m');
    expect(m?.source).toBe('kimbia');
    expect(m?.parsed.collection).toBe('app.kimbia.adventure');
  });

  it('parses a kimbia profile, and leaves its dotless pages alone', () => {
    expect(match('https://kimbia.app/alice.bsky.social')?.parsed.type).toBe('profile');
    expect(match('https://kimbia.app/pricing')).toBeNull();
  });

  it('ignores unsupported hosts', () => {
    expect(match('https://example.com/profile/alice')).toBeNull();
  });
});

describe('isSupportedHost', () => {
  it('recognizes exact hosts and strips www', () => {
    expect(isSupportedHost('bsky.app')).toBe(true);
    expect(isSupportedHost('www.anisota.net')).toBe(true);
    expect(isSupportedHost('offprint.app')).toBe(true);
    expect(isSupportedHost('ANISOTA.NET')).toBe(true);
  });

  it('recognizes anisota subdomains', () => {
    expect(isSupportedHost('eclose.anisota.net')).toBe(true);
    expect(isSupportedHost('sub.eclose.anisota.net')).toBe(true);
  });

  it('rejects lookalikes and non-subdomain hosts', () => {
    expect(isSupportedHost('notanisota.net')).toBe(false);
    expect(isSupportedHost('anisota.net.evil.com')).toBe(false);
    expect(isSupportedHost('bsky.app.evil.com')).toBe(false);
    expect(isSupportedHost('example.com')).toBe(false);
    // Only opted-in hosts match subdomains; bsky.app does not.
    expect(isSupportedHost('foo.bsky.app')).toBe(false);
  });
});

describe('parseAtUri', () => {
  it('parses a record at-uri', () => {
    const m = parseAtUri('at://did:plc:x/app.bsky.feed.post/abc');
    expect(m?.parsed.type).toBe('post');
    expect(m?.parsed.did).toBe('did:plc:x');
    expect(m?.parsed.collection).toBe('app.bsky.feed.post');
    expect(m?.parsed.rkey).toBe('abc');
  });

  it('parses a profile at-uri', () => {
    const m = parseAtUri('at://alice.bsky.social');
    expect(m?.parsed.type).toBe('profile');
    expect(m?.parsed.handle).toBe('alice.bsky.social');
    expect(m?.parsed.did).toBeUndefined();
  });

  it('rejects non-at uris', () => {
    expect(parseAtUri('https://bsky.app/profile/alice')).toBeNull();
  });
});

/**
 * Permissioned space addresses are private. Reverse-parsing one would offer it
 * to every public explorer in the waypoint list, so each detector returns null
 * and the URL reads as unrecognized instead.
 */
describe('space addresses are never reverse-matched', () => {
  it('refuses an aturi.to explorer space path', () => {
    expect(match('https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1')).toBeNull();
    expect(
      match(
        'https://aturi.to/explore/did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
      ),
    ).toBeNull();
  });

  it('still matches a public collection whose NSID starts with "space"', () => {
    const m = match('https://aturi.to/explore/did:plc:x/space.example.thing/abc');
    expect(m?.source).toBe('aturiExplore');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('space.example.thing');
    expect(m?.parsed.rkey).toBe('abc');
  });

  it('refuses a taproot space URL', () => {
    expect(match('https://atproto.at/uri/at://did:plc:x/space/com.example.forum/skey1')).toBeNull();
  });

  it('refuses a pdsls / atp.tools space URL', () => {
    // These two share `parseAtUriPath`, so the guard lives there rather than in
    // each matcher. Without it the address is read as a record in a collection
    // literally named `space`, with the space type in the rkey slot.
    expect(match('https://pdsls.dev/at://did:plc:x/space/com.example.forum/skey1')).toBeNull();
    expect(
      match(
        'https://pdsls.dev/at://did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc',
      ),
    ).toBeNull();
    expect(match('https://atp.tools/at:/did:plc:x/space/com.example.forum/skey1')).toBeNull();
  });

  it('still matches a pdsls record whose collection starts with "space"', () => {
    const m = match('https://pdsls.dev/at://did:plc:x/space.example.thing/abc');
    expect(m?.source).toBe('pdsls');
    expect(m?.parsed.collection).toBe('space.example.thing');
  });

  it('refuses a space at-uri found in a <link> tag', () => {
    expect(
      parseAtUri('at://did:plc:x/space/com.example.forum/skey1/did:plc:y/app.bsky.feed.post/abc'),
    ).toBeNull();
    expect(parseAtUri('at://did:plc:x/space/com.example.forum/skey1')).toBeNull();
  });

  it('still parses an at-uri whose collection merely starts with "space"', () => {
    const m = parseAtUri('at://did:plc:x/space.example.thing/abc');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('space.example.thing');
  });
});
