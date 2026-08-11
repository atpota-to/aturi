import { describe, it, expect } from 'vitest';
import {
  CATEGORY_ORDER,
  COMPAT_FAMILIES,
  COMPAT_FAMILY_ORDER,
  WAYPOINT_CATEGORIES_DATA,
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  getCategorizedWaypointsData,
  getRecommendedWaypointsData,
  getWaypointCountData,
  getWaypointDataForType,
  supportsComposeIntent,
  waypointActivity,
  type CategorizedWaypointsData,
  type RedirectCompatFamily,
  type WaypointType,
} from '../waypoints.data';

/**
 * AGENTS.md documents adding a waypoint as "four edits, all required, none of
 * which fail the build if you skip them". This file is the build failure. Every
 * assertion here corresponds to a way a half-finished catalog entry currently
 * ships green: an id in `WAYPOINT_ORDER` with no data behind it, a data entry
 * that never renders because it is missing from the order, a `category` no
 * picker knows about, a `redirectCompat` family that silently disables
 * auto-redirect instead of enabling it.
 *
 * (Step 3 of the checklist — an icon keyed by id in `WAYPOINT_ICONS` — lives in
 * `@aturi.to/waypoints-react`, so its parity test lives there.)
 */

const ALL_TYPES: WaypointType[] = ['post', 'profile', 'list', 'record', 'unknown'];

/** Every waypoint id, in catalog order, as a table for `it.each`. */
const WAYPOINT_ROWS = WAYPOINT_ORDER.map((id) => [id] as const);

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return [...dupes];
}

describe('WAYPOINT_ORDER <-> WAYPOINT_DESTINATIONS_DATA', () => {
  it('has no duplicate ids', () => {
    expect(duplicatesOf(WAYPOINT_ORDER)).toEqual([]);
  });

  it('lists exactly the ids the catalog defines', () => {
    // Step 2 of the checklist. An id in DATA but not in ORDER never renders;
    // an id in ORDER but not in DATA throws the moment anything maps the order.
    const ordered = [...WAYPOINT_ORDER].sort();
    const defined = Object.keys(WAYPOINT_DESTINATIONS_DATA).sort();
    expect({
      inOrderButNotDefined: ordered.filter((id) => !defined.includes(id)),
      definedButNotOrdered: defined.filter((id) => !ordered.includes(id)),
    }).toEqual({ inOrderButNotDefined: [], definedButNotOrdered: [] });
  });

  it('keys every entry by its own id', () => {
    for (const [key, waypoint] of Object.entries(WAYPOINT_DESTINATIONS_DATA)) {
      expect({ key, id: waypoint.id }).toEqual({ key, id: key });
    }
  });

  it('reports the catalog size from the order', () => {
    expect(getWaypointCountData()).toBe(WAYPOINT_ORDER.length);
    expect(getWaypointCountData()).toBe(Object.keys(WAYPOINT_DESTINATIONS_DATA).length);
  });
});

