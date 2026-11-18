/**
 * The mutuals' blocks tool's logic.
 *
 * A block on Bluesky is a public record: `app.bsky.graph.block`, written in
 * the blocker's own repository, naming the account blocked. So the accounts
 * an account's mutuals block can be read straight from their repositories,
 * and an account that many of them block independently stands out.
 *
 * The run, in order (the requests are in mutualsClient.ts):
 *
 *   1. Who the account follows, from the AppView, with a profile for each.
 *   2. Which of those follow back. Either every follower is listed and the
 *      two sets are intersected, or the follows are checked thirty at a time
 *      with `getRelationships`; `mutualStrategy` picks whichever costs
 *      fewer requests for this account.
 *   3. Each mutual's block records, read from its own PDS, every page. Each
 *      blocked account is tallied against the mutuals that block it.
 *   4. Each mutual's `app.bsky.graph.listblock` records: the moderation
 *      lists it blocks wholesale. They are counted per list, not expanded
 *      into their members, which would take a request per hundred members
 *      of every list.
 *
 * What comes out is a tally from blocked account to the mutuals blocking
 * it. Everything the page draws is a view of that tally at a threshold: the
 * distribution of counts, the ranked accounts, and the map of who blocks
 * whom. Saving writes the chosen accounts into a new moderation list in the
 * signed-in account's repository.
 *
 * Everything here is pure.
 */

import { APPLY_WRITES_MAX } from '@/components/explore/collectionListHelpers';
import { countGraphemes } from './share';
import { NOT_LABELLED, parseSubjectInput } from './labels';

export { APPLY_WRITES_MAX };

export const BLOCK_COLLECTION = 'app.bsky.graph.block';
export const LISTBLOCK_COLLECTION = 'app.bsky.graph.listblock';
export const LIST_COLLECTION = 'app.bsky.graph.list';
export const LISTITEM_COLLECTION = 'app.bsky.graph.listitem';
export const MODLIST_PURPOSE = 'app.bsky.graph.defs#modlist';

/** `getFollows` and `getFollowers` return at most this many a page. */
export const GRAPH_PAGE_SIZE = 100;
/**
 * Pages of follows, or of followers, read at most: 20,000 accounts. An
 * account following more than that is rare, and its mutuals are reported as
 * partial rather than read without end.
 */
export const GRAPH_PAGE_LIMIT = 200;
/** `getRelationships` takes at most this many accounts a request. */
export const RELATIONSHIPS_CHUNK = 30;

/** A create costs three of a PDS's write points (writeThrottle.ts). */
export const CREATE_POINTS = 3;

/** The lexicon's limits for a list's name (UTF-8 bytes) and description (graphemes). */
export const LIST_NAME_MAX_BYTES = 64;
export const LIST_DESCRIPTION_MAX_GRAPHEMES = 300;

/* -------------------------------------------------------------------------- *
 * Input
 * -------------------------------------------------------------------------- */

export type AccountInput = { ok: true; actor: string } | { ok: false; reason: string };

const ACCOUNTS_ONLY = 'Mutuals belong to accounts. Enter a handle or a DID.';

/** A handle, a DID, an at:// URI of an account, or a profile link. */
export function parseAccountInput(raw: string): AccountInput {
  if (!raw.trim()) return { ok: false, reason: 'Enter a handle or a DID.' };
  const input = parseSubjectInput(raw);
  if (!input.ok) return { ok: false, reason: input.reason === NOT_LABELLED ? ACCOUNTS_ONLY : input.reason };
  if (input.target.kind !== 'account') return { ok: false, reason: ACCOUNTS_ONLY };
  return { ok: true, actor: input.target.actor };
}

/** The threshold as the query string holds it. Null when absent or not a whole number from 1. */
export function parseThreshold(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 ? value : null;
}

/* -------------------------------------------------------------------------- *
 * Finding the mutuals
 * -------------------------------------------------------------------------- */

/**
 * How to tell which follows follow back.
 *
 *   `followers`      list every follower and intersect. A request per
 *                    hundred followers.
 *   `relationships`  ask about the follows thirty at a time. A request per
 *                    thirty follows.
 *
 * An account with a modest following is cheapest to read through its
 * followers; one with a large following, through its follows. Followers past
 * what can be paged through are never complete, so they rule the first out.
 */
