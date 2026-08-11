// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { DID_REQUIRED_WAYPOINTS } from '@aturi.to/waypoints';
import { useWaypoints } from '../useWaypoints';

/*
 * Regression guard for the DID gate.
 *
 * The defect this exists for: the core resolver drops the waypoints whose URLs
 * are only correct with a DID when no DID is known, and the core README
 * documents that rule — but `useWaypoints` had no equivalent check. The same
 * library gave two contradictory answers for the same input depending on which
 * entry point you used, and only one of them was documented.
 *
 * The expected set is read from the core's own constant rather than hard-coded
 * here, so this stays correct when the catalog's DID rules change.
 */

afterEach(cleanup);

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';

function idsFor(params: Parameters<typeof useWaypoints>[0]): string[] {
  const { result } = renderHook(() => useWaypoints(params));
  return result.current.waypoints.map((w) => w.id);
}

describe('DID-required waypoints', () => {
  it('has something to test', () => {
    // Guards against the whole suite going vacuous if the constant empties out.
    expect(DID_REQUIRED_WAYPOINTS.size).toBeGreaterThan(0);
  });

  it('omits every DID-required waypoint when no did is supplied', () => {
    const ids = idsFor({ type: 'profile', handle: 'alice.example.com' });
    expect(ids.length).toBeGreaterThan(0);
    const leaked = ids.filter((id) => DID_REQUIRED_WAYPOINTS.has(id));
    expect(leaked).toEqual([]);
  });

  it('omits them for record targets too', () => {
    const ids = idsFor({
      type: 'record',
      handle: 'alice.example.com',
      collection: 'app.bsky.feed.post',
      rkey: '3k1abcdefgh',
    });
    expect(ids.length).toBeGreaterThan(0);
    const leaked = ids.filter((id) => DID_REQUIRED_WAYPOINTS.has(id));
    expect(leaked).toEqual([]);
  });

  it('surfaces them once a did is supplied', () => {
    const ids = idsFor({
      type: 'profile',
      handle: 'alice.example.com',
      did: DID,
    });
    const present = ids.filter((id) => DID_REQUIRED_WAYPOINTS.has(id));
    expect(present.length).toBeGreaterThan(0);
  });

  it('changes the row count between the did and no-did cases', () => {
    // The audit's exact symptom was an identical row count with and without a
    // `did` prop, which is what made the omission invisible in the UI.
    const without = idsFor({ type: 'profile', handle: 'alice.example.com' });
    const with_ = idsFor({
      type: 'profile',
      handle: 'alice.example.com',
      did: DID,
    });
    expect(with_.length).toBeGreaterThan(without.length);
  });

  it('never hands a row a url that still contains the raw handle in a did slot', () => {
    // The failure mode users saw: handle-shaped URLs at pdsls.dev / atp.tools
    // that 404, because those routes address a repo by DID.
    const { result } = renderHook(() =>
      useWaypoints({ type: 'profile', handle: 'alice.example.com', did: DID }),
    );
    const didOnly = result.current.waypoints.filter((w) =>
      DID_REQUIRED_WAYPOINTS.has(w.id),
    );
    expect(didOnly.length).toBeGreaterThan(0);
    for (const w of didOnly) {
      expect(w.url, `${w.id} built a url without the did`).toContain(DID);
    }
  });
});