describe('waypoint shape', () => {
  it.each(WAYPOINT_ROWS)('%s declares a usable name and description', (id) => {
    const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
    expect(waypoint.name.trim()).not.toBe('');
    if (typeof waypoint.description === 'function') {
      // A description function has to survive being called with nothing, since
      // the picker renders it before a record is known.
      expect(waypoint.description(undefined, undefined).trim()).not.toBe('');
      expect(waypoint.description('site.standard.document', 'record').trim()).not.toBe('');
    } else {
      expect(waypoint.description.trim()).not.toBe('');
    }
  });

  it.each(WAYPOINT_ROWS)('%s declares valid supportedTypes', (id) => {
    const { supportedTypes } = WAYPOINT_DESTINATIONS_DATA[id];
    expect(supportedTypes.length).toBeGreaterThan(0);
    expect(duplicatesOf(supportedTypes)).toEqual([]);
    expect(supportedTypes.filter((t) => !ALL_TYPES.includes(t))).toEqual([]);
  });

  it.each(WAYPOINT_ROWS)('%s declares a registered category', (id) => {
    const { category } = WAYPOINT_DESTINATIONS_DATA[id];
    expect(Object.keys(WAYPOINT_CATEGORIES_DATA)).toContain(category);
    expect(CATEGORY_ORDER).toContain(category);
  });

  it.each(WAYPOINT_ROWS)('%s declares registered redirectCompat families', (id) => {
    const { redirectCompat } = WAYPOINT_DESTINATIONS_DATA[id];
    // An empty array is meaningful (never a redirect source or destination),
    // but an unregistered family is a typo that silently disables redirects.
    expect(duplicatesOf(redirectCompat)).toEqual([]);
    const registered = Object.keys(COMPAT_FAMILIES);
    expect(redirectCompat.filter((f) => !registered.includes(f))).toEqual([]);
  });

  it.each(WAYPOINT_ROWS)('%s declares well-formed expectedCollections', (id) => {
    const { expectedCollections } = WAYPOINT_DESTINATIONS_DATA[id];
    if (expectedCollections === undefined) return;
    // Omit the field for generic explorers rather than shipping an empty array,
    // which `waypointActivity` cannot distinguish from "no opinion".
    expect(expectedCollections.length).toBeGreaterThan(0);
    expect(duplicatesOf(expectedCollections)).toEqual([]);
    for (const prefix of expectedCollections) {
      // A full NSID (`site.standard.document`) or a trailing-dot namespace
      // prefix (`sh.tangled.`). Anything else fails to prefix-match anything.
      expect({ id, prefix }).toEqual({
        id,
        prefix: expect.stringMatching(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+\.?$/),
      });
    }
  });

  it.each(WAYPOINT_ROWS)('%s exposes its expectations through waypointActivity', (id) => {
    const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
    const expected = waypoint.expectedCollections;
    if (!expected) {
      expect(waypointActivity(waypoint, new Set(['app.bsky.feed.post']))).toBe('unknown');
      return;
    }
    // A declared prefix has to actually match a collection under it, otherwise
    // the popup flags every account as "no records found" for this waypoint.
    const sample = expected[0].endsWith('.') ? `${expected[0]}record` : expected[0];
    expect({ id, activity: waypointActivity(waypoint, new Set([sample])) }).toEqual({
      id,
      activity: 'present',
    });
    expect(waypointActivity(waypoint, new Set(['zz.nonexistent.record']))).toBe('absent');
    expect(waypointActivity(waypoint, null)).toBe('unknown');
  });

  it.each(WAYPOINT_ROWS)('%s never builds a url containing "undefined" or "null"', (id) => {
    const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
    const inputs: [string, string | undefined, string | undefined, string | undefined][] = [
      ['alice.bsky.social', undefined, undefined, undefined],
      ['alice.bsky.social', undefined, undefined, 'did:plc:xyz'],
      ['alice.bsky.social', 'app.bsky.feed.post', 'rk1', 'did:plc:xyz'],
      ['alice.bsky.social', 'app.bsky.graph.list', 'rk1', 'did:plc:xyz'],
      ['did:plc:xyz', 'site.standard.document', 'rk1', 'did:plc:xyz'],
      ['did:plc:xyz', 'pub.leaflet.document', 'rk1', 'did:plc:xyz'],
    ];
    for (const [handle, collection, rkey, did] of inputs) {
      const url = waypoint.getUrl(handle, collection, rkey, did);
      if (url === null) continue;
      // `getUrl` returns null for unrenderable input rather than interpolating
      // a missing argument into the path.
      expect({ id, url }).toEqual({ id, url: expect.not.stringContaining('undefined') });
      expect({ id, url }).toEqual({ id, url: expect.not.stringContaining('null') });
      expect(() => new URL(url)).not.toThrow();
    }
  });

  it.each(WAYPOINT_ROWS)('%s points any compose intent at its own origin', (id) => {
    const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
    if (!supportsComposeIntent(waypoint)) return;
    const intent = waypoint.composeIntent!;
    // The catalog stores the bare route; the query string is built per call.
    expect({ id, url: intent.url }).toEqual({ id, url: expect.not.stringContaining('?') });
    expect(new URL(intent.url).protocol).toBe('https:');
    if (intent.appUrl) expect(intent.appUrl).not.toContain('?');
  });
});

describe('categories', () => {
  it('orders exactly the categories it defines, without duplicates', () => {
    expect(duplicatesOf(CATEGORY_ORDER)).toEqual([]);
    expect([...CATEGORY_ORDER].sort()).toEqual(Object.keys(WAYPOINT_CATEGORIES_DATA).sort());
  });

  it('keys every category by its own id', () => {
    for (const [key, category] of Object.entries(WAYPOINT_CATEGORIES_DATA)) {
      expect({ key, id: category.id }).toEqual({ key, id: key });
    }
  });

  it('names a default waypoint that exists and belongs to the category', () => {
    for (const category of Object.values(WAYPOINT_CATEGORIES_DATA)) {
      const target = WAYPOINT_DESTINATIONS_DATA[category.defaultWaypointId];
      expect({ category: category.id, exists: !!target }).toEqual({
        category: category.id,
        exists: true,
      });
      expect({ category: category.id, of: target.category }).toEqual({
        category: category.id,
        of: category.id,
      });
    }
  });

  it('declares every subcategory as a real top-level category too', () => {
    for (const category of Object.values(WAYPOINT_CATEGORIES_DATA)) {
      for (const subcategory of category.subcategories ?? []) {
        // `getCategorizedWaypointsData` skips a subcategory at top level and
        // expects the picker to nest it, so the standalone entry has to exist.
        expect(Object.keys(WAYPOINT_CATEGORIES_DATA)).toContain(subcategory.id);
        expect(WAYPOINT_CATEGORIES_DATA[subcategory.id]).toMatchObject({
          id: subcategory.id,
          name: subcategory.name,
          defaultWaypointId: subcategory.defaultWaypointId,
        });
      }
    }
  });

  it('has at least one waypoint in every ordered category', () => {
    const populated = new Set(
      Object.values(WAYPOINT_DESTINATIONS_DATA).map((w) => w.category),
    );
    expect(CATEGORY_ORDER.filter((id) => !populated.has(id))).toEqual([]);
  });
});

