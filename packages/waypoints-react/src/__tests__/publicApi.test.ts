import { describe, expect, it } from 'vitest';
import * as core from '@aturi.to/waypoints';
import * as pkg from '../index';

/*
 * The entry point is the package's actual contract, and until now nothing
 * checked it: `tsc --noEmit` verifies that each module typechecks, not that
 * index.ts still re-exports it. Removing a name here is a breaking change for
 * every consumer, so it should take a deliberate edit to this list.
 *
 * This asserts presence, not an exact set — adding an export is not breaking,
 * so a snapshot of the full surface would only generate churn.
 */

const DOCUMENTED = [
  'useWaypoints',
  'WaypointButton',
  'WaypointList',
  'WaypointPicker',
  'cx',
  'WAYPOINT_ICONS',
  'AnisotaLogo',
] as const;

describe('public API', () => {
  it.each(DOCUMENTED)('exports %s', (name) => {
    expect(pkg).toHaveProperty(name);
    expect((pkg as Record<string, unknown>)[name]).toBeTruthy();
  });

  it('re-exports the whole core package', () => {
    // The README tells consumers they need only one install; that promise is
    // `export * from '@aturi.to/waypoints'` in index.ts and nothing else.
    const missing = Object.keys(core).filter(
      (name) => !Object.prototype.hasOwnProperty.call(pkg, name),
    );
    expect(missing).toEqual([]);
  });

  it('exports components as functions, not objects', () => {
    for (const name of ['WaypointButton', 'WaypointList', 'WaypointPicker']) {
      expect(typeof (pkg as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
