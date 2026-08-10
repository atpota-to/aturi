/**
 * Read layer for the feedback board.
 *
 * The userinput.app lexicons describe a board with no AppView behind it: the
 * space is one record, and every discussion, vote, reply and moderation action
 * is a record in a different repo pointing back at it. Assembling a board is
 * therefore a fan-out, and this module is the only place that knows the shape
 * of it:
 *
 *   Constellation  — "what links here?" Turns a space URI into the coordinates
 *                    of every discussion filed into it, and a discussion URI
 *                    into its vote / reply / status counts.
 *   Slingshot      — "what is this record?" Hydrates those coordinates into
 *                    record values through an edge cache, so the browser makes
 *                    one request per record instead of resolve-DID-then-ask-PDS.
 *
 * Nothing here trusts a record because it exists. Statuses, pins, hides, locks
 * and bans are only honored when their author is the space owner or holds a
 * role the owner granted, and edits only when their author wrote the record
 * being edited. That check happens once, in `loadSpaceContext`, and every
 * other function takes its result as an argument.
 */

import {
  getAllBacklinks,
  getBacklinkCounts,
  getManyToMany,
} from '@/utils/atproto/constellation';
import {
  getRecordByUri,
  getRecordsByUris,
  mapWithConcurrency,
  resolveMiniDoc,
  type FetchedRecord,
} from '@/utils/atproto/slingshot';
import { listRecords, listRecordsPage } from '@/utils/atproto/pdsClient';
import { parseAtUri, rkeyFromAtUri, toAtUri } from '@/utils/atproto/urls';
import { getBlobUrl } from '@/utils/recordImages';
import { FEEDBACK_OWNER, FEEDBACK_SPACE_URI } from './config';
import {
  byNewestCreatedAt,
  isUiState,
  UI_LINK,
  UI_NSID,
  type DiscussionRecord,
  type EditRecord,
  type LockRecord,
  type ReplyRecord,
  type SpaceRecord,
  type SpaceTag,
  type StatusRecord,
  type StrongRef,
  type UiState,
} from './lexicons';

/* ------------------------------------------------------------------ space */

export type ResolvedSpace = {
  uri: string;
  cid: string;
  /** The repo the space record lives in — the owner, by definition. */
  ownerDid: string;
  ownerHandle: string | null;
  record: SpaceRecord;
  /** Ready-to-render icon URL, or null when the space has no icon. */
  iconUrl: string | null;
};

/**
 * Locate the board's space: the pinned URI when one is configured, otherwise
 * the earliest `app.userinput.space` in the configured owner's repo. Returns
 * null when no space exists yet — the board renders its setup panel then,
 * rather than an error.
 */
export async function resolveSpace(): Promise<ResolvedSpace | null> {
  if (FEEDBACK_SPACE_URI) {
    const rec = await getRecordByUri<SpaceRecord>(FEEDBACK_SPACE_URI);
    if (rec) return hydrateSpace(rec.uri, rec.cid, rec.value);
  }

  const doc = await resolveMiniDoc(FEEDBACK_OWNER);
  if (!doc) return null;

  // `reverse` walks the collection oldest-first, so the first page holds the
  // original space even for an owner who later created more.
  let page;
  try {
    page = await listRecordsPage(doc.pds, {
      repo: doc.did,
      collection: UI_NSID.space,
      limit: 1,
      reverse: true,
    });
  } catch {
    return null;
  }
  const first = page.records?.[0];
  if (!first) return null;
  return hydrateSpace(
    first.uri,
    first.cid,
    first.value as unknown as SpaceRecord,
    doc.handle,
  );
}