describe('compat families', () => {
  it('orders exactly the families it registers, without duplicates', () => {
    expect(duplicatesOf(COMPAT_FAMILY_ORDER)).toEqual([]);
    expect([...COMPAT_FAMILY_ORDER].sort()).toEqual(
      (Object.keys(COMPAT_FAMILIES) as RedirectCompatFamily[]).sort(),
    );
  });

  it('keys every family by its own id and describes it', () => {
    for (const [key, family] of Object.entries(COMPAT_FAMILIES)) {
      expect({ key, id: family.id }).toEqual({ key, id: key });
      expect(family.name.trim()).not.toBe('');
      expect(family.description.trim()).not.toBe('');
    }
  });

  it('is claimed by at least one waypoint', () => {
    // A registered family nothing claims is dead weight in the options UI: it
    // renders a "Favorite for X" control that can never fire. (One claimant is
    // legitimate — several single-app families exist so the redirect rule is
    // ready the day a second client for that lexicon ships.)
    const claimed = new Set(
      WAYPOINT_ORDER.flatMap((id) => WAYPOINT_DESTINATIONS_DATA[id].redirectCompat),
    );
    expect(COMPAT_FAMILY_ORDER.filter((family) => !claimed.has(family))).toEqual([]);
  });
});

/**
 * A category can declare `subcategories`, and `getCategorizedWaypointsData`
 * skips those at top level so the picker can nest them under their parent.
 * Collect ids through both shapes — a flat list of groups, or groups carrying
 * nested ones — so this file asserts *coverage* rather than a layout choice.
 */
type NestableGroup = CategorizedWaypointsData & {
  subcategories?: CategorizedWaypointsData[];
};

function collectIds(groups: readonly CategorizedWaypointsData[]): string[] {
  const ids: string[] = [];
  for (const group of groups as readonly NestableGroup[]) {
    ids.push(...group.waypoints.map((w) => w.id));
    if (group.subcategories) ids.push(...collectIds(group.subcategories));
  }
  return ids;
}

describe('getCategorizedWaypointsData', () => {
  it.each(ALL_TYPES)('covers every %s-capable waypoint exactly once', (type) => {
    const seen = collectIds(getCategorizedWaypointsData(type));
    expect(duplicatesOf(seen)).toEqual([]);
    // Regression guard: a waypoint in a category that `CATEGORY_ORDER` forgot,
    // or in a category declared only as a subcategory, silently vanishes from
    // the picker while still passing every other test in the suite.
    expect([...seen].sort()).toEqual(getWaypointDataForType(type).map((w) => w.id).sort());
  });

  it('reaches every waypoint in the catalog across all types', () => {
    const reachable = new Set(
      ALL_TYPES.flatMap((type) => collectIds(getCategorizedWaypointsData(type))),
    );
    expect(WAYPOINT_ORDER.filter((id) => !reachable.has(id))).toEqual([]);
  });

  it('emits categories in CATEGORY_ORDER and never an empty group', () => {
    for (const type of ALL_TYPES) {
      const ids = getCategorizedWaypointsData(type).map((group) => group.category.id);
      expect(ids).toEqual(CATEGORY_ORDER.filter((id) => ids.includes(id)));
      for (const group of getCategorizedWaypointsData(type)) {
        expect(group.waypoints.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps waypoints in catalog order within a category', () => {
    for (const type of ALL_TYPES) {
      for (const group of getCategorizedWaypointsData(type)) {
        const ids = group.waypoints.map((w) => w.id);
        expect(ids).toEqual(WAYPOINT_ORDER.filter((id) => ids.includes(id)));
      }
    }
  });
});

describe('recommendations', () => {
  const COLLECTIONS = [
    undefined,
    'app.bsky.feed.post',
    'app.bsky.graph.list',
    'site.standard.document',
    'pub.leaflet.document',
    'sh.tangled.repo',
    'at.margin.annotation',
    'social.grain.gallery',
    'community.lexicon.calendar.event',
    'zz.unregistered.thing',
  ];

  it('only ever recommends waypoints that exist in the catalog', () => {
    // The recommendation tables key on ids by hand, so a renamed waypoint
    // leaves a dangling id that either throws or silently drops out of the
    // recommended row while every other test stays green.
    const unknown: string[] = [];
    for (const type of ALL_TYPES) {
      for (const collection of COLLECTIONS) {
        const { waypoints, label } = getRecommendedWaypointsData(type, collection);
        expect({ type, collection, labelled: label.trim() !== '' }).toMatchObject({
          labelled: true,
        });
        for (const waypoint of waypoints) {
          if (WAYPOINT_DESTINATIONS_DATA[waypoint.id] !== waypoint) {
            unknown.push(`${type}/${collection}: ${waypoint.id}`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});
