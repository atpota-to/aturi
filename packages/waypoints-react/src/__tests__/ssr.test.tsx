import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WaypointType } from '@aturi.to/waypoints';
import { WaypointPicker } from '../WaypointPicker';

/*
 * The package ships a "use client" directive, but a client component still has
 * to survive the server pass of every React framework that renders one — Next's
 * App Router prerenders client components on the server before hydration. A
 * component that reaches for `window`, `document` or `navigator` at render time
 * throws there and takes the whole route down, which nothing else in this
 * repo's checks can see: `tsc --noEmit` cannot detect a render crash.
 */

const ALL_TYPES: WaypointType[] = [
  'post',
  'profile',
  'list',
  'record',
  'unknown',
];

/** Count of default rows, which are keyed by the row's `data-aturi-wp` slot. */
function countRows(html: string): number {
  return html.split('data-aturi-wp="button"').length - 1;
}

describe('server rendering', () => {
  it.each(ALL_TYPES)('renders type "%s" without throwing', (type) => {
    const html = renderToStaticMarkup(
      <WaypointPicker
        type={type}
        handle="alice.example.com"
        collection="app.bsky.feed.post"
        rkey="3k1abcdefgh"
      />,
    );
    expect(html).toContain('data-aturi-wp="root"');
    expect(countRows(html)).toBeGreaterThan(0);
  });

  it('renders with a did and with none, in both cases producing rows', () => {
    const withoutDid = renderToStaticMarkup(
      <WaypointPicker type="profile" handle="alice.example.com" />,
    );
    const withDid = renderToStaticMarkup(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        did="did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
      />,
    );
    expect(countRows(withoutDid)).toBeGreaterThan(0);
    expect(countRows(withDid)).toBeGreaterThan(0);
  });

  it('renders the empty state rather than throwing when every id is hidden', () => {
    const html = renderToStaticMarkup(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        waypointIds={['definitely-not-a-waypoint-id']}
      />,
    );
    expect(html).toContain('data-aturi-wp="empty"');
  });

  it('renders a custom waypoint on the server', () => {
    const html = renderToStaticMarkup(
      <WaypointPicker
        type="profile"
        handle="alice.example.com"
        customWaypoints={[
          {
            id: 'test-custom',
            name: 'Test Custom',
            getUrl: (handle) => `https://example.test/${handle}`,
          },
        ]}
      />,
    );
    expect(html).toContain('https://example.test/alice.example.com');
  });
});