async function hydrateSpace(
  uri: string,
  cid: string,
  record: SpaceRecord,
  knownHandle?: string | null,
): Promise<ResolvedSpace | null> {
  const ownerDid = parseAtUri(uri)?.repo;
  if (!ownerDid || !record?.name) return null;

  // The icon is a blob, so rendering it needs the owner's PDS host. When the
  // caller already resolved the owner (the discovery path) we skip the hop.
  let ownerHandle = knownHandle ?? null;
  let iconUrl: string | null = null;
  if (record.icon?.ref?.$link) {
    const doc = await resolveMiniDoc(ownerDid);
    if (doc) {
      ownerHandle = ownerHandle ?? doc.handle;
      iconUrl = getBlobUrl(doc.pds, ownerDid, record.icon.ref.$link);
    }
  }

  return { uri, cid, ownerDid, ownerHandle, record, iconUrl };
}

export function spaceRef(space: ResolvedSpace): StrongRef {
  return { uri: space.uri, cid: space.cid };
}

export function spaceTags(space: ResolvedSpace): SpaceTag[] {
  return space.record.tags ?? [];
}

/* --------------------------------------------------- moderation authority */

export type SpaceContext = {
  space: ResolvedSpace;
  /** Owner + everyone granted a role, i.e. whose moderation records count. */
  moderatorDids: Set<string>;
  /** DIDs banned from the space by a moderator; their content is dropped. */
  bannedDids: Set<string>;
  /** Discussion URIs a moderator pinned to the top. */
  pinnedUris: Set<string>;
  /** Discussion / reply URIs a moderator hid. */
  hiddenUris: Set<string>;
  /** The live official status per subject URI, newest moderator record wins. */
  statuses: Map<string, StatusRecord>;
};

/**
 * Load everything that governs what the board is allowed to show, in four
 * parallel Constellation queries plus one pass over the moderators' repos.
 *
 * Membership, pins, hides and bans all carry both a `space` link and the thing
 * they act on, so `getManyToMany` reads both ends at once — the alternative is
 * hydrating every moderation record just to learn its subject.
 *
 * The ordering matters: moderator DIDs gate the other three, so those are
 * filtered after the join rather than in it. A pin authored by a stranger is
 * simply dropped.
 */
export async function loadSpaceContext(space: ResolvedSpace): Promise<SpaceContext> {
  const [members, bans, pins, hides] = await Promise.all([
    getManyToMany(space.uri, UI_LINK.membersOfSpace, 'subject'),
    getManyToMany(space.uri, UI_LINK.bansInSpace, 'subject'),
    getManyToMany(space.uri, UI_LINK.pinsInSpace, 'subject.uri'),
    getManyToMany(space.uri, UI_LINK.hidesInSpace, 'subject.uri'),
  ]);

  // Only the owner may grant a role, so membership is filtered against the
  // owner alone — a moderator can't appoint more moderators.
  const moderatorDids = new Set<string>([space.ownerDid]);
  for (const item of members ?? []) {
    if (item.linkRecord.did === space.ownerDid && item.otherSubject?.startsWith('did:')) {
      moderatorDids.add(item.otherSubject);
    }
  }

  const authored = (did: string) => moderatorDids.has(did);
  const bannedDids = new Set<string>();
  for (const item of bans ?? []) {
    if (authored(item.linkRecord.did) && item.otherSubject?.startsWith('did:')) {
      bannedDids.add(item.otherSubject);
    }
  }

  const pinnedUris = new Set<string>();
  for (const item of pins ?? []) {
    if (authored(item.linkRecord.did) && item.otherSubject) pinnedUris.add(item.otherSubject);
  }

  const hiddenUris = new Set<string>();
  for (const item of hides ?? []) {
    if (authored(item.linkRecord.did) && item.otherSubject) hiddenUris.add(item.otherSubject);
  }

  const statuses = await loadModeratorStatuses(moderatorDids);

  return { space, moderatorDids, bannedDids, pinnedUris, hiddenUris, statuses };
}

