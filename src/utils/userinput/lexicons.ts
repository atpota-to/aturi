/**
 * Type definitions and constants for the userinput.app lexicon family
 * (`app.userinput.*`), the schema aturi.to's feedback board is built on.
 *
 * The canonical schemas are published as `com.atproto.lexicon.schema` records
 * in userinput.app's own repo and are browsable at
 * https://aturi.to/explore/userinput.app/com.atproto.lexicon.schema.
 *
 * The shape of the system is worth stating once, because it drives every
 * decision in `client.ts`: **there is no AppView**. A space is one record in
 * its owner's repo; every discussion, reply, vote, status and moderation
 * action is a record in the *acting user's* repo pointing back at what it
 * acts on. Nothing is aggregated server-side. Reading a board therefore means
 * asking Constellation "what links here?" and hydrating the answers through
 * Slingshot — which is exactly what the explorer already does for backlinks,
 * pointed at a different set of collections.
 *
 * Two consequences shape the client:
 *
 *   1. **Authority is checked at read time, not write time.** Anyone can write
 *      an `app.userinput.status` record claiming a discussion is "implemented".
 *      It only counts if its author is the space owner or holds an
 *      `app.userinput.member` role granted by the owner. Every moderation
 *      collection below is filtered that way before it's honored.
 *   2. **Records are never mutated in place.** Edits are sidecar
 *      `app.userinput.edit` records pointing at the original, so the newest
 *      one from the original author is the live content and the full set is
 *      the revision history.
 */

/** Every collection in the family, and the `source` string Constellation
 * indexes each of its links under (`collection:path`, no leading dot). */
export const UI_NSID = {
  space: 'app.userinput.space',
  discussion: 'app.userinput.discussion',
  reply: 'app.userinput.reply',
  upvote: 'app.userinput.upvote',
  downvote: 'app.userinput.downvote',
  status: 'app.userinput.status',
  edit: 'app.userinput.edit',
  pin: 'app.userinput.pin',
  hide: 'app.userinput.hide',
  lock: 'app.userinput.lock',
  ban: 'app.userinput.ban',
  member: 'app.userinput.member',
  visited: 'app.userinput.visited',
} as const;

/** Constellation link sources, i.e. "records of type X pointing at me via Y". */
export const UI_LINK = {
  /** Discussions filed into a space. */
  discussionsInSpace: `${UI_NSID.discussion}:space.uri`,
  /** Replies on a discussion. */
  repliesTo: `${UI_NSID.reply}:subject.uri`,
  /** Replies threaded under another reply. */
  repliesToParent: `${UI_NSID.reply}:parent.uri`,
  upvotesOn: `${UI_NSID.upvote}:subject.uri`,
  downvotesOn: `${UI_NSID.downvote}:subject.uri`,
  statusesOn: `${UI_NSID.status}:subject.uri`,
  editsOf: `${UI_NSID.edit}:subject.uri`,
  locksOn: `${UI_NSID.lock}:subject.uri`,
  pinsInSpace: `${UI_NSID.pin}:space.uri`,
  hidesInSpace: `${UI_NSID.hide}:space.uri`,
  bansInSpace: `${UI_NSID.ban}:space.uri`,
  membersOfSpace: `${UI_NSID.member}:space.uri`,
  visitsToSpace: `${UI_NSID.visited}:space.uri`,
} as const;

/** `com.atproto.repo.strongRef` — a URI pinned to a specific record version. */
export type StrongRef = {
  uri: string;
  cid: string;
};

export type BlobRef = {
  $type?: 'blob';
  ref: { $link: string };
  mimeType: string;
  size?: number;
};

export type SpaceTag = {
  /** Stable machine value, stored on discussions. */
  value: string;
  /** Human-readable display label. */
  label: string;
};

export type SpaceRecord = {
  $type?: typeof UI_NSID.space;
  name: string;
  description?: string;
  icon?: BlobRef;
  tags?: SpaceTag[];
  createdAt: string;
};

export type DiscussionImage = {
  image: BlobRef;
  alt?: string;
};

export type DiscussionRecord = {
  $type?: typeof UI_NSID.discussion;
  space: StrongRef;
  title: string;
  body?: string;
  tags?: string[];
  images?: DiscussionImage[];
  createdAt: string;
};

export type ReplyRecord = {
  $type?: typeof UI_NSID.reply;
  subject: StrongRef;
  parent?: StrongRef;
  body: string;
  createdAt: string;
};

export type VoteRecord = {
  $type?: typeof UI_NSID.upvote | typeof UI_NSID.downvote;
  subject: StrongRef;
  createdAt: string;
};

export const UI_STATES = [
  'open',
  'under-review',
  'backlog',
  'planned',
  'in-progress',
  'implemented',
  'declined',
  'duplicate',
  'closed',
] as const;

export type UiState = (typeof UI_STATES)[number];

export type StatusRecord = {
  $type?: typeof UI_NSID.status;
  subject: StrongRef;
  state: UiState;
  note?: string;
  duplicateOf?: StrongRef;
  createdAt: string;
};

export type EditRecord = {
  $type?: typeof UI_NSID.edit;
  subject: StrongRef;
  title?: string;
  body?: string;
  tags?: string[];
  createdAt: string;
};

export type PinRecord = {
  $type?: typeof UI_NSID.pin;
  space: StrongRef;
  subject: StrongRef;
  createdAt: string;
};

export type HideRecord = {
  $type?: typeof UI_NSID.hide;
  space: StrongRef;
  subject: StrongRef;
  createdAt: string;
};

export type LockRecord = {
  $type?: typeof UI_NSID.lock;
  subject: StrongRef;
  /** Replies created at or before this instant stay visible; later ones don't. */
  lockedAt: string;
  createdAt: string;
};

export type MemberRecord = {
  $type?: typeof UI_NSID.member;
  space: StrongRef;
  /** The DID being granted the role. */
  subject: string;
  role: 'moderator' | 'admin';
  createdAt: string;
};

export type VisitedRecord = {
  $type?: typeof UI_NSID.visited;
  space: StrongRef;
  firstVisited: string;
  lastVisited: string;
};

/** Display metadata for each status, including the CSS custom property the
 * board paints its chip with. Statuses that mean "this is going to happen"
 * share the accent hue; terminal-negative ones borrow the danger palette. */
export const UI_STATE_META: Record<
  UiState,
  { label: string; tone: 'neutral' | 'active' | 'positive' | 'negative' }
> = {
  open: { label: 'Open', tone: 'neutral' },
  'under-review': { label: 'Under review', tone: 'active' },
  backlog: { label: 'Backlog', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'active' },
  'in-progress': { label: 'In progress', tone: 'active' },
  implemented: { label: 'Implemented', tone: 'positive' },
  declined: { label: 'Declined', tone: 'negative' },
  duplicate: { label: 'Duplicate', tone: 'negative' },
  closed: { label: 'Closed', tone: 'negative' },
};

export function isUiState(value: unknown): value is UiState {
  return typeof value === 'string' && (UI_STATES as readonly string[]).includes(value);
}

/**
 * Compare two ISO timestamps, newest first, for the "latest createdAt wins"
 * rule the status / edit / lock lexicons all specify. Unparseable dates sort
 * last so a malformed record can never displace a well-formed one.
 */
export function byNewestCreatedAt(
  a: { createdAt?: string },
  b: { createdAt?: string },
): number {
  const ta = Date.parse(a.createdAt || '');
  const tb = Date.parse(b.createdAt || '');
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
  if (!Number.isFinite(ta)) return 1;
  if (!Number.isFinite(tb)) return -1;
  return tb - ta;
}
