/**
 * Sorts an identity's backlink sources into the relationships a reader
 * recognises (followers, mentions, lists…) and the apps they come from.
 * Pure: no network IO, so the Backlinks tab and its tests share one copy.
 *
 * Constellation reports links as `collection` + record `path` pairs, and
 * one relationship is usually spread over many of them: @bsky.app is
 * followed through eight follow lexicons and mentioned through four
 * `app.bsky.feed.post` paths alone. The rules below are written for DID
 * targets. A record target (likes, reposts, replies) needs its own set.
 */

import type { BacklinkSource } from './constellation';
import { appDomainFor, groupPrefix, namespaceKey } from '../ufos/nsid';

export type BacklinkRelation =
  | 'follow'
  | 'mention'
  | 'list'
  | 'block'
  | 'verify'
  | 'endorse'
  | 'embed'
  | 'other';

/** Display order of the relationship tiles; "other" always comes last. */
export const RELATION_ORDER: readonly BacklinkRelation[] = [
  'follow',
  'mention',
  'list',
  'block',
  'verify',
  'endorse',
  'embed',
  'other',
];

/**
 * Paths that hold a denormalised copy of someone's details rather than a
 * deliberate link: a starter pack embedding a feed view (`.feeds[].creator`),
 * a reply carrying its parent's author, label and verification views. They
 * are checked before the follow / block / verification rules, so a starter
 * pack quoting a verification is a copy, not a verification.
 */
const EMBED_PATH = /(\.creator\.|\.author\.|labels\[\]|verifications\[\]|^\.reply\.|^\.embed\.)/;

/**
 * Richtext facets point at a DID only to mention it. Most lexicons name the
 * feature (`#mention`, `#didMention`); some records omit the type and leave
 * `.facets[].features[].did`, which is still a mention.
 */
const MENTION_PATH = /mention|facets\[[^\]]*\]\.features\[[^\]]*\]\.did$/i;

/** Array fields that make a record a roster of accounts. */
const ROSTER_PATH = /\.(users|members|streamers)\[\]$/;

const ENDORSE_WORDS = /endorse|vouch|trust|friends|top8|shoutout|contact|partners|vote/i;

/**
 * The relationship one source expresses. First matching rule wins; anything
 * unrecognised is `other`, so a new lexicon is always listed somewhere.
 */
export function relationOf(collection: string, path: string): BacklinkRelation {
  const name = collection.split('.').pop() ?? '';
  if (MENTION_PATH.test(path)) return 'mention';
  if (EMBED_PATH.test(path)) return 'embed';
  if (/follow$/i.test(name) && /^\.(subject|did|subjectDid)$/.test(path)) return 'follow';
  if (/block$/i.test(name)) return 'block';
  if (/verif|certif/i.test(collection + path)) return 'verify';
  if (name === 'listitem' || ROSTER_PATH.test(path)) return 'list';
  if (ENDORSE_WORDS.test(collection + path)) return 'endorse';
  return 'other';
}

/**
 * Namespaces whose app has a mark in the waypoint catalogue, keyed by the
 * NSID's first two segments. The value is a `WAYPOINT_ICONS` id. Only
 * namespaces that app owns are listed: `site.standard` documents are written
 * by several publishing apps, so they fall through to their domain.
 */
const NAMESPACE_WAYPOINTS: Record<string, { name: string; waypoint: string }> = {
  'app.bsky': { name: 'Bluesky', waypoint: 'bluesky' },
  'sh.tangled': { name: 'Tangled', waypoint: 'tangled' },
  'place.stream': { name: 'Streamplace', waypoint: 'streamplace' },
  'pub.leaflet': { name: 'Leaflet', waypoint: 'leaflet' },
  'app.blento': { name: 'Blento', waypoint: 'blento' },
  'id.sifa': { name: 'Sifa', waypoint: 'sifa' },
  'blog.pckt': { name: 'pckt', waypoint: 'pckt' },
  'app.offprint': { name: 'Offprint', waypoint: 'offprint' },
  'app.witchsky': { name: 'Witchsky', waypoint: 'witchsky' },
  'at.margin': { name: 'Margin', waypoint: 'margin' },
  'social.grain': { name: 'Grain', waypoint: 'grain' },
  'social.popfeed': { name: 'Popfeed', waypoint: 'popfeed' },
};

