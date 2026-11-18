/**
 * Sorts an identity's backlink sources into the relationships a reader
 * recognises (followers, mentions, lists…) and the apps they come from.
 * Pure: no network IO, so the Backlinks tab and its tests share one copy.
 *
 * Constellation reports links as `collection` + record `path` pairs, and
 * one relationship is usually spread over many of them: @bsky.app is
 * followed through eight follow lexicons and mentioned through four
 * `app.bsky.feed.post` paths alone. There are two sets of rules: one for a
 * DID target (who follows, mentions or lists an account) and one for a
 * record target (what likes, answers or quotes a record).
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

export type RecordBacklinkRelation =
  | 'reply'
  | 'thread'
  | 'quote'
  | 'repost'
  | 'like'
  | 'mention'
  | 'item'
  | 'subscribe'
  | 'via'
  | 'other';

/**
 * Display order for a record's relationships. What was written in answer
 * comes first, since those links have something to read; the tallies follow,
 * then how the record is filed and found. "other" always comes last.
 */
export const RECORD_RELATION_ORDER: readonly RecordBacklinkRelation[] = [
  'reply',
  'thread',
  'quote',
  'repost',
  'like',
  'mention',
  'item',
  'subscribe',
  'via',
  'other',
];

/** Any richtext facet: a record names another in its text only to link it. */
const FACET_PATH = /facets\[/i;

/** Lexicons that are a tally on a subject, by the collection's last segment. */
const LIKE_NAME = /^(like|favou?rite|star|vote|upvote|reaction|recommend)$/i;
const REPOST_NAME = /^(repost|reshare|boost)$/i;
const COMMENT_NAME = /^(comment|reply)$/i;

/** `.via.uri` on a follow, `.joinedViaStarterPack.uri` on a profile. */
const VIA_PATH = /(^|\.)(via|joinedVia[A-Za-z]*)(\.|$)/;

/**
 * Fields that file a record under another without being named for its type:
 * a `site.standard.document` belongs to its publication through `.site`.
 * Keyed by the target collection's last segment.
 */
const OWNER_FIELD_ALIASES: Record<string, readonly string[]> = {
  publication: ['site'],
};

/**
 * A record files itself under another through one top-level field named for
 * what it belongs to: a list item's `.list`, a document's `.publication`, an
 * issue's `.repo`. So the field is compared with the target's own type.
 */
function isOwnerField(path: string, targetCollection: string | undefined): boolean {
  const field = /^\.([A-Za-z]+)(\.uri)?$/.exec(path)?.[1].toLowerCase();
  const type = targetCollection?.split('.').pop()?.toLowerCase();
  if (!field || !type) return false;
  return field === type || (OWNER_FIELD_ALIASES[type] ?? []).includes(field);
}

/**
 * The relationship one source expresses towards a record. `targetCollection`
 * is the record's own collection, which the "item" rule needs. First
 * matching rule wins, and anything unrecognised is `other`.
 *
 * A reply links its parent and the thread's root. On a root post those are
 * the same record, so the two paths are kept apart rather than merged:
 * "reply" is what answers the record directly, "thread" everything under it.
 */
export function recordRelationOf(
  collection: string,
  path: string,
  targetCollection?: string,
): RecordBacklinkRelation {
  const name = collection.split('.').pop() ?? '';
  if (FACET_PATH.test(path) || MENTION_PATH.test(path)) return 'mention';
  if (/^\.reply\.root(\.|$)/.test(path)) return 'thread';
  if (/^\.reply\.parent(\.|$)/.test(path) || COMMENT_NAME.test(name)) return 'reply';
  if (LIKE_NAME.test(name)) return 'like';
  if (REPOST_NAME.test(name)) return 'repost';
  if (/^\.embed\./.test(path)) return 'quote';
  if (VIA_PATH.test(path)) return 'via';
  if (/subscri/i.test(name)) return 'subscribe';
  if (name === 'listitem' || isOwnerField(path, targetCollection)) return 'item';
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

export type RelationBucket<R extends string = BacklinkRelation> = {
  relation: R;
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
 * Group sources by the relationship `classify` gives each, in `order`,
 * dropping empty buckets. Sources keep their relative order.
 */
function bucketBy<R extends string>(
  sources: readonly BacklinkSource[],
  classify: (source: BacklinkSource) => R,
  order: readonly R[],
): RelationBucket<R>[] {
  const buckets = new Map<R, RelationBucket<R>>();
  const apps = new Map<R, Map<string, RelationApp>>();
  for (const s of sources) {
    const relation = classify(s);
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
  return order.flatMap((r) => {
    const b = buckets.get(r);
    if (!b) return [];
    b.apps = [...apps.get(r)!.values()].sort((x, y) => y.count - x.count);
    return [b];
  });
}

/** An account's sources by relationship, in {@link RELATION_ORDER}. */
export function bucketSources(sources: readonly BacklinkSource[]): RelationBucket[] {
  return bucketBy(sources, (s) => relationOf(s.collection, s.path), RELATION_ORDER);
}

/**
 * A record's sources by relationship, in {@link RECORD_RELATION_ORDER}.
 * `targetCollection` is the collection of the record they point at.
 */
export function bucketRecordSources(
  sources: readonly BacklinkSource[],
  targetCollection: string,
): RelationBucket<RecordBacklinkRelation>[] {
  return bucketBy(
    sources,
    (s) => recordRelationOf(s.collection, s.path, targetCollection),
    RECORD_RELATION_ORDER,
  );
}