/**
 * Every status the moderators have issued, indexed by the subject it applies to.
 *
 * The obvious way to find a discussion's status is to ask Constellation who
 * links to it — but that's one query per discussion, plus a hydration per hit,
 * and on a board of fifty it dominates load time. Statuses are only honored
 * from moderators, and moderators are a short, already-known list, so reading
 * their `app.userinput.status` collections directly answers the same question
 * for the whole board in a couple of requests.
 *
 * Newest `createdAt` wins per subject, matching the lexicon's rule.
 */
async function loadModeratorStatuses(
  moderatorDids: ReadonlySet<string>,
): Promise<Map<string, StatusRecord>> {
  const perModerator = await Promise.all(
    Array.from(moderatorDids, async (did) => {
      const doc = await resolveMiniDoc(did);
      if (!doc) return [] as StatusRecord[];
      try {
        const records = await listRecords(doc.pds, {
          repo: doc.did,
          collection: UI_NSID.status,
          max: 1000,
        });
        return records.map((r) => r.value as unknown as StatusRecord);
      } catch {
        // No statuses issued yet: the collection doesn't exist and the PDS 400s.
        return [] as StatusRecord[];
      }
    }),
  );

  const newest = new Map<string, StatusRecord>();
  for (const record of perModerator.flat()) {
    const subject = record?.subject?.uri;
    if (!subject || !isUiState(record.state)) continue;
    const held = newest.get(subject);
    if (!held || byNewestCreatedAt(record, held) < 0) newest.set(subject, record);
  }
  return newest;
}

/* ------------------------------------------------------------ discussions */

export type DiscussionCounts = {
  upvotes: number;
  downvotes: number;
  replies: number;
  /** Net score, the board's default sort. */
  score: number;
};

export type Discussion = {
  uri: string;
  cid: string;
  authorDid: string;
  record: DiscussionRecord;
  /** Live title/body/tags after applying the author's newest edit. */
  title: string;
  body: string;
  tags: string[];
  /** Set when an `app.userinput.edit` superseded the original content. */
  editedAt: string | null;
  createdAt: string;
  counts: DiscussionCounts;
  status: UiState;
  statusNote: string | null;
  pinned: boolean;
};

/**
 * How many `links/all` requests are in flight at once. Each is a fast edge
 * lookup, but a fifty-row board fires one per row: unbounded, the browser
 * queues them six-deep per host anyway and the tail latency is worse than the
 * throughput gain.
 */
const COUNT_CONCURRENCY = 12;

/**
 * Every discussion in the space, hydrated, filtered and counted.
 *
 * The pipeline is deliberately shaped to keep per-discussion work to a single
 * request in the common case:
 *
 *   1. One Constellation query for every discussion coordinate in the space.
 *   2. One Slingshot fetch per discussion to hydrate it (bounded concurrency).
 *   3. One `links/all` per discussion, which returns upvotes, downvotes,
 *      replies *and* the edit count together.
 *   4. Edits fetched only for the discussions step 3 says actually have one.
 *
 * Statuses aren't in that list because `loadSpaceContext` already read them
 * from the moderators' repos in bulk — asking per discussion would double the
 * request count to answer a question a couple of `listRecords` calls settle
 * for the whole board.
 *
 * Discussions authored by a banned DID, or hidden by a moderator, never make
 * it into the returned list.
 */
export async function loadDiscussions(
  ctx: SpaceContext,
  opts: { max?: number } = {},
): Promise<Discussion[]> {
  const { max = 200 } = opts;
  const links = await getAllBacklinks(ctx.space.uri, UI_LINK.discussionsInSpace, { max });
  if (!links?.length) return [];

  const uris = links
    .filter((l) => !ctx.bannedDids.has(l.did))
    .map((l) => toAtUri({ did: l.did, collection: l.collection, rkey: l.rkey }))
    .filter((uri) => !ctx.hiddenUris.has(uri));

  const records = await getRecordsByUris<DiscussionRecord>(uris, { concurrency: 8 });

  const present = uris.filter((uri) => {
    const rec = records.get(uri);
    // A discussion that points at a different space shares the collection but
    // isn't ours; Constellation already filtered by space, but the hydrated
    // record is the authority.
    return Boolean(rec?.value?.title) && rec?.value?.space?.uri === ctx.space.uri;
  });

  const enriched = await mapWithConcurrency(present, COUNT_CONCURRENCY, async (uri) => {
    const rec = records.get(uri)!;
    const sources = await getBacklinkCounts(uri);
    const overlay = await loadOverlay(uri, ctx, sources);
    return buildDiscussion(rec, countsFrom(sources), overlay, ctx);
  });

  return sortDiscussions(enriched, 'top');
}

