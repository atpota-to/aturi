import { describe, it, expect } from 'vitest';
import { matchSupportedUrl } from '@aturi/reverseParsers';

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
    const m = match('https://bsky.app/profile/alice.bsky.social/post/3k7abc');
    expect(m?.source).toBe('bluesky');
    expect(m?.parsed.type).toBe('post');
    expect(m?.parsed.rkey).toBe('3k7abc');
    expect(m?.parsed.collection).toBe('app.bsky.feed.post');
  });

  it('parses a bsky.app list', () => {
    const m = match('https://bsky.app/profile/alice.bsky.social/lists/abc');
    expect(m?.parsed.type).toBe('list');
    expect(m?.parsed.collection).toBe('app.bsky.graph.list');
  });

  it('parses blacksky', () => {
    const m = match('https://blacksky.community/profile/alice.bsky.social/post/3k7abc');
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

  it('ignores unsupported hosts', () => {
    expect(match('https://example.com/profile/alice')).toBeNull();
  });
});

describe('matchSupportedUrl - aturi.to itself', () => {
  it('parses an explore record URL (the reported case)', () => {
    const m = match('https://aturi.to/explore/dame.is/is.dame.arena.mirror.block/38397630');
    expect(m?.source).toBe('aturiExplore');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.handle).toBe('dame.is');
    expect(m?.parsed.collection).toBe('is.dame.arena.mirror.block');
    expect(m?.parsed.rkey).toBe('38397630');
    expect(m?.parsed.uri).toBe('at://dame.is/is.dame.arena.mirror.block/38397630');
    expect(m?.parsed.did).toBeUndefined();
  });

  it('parses an explore record URL keyed by DID', () => {
    const m = match('https://aturi.to/explore/did:plc:xyz/app.bsky.feed.post/rk123');
    expect(m?.source).toBe('aturiExplore');
    expect(m?.parsed.type).toBe('post');
    expect(m?.parsed.did).toBe('did:plc:xyz');
  });

  it('parses an explore profile / repo-browse URL', () => {
    const m = match('https://aturi.to/explore/dame.is');
    expect(m?.source).toBe('aturiExplore');
    expect(m?.parsed.type).toBe('profile');
    expect(m?.parsed.handle).toBe('dame.is');
    expect(m?.parsed.collection).toBeUndefined();
  });

  it('treats an explore collection listing (no rkey) as profile-level', () => {
    const m = match('https://aturi.to/explore/dame.is/is.dame.arena.mirror.block');
    expect(m?.source).toBe('aturiExplore');
    expect(m?.parsed.type).toBe('profile');
  });

  it('parses a /profile post URL as the aturi universal-link source', () => {
    const m = match('https://aturi.to/profile/alice.bsky.social/post/3k7abc');
    expect(m?.source).toBe('aturi');
    expect(m?.parsed.type).toBe('post');
    expect(m?.parsed.collection).toBe('app.bsky.feed.post');
    expect(m?.parsed.rkey).toBe('3k7abc');
  });

  it('parses a /profile lists URL', () => {
    const m = match('https://aturi.to/profile/alice.bsky.social/lists/abc');
    expect(m?.source).toBe('aturi');
    expect(m?.parsed.type).toBe('list');
    expect(m?.parsed.collection).toBe('app.bsky.graph.list');
  });

  it('parses a generic /profile record URL', () => {
    const m = match('https://aturi.to/profile/dame.is/is.dame.arena.mirror.block/38397630');
    expect(m?.source).toBe('aturi');
    expect(m?.parsed.type).toBe('record');
    expect(m?.parsed.collection).toBe('is.dame.arena.mirror.block');
  });

  it('parses a bare /profile URL as a profile', () => {
    const m = match('https://aturi.to/profile/alice.bsky.social');
    expect(m?.source).toBe('aturi');
    expect(m?.parsed.type).toBe('profile');
  });

  it('ignores the explorer sub-tools and non-account routes', () => {
    // Bare-word first segments aren't accounts, so these must not falsely
    // resolve to a profile on a fake "lexicons" / "pds" / "settings" handle.
    expect(match('https://aturi.to/')).toBeNull();
    expect(match('https://aturi.to/explore/lexicons')).toBeNull();
    expect(match('https://aturi.to/explore/lexicons/app.bsky.feed.post')).toBeNull();
    expect(match('https://aturi.to/explore/pds')).toBeNull();
    expect(match('https://aturi.to/explore/pds/example.com')).toBeNull();
    expect(match('https://aturi.to/docs')).toBeNull();
    expect(match('https://aturi.to/settings')).toBeNull();
  });
});

/**
 * Permissioned space addresses are private. Reverse-parsing one would offer it
 * to every public explorer in the popup's waypoint list, so each detector
 * returns null and the tab reads as unrecognized instead.
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

  it('still matches a public collection whose NSID starts with "space"', () => {
    const m = match('https://aturi.to/explore/did:plc:x/space.example.thing/abc');
    expect(m?.source).toBe('aturiExplore');
    expect(m?.parsed.collection).toBe('space.example.thing');
  });
});
