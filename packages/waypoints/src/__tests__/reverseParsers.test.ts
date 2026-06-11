import { describe, it, expect } from 'vitest';
import { matchSupportedUrl, parseAtUri } from '../reverseParsers';

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

  it('parses blacksky', () => {
    const m = match('https://blacksky.community/profile/alice.bsky.social/post/abc');
    expect(m?.source).toBe('blacksky');
    expect(m?.parsed.type).toBe('post');
  });

  it.each([
    ['reddwarf.app', 'reddwarf'],
    ['witchsky.app', 'witchsky'],
    ['catsky.social', 'catsky'],
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

  it('ignores unsupported hosts', () => {
    expect(match('https://example.com/profile/alice')).toBeNull();
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