export type MutualStrategy = 'followers' | 'relationships';

export function mutualStrategy(follows: number, followers: number): MutualStrategy {
  if (followers > GRAPH_PAGE_SIZE * GRAPH_PAGE_LIMIT) return 'relationships';
  const viaFollowers = Math.ceil(followers / GRAPH_PAGE_SIZE);
  const viaRelationships = Math.ceil(Math.min(follows, GRAPH_PAGE_SIZE * GRAPH_PAGE_LIMIT) / RELATIONSHIPS_CHUNK);
  return viaFollowers <= viaRelationships ? 'followers' : 'relationships';
}

/** An account as the page shows it. */
export type Person = {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
};

/** `handle.invalid` is what the AppView says when a handle no longer resolves. */
export function cleanHandle(handle: string | null | undefined): string | null {
  return handle && handle !== 'handle.invalid' ? handle : null;
}

/** The AppView's full-size avatar URL, swapped for its thumbnail where it is one. */
export function avatarThumb(url: string | null): string | null {
  if (!url) return null;
  return url.replace('/img/avatar/plain/', '/img/avatar_thumbnail/plain/');
}

/* -------------------------------------------------------------------------- *
 * Reading the blocks
 * -------------------------------------------------------------------------- */

/** Where a mutual's reading has got to. */
export type MutualState =
  | { status: 'queued' }
  | { status: 'reading'; blocks: number }
  | { status: 'done'; blocks: number; listBlocks: number }
  /**
   * Its repository was not read to the end: gone, deactivated, its PDS did
   * not answer, or (`stopped`) the scan was stopped first.
   */
  | { status: 'skipped'; blocks: number; reason: string; stopped?: boolean };

const DID_SHAPE = /^did:[a-z]+:[a-zA-Z0-9._:%-]{1,2048}$/;

/** The account a block record names, or null for a record that is not one. */
export function readBlockSubject(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const subject = (value as { subject?: unknown }).subject;
  return typeof subject === 'string' && DID_SHAPE.test(subject) ? subject : null;
}

/** The list a listblock record names, or null for a record that is not one. */
export function readListBlockSubject(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const subject = (value as { subject?: unknown }).subject;
  return typeof subject === 'string' && /^at:\/\/did:[^/]+\/app\.bsky\.graph\.list\/[^/]+$/.test(subject)
    ? subject
    : null;
}

/** Blocked account (or list) to the indexes of the mutuals blocking it. */
export type Tally = Map<string, number[]>;

/**
 * Count one record against one mutual. `seen` holds what this mutual has
 * already been counted for: an account blocked twice by the same person, by
 * two records, is still one person's block. Returns whether it was counted.
 */
export function tallyBlock(tally: Tally, seen: Set<string>, mutual: number, subject: string): boolean {
  if (seen.has(subject)) return false;
  seen.add(subject);
  const blockers = tally.get(subject);
  if (blockers) blockers.push(mutual);
  else tally.set(subject, [mutual]);
  return true;
}

/* -------------------------------------------------------------------------- *
 * The distribution
 * -------------------------------------------------------------------------- */

/**
 * How many accounts are blocked by exactly k mutuals, at index k. Index 0
 * is always 0, so the array's length is one more than the highest count.
 */
export function histogram(tally: Tally, exclude?: ReadonlySet<string>): number[] {
  const counts: number[] = [0];
  for (const [subject, blockers] of tally) {
    if (exclude?.has(subject)) continue;
    const k = blockers.length;
    while (counts.length <= k) counts.push(0);
    counts[k] += 1;
  }
  return counts;
}

/** Accounts blocked by at least `threshold` mutuals. */
export function countAtLeast(counts: readonly number[], threshold: number): number {
  let total = 0;
  for (let k = Math.max(1, threshold); k < counts.length; k++) total += counts[k];
  return total;
}

/** The most mutuals blocking any one account. 0 when nothing is blocked. */
export function highestCount(counts: readonly number[]): number {
  for (let k = counts.length - 1; k >= 1; k--) if (counts[k] > 0) return k;
  return 0;
}

