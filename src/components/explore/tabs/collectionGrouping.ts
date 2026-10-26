export type SubGroup = {
  /** 3rd NSID segment, e.g. "feed", "graph", "actor". */
  key: string;
  /** Composite key used as a stable React + collapsed-state id. */
  fullKey: string;
  items: string[];
};

export type MajorGroup = {
  /** First two NSID segments, e.g. "app.bsky", "is.dame". */
  key: string;
  /** 3-segment NSIDs that live directly under the major group (no sub). */
  directItems: string[];
  /** 4+ segment NSIDs grouped by their 3rd segment. */
  subgroups: SubGroup[];
  /** Total leaf NSIDs across direct + all sub-groups. */
  totalCount: number;
};

/**
 * Two-level hierarchical grouping.
 *
 *   `app.bsky.feed.post`        → major `app.bsky`, sub `feed`, leaf
 *   `app.bsky.feed.post.shit`   → major `app.bsky`, sub `feed`, leaf
 *   `app.bsky.actor.profile`    → major `app.bsky`, sub `actor`, leaf
 *   `is.dame.now`               → major `is.dame`, no sub, direct leaf
 *
 * For NSIDs with fewer than 4 segments there's no third segment to sub-group
 * by, so they sort under the major group as direct leaves above the sub-groups.
 */
export function groupHierarchically(list: string[], filterStr: string): MajorGroup[] {
  const f = filterStr.trim().toLowerCase();
  const filtered = f ? list.filter((nsid) => nsid.toLowerCase().includes(f)) : list;

  // Two-pass: bucket by major, then by sub within each major.
  const majors = new Map<
    string,
    { direct: string[]; subs: Map<string, string[]> }
  >();
  for (const nsid of filtered) {
    const segs = nsid.split('.');
    const major = segs.length >= 2 ? `${segs[0]}.${segs[1]}` : nsid;
    if (!majors.has(major)) majors.set(major, { direct: [], subs: new Map() });
    const bucket = majors.get(major)!;
    if (segs.length >= 4) {
      const subKey = segs[2];
      if (!bucket.subs.has(subKey)) bucket.subs.set(subKey, []);
      bucket.subs.get(subKey)!.push(nsid);
    } else {
      bucket.direct.push(nsid);
    }
  }

  // Sort + materialize. Sub-groups with a single item are hoisted up to
  // the major's direct list — a collapsible group containing one row is
  // pure wrapper noise.
  return Array.from(majors.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([majorKey, bucket]) => {
      const hoistedDirect = [...bucket.direct];
      const subgroups: SubGroup[] = [];
      for (const [subKey, items] of bucket.subs.entries()) {
        if (items.length === 1) {
          hoistedDirect.push(items[0]);
        } else {
          subgroups.push({
            key: subKey,
            fullKey: `${majorKey}.${subKey}`,
            items: items.sort(),
          });
        }
      }
      subgroups.sort((a, b) => a.key.localeCompare(b.key));
      const totalCount =
        hoistedDirect.length + subgroups.reduce((acc, s) => acc + s.items.length, 0);
      return {
        key: majorKey,
        directItems: hoistedDirect.sort(),
        subgroups,
        totalCount,
      };
    });
}

/**
 * Open-state key for a pinned group block, namespaced so it can't collide
 * with a main-list group key of the same prefix.
 */
export function pinnedKey(entry: string): string {
  return `pinned:${entry}`;
}
