import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
} from '@aturi.to/waypoints';
import { WAYPOINT_ICONS } from '../waypointIcons';

/*
 * Step 3 of the add-a-waypoint checklist in AGENTS.md — "icon keyed by id in
 * WAYPOINT_ICONS" — is the one step that fails silently: a waypoint with no
 * icon still builds, still typechecks (WAYPOINT_ICONS is Record<string, …>)
 * and still renders, just with a blank icon slot. The core package cannot
 * check this because the icon catalog lives here, so this is the only place
 * the two halves are compared.
 */

describe('icon parity with the core catalog', () => {
  it('has an icon for every id in WAYPOINT_ORDER', () => {
    const missing = WAYPOINT_ORDER.filter(
      (id) => !Object.prototype.hasOwnProperty.call(WAYPOINT_ICONS, id),
    );
    expect(missing).toEqual([]);
  });

  it('has no icon keyed to an id the catalog does not define', () => {
    const known = new Set<string>(WAYPOINT_ORDER);
    const orphans = Object.keys(WAYPOINT_ICONS).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it('keeps WAYPOINT_ORDER and WAYPOINT_DESTINATIONS_DATA in agreement', () => {
    // Guards the other direction of the same checklist: an entry added to the
    // data map but never appended to WAYPOINT_ORDER never renders at all.
    expect([...WAYPOINT_ORDER].sort()).toEqual(
      Object.keys(WAYPOINT_DESTINATIONS_DATA).sort(),
    );
  });

  it('renders every icon to non-empty markup', () => {
    // A `null`/`undefined` value would satisfy the key checks above while still
    // leaving a blank icon slot in every row.
    const empty: string[] = [];
    for (const id of WAYPOINT_ORDER) {
      const icon = WAYPOINT_ICONS[id];
      if (!isValidElement(icon)) {
        empty.push(id);
        continue;
      }
      if (renderToStaticMarkup(icon).trim() === '') empty.push(id);
    }
    expect(empty).toEqual([]);
  });
});
