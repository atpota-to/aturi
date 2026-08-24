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
  /**
   * Where an entry sends a reader who wants the thing it announces. A
   * root-relative path: the surfaces render it as a link that dismisses
   * itself on the way out, so an external URL would leave the reader
   * somewhere this app can't close behind them.
   */
  href?: string;
  /** Label for {@link href}. Ignored without one. */
  linkLabel?: string;
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
    id: '2026-08-space-admin',
    label: 'August 2026',
    entries: [
      {
        id: 'space-admin',
        title: 'Run your own spaces',
        body: 'Spaces are no longer read-only here. Create one from your spaces page, choose who may join and which applications may reach it, add and remove members, and delete it when it has served its purpose. Managing a space is its own permission, so tick it at sign-in; everything is anchored on your own account, and only its owner can administer a space.',
        href: '/explore/spaces',
        linkLabel: 'Open spaces',
      },
    ],
  },
  {
    // A second August release rather than another entry under `2026-08`: the
    // seen-cursor is per release, so anyone who already read that one would
    // never be shown an entry added to it.
    id: '2026-08-spaces',
    label: 'August 2026',
    entries: [
      {
        id: 'spaces',
        title: 'Atproto spaces',
        body: 'The explorer now reads permissioned data: the spaces you write to, the collections in them, and the records inside. Your repo page lists them below the public half, and every address links onward the way public records do. Spaces are an alpha, so this needs an account on a server running that build.',
        href: '/explore/spaces',
        linkLabel: 'Open spaces',
      },
    ],
  },
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