export type BacklinkApp = {
  /** Grouping key: the app's domain (`bsky.app`), or its namespace when none. */
  key: string;
  /** What the chip says: a known app's name, otherwise the domain. */
  name: string;
  /** `WAYPOINT_ICONS` id when the app has a mark. */
  waypoint: string | null;
};

/** The app a collection belongs to, by the reversed-domain convention. */
export function appForCollection(collection: string): BacklinkApp {
  const known = NAMESPACE_WAYPOINTS[namespaceKey(collection)];
  const domain = appDomainFor(groupPrefix(collection));
  const key = domain ?? namespaceKey(collection);
  return { key, name: known?.name ?? key, waypoint: known?.waypoint ?? null };
}

/**
 * A record path with the NSIDs inside its type qualifiers shortened:
 * `[app.bsky.richtext.facet#mention]` -> `[#mention]`,
 * `[pub.leaflet.pages.linearDocument]` -> `[linearDocument]`. With
 * `keepAuthority` the namespace stays (`[com.atproto…#mention]`), for
 * telling apart two paths that would otherwise read the same.
 */
export function shortBacklinkPath(path: string, keepAuthority = false): string {
  if (path === '.') return '(record root)';
  return path.replace(/\[([A-Za-z0-9.-]+)(#[A-Za-z0-9]+)?\]/g, (_m, nsid: string, frag?: string) => {
    const last = frag ?? nsid.split('.').pop() ?? nsid;
    return keepAuthority ? `[${namespaceKey(nsid)}…${last}]` : `[${last}]`;
  });
}

/**
 * Short labels for every path of one collection, falling back to the
 * namespaced form where two would collide: `app.bsky.feed.post` mentions by
 * `app.bsky.richtext.facet#mention` and by `com.atproto.richtext.facet#mention`
 * both shorten to `[#mention]`.
 */
export function backlinkPathLabels(paths: readonly string[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const p of paths) {
    const s = shortBacklinkPath(p);
    seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  return new Map(
    paths.map((p) => {
      const s = shortBacklinkPath(p);
      return [p, (seen.get(s) ?? 0) > 1 ? shortBacklinkPath(p, true) : s];
    }),
  );
}

export type RelationApp = { app: BacklinkApp; count: number };

export type RelationBucket = {
  relation: BacklinkRelation;
  /** Links across every source in the bucket. */
  count: number;
  /**
   * Distinct linking accounts, summed per source. An account that links
   * through two sources (follows on two apps) counts twice; Constellation
   * does not report distinct accounts across sources.
   */
  accounts: number;
  /** Most links first, the order Constellation's counts give. */
  sources: BacklinkSource[];
  /** Apps behind the bucket, most links first. */
  apps: RelationApp[];
};

/**
 * Group sources by relationship, in {@link RELATION_ORDER}, dropping empty
 * buckets. Sources keep their relative order.
 */
export function bucketSources(sources: readonly BacklinkSource[]): RelationBucket[] {
  const buckets = new Map<BacklinkRelation, RelationBucket>();
  const apps = new Map<BacklinkRelation, Map<string, RelationApp>>();
  for (const s of sources) {
    const relation = relationOf(s.collection, s.path);
    let b = buckets.get(relation);
    if (!b) {
      b = { relation, count: 0, accounts: 0, sources: [], apps: [] };
      buckets.set(relation, b);
      apps.set(relation, new Map());
    }
    b.count += s.count;
    b.accounts += s.distinctDids ?? 0;
    b.sources.push(s);
    const app = appForCollection(s.collection);
    const byApp = apps.get(relation)!;
    const entry = byApp.get(app.key) ?? { app, count: 0 };
    entry.count += s.count;
    byApp.set(app.key, entry);
  }
  return RELATION_ORDER.flatMap((r) => {
    const b = buckets.get(r);
    if (!b) return [];
    b.apps = [...apps.get(r)!.values()].sort((x, y) => y.count - x.count);
    return [b];
  });
}
