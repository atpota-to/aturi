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