export type Bin = {
  /** The lowest and highest count the bin covers, inclusive. */
  from: number;
  to: number;
  /** Accounts in it. */
  count: number;
};

/**
 * The distribution in at most `maxBins` columns, one count per column while
 * it fits and equal ranges once it does not. Runs to the highest count, so
 * the last column always holds something.
 */
export function histogramBins(counts: readonly number[], maxBins = 40): Bin[] {
  const top = highestCount(counts);
  if (top === 0) return [];
  const width = Math.max(1, Math.ceil(top / maxBins));
  const bins: Bin[] = [];
  for (let from = 1; from <= top; from += width) {
    const to = Math.min(top, from + width - 1);
    let count = 0;
    for (let k = from; k <= to; k++) count += counts[k] ?? 0;
    bins.push({ from, to, count });
  }
  return bins;
}

/**
 * A starting threshold: one in twenty of the mutuals read, from 2 to 10,
 * lowered until at least one account meets it. Two mutuals blocking the same
 * account is the least that says anything; ten is enough that the list is
 * short for anyone.
 */
export function suggestThreshold(mutualsRead: number, counts: readonly number[]): number {
  let threshold = Math.min(10, Math.max(2, Math.ceil(mutualsRead / 20)));
  while (threshold > 1 && countAtLeast(counts, threshold) === 0) threshold -= 1;
  return threshold;
}

/* -------------------------------------------------------------------------- *
 * The ranked accounts
 * -------------------------------------------------------------------------- */

export type Candidate = { did: string; blockers: readonly number[] };

/** Accounts blocked by at least `threshold` mutuals, most blocked first. */
export function rankCandidates(tally: Tally, threshold: number, exclude?: ReadonlySet<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const [did, blockers] of tally) {
    if (blockers.length >= threshold && !exclude?.has(did)) out.push({ did, blockers });
  }
  return out.sort((a, b) => b.blockers.length - a.blockers.length || (a.did < b.did ? -1 : a.did > b.did ? 1 : 0));
}

/** What the scanned account already has to do with a candidate. */
export type CandidateFlags = {
  /** It follows the candidate. */
  followed: boolean;
  /** The candidate is one of its mutuals. */
  mutual: boolean;
  /** It already blocks the candidate. */
  blocked: boolean;
  /** The AppView has no profile for the candidate: deleted, deactivated or taken down. */
  missing: boolean;
};

/**
 * Whether a candidate starts out ticked for the list. An account the person
 * follows, or a mutual, is something they chose, and a missing account
 * cannot be shown to anyone; those start unticked. One already blocked stays
 * ticked: the list is also for sharing.
 */
export function selectedByDefault(flags: CandidateFlags): boolean {
  return !flags.followed && !flags.mutual && !flags.missing;
}

/* -------------------------------------------------------------------------- *
 * The map
 * -------------------------------------------------------------------------- */

export type OrbitLayout = {
  /** Angles in radians from 0 (12 o'clock), clockwise. */
  targets: { did: string; angle: number }[];
  mutuals: { index: number; angle: number; degree: number }[];
};

const TAU = Math.PI * 2;

