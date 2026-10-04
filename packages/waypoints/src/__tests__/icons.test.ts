import { describe, it, expect } from 'vitest';
import { WAYPOINT_ORDER } from '../waypoints.data';
import {
  WAYPOINT_ICON_SVGS,
  getWaypointIconSvg,
  anisotaIconSvg,
  anisotaReaderIconSvg,
} from '../icons';

// `waypointIcons.data.ts` is generated from the app's canonical JSX catalog by
// scripts/svgFromJsx.mjs. These cover the two things the generator cannot check
// for itself: that the catalog still lines up with the waypoint list, and that
// what it emitted is markup a consumer outside Aturi can actually render.

describe('WAYPOINT_ICON_SVGS', () => {
  it('carries a mark for every waypoint in WAYPOINT_ORDER', () => {
    const missing = WAYPOINT_ORDER.filter((id) => !(id in WAYPOINT_ICON_SVGS));
    expect(missing).toEqual([]);
  });

  it('carries no marks for ids that are not waypoints', () => {
    const orphans = Object.keys(WAYPOINT_ICON_SVGS).filter(
      (id) => !WAYPOINT_ORDER.includes(id),
    );
    expect(orphans).toEqual([]);
  });

  it.each(Object.entries(WAYPOINT_ICON_SVGS))(
    '%s is a single self-contained <svg> element',
    (_id, svg) => {
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      // A second root would mean the collapse pass merged two components.
      expect(svg.match(/<svg[\s>]/g)).toHaveLength(1);
    },
  );

  it.each(Object.entries(WAYPOINT_ICON_SVGS))(
    '%s declares the SVG namespace so it stands alone',
    (_id, svg) => {
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    },
  );

  it.each(Object.entries(WAYPOINT_ICON_SVGS))(
    '%s uses SVG attribute spellings, not React ones',
    (_id, svg) => {
      // Attribute names only: `viewBox` is legitimately camelCase, and the
      // values carry unrelated capitals (path commands, colour keywords).
      const attributes = [...svg.matchAll(/[\s<]([a-zA-Z][\w:-]*)=/g)].map(
        (match) => match[1],
      );
      const camelCased = attributes.filter(
        (name) => /[A-Z]/.test(name) && name !== 'viewBox',
      );
      expect(camelCased).toEqual([]);
    },
  );

  it.each(Object.entries(WAYPOINT_ICON_SVGS))(
    '%s gives every CSS variable a fallback',
    (_id, svg) => {
      // Consumers have no Aturi theme, and a bare `var()` on an undefined
      // property makes the declaration invalid at computed-value time, which
      // silently drops the paint to whatever the element inherits.
      const bare = [...svg.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map(
        (match) => match[1],
      );
      expect(bare).toEqual([]);
    },
  );

  it.each(Object.entries(WAYPOINT_ICON_SVGS))(
    '%s declares no document-scoped ids',
    (_id, svg) => {
      // An id inside inlined markup is global to the host document, so two
      // copies of a mark on one page would collide and clip or paint wrongly.
      const ids = [...svg.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);
      expect(ids).toEqual([]);
    },
  );

  it('knocks out to --bg-primary in exactly the documented marks', () => {
    // The README names these three so consumers know which marks need
    // `--bg-primary` set on a non-white surface. A new mark using the knockout
    // has to be added there as well, or the docs are quietly wrong.
    const knockout = Object.entries(WAYPOINT_ICON_SVGS)
      .filter(([, svg]) => svg.includes('--bg-primary'))
      .map(([id]) => id)
      .sort();
    expect(knockout).toEqual(['lea', 'leaflet', 'pckt']);
  });

  it('shares one string between waypoints that share a mark', () => {
    // Anisota's mark is ~34KB and two waypoints point at it. Aliasing rather
    // than duplicating is what keeps the icons bundle to roughly one copy.
    expect(anisotaReaderIconSvg).toBe(anisotaIconSvg);
  });
});

describe('getWaypointIconSvg', () => {
  it('returns the mark for a known waypoint', () => {
    expect(getWaypointIconSvg('bluesky')).toBe(WAYPOINT_ICON_SVGS.bluesky);
  });

  it('returns undefined for an unknown id', () => {
    expect(getWaypointIconSvg('not-a-waypoint')).toBeUndefined();
  });

  it('does not reach through to Object.prototype', () => {
    expect(getWaypointIconSvg('toString')).toBeUndefined();
    expect(getWaypointIconSvg('constructor')).toBeUndefined();
  });
});