type CountMap = Awaited<ReturnType<typeof getBacklinkCounts>>;

/** Vote / reply tallies pulled out of one `links/all` response. */
function countsFrom(sources: CountMap): DiscussionCounts {
  const at = (source: string) => sources?.get(source)?.count ?? 0;
  const upvotes = at(UI_LINK.upvotesOn);
  const downvotes = at(UI_LINK.downvotesOn);
  return { upvotes, downvotes, replies: at(UI_LINK.repliesTo), score: upvotes - downvotes };
}

type DiscussionOverlay = {
  status: UiState;
  statusNote: string | null;
  title?: string;
  body?: string;
  tags?: string[];
  editedAt: string | null;
};

/**
 * The sidecar records that change how a subject reads: its official status,
 * and its live content after the author's newest revision.
 *
 * `sources` is the subject's `links/all` response, which is what makes the
 * edit lookup cheap — most records are never edited, and their entry simply
 * has no `app.userinput.edit` key, so there's nothing to fetch.
 */
async function loadOverlay(
  uri: string,
  ctx: SpaceContext,
  sources: CountMap,
): Promise<DiscussionOverlay> {
  const status = ctx.statuses.get(uri) ?? null;
  const edit = (sources?.get(UI_LINK.editsOf)?.count ?? 0) > 0 ? await resolveEdit(uri) : null;

  return {
    status: status?.state ?? 'open',
    statusNote: status?.note?.trim() || null,
    title: edit?.title,
    body: edit?.body,
    tags: edit?.tags,
    editedAt: edit?.createdAt ?? null,
  };
}

/**
 * The author's newest revision of their own record, or null.
 *
 * Only the original author may revise their own record, so the edit search is
 * scoped to that DID with Constellation's `did` filter — an edit written by
 * anyone else is noise on the network, not content, and never gets fetched.
 */
async function resolveEdit(subjectUri: string): Promise<EditRecord | null> {
  const authorDid = parseAtUri(subjectUri)?.repo;
  if (!authorDid) return null;
  const links = await getAllBacklinks(subjectUri, UI_LINK.editsOf, {
    max: 50,
    dids: [authorDid],
  });
  if (!links?.length) return null;
  const map = await getRecordsByUris<EditRecord>(
    links.map((l) => toAtUri({ did: l.did, collection: l.collection, rkey: l.rkey })),
    { concurrency: 4 },
  );
  const values = Array.from(map.values()).map((r) => r.value);
  values.sort(byNewestCreatedAt);
  return values[0] ?? null;
}

function buildDiscussion(
  rec: FetchedRecord<DiscussionRecord>,
  counts: DiscussionCounts,
  overlay: DiscussionOverlay,
  ctx: SpaceContext,
): Discussion {
  const authorDid = parseAtUri(rec.uri)?.repo ?? '';
  return {
    uri: rec.uri,
    cid: rec.cid,
    authorDid,
    record: rec.value,
    title: overlay.title ?? rec.value.title,
    body: overlay.body ?? rec.value.body ?? '',
    tags: overlay.tags ?? rec.value.tags ?? [],
    editedAt: overlay.editedAt,
    createdAt: rec.value.createdAt,
    counts,
    status: overlay.status,
    statusNote: overlay.statusNote,
    pinned: ctx.pinnedUris.has(rec.uri),
  };
}

export type DiscussionSort = 'top' | 'new' | 'discussed';

