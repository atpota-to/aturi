/**
 * Hand-authored release notes, surfaced by the "What's new" modal and the
 * header badge.
 *
 * Adding a release: prepend an entry to `RELEASES`. That's the whole ritual —
 * `LATEST_RELEASE_ID` and the unseen diff derive from the array, and
 * `DEFAULT_PREFERENCES.lastSeenReleaseId` picks up the new id automatically so
 * first-time visitors never get a backlog.
 *
 * An entry that ships a built-in waypoint should list its ids in
 * `waypointIds`. That's what turns a prose entry into an actionable one: the
 * UI renders an "Add to my waypoints" button wired to
 * `addWaypointsToDefaultGroups`. Waypoint ids are checked against the catalog
 * at render time, so a typo degrades to plain prose rather than a dead button.
 */

export type ReleaseEntry = {
  /** Stable id, unique within its release. Used as a React key. */
  id: string;
  title: string;
  body: string;
  /**
   * Built-in waypoint ids introduced by this entry. Presence of a valid id
   * is what makes the entry actionable.
   */
  waypointIds?: string[];
};

export type Release = {
  /**
   * Stable, human-meaningful id. Stored verbatim in preferences as the
   * "last seen" cursor, so never rewrite an id once it has shipped.
   */
  id: string;
  /** Shown under the heading, e.g. "August 2026". */
  label: string;
  entries: ReleaseEntry[];
};

/** Newest first. The order here is the order readers see. */
export const RELEASES: Release[] = [
  {
    id: '2026-08',
    label: 'August 2026',
    entries: [
      {
        id: 'impro',
        title: 'Impro joins the catalog',
        body: 'A from-scratch Bluesky client at impro.social, with its own take on posts, profiles, and lists.',
        waypointIds: ['impro'],
      },
    ],
  },
];

export const LATEST_RELEASE_ID: string = RELEASES[0]?.id ?? '';

/**
 * Releases the reader hasn't acknowledged yet, newest first.
 *
 * The cursor is deliberately forgiving. An empty or unrecognized id means we
 * can't place the reader in history — someone whose preferences predate this
 * feature, or whose stored id refers to a release that has since been renamed.
 * Rather than replaying the whole changelog at them, announce only the newest
 * release. Missing older news is a much cheaper failure than a wall of it.
 */
export function unseenReleases(lastSeenReleaseId: string | null | undefined): Release[] {
  if (RELEASES.length === 0) return [];
  if (!lastSeenReleaseId) return RELEASES.slice(0, 1);

  const index = RELEASES.findIndex((r) => r.id === lastSeenReleaseId);
  if (index === -1) return RELEASES.slice(0, 1);

  return RELEASES.slice(0, index);
}

/** Total entries across a list of releases — drives the badge's summary line. */
export function countEntries(releases: Release[]): number {
  return releases.reduce((total, release) => total + release.entries.length, 0);
}