function normalize(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

/** The mean direction of some angles. Falls back to `fallback` when they cancel out. */
function circularMean(angles: readonly number[], fallback: number): number {
  let x = 0;
  let y = 0;
  for (const a of angles) {
    x += Math.cos(a);
    y += Math.sin(a);
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return fallback;
  return normalize(Math.atan2(y, x));
}

/**
 * Space items evenly around the circle in the order of their wanted angles,
 * turned so that, on average, each lands as near its wanted angle as it can.
 */
function spread<T>(items: { item: T; want: number }[]): { item: T; angle: number }[] {
  const n = items.length;
  if (n === 0) return [];
  const sorted = [...items].sort((a, b) => a.want - b.want);
  const step = TAU / n;
  const phase = circularMean(
    sorted.map((entry, i) => entry.want - i * step),
    0,
  );
  return sorted.map((entry, i) => ({ item: entry.item, angle: normalize(phase + i * step) }));
}

/**
 * Place blocked accounts on an outer ring and the mutuals blocking them on
 * an inner one, so the lines between them cross as little as they can.
 *
 * The usual barycentre method, on a circle: mutuals start grouped by the
 * accounts they block, then each ring in turn is sorted by the
 * mean direction of its neighbours on the other and spread evenly again. A
 * group of mutuals blocking the same accounts ends up facing them. A few
 * rounds settle it; the result is the same for the same input.
 */
export function orbitLayout(targets: readonly Candidate[], rounds = 6): OrbitLayout {
  const degree = new Map<number, number>();
  for (const target of targets) for (const m of target.blockers) degree.set(m, (degree.get(m) ?? 0) + 1);

  // Start the mutuals in the order they first appear among the accounts,
  // which are ranked: the blockers of one account start side by side. Any
  // order that scatters a group around the ring would let its pulls cancel.
  const mutualOrder: number[] = [];
  const placed = new Set<number>();
  for (const target of targets) {
    for (const m of target.blockers) {
      if (placed.has(m)) continue;
      placed.add(m);
      mutualOrder.push(m);
    }
  }
  let mutualAngle = new Map(mutualOrder.map((m, i) => [m, (i * TAU) / Math.max(1, mutualOrder.length)]));
  let targetAngle = new Map<string, number>();

  for (let round = 0; round < Math.max(1, rounds); round++) {
    targetAngle = new Map(
      spread(
        targets.map((target, i) => ({
          item: target.did,
          want: circularMean(
            target.blockers.map((m) => mutualAngle.get(m) ?? 0),
            (i * TAU) / Math.max(1, targets.length),
          ),
        })),
      ).map(({ item, angle }) => [item, angle]),
    );

    const neighbours = new Map<number, number[]>();
    for (const target of targets) {
      const angle = targetAngle.get(target.did) ?? 0;
      for (const m of target.blockers) {
        const list = neighbours.get(m);
        if (list) list.push(angle);
        else neighbours.set(m, [angle]);
      }
    }
    mutualAngle = new Map(
      spread(
        mutualOrder.map((m) => ({ item: m, want: circularMean(neighbours.get(m) ?? [], mutualAngle.get(m) ?? 0) })),
      ).map(({ item, angle }) => [item, angle]),
    );
  }

  return {
    targets: targets.map((target) => ({ did: target.did, angle: targetAngle.get(target.did) ?? 0 })),
    mutuals: mutualOrder.map((index) => ({ index, angle: mutualAngle.get(index) ?? 0, degree: degree.get(index) ?? 0 })),
  };
}

/* -------------------------------------------------------------------------- *
 * Block lists
 * -------------------------------------------------------------------------- */

export type ListSubscription = { uri: string; subscribers: readonly number[] };

/** Lists blocked by at least `min` mutuals, most subscribed first. */
export function rankListBlocks(listBlocks: Tally, min = 1): ListSubscription[] {
  return [...listBlocks]
    .filter(([, subscribers]) => subscribers.length >= min)
    .map(([uri, subscribers]) => ({ uri, subscribers }))
    .sort((a, b) => b.subscribers.length - a.subscribers.length || (a.uri < b.uri ? -1 : 1));
}

/* -------------------------------------------------------------------------- *
 * Saving as a moderation list
 * -------------------------------------------------------------------------- */

const utf8 = new TextEncoder();

/** Why a list name will not do, or null when it will. */
export function listNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the list a name.';
  if (utf8.encode(trimmed).length > LIST_NAME_MAX_BYTES) return 'That name is too long for a list.';
  return null;
}

/** Why a description will not do, or null when it will. */
export function listDescriptionProblem(description: string): string | null {
  const graphemes = countGraphemes(description.trim());
  if (graphemes > LIST_DESCRIPTION_MAX_GRAPHEMES) {
    return `The description is ${graphemes} characters; a list allows ${LIST_DESCRIPTION_MAX_GRAPHEMES}.`;
  }
  return null;
}

export const DEFAULT_LIST_NAME = 'Blocked by my mutuals';

/** What the list says about itself, until the person changes it. */
export function defaultListDescription(threshold: number, mutualsRead: number, date: Date): string {
  const day = date.toISOString().slice(0, 10);
  const who = threshold === 1 ? 'at least one' : `at least ${threshold}`;
  return `Accounts blocked by ${who} of the ${mutualsRead.toLocaleString('en-US')} mutuals I checked on ${day}, found with aturi.to/tools/mutuals.`;
}

export type ListRecord = {
  $type: typeof LIST_COLLECTION;
  purpose: typeof MODLIST_PURPOSE;
  name: string;
  description?: string;
  createdAt: string;
};

export function listRecord(name: string, description: string, createdAt: string): ListRecord {
  const record: ListRecord = { $type: LIST_COLLECTION, purpose: MODLIST_PURPOSE, name: name.trim(), createdAt };
  const text = description.trim();
  if (text) record.description = text;
  return record;
}

export type ListItemCreate = {
  $type: 'com.atproto.repo.applyWrites#create';
  collection: typeof LISTITEM_COLLECTION;
  value: { $type: typeof LISTITEM_COLLECTION; subject: string; list: string; createdAt: string };
};

/** One applyWrites create per account, for a list. */
export function listItemWrites(list: string, subjects: readonly string[], createdAt: string): ListItemCreate[] {
  return subjects.map((subject) => ({
    $type: 'com.atproto.repo.applyWrites#create',
    collection: LISTITEM_COLLECTION,
    value: { $type: LISTITEM_COLLECTION, subject, list, createdAt },
  }));
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Write points a list of `members` costs: the list, each member, and the block if asked for. */
export function savePoints(members: number, block: boolean): number {
  return (1 + members + (block ? 1 : 0)) * CREATE_POINTS;
}

/** The list's page on Bluesky. Null for a URI that is not a list. */
export function bskyListUrl(listUri: string): string | null {
  const match = listUri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.graph\.list\/([^/]+)$/);
  return match ? `https://bsky.app/profile/${match[1]}/lists/${match[2]}` : null;
}

/* -------------------------------------------------------------------------- *
 * The summary
 * -------------------------------------------------------------------------- */

/** "1,204 accounts are blocked by at least 3 of 312 mutuals." */
export function summary(matching: number, threshold: number, mutualsRead: number): string {
  const accounts = matching === 1 ? '1 account is' : `${matching.toLocaleString('en-US')} accounts are`;
  const mutuals = mutualsRead === 1 ? '1 mutual' : `${mutualsRead.toLocaleString('en-US')} mutuals`;
  const least = threshold <= 1 ? 'at least one' : `at least ${threshold.toLocaleString('en-US')}`;
  return `${accounts} blocked by ${least} of ${mutuals}`;
}

/* -------------------------------------------------------------------------- *
 * Keeping a scan across sign-in
 * -------------------------------------------------------------------------- */

/**
 * Signing in leaves the page for the account's authorization server and
 * comes back to it, which would otherwise throw away a scan that took a
 * minute or more. So a finished scan is kept in session storage, slimmed:
 * accounts only one mutual blocks are usually most of the tally and are
 * never worth a list on their own, so they are counted in the distribution
 * but not kept by name.
 */
export const SNAPSHOT_VERSION = 1;
/** A snapshot older than this is a different afternoon's network. */
export const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
/** Accounts kept by name need at least this many blockers. */
export const SNAPSHOT_MIN_BLOCKERS = 2;

export type ScanSnapshot = {
  v: typeof SNAPSHOT_VERSION;
  /** The input it answered, lower-cased, and the DID it resolved to. */
  actor: string;
  did: string;
  savedAt: number;
  account: Person;
  mutuals: Person[];
  states: MutualState[];
  follows: string[];
  ownBlocks: string[] | null;
  /** [blocked DID, mutual indexes], for accounts with SNAPSHOT_MIN_BLOCKERS or more. */
  tally: [string, number[]][];
  /** How many accounts each count of mutuals blocks, as `histogram` returns it, before slimming. */
  counts: number[];
  listBlocks: [string, number[]][];
  blocksRead: number;
  stopped: boolean;
  partialMutuals: boolean;
};

export function slimTally(tally: Tally): [string, number[]][] {
  const out: [string, number[]][] = [];
  for (const [did, blockers] of tally) if (blockers.length >= SNAPSHOT_MIN_BLOCKERS) out.push([did, blockers]);
  return out;
}

function isPerson(value: unknown): value is Person {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  const optional = (v: unknown) => v === null || typeof v === 'string';
  return typeof p.did === 'string' && optional(p.handle) && optional(p.displayName) && optional(p.avatar);
}

const STATUSES = new Set<unknown>(['queued', 'reading', 'done', 'skipped']);

const isIndexList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((n) => Number.isInteger(n) && n >= 0);

const isEntryList = (value: unknown): value is [string, number[]][] =>
  Array.isArray(value) &&
  value.every((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && isIndexList(entry[1]));

/**
 * Read a stored snapshot back, for one input. Null when there is none for
 * it, it is too old, or it does not have the shape this version writes.
 */
export function readSnapshot(raw: string | null, actor: string, now: number): ScanSnapshot | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const s = value as Partial<ScanSnapshot>;
  if (s.v !== SNAPSHOT_VERSION || s.actor !== actor.toLowerCase()) return null;
  if (typeof s.savedAt !== 'number' || now - s.savedAt > SNAPSHOT_MAX_AGE_MS || s.savedAt > now + 60_000) return null;
  if (typeof s.did !== 'string' || !isPerson(s.account)) return null;
  if (!Array.isArray(s.mutuals) || !s.mutuals.every(isPerson)) return null;
  if (!Array.isArray(s.states) || s.states.length !== s.mutuals.length) return null;
  if (!s.states.every((st) => st && typeof st === 'object' && STATUSES.has((st as { status?: unknown }).status))) return null;
  if (!Array.isArray(s.follows) || !s.follows.every((d) => typeof d === 'string')) return null;
  if (s.ownBlocks !== null && !(Array.isArray(s.ownBlocks) && s.ownBlocks.every((d) => typeof d === 'string'))) return null;
  if (!isEntryList(s.tally) || !isEntryList(s.listBlocks)) return null;
  if (!Array.isArray(s.counts) || !s.counts.every((n) => Number.isInteger(n) && n >= 0)) return null;
  const mutualCount = s.mutuals.length;
  const inRange = (entries: [string, number[]][]) => entries.every(([, ids]) => ids.every((i) => i < mutualCount));
  if (!inRange(s.tally) || !inRange(s.listBlocks)) return null;
  return {
    v: SNAPSHOT_VERSION,
    actor: s.actor,
    did: s.did,
    savedAt: s.savedAt,
    account: s.account,
    mutuals: s.mutuals,
    states: s.states as MutualState[],
    follows: s.follows,
    ownBlocks: s.ownBlocks ?? null,
    tally: s.tally,
    counts: s.counts,
    listBlocks: s.listBlocks,
    blocksRead: typeof s.blocksRead === 'number' ? s.blocksRead : 0,
    stopped: s.stopped === true,
    partialMutuals: s.partialMutuals === true,
  };
}

/* -------------------------------------------------------------------------- *
 * Whether the session may write the list
 * -------------------------------------------------------------------------- */

/**
 * Whether a granted OAuth scope lets this app create records in every one
 * of `collections`. True for the old catch-all `transition:generic`, and for
 * a `repo:` grant naming the collection (or `*`) with no action, which means
 * every action, or with `action=create`. Null when the scope is not known,
 * which the page treats as "try, and say so if the PDS refuses".
 */
export function scopeAllowsCreate(scope: string | null, collections: readonly string[]): boolean | null {
  if (scope === null) return null;
  const tokens = scope.split(/\s+/).filter(Boolean);
  if (tokens.includes('transition:generic')) return true;
  const allowed = (collection: string) =>
    tokens.some((token) => {
      // `repo:<collection>?…`, or `repo?collection=…&…` for several.
      if (!token.startsWith('repo:') && !token.startsWith('repo?')) return false;
      const [target, query = ''] = token.slice('repo'.length).replace(/^:/, '').split('?');
      const params = new URLSearchParams(query);
      const targets = [target, ...params.getAll('collection')].filter(Boolean);
      if (!targets.some((t) => t === '*' || t === collection)) return false;
      const actions = params.getAll('action');
      return actions.length === 0 || actions.includes('create');
    });
  return collections.every(allowed);
}
