import { describe, it, expect } from 'vitest';
import {
  resolveAtUri,
  resolveUrl,
  buildWaypointsForParsed,
} from '../resolve';
import { DID_REQUIRED_WAYPOINTS } from '../waypoints.data';

describe('resolveAtUri', () => {
  it('resolves a post end to end', () => {
    const r = resolveAtUri('at://did:plc:x/app.bsky.feed.post/abc');
    expect(r).not.toBeNull();
    const bsky = r!.waypoints.find((w) => w.id === 'bluesky');
    expect(bsky?.url).toBe('https://bsky.app/profile/did:plc:x/post/abc');
    expect(r!.recommended.ids).toContain('bluesky');
    // DID is present, so DID-only waypoints are included.
    expect(r!.waypoints.some((w) => w.id === 'pdsls')).toBe(true);
  });

  it('returns null for an invalid at-uri', () => {
    expect(resolveAtUri('https://bsky.app/x')).toBeNull();
  });
});

describe('buildWaypointsForParsed', () => {
  it('omits DID-only waypoints when no DID is known', () => {
    const { waypoints } = buildWaypointsForParsed({
      type: 'profile',
      uri: 'at://alice.bsky.social',
      handle: 'alice.bsky.social',
    });
    for (const id of DID_REQUIRED_WAYPOINTS) {
      expect(waypoints.some((w) => w.id === id)).toBe(false);
    }
  });

  it('excludes the source waypoint', () => {
    const { waypoints, recommended } = buildWaypointsForParsed(
      {
        type: 'post',
        uri: 'at://did:plc:x/app.bsky.feed.post/abc',
        handle: 'did:plc:x',
        did: 'did:plc:x',
        collection: 'app.bsky.feed.post',
        rkey: 'abc',
      },
      { excludeSourceId: 'bluesky' },
    );
    expect(waypoints.some((w) => w.id === 'bluesky')).toBe(false);
    expect(recommended.ids).not.toContain('bluesky');
  });
});

describe('resolveUrl', () => {
  it('resolves a recognized URL pattern offline', async () => {
    const r = await resolveUrl('https://bsky.app/profile/alice.bsky.social/post/abc');
    expect(r?.source).toBe('bluesky');
    expect(r?.parsed.type).toBe('post');
    // The source app is omitted from its own result.
    expect(r?.waypoints.some((w) => w.id === 'bluesky')).toBe(false);
    expect(r?.waypoints.some((w) => w.id === 'anisota')).toBe(true);
  });

  it('resolves a handle to a DID via the provided resolver', async () => {
    const r = await resolveUrl('https://bsky.app/profile/alice.bsky.social', {
      resolveHandle: async () => 'did:plc:resolved',
    });
    expect(r?.did).toBe('did:plc:resolved');
    expect(r?.didResolved).toBe(true);
    expect(r?.waypoints.some((w) => w.id === 'pdsls')).toBe(true);
  });

  it('returns null for unsupported hosts', async () => {
    expect(await resolveUrl('https://example.com/whatever')).toBeNull();
  });
});