/**
 * Order a discussion list. Pins always float, whatever the sort — that's the
 * point of a pin — and ties break by recency so the order is stable rather
 * than dependent on Constellation's return order.
 */
export function sortDiscussions(list: Discussion[], sort: DiscussionSort): Discussion[] {
  const byRecency = (a: Discussion, b: Discussion) => byNewestCreatedAt(a, b);
  const ranked = [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'new') return byRecency(a, b);
    if (sort === 'discussed') {
      return b.counts.replies - a.counts.replies || byRecency(a, b);
    }
    return b.counts.score - a.counts.score || byRecency(a, b);
  });
  return ranked;
}

/* ----------------------------------------------------------------- thread */

export type ThreadReply = {
  uri: string;
  cid: string;
  authorDid: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  parentUri: string | null;
  counts: { upvotes: number; downvotes: number; score: number };
  /** Depth in the reply tree, capped so deep threads stay readable. */
  depth: number;
};

export type Thread = {
  discussion: Discussion;
  replies: ThreadReply[];
  /** Set when a moderator locked the thread; replies after it are dropped. */
  lockedAt: string | null;
};

/**
 * One discussion with its replies, threaded and ordered.
 *
 * A lock hides replies created after its cutoff rather than deleting them, so
 * the cutoff is applied here at read time — the records still exist in their
 * authors' repos, and unlocking restores them.
 */
export async function loadThread(
  ctx: SpaceContext,
  discussionUri: string,
): Promise<Thread | null> {
  const rec = await getRecordByUri<DiscussionRecord>(discussionUri);
  if (!rec?.value?.title) return null;
  if (ctx.hiddenUris.has(rec.uri)) return null;
  const authorDid = parseAtUri(rec.uri)?.repo ?? '';
  if (ctx.bannedDids.has(authorDid)) return null;

  const [sources, lockedAt, replyLinks] = await Promise.all([
    getBacklinkCounts(rec.uri),
    resolveLock(rec.uri, ctx),
    getAllBacklinks(rec.uri, UI_LINK.repliesTo, { max: 300 }),
  ]);

  const overlay = await loadOverlay(rec.uri, ctx, sources);
  const discussion = buildDiscussion(rec, countsFrom(sources), overlay, ctx);
  const replies = await loadReplies(ctx, replyLinks, lockedAt);
  return { discussion, replies, lockedAt };
}

async function resolveLock(uri: string, ctx: SpaceContext): Promise<string | null> {
  const links = await getAllBacklinks(uri, UI_LINK.locksOn, { max: 50 });
  const fromMods = (links ?? []).filter((l) => ctx.moderatorDids.has(l.did));
  if (!fromMods.length) return null;
  const map = await getRecordsByUris<LockRecord>(
    fromMods.map((l) => toAtUri({ did: l.did, collection: l.collection, rkey: l.rkey })),
    { concurrency: 4 },
  );
  const values = Array.from(map.values()).map((r) => r.value);
  values.sort(byNewestCreatedAt);
  return values[0]?.lockedAt ?? null;
}

const MAX_REPLY_DEPTH = 6;

