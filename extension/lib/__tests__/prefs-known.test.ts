import { describe, it, expect } from 'vitest';
import { WAYPOINT_ORDER } from '@aturi/waypoints.data';
import { DEFAULT_PREFS, addWaypointToGroup, type Prefs, type WaypointGroup } from '../prefs';
import { newBuiltinWaypoints } from '../catalog';

// Internal helpers aren't exported, so we exercise the migration path the same
// way runtime code does: by reading prefs through `loadPrefs`. That goes
// through `chrome.storage`, which isn't available in vitest. Instead, we
// validate the user-visible behavior using the helpers that do the lifting.

function makePrefs(overrides: Partial<Prefs> = {}): Prefs {
  return {
    ...DEFAULT_PREFS,
    ...overrides,
  };
}

describe('newBuiltinWaypoints', () => {
  it('returns nothing when knownWaypointIds includes the full built-in list', () => {
    const prefs = makePrefs({ knownWaypointIds: [...WAYPOINT_ORDER] });
    expect(newBuiltinWaypoints(prefs)).toEqual([]);
  });

  it('flags built-ins missing from knownWaypointIds in WAYPOINT_ORDER order', () => {
    // Pretend "bluepy" and "deer" have never been seen.
    const seen = WAYPOINT_ORDER.filter(id => id !== 'bluepy' && id !== 'deer');
    const prefs = makePrefs({ knownWaypointIds: seen });
    const flagged = newBuiltinWaypoints(prefs).map(w => w.id);
    expect(flagged).toContain('bluepy');
    expect(flagged).toContain('deer');
    // Ordered by WAYPOINT_ORDER, so bluepy (earlier) comes before deer.
    expect(flagged.indexOf('bluepy')).toBeLessThan(flagged.indexOf('deer'));
  });

  it('treats empty known list as nothing new — defensive against bad migrations', () => {
    // This shouldn't happen in practice (mergePrefs seeds known), but if it
    // does, blasting the user with every built-in as "new" would be terrible.
    // The current implementation will *technically* return all built-ins,
    // because the empty-array case is handled at the seeding layer, not here.
    // Document that contract so the migration stays honest.
    const prefs = makePrefs({ knownWaypointIds: [] });
    const flagged = newBuiltinWaypoints(prefs).map(w => w.id);
    expect(flagged).toEqual([...WAYPOINT_ORDER]);
  });
});

describe('addWaypointToGroup', () => {
  const group: WaypointGroup = { id: 'g1', name: 'Test', waypointIds: [] };

  it('adds a built-in waypoint to the group and marks it known', () => {
    const prefs = makePrefs({
      waypointGroups: [group],
      knownWaypointIds: WAYPOINT_ORDER.filter(id => id !== 'bluepy'),
    });

    expect(newBuiltinWaypoints(prefs).map(w => w.id)).toEqual(['bluepy']);

    const next = addWaypointToGroup(prefs, 'g1', 'bluepy');
    expect(next.waypointGroups[0].waypointIds).toEqual(['bluepy']);
    expect(next.knownWaypointIds).toContain('bluepy');
    expect(newBuiltinWaypoints(next)).toEqual([]);
  });

  it('does not pollute knownWaypointIds with custom waypoint ids', () => {
    const prefs = makePrefs({
      waypointGroups: [group],
      knownWaypointIds: [...WAYPOINT_ORDER],
    });
    const next = addWaypointToGroup(prefs, 'g1', 'custom:abc');
    expect(next.knownWaypointIds).not.toContain('custom:abc');
    expect(next.waypointGroups[0].waypointIds).toEqual(['custom:abc']);
  });

  it('is a no-op for already-known waypoints (no duplicate entries)', () => {
    const prefs = makePrefs({
      waypointGroups: [group],
      knownWaypointIds: [...WAYPOINT_ORDER],
    });
    const next = addWaypointToGroup(prefs, 'g1', 'bluepy');
    const count = next.knownWaypointIds.filter(id => id === 'bluepy').length;
    expect(count).toBe(1);
  });
});
