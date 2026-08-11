import { describe, it, expect } from 'vitest';
import { matchSupportedUrl, parseAtUri, isSupportedHost } from '../reverseParsers';
import { resolveUrl } from '../resolve';

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
    ['witchsky.app', 'witchsky'],
    ['deer.social', 'deer'],
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

  it('ignores unsupported hosts', () => {
    expect(match('https://example.com/profile/alice')).toBeNull();
  });
});

/**
 * Regression tests for the hosts whose account pages sit at the path root.
 * `tangled.org`, `stream.place` and `blento.app` took *any* first segment as a
 * handle, so `/about` and `/login` returned a successful parse and the picker
 * rendered ~20 links to https://bsky.app/profile/about. A repo identifier is
 * always a DID or a dotted handle; a bare word never is.
 */
describe('root-path hosts do not treat site pages as accounts', () => {
  const SITE_PATHS = ['about', 'login', 'settings', 'privacy', 'docs', 'new', 'explore'];

  it.each([
    ['tangled.org', 'tangled'],
    ['stream.place', 'streamplace'],
    ['blento.app', 'blento'],
  ])('%s rejects bare site paths', (host, source) => {
    for (const path of SITE_PATHS) {
      expect({ url: `https://${host}/${path}`, m: match(`https://${host}/${path}`) }).toEqual({
        url: `https://${host}/${path}`,
        m: null,
      });
    }
    // Deeper site routes are just as wrong, and used to parse too.
    expect(match(`https://${host}/settings/keys`)).toBeNull();
    // The happy path must not regress: a real account is still recognized.
    expect(match(`https://${host}/alice.bsky.social`)?.source).toBe(source);
    expect(match(`https://${host}/did:plc:xyz`)?.source).toBe(source);
    expect(match(`https://${host}/did:plc:xyz`)?.parsed.did).toBe('did:plc:xyz');
  });

  it('offprint and pckt reject a non-identifier repo segment', () => {
    // Same heuristic on the flat `/<identifier>/<collection>/<rkey>` hosts.
    expect(match('https://offprint.app/settings/site.standard.document/rk')).toBeNull();
    expect(match('https://pckt.blog/about/pub.leaflet.document/rk')).toBeNull();
    expect(
      match('https://offprint.app/alice.bsky.social/site.standard.document/rk')?.source,
    ).toBe('offprint');
  });

  it('does not hand resolveUrl a menu of dead links for tangled.org/about', async () => {
    // The user-visible failure: every waypoint built a profile URL for a
    // "handle" of `about`, and the caller had no way to tell it apart from a
    // real account page.
    expect(await resolveUrl('https://tangled.org/about')).toBeNull();
    expect(await resolveUrl('https://tangled.org/settings/keys')).toBeNull();
    const real = await resolveUrl('https://tangled.org/alice.bsky.social');
    expect(real?.parsed.handle).toBe('alice.bsky.social');
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
