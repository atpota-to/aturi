import { describe, it, expect } from 'vitest';
import {
  WAYPOINT_DESTINATIONS_DATA,
  getRecommendedWaypointsData,
  getWaypointDataForType,
  getFeaturedWaypointData,
} from '../waypoints.data';

describe('getUrl', () => {
  it('builds a bluesky post url', () => {
    const url = WAYPOINT_DESTINATIONS_DATA.bluesky.getUrl(
      'alice.bsky.social',
      'app.bsky.feed.post',
      'abc',
    );
    expect(url).toBe('https://bsky.app/profile/alice.bsky.social/post/abc');
  });

  it('builds an anisota post url', () => {
    const url = WAYPOINT_DESTINATIONS_DATA.anisota.getUrl(
      'alice.bsky.social',
      'app.bsky.feed.post',
      'abc',
    );
    expect(url).toBe('https://anisota.net/profile/alice.bsky.social/post/abc');
  });

  // Regression: these clients advertised `list` support but had no
  // `app.bsky.graph.list` branch, so every list URL collapsed to its author's
  // profile.
  it.each([
    ['bluesky', 'https://bsky.app'],
    ['blacksky', 'https://blacksky.community'],
    ['witchsky', 'https://witchsky.app'],
    ['deer', 'https://deer.social'],
    ['mu', 'https://mu.social'],
    ['impro', 'https://impro.social'],
    ['anisota', 'https://anisota.net'],
    ['aturi', 'https://aturi.to'],
  ])('builds a %s list url', (id, origin) => {
    const url = WAYPOINT_DESTINATIONS_DATA[id].getUrl(
      'alice.bsky.social',
      'app.bsky.graph.list',
      'abc',
    );
    expect(url).toBe(`${origin}/profile/alice.bsky.social/lists/abc`);
  });

  it('does not advertise list support for reddwarf, which has no list route', () => {
    expect(WAYPOINT_DESTINATIONS_DATA.reddwarf.supportedTypes).not.toContain('list');
  });

  it('never sends a list to its author', () => {
    // Waypoints in the bluesky-social family render bsky lists themselves, so
    // one claiming `list` support has to address the list rather than fall back
    // to the author's profile. (Apps outside the family — Leaflet, Tangled, and
    // friends — legitimately fall back: they can't render a bsky list at all,
    // and the picker offers them as "find this person over there" jumps.)
    for (const waypoint of Object.values(WAYPOINT_DESTINATIONS_DATA)) {
      if (!waypoint.redirectCompat.includes('bluesky-social')) continue;
      if (!waypoint.supportedTypes.includes('list')) continue;
      const list = waypoint.getUrl('alice.bsky.social', 'app.bsky.graph.list', 'abc');
      const profile = waypoint.getUrl('alice.bsky.social');
      expect({ id: waypoint.id, list }).not.toEqual({ id: waypoint.id, list: profile });
    }
  });

  it('returns null for offprint without a record', () => {
    expect(WAYPOINT_DESTINATIONS_DATA.offprint.getUrl('alice.bsky.social')).toBeNull();
  });
});

describe('getRecommendedWaypointsData', () => {
  it('recommends bluesky/anisota/blacksky for posts', () => {
    const { waypoints, label } = getRecommendedWaypointsData('post', 'app.bsky.feed.post');
    expect(waypoints.map((w) => w.id)).toEqual(['bluesky', 'anisota', 'blacksky']);
    expect(label).toBe('Recommended for Posts');
  });

  it('matches namespace prefixes (tangled)', () => {
    const { waypoints } = getRecommendedWaypointsData('record', 'sh.tangled.repo');
    expect(waypoints.map((w) => w.id)).toContain('tangled');
  });

  it('falls back to a default recommendation', () => {
    const { waypoints } = getRecommendedWaypointsData('unknown');
    expect(waypoints.length).toBeGreaterThan(0);
  });
});

describe('catalog helpers', () => {
  it('lists post-capable waypoints in order', () => {
    const ids = getWaypointDataForType('post').map((w) => w.id);
    expect(ids[0]).toBe('anisota');
    expect(ids).toContain('bluesky');
  });

  it('returns a featured waypoint for posts', () => {
    expect(getFeaturedWaypointData('post', 'app.bsky.feed.post')?.id).toBe('bluesky');
  });
});
