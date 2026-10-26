import { describe, it, expect } from 'vitest';
import { WAYPOINT_ORDER } from '@aturi/waypoints.data';
import {
  DEFAULT_PREFS,
  adoptTargetFor,
  adoptWaypoint,
  markKnown,
  nativeGroupFor,
  type CustomWaypoint,
  type Prefs,
  type WaypointGroup,
} from '../prefs';
import { newBuiltinWaypoints, visibleWaypointIds } from '../catalog';

function makePrefs(overrides: Partial<Prefs> = {}): Prefs {
  return { ...DEFAULT_PREFS, ...overrides };
}

// A user who arranged their own groups before `standardReader` shipped. This
// is the shape that made new built-ins invisible: they belong to a category
// the user has a group for, but nothing ever puts them in it.
function customizedPrefs(): Prefs {
  const groups: WaypointGroup[] = [
    { id: 'publications', name: 'Reading', waypointIds: ['leaflet'] },
    { id: 'blueskyClients', name: 'Bluesky', waypointIds: ['bluesky', 'deer'] },
  ];
  return makePrefs({
    waypointGroups: groups,
    knownWaypointIds: WAYPOINT_ORDER.filter(id => id !== 'standardReader'),
  });
}

describe('nativeGroupFor', () => {
  it('maps a built-in to its category', () => {
    expect(nativeGroupFor('standardReader')).toEqual({
      id: 'publications',
      name: 'Publications',
    });
  });

  it('maps custom waypoints to the Custom group', () => {
    expect(nativeGroupFor('custom:abc').id).toBe('custom');
  });

  it('falls back to Custom for ids that are no longer in the catalog', () => {
    expect(nativeGroupFor('retiredWaypoint').id).toBe('custom');
  });
});

describe('adoptTargetFor', () => {
  it('points at the user\'s existing group for the category, by its name', () => {
    // The group was renamed to "Reading" — the button should say so, not
    // invent a second Publications group.
    expect(adoptTargetFor(customizedPrefs(), 'standardReader')).toEqual({
      id: 'publications',
      name: 'Reading',
      created: false,
    });
  });

  it('flags that the group has to be created when the user deleted it', () => {
    const prefs = makePrefs({
      waypointGroups: [{ id: 'blueskyClients', name: 'Bluesky', waypointIds: [] }],
    });
    expect(adoptTargetFor(prefs, 'standardReader')).toEqual({
      id: 'publications',
      name: 'Publications',
      created: true,
    });
  });
});

describe('adoptWaypoint', () => {
  it('places a new built-in into the matching group and clears the new flag', () => {
    const prefs = customizedPrefs();
    expect(newBuiltinWaypoints(prefs).map(w => w.id)).toEqual(['standardReader']);
    expect(visibleWaypointIds(prefs).has('standardReader')).toBe(false);

    const next = adoptWaypoint(prefs, 'standardReader');

    expect(next.waypointGroups[0].waypointIds).toEqual(['leaflet', 'standardReader']);
    expect(visibleWaypointIds(next).has('standardReader')).toBe(true);
    expect(newBuiltinWaypoints(next)).toEqual([]);
  });

  it('leaves every other group and the user\'s ordering untouched', () => {
    const prefs = customizedPrefs();
    const next = adoptWaypoint(prefs, 'standardReader');

    expect(next.waypointGroups.map(g => g.id)).toEqual(['publications', 'blueskyClients']);
    expect(next.waypointGroups[0].name).toBe('Reading');
    expect(next.waypointGroups[1]).toEqual(prefs.waypointGroups[1]);
  });

  it('recreates a deleted category group in CATEGORY_ORDER position', () => {
    // publications sorts before atmosphereApps, so the recreated group should
    // land between blueskyClients and atmosphereApps — not at the bottom.
    const prefs = makePrefs({
      waypointGroups: [
        { id: 'blueskyClients', name: 'Bluesky', waypointIds: ['bluesky'] },
        { id: 'atmosphereApps', name: 'Atmosphere', waypointIds: ['tangled'] },
      ],
    });
    const next = adoptWaypoint(prefs, 'standardReader');

    expect(next.waypointGroups.map(g => g.id)).toEqual([
      'blueskyClients',
      'publications',
      'atmosphereApps',
    ]);
    expect(next.waypointGroups[1]).toMatchObject({
      name: 'Publications',
      waypointIds: ['standardReader'],
    });
  });

  it('appends a recreated group after user-made groups with unknown ids', () => {
    const prefs = makePrefs({
      waypointGroups: [{ id: 'group:abc', name: 'Mine', waypointIds: ['bluesky'] }],
    });
    const next = adoptWaypoint(prefs, 'standardReader');
    expect(next.waypointGroups.map(g => g.id)).toEqual(['group:abc', 'publications']);
  });

  it('is idempotent — adopting twice does not duplicate the waypoint', () => {
    const once = adoptWaypoint(customizedPrefs(), 'standardReader');
    const twice = adoptWaypoint(once, 'standardReader');
    expect(twice.waypointGroups[0].waypointIds).toEqual(['leaflet', 'standardReader']);
    expect(twice.waypointGroups).toHaveLength(2);
  });

  it('adopts a custom waypoint into the Custom group without tracking it as known', () => {
    const custom: CustomWaypoint = {
      id: 'custom:mu',
      name: 'Mu',
      domain: 'mu.example',
      category: 'custom',
      supportedTypes: ['profile'],
      templates: {},
    };
    const prefs = makePrefs({ customWaypoints: [custom], waypointGroups: [] });
    const next = adoptWaypoint(prefs, 'custom:mu');

    expect(next.waypointGroups).toEqual([
      { id: 'custom', name: 'Custom', waypointIds: ['custom:mu'] },
    ]);
    expect(next.knownWaypointIds).not.toContain('custom:mu');
  });

  it('applies cleanly one id at a time, the way "Add all" folds them', () => {
    let prefs = makePrefs({
      waypointGroups: [{ id: 'publications', name: 'Reading', waypointIds: [] }],
      knownWaypointIds: WAYPOINT_ORDER.filter(
        id => id !== 'standardReader' && id !== 'taproot'
      ),
    });
    for (const w of newBuiltinWaypoints(prefs)) prefs = adoptWaypoint(prefs, w.id);

    expect(newBuiltinWaypoints(prefs)).toEqual([]);
    const visible = visibleWaypointIds(prefs);
    expect(visible.has('standardReader')).toBe(true);
    expect(visible.has('taproot')).toBe(true);
    // taproot is a dev tool; its group had to be created.
    expect(prefs.waypointGroups.map(g => g.id)).toEqual(['publications', 'devTools']);
  });
});

describe('markKnown', () => {
  it('clears the new flag without adding the waypoint anywhere', () => {
    const prefs = customizedPrefs();
    const next = markKnown(prefs, ['standardReader']);
    expect(newBuiltinWaypoints(next)).toEqual([]);
    expect(visibleWaypointIds(next).has('standardReader')).toBe(false);
    expect(next.waypointGroups).toEqual(prefs.waypointGroups);
  });

  it('ignores custom ids and returns the same object when nothing changes', () => {
    const prefs = makePrefs({ knownWaypointIds: [...WAYPOINT_ORDER] });
    expect(markKnown(prefs, ['custom:abc'])).toBe(prefs);
    expect(markKnown(prefs, ['bluepy'])).toBe(prefs);
  });
});
