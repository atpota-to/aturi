import { describe, it, expect } from 'vitest';
import {
  WAYPOINT_DESTINATIONS_DATA,
  describeComposeIntent,
  getComposeIntentAppUrl,
  getComposeIntentTemplate,
  getComposeIntentUrl,
  getComposeIntentWaypoints,
  getRecommendedWaypointsData,
  getWaypointDataForType,
  getFeaturedWaypointData,
  supportsComposeIntent,
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

describe('compose intents', () => {
  // Each of these was confirmed against the client's shipped bundle: the
  // social-app forks all parse `/intent/compose?text=`, Impro routes the path
  // but drops the text. Anisota is the exception — its route is in flight, so
  // this asserts the shape we agreed on, not something already deployed.
  // Anything not listed here has no confirmed route.
  it.each([
    ['bluesky', 'https://bsky.app/intent/compose?text=hello%20there'],
    ['anisota', 'https://anisota.net/intent/compose?text=hello%20there'],
    ['blacksky', 'https://blacksky.community/intent/compose?text=hello%20there'],
    ['deer', 'https://deer.social/intent/compose?text=hello%20there'],
    ['witchsky', 'https://witchsky.app/intent/compose?text=hello%20there'],
    ['mu', 'https://mu.social/intent/compose?text=hello%20there'],
  ])('builds a pre-filled %s compose link', (id, expected) => {
    expect(getComposeIntentUrl(WAYPOINT_DESTINATIONS_DATA[id], 'hello there')).toBe(expected);
  });

  it('drops the text for a client that ignores it', () => {
    const impro = WAYPOINT_DESTINATIONS_DATA.impro;
    expect(supportsComposeIntent(impro)).toBe(true);
    expect(getComposeIntentUrl(impro, 'hello there')).toBe(
      'https://impro.social/intent/compose',
    );
    expect(describeComposeIntent(impro)?.prefillsText).toBe(false);
  });

  it('returns null for clients with no confirmed intent route', () => {
    for (const id of ['bluepy', 'reddwarf', 'pinksky', 'pdsls', 'leaflet']) {
      const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
      expect(supportsComposeIntent(waypoint)).toBe(false);
      expect(getComposeIntentUrl(waypoint, 'hi')).toBeNull();
      expect(describeComposeIntent(waypoint)).toBeNull();
    }
  });

  it('omits the query string when no text is passed', () => {
    expect(getComposeIntentUrl(WAYPOINT_DESTINATIONS_DATA.bluesky)).toBe(
      'https://bsky.app/intent/compose',
    );
  });

  it('url-encodes the text', () => {
    const url = getComposeIntentUrl(
      WAYPOINT_DESTINATIONS_DATA.bluesky,
      'a & b?c=d #tag',
    );
    expect(url).toBe('https://bsky.app/intent/compose?text=a%20%26%20b%3Fc%3Dd%20%23tag');
    expect(new URL(url!).searchParams.get('text')).toBe('a & b?c=d #tag');
  });

  it('exposes the native deep link only where a scheme is published', () => {
    expect(getComposeIntentAppUrl(WAYPOINT_DESTINATIONS_DATA.bluesky, 'hi')).toBe(
      'bluesky://intent/compose?text=hi',
    );
    expect(getComposeIntentAppUrl(WAYPOINT_DESTINATIONS_DATA.deer, 'hi')).toBeNull();
  });

  it('templates the text placeholder for callers that build their own links', () => {
    expect(getComposeIntentTemplate(WAYPOINT_DESTINATIONS_DATA.deer)).toBe(
      'https://deer.social/intent/compose?text={text}',
    );
    // No placeholder when the client won't read it.
    expect(getComposeIntentTemplate(WAYPOINT_DESTINATIONS_DATA.impro)).toBe(
      'https://impro.social/intent/compose',
    );
  });

  it('lists compose-capable waypoints in catalog order', () => {
    expect(getComposeIntentWaypoints().map((w) => w.id)).toEqual([
      'anisota',
      'bluesky',
      'impro',
      'blacksky',
      'witchsky',
      'mu',
      'deer',
    ]);
  });

  it('narrows the list to clients that also render the type', () => {
    const ids = getComposeIntentWaypoints('list').map((w) => w.id);
    expect(ids).toContain('bluesky');
    // Every compose-capable client renders lists, so the filter is only
    // meaningful once one of them drops a type — assert the shape holds.
    for (const id of ids) {
      expect(WAYPOINT_DESTINATIONS_DATA[id].supportedTypes).toContain('list');
    }
  });

  it('only claims compose support for clients in the bluesky family', () => {
    for (const waypoint of getComposeIntentWaypoints()) {
      expect(waypoint.redirectCompat).toContain('bluesky-social');
    }
  });

  it('points every intent at the client’s own origin', () => {
    for (const waypoint of getComposeIntentWaypoints()) {
      const intentOrigin = new URL(waypoint.composeIntent!.url).origin;
      const profileOrigin = new URL(waypoint.getUrl('alice.bsky.social')!).origin;
      expect({ id: waypoint.id, intentOrigin }).toEqual({
        id: waypoint.id,
        intentOrigin: profileOrigin,
      });
    }
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