async function loadReplies(
  ctx: SpaceContext,
  links: Awaited<ReturnType<typeof getAllBacklinks>>,
  lockedAt: string | null,
): Promise<ThreadReply[]> {
  const uris = (links ?? [])
    .filter((l) => !ctx.bannedDids.has(l.did))
    .map((l) => toAtUri({ did: l.did, collection: l.collection, rkey: l.rkey }))
    .filter((uri) => !ctx.hiddenUris.has(uri));
  if (!uris.length) return [];

  const records = await getRecordsByUris<ReplyRecord>(uris, { concurrency: 8 });
  const cutoff = lockedAt ? Date.parse(lockedAt) : null;

  const visible = Array.from(records.values()).filter((r) => {
    if (!r.value?.body) return false;
    if (cutoff == null || !Number.isFinite(cutoff)) return true;
    const at = Date.parse(r.value.createdAt || '');
    return !Number.isFinite(at) || at <= cutoff;
  });

  const flat = await mapWithConcurrency(visible, COUNT_CONCURRENCY, async (r) => {
    const sources = await getBacklinkCounts(r.uri);
    const counts = countsFrom(sources);
    const edited =
      (sources?.get(UI_LINK.editsOf)?.count ?? 0) > 0 ? await resolveEdit(r.uri) : null;
    return {
      uri: r.uri,
      cid: r.cid,
      authorDid: parseAtUri(r.uri)?.repo ?? '',
      body: edited?.body ?? r.value.body,
      createdAt: r.value.createdAt,
      editedAt: edited?.createdAt ?? null,
      parentUri: r.value.parent?.uri ?? null,
      counts: {
        upvotes: counts.upvotes,
        downvotes: counts.downvotes,
        score: counts.score,
      },
      depth: 0,
    } satisfies ThreadReply;
  });

  return threadReplies(flat);
}

/**
 * Flatten the reply graph into render order: each reply immediately followed
 * by its children, oldest first. Replies whose parent isn't in the set (hidden,
 * banned, deleted) are re-rooted rather than dropped, so a moderated middle of
 * a thread doesn't take its descendants with it.
 */
function threadReplies(flat: ThreadReply[]): ThreadReply[] {
  const byUri = new Map(flat.map((r) => [r.uri, r]));
  const children = new Map<string, ThreadReply[]>();
  const roots: ThreadReply[] = [];

  const oldestFirst = [...flat].sort((a, b) => byNewestCreatedAt(b, a));
  for (const reply of oldestFirst) {
    const parent = reply.parentUri && byUri.has(reply.parentUri) ? reply.parentUri : null;
    if (!parent) {
      roots.push(reply);
      continue;
    }
    const siblings = children.get(parent) ?? [];
    siblings.push(reply);
    children.set(parent, siblings);
  }

  const out: ThreadReply[] = [];
  const walk = (reply: ThreadReply, depth: number) => {
    out.push({ ...reply, depth: Math.min(depth, MAX_REPLY_DEPTH) });
    for (const child of children.get(reply.uri) ?? []) walk(child, depth + 1);
  };
  roots.forEach((r) => walk(r, 0));
  return out;
}

/* ----------------------------------------------------------- viewer votes */

export type ViewerVotes = {
  /** rkeys of subjects the viewer upvoted. */
  up: Set<string>;
  /** rkeys of subjects the viewer downvoted. */
  down: Set<string>;
};

export const EMPTY_VOTES: ViewerVotes = { up: new Set(), down: new Set() };

/**
 * Which subjects the viewer has already voted on.
 *
 * The vote lexicons pin the vote's record key to its *subject's* record key,
 * which is what enforces one vote per person per subject — and it also means
 * the viewer's whole voting history can be read as two `listRecords` calls and
 * compared by rkey, instead of asking Constellation per discussion whether
 * this DID is among the voters.
 */
export async function loadViewerVotes(
  did: string | null,
  opts: { max?: number } = {},
): Promise<ViewerVotes> {
  if (!did) return EMPTY_VOTES;
  const doc = await resolveMiniDoc(did);
  if (!doc) return EMPTY_VOTES;
  const { max = 1000 } = opts;

  const read = async (collection: string) => {
    try {
      const records = await listRecords(doc.pds, { repo: doc.did, collection, max });
      return new Set(records.map((r) => rkeyFromAtUri(r.uri)).filter(Boolean) as string[]);
    } catch {
      // A repo with no votes yet 400s on listRecords for a missing collection.
      return new Set<string>();
    }
  };

  const [up, down] = await Promise.all([read(UI_NSID.upvote), read(UI_NSID.downvote)]);
  return { up, down };
}

/** The rkey a vote on `subjectUri` must be written at. */
export function voteRkeyFor(subjectUri: string): string | null {
  return rkeyFromAtUri(subjectUri);
}
