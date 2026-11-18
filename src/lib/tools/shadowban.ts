/**
 * The shadowban checker's logic: what to compare, and what a difference means.
 *
 * An account's posts live in its repository on its PDS, and anyone can read
 * them there. An AppView is a separate service that indexes repositories and
 * answers apps, and it can leave things out of its answers without telling
 * anyone: a post it will not return, a reply it drops from the thread it
 * belongs to, an account its search skips. Bluesky's AppView used to mark the
 * account for the last of these with a public `needs-review` label; it no
 * longer does, so the only way to see it is to put the PDS and the AppView
 * side by side, which is what this does.
 *
 * Every rule below was checked against the live services before it was
 * written down, and several exist to stop an innocent difference being
 * reported as a hidden one:
 *
 *   - A thread answer lists at most THREAD_REPLY_CAP direct replies, on both
 *     Bluesky and Blacksky, so a reply missing from a longer thread is "too
 *     long to tell", not hidden.
 *   - An AppView drops a reply across a block between the replier and the
 *     thread, and a reply that breaks the thread's reply rules. Both are
 *     looked up before a missing reply is called unexplained.
 *   - Search leaves out every account carrying the `!no-unauthenticated`
 *     self-label when the request is logged out, as this one is. Of sixty
 *     ordinary accounts sampled, every one search left out carried it.
 *   - Typeahead finds an account by handle even where full search leaves it
 *     out, so it is the control: found by typeahead and not by search means
 *     the account was indexed and then excluded.
 *   - Indexing takes moments and search takes longer, so posts younger than
 *     a grace period are not counted against either.
 *
 * Everything here is pure. The requests are in shadowbanClient.ts.
 */

import { matchSupportedUrl } from '@/utils/reverseParsers';
import { isValidDid } from '@/utils/atproto/spaceUri';
import { tidToDate } from '@/utils/atproto/tid';
import { parseAtUri } from '@/utils/atproto/urls';

export const POST_COLLECTION = 'app.bsky.feed.post';

/** Recent posts compared. One getPosts request carries at most 25 URIs. */
export const RECENT_POSTS = 25;

/** Replies whose threads are opened, at most: one request each. */
export const REPLIES_CHECKED = 10;

/**
 * The most direct replies an AppView returns for one post. Measured on
 * Bluesky and Blacksky, against a post with 581 replies: both stopped at 200.
 */
export const THREAD_REPLY_CAP = 200;

/** A post younger than this may not have been indexed yet. */
export const INDEX_GRACE_MS = 2 * 60_000;

/** Search is fed after the AppView's own index, and lags it. */
export const SEARCH_GRACE_MS = 15 * 60_000;

/** The self-label that asks apps not to show an account to logged-out visitors. */
export const NO_UNAUTHENTICATED = '!no-unauthenticated';

/* -------------------------------------------------------------------------- *
 * Which AppView
 * -------------------------------------------------------------------------- */

export type AppView = {
  /** The `appview` query parameter: an id for a listed AppView, a host for any other. */
  param: string;
  name: string;
  origin: string;
  /** False for a host typed by hand. */
  listed: boolean;
};

/**
 * AppViews that answer a browser without signing in.
 *
 * Bluesky's is asked at api.bsky.app rather than public.api.bsky.app. The
 * public host is a cache in front of the same service, so a reply written a
 * minute ago can be missing from its answer for no reason but age, and it
 * refuses post search outright.
 */
export const APPVIEWS: readonly AppView[] = [
  { param: 'bluesky', name: 'Bluesky', origin: 'https://api.bsky.app', listed: true },
  { param: 'blacksky', name: 'Blacksky', origin: 'https://api.blacksky.community', listed: true },
];

export const DEFAULT_APPVIEW = APPVIEWS[0];

export type AppViewChoice = { ok: true; appview: AppView } | { ok: false; reason: string };

type HostUrl = { ok: true; origin: string } | { ok: false; reason: string };

/**
 * Tidy a typed host into an origin. A bare name gets https. Plain http is
 * kept only for this machine, which is where an AppView under development
 * runs and the one place a browser will send it from a secure page.
 */
function normalizeHostUrl(raw: string): HostUrl {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter the AppView’s host, such as appview.example.com.' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, reason: 'That isn’t a host name or URL.' };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && !local) {
    return { ok: false, reason: 'Use https. Browsers won’t send this request over plain http.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'Use an https address.' };
  }
  if (url.username || url.password) return { ok: false, reason: 'Remove the username and password from the address.' };
  return { ok: true, origin: url.origin };
}

/** Read the `appview` parameter: empty for Bluesky's, a listed id, or any host. */
export function readAppViewParam(raw: string): AppViewChoice {
  const value = raw.trim();
  if (!value) return { ok: true, appview: DEFAULT_APPVIEW };
  const listed = APPVIEWS.find((appview) => appview.param === value.toLowerCase());
  if (listed) return { ok: true, appview: listed };

  const host = normalizeHostUrl(value);
  if (!host.ok) return { ok: false, reason: host.reason };
  const same = APPVIEWS.find((appview) => appview.origin === host.origin);
  if (same) return { ok: true, appview: same };
  const name = new URL(host.origin).host;
  // A bare host reads back as https, so only plain http keeps its scheme.
  const param = host.origin.startsWith('https://') ? name : host.origin;
  return { ok: true, appview: { param, name, origin: host.origin, listed: false } };
}

/* -------------------------------------------------------------------------- *
 * What was asked about
 * -------------------------------------------------------------------------- */

/** An account or a post, with the account still as typed (a handle or a DID). */
export type ShadowbanTarget =
  | { kind: 'account'; actor: string }
  | { kind: 'post'; actor: string; rkey: string };

export type ShadowbanInput = { ok: true; target: ShadowbanTarget } | { ok: false; reason: string };

/** The reason given for a record that is neither an account nor a post. */
export const NOT_CHECKED = 'This checks accounts and posts. Enter a handle, a DID, or a link to a post.';

const PROFILE_COLLECTION = 'app.bsky.actor.profile';
const HANDLE_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** An account the way people paste one: a DID, or a handle with or without the @. */
function readAccount(input: string): string | null {
  let value = input.trim();
  if (value.startsWith('@')) value = value.slice(1);
  if (value.startsWith('did:')) return isValidDid(value) ? value : null;
  const handle = value.toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

function targetFrom(actor: string, collection?: string, rkey?: string): ShadowbanInput {
  const account = readAccount(actor);
  if (!account) return { ok: false, reason: `“${actor}” isn’t a handle or a DID.` };
  if (!collection || collection === PROFILE_COLLECTION) return { ok: true, target: { kind: 'account', actor: account } };
  if (collection === POST_COLLECTION && rkey) return { ok: true, target: { kind: 'post', actor: account, rkey } };
  return { ok: false, reason: NOT_CHECKED };
}

/**
 * A handle, a DID, an at:// URI, or a profile or post link from any client
 * the link resolver knows (bsky.app and the rest of that family).
 */
export function parseShadowbanInput(raw: string): ShadowbanInput {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter a handle, a DID, or a link to a post.' };

  if (/^at:\/\//i.test(value)) {
    const parsed = parseAtUri(value);
    if (!parsed || parsed.space) return { ok: false, reason: 'That at:// URI isn’t valid.' };
    return targetFrom(parsed.repo, parsed.collection, parsed.rkey);
  }

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return { ok: false, reason: 'That link isn’t valid.' };
    }
    const match = matchSupportedUrl(url);
    if (!match) {
      return { ok: false, reason: 'This tool doesn’t recognize that link. Paste the handle instead.' };
    }
    return targetFrom(match.parsed.handle, match.parsed.collection, match.parsed.rkey);
  }

  return targetFrom(value);
}

/** A stable string for a target, to key a run on. */
export function targetKey(target: ShadowbanTarget): string {
  return target.kind === 'post' ? `post:${target.actor}/${target.rkey}` : `account:${target.actor}`;
}

/* -------------------------------------------------------------------------- *
 * What was observed
 * -------------------------------------------------------------------------- */

/** A question asked of a service: its answer, or why there was none. */
export type Probe<T> = { ok: true; value: T } | { ok: false; message: string };

export type Identity = {
  did: string;
  /** The handle the DID document claims, or the one typed. Null when there is neither. */
  handle: string | null;
  /** The PDS origin, without a trailing slash. */
  pds: string;
};

/** What the PDS says about the repository, from com.atproto.sync.getRepoStatus. */
export type RepoState =
  | { state: 'active' }
  | { state: 'inactive'; status: string | null }
  | { state: 'unknown'; message: string };

export type ProfileLabel = { val: string; src: string };

export type ProfileState =
  | {
      state: 'found';
      handle: string | null;
      displayName: string | null;
      avatar: string | null;
      labels: ProfileLabel[];
    }
  /** The AppView says it has taken the account down. */
  | { state: 'suspended'; message: string }
  | { state: 'deactivated'; message: string }
  /** The AppView has no profile, and does not say why. */
  | { state: 'missing'; message: string }
  | { state: 'error'; message: string };

/** A post as its repository holds it. */
export type RepoPost = {
  uri: string;
  rkey: string;
  text: string;
  /** When it was written: from a TID record key, else from createdAt. */
  writtenAt: number | null;
  reply: { parent: string; root: string } | null;
};

/** What the AppView answered when asked for the thread a reply belongs in. */
export type ThreadAnswer =
  /** The reply is among the parent's replies. */
  | 'shown'
  /** It is not, and the thread was short enough to list them all. */
  | 'absent'
  /** It is not, but the thread has more replies than one answer lists. */
  | 'crowded'
  /** The post it answers is not on the AppView. */
  | 'no-parent'
  | 'error';

/** One reply, and where it turned up. */
export type ReplyProbe = {
  uri: string;
  parent: string;
  root: string;
  thread: ThreadAnswer;
  /** The AppView's words, when the thread could not be read. */
  message?: string;
  /**
   * The thread's reply rules, read for a reply that is absent. `restricted`
   * is any rule limiting who may reply; `hidden` is this reply being one the
   * thread's author hid. Null when it could not be read.
   */
  gate?: { restricted: boolean; hidden: boolean } | null;
  /**
   * A block between the replier and the author of the parent or the root,
   * looked up for a reply that is absent. Null when it could not be checked.
   */
  block?: { found: boolean } | null;
};

export type ActorSearch = {
  /** Full search, for the account's handle. */
  inSearch: boolean;
  /** Typeahead, for the same. Null when it did not answer. */
  inTypeahead: boolean | null;
};

/**
 * Everything observed so far. A field left undefined is still on its way;
 * once `done` is set, one left undefined was not asked.
 */
export type Evidence = {
  target: ShadowbanTarget;
  appview: AppView;
  /** When the run started, which the grace periods are measured from. */
  checkedAt?: number;
  identity?: Identity;
  repo?: RepoState;
  profile?: ProfileState;
  /** From the PDS: the account's most recent posts, whatever was asked about. */
  posts?: Probe<RepoPost[]>;
  /** Of `posts`, the URIs the AppView returned. */
  shown?: Probe<string[]>;
  replies?: Probe<ReplyProbe[]>;
  actorSearch?: Probe<ActorSearch>;
  /** URIs of the account's posts that post search returned. */
  postSearch?: Probe<string[]>;
  /**
   * When a post was asked about, the account is checked as above and the
   * post on its own as well. This is its record from the PDS, or null when
   * the repository has no such record.
   */
  post?: Probe<RepoPost | null>;
  /** The post's URI when the AppView returns it, as `shown` is for `posts`. */
  postShown?: Probe<string[]>;
  /** For a post that is a reply: where it turned up in its thread. */
  postThread?: Probe<ReplyProbe>;
  done?: boolean;
};

/* -------------------------------------------------------------------------- *
 * Reading records and answers
 * -------------------------------------------------------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strongRefUri(value: unknown): string | null {
  return isObject(value) && typeof value.uri === 'string' ? value.uri : null;
}

/** A post from a listRecords or getRecord answer. */
export function readRepoPost(record: { uri: string; value: unknown }): RepoPost {
  const value = isObject(record.value) ? record.value : {};
  const rkey = record.uri.split('/').pop() ?? '';
  const fromKey = tidToDate(rkey)?.getTime() ?? null;
  const fromField = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : NaN;
  const reply = isObject(value.reply) ? value.reply : null;
  const parent = strongRefUri(reply?.parent);
  const root = strongRefUri(reply?.root);
  return {
    uri: record.uri,
    rkey,
    text: typeof value.text === 'string' ? value.text : '',
    writtenAt: fromKey ?? (Number.isFinite(fromField) ? fromField : null),
    reply: parent ? { parent, root: root ?? parent } : null,
  };
}

/** The DID in an at:// URI, or the empty string. */
export function authorOf(uri: string): string {
  return /^at:\/\/([^/]+)/.exec(uri)?.[1] ?? '';
}

/**
 * The AppView's reason for not returning a profile, sorted by what it means.
 * Bluesky's AppView answers 400 with `AccountTakedown` and "Account has been
 * suspended" for a takedown, `AccountDeactivated` for a deactivation, and
 * "Profile not found" for an account it has never indexed.
 */
export function readProfileFailure(status: number, error: string | null, message: string | null): ProfileState {
  const words = message || error || `HTTP ${status}`;
  const said = `${error ?? ''} ${message ?? ''}`.toLowerCase();
  if (status === 400 || status === 404) {
    if (/takedown|suspended|taken down/.test(said)) return { state: 'suspended', message: words };
    if (/deactivated/.test(said)) return { state: 'deactivated', message: words };
    return { state: 'missing', message: words };
  }
  return { state: 'error', message: words };
}

/**
 * Where a reply is in an answer to getPostThread for its parent. `replies`
 * is the thread's `replies` array: thread views carry the post under `post`,
 * and blocked or missing entries carry a bare `uri`.
 */
export function placeReply(uri: string, replies: unknown): ThreadAnswer {
  const list = Array.isArray(replies) ? replies : [];
  const found = list.some((entry) => {
    if (!isObject(entry)) return false;
    const post = isObject(entry.post) ? entry.post : null;
    return (post?.uri ?? entry.uri) === uri;
  });
  if (found) return 'shown';
  return list.length >= THREAD_REPLY_CAP ? 'crowded' : 'absent';
}

/** The replies to look up, newest first: those the AppView returned, up to the limit. */
export function repliesToCheck(posts: RepoPost[], shown: readonly string[], limit = REPLIES_CHECKED): RepoPost[] {
  const visible = new Set(shown);
  return posts.filter((post) => post.reply && visible.has(post.uri)).slice(0, limit);
}

/* -------------------------------------------------------------------------- *
 * What it means
 * -------------------------------------------------------------------------- */

export type ReplyReading = {
  /**
   * `hidden` counts towards a shadowban. `explained` is left out for a reason
   * anyone can see. `unknown` could not be told either way.
   */
  outcome: 'shown' | 'hidden' | 'explained' | 'unknown';
  /** A few words, for a pill. */
  label: string;
  /** A sentence. */
  reason: string;
};

export function readReply(reply: ReplyProbe, author: string): ReplyReading {
  switch (reply.thread) {
    case 'shown':
      return { outcome: 'shown', label: 'In its thread', reason: 'Appears under the post it replies to.' };
    case 'crowded':
      return {
        outcome: 'unknown',
        label: 'Thread too long to tell',
        reason: `The post it replies to has more than ${THREAD_REPLY_CAP} replies, and the AppView only returns ${THREAD_REPLY_CAP} at a time.`,
      };
    case 'no-parent':
      return {
        outcome: 'unknown',
        label: 'Parent not shown',
        reason: 'The post it replies to isn’t on the AppView, so there’s no thread to check.',
      };
    case 'error':
      return {
        outcome: 'unknown',
        label: 'Thread didn’t load',
        reason: reply.message ? `The thread didn’t load: ${reply.message}` : 'The thread didn’t load.',
      };
    case 'absent':
      break;
  }

  const ownThread = authorOf(reply.root) === author && authorOf(reply.parent) === author;
  if (reply.gate?.hidden && authorOf(reply.root) !== author) {
    return {
      outcome: 'explained',
      label: 'Hidden by the thread’s author',
      reason: 'The person who started the thread hid this reply.',
    };
  }
  if (reply.block?.found) {
    return {
      outcome: 'explained',
      label: 'Block in the thread',
      reason: 'There’s a block between this account and someone earlier in the thread. AppViews hide replies when there’s a block.',
    };
  }
  if (reply.gate?.restricted && authorOf(reply.root) !== author) {
    return {
      outcome: 'explained',
      label: 'Thread limits replies',
      reason: 'The person who started the thread limits who can reply. AppViews hide replies from people outside that limit.',
    };
  }
  const unchecked = [
    reply.block === null && !ownThread ? 'blocks' : null,
    reply.gate === null && !ownThread ? 'the thread’s reply limits' : null,
  ].filter(Boolean);
  return {
    outcome: 'hidden',
    label: 'Missing from its thread',
    reason: ownThread
      ? 'This reply is in the account’s own thread, where blocks and reply limits don’t apply, and it’s still missing.'
      : `Missing from the thread, and no block or reply limit explains it.${
          unchecked.length ? ` (Couldn’t check ${unchecked.join(' or ')}.)` : ''
        }`,
  };
}

export type PostPresence = 'shown' | 'missing' | 'new' | 'pending';

/** Whether the AppView returned a post, allowing for one too new to be indexed. */
export function postPresence(post: RepoPost, shown: Probe<string[]> | undefined, now: number): PostPresence {
  if (!shown) return 'pending';
  if (!shown.ok) return 'pending';
  if (shown.value.includes(post.uri)) return 'shown';
  return post.writtenAt !== null && now - post.writtenAt < INDEX_GRACE_MS ? 'new' : 'missing';
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip' | 'pending';

export type ShadowbanCheck = {
  id: 'pds' | 'profile' | 'posts' | 'threads' | 'actorSearch' | 'postSearch' | 'postRecord' | 'post' | 'thread';
  status: CheckStatus;
  title: string;
  summary: string;
  /** Evidence, one line each. */
  detail?: string[];
};

function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '');
}

/** Labels on the profile that someone other than the account applied. */
export function moderationLabels(labels: ProfileLabel[], did: string): string[] {
  return [...new Set(labels.filter((label) => label.src !== did).map((label) => label.val))];
}

function pdsCheck(evidence: Evidence): ShadowbanCheck {
  const title = 'Account on its PDS';
  const { identity, repo } = evidence;
  if (!identity || !repo) return { id: 'pds', status: 'pending', title, summary: 'Reading the PDS…' };
  const host = hostOf(identity.pds);
  if (repo.state === 'inactive') {
    return {
      id: 'pds',
      status: 'warn',
      title,
      summary: `${host} reports the account as ${repo.status ?? 'inactive'}. AppViews stop showing accounts that their PDS has turned off.`,
    };
  }
  if (repo.state === 'unknown') {
    return { id: 'pds', status: 'info', title, summary: `${host} didn’t say whether the account is active: ${repo.message}` };
  }
  return { id: 'pds', status: 'pass', title, summary: `Active on ${host}.` };
}

function profileCheck(evidence: Evidence): ShadowbanCheck {
  const { appview, profile, identity } = evidence;
  const title = `Profile on ${appview.name}`;
  if (!profile) return { id: 'profile', status: 'pending', title, summary: 'Asking the AppView…' };
  switch (profile.state) {
    case 'suspended':
      return {
        id: 'profile',
        status: 'fail',
        title,
        summary: `${appview.name} says “${profile.message}”. The account is suspended, and the AppView says so openly.`,
      };
    case 'deactivated':
      return { id: 'profile', status: 'info', title, summary: `${appview.name} says “${profile.message}”.` };
    case 'missing':
      return {
        id: 'profile',
        status: 'fail',
        title,
        summary: `${appview.name} has no profile for this account (“${profile.message}”). Either it never indexed the account, or it removed it without saying why.`,
      };
    case 'error':
      return { id: 'profile', status: 'warn', title, summary: `${appview.name} didn’t answer: ${profile.message}` };
    case 'found':
      break;
  }
  const applied = moderationLabels(profile.labels, identity?.did ?? '');
  const selfHidden = profile.labels.some((label) => label.val === NO_UNAUTHENTICATED && label.src === identity?.did);
  const detail = selfHidden
    ? ['The account has the !no-unauthenticated label, which asks apps to hide it from people who aren’t signed in.']
    : undefined;
  if (applied.length > 0) {
    return {
      id: 'profile',
      status: 'warn',
      title,
      summary: `${appview.name} shows the profile, with ${applied.length === 1 ? 'a moderation label' : 'moderation labels'}: ${applied.join(', ')}.`,
      detail,
    };
  }
  return { id: 'profile', status: 'pass', title, summary: `${appview.name} shows the profile, with no moderation labels.`, detail };
}

function postsCheck(evidence: Evidence, now: number): ShadowbanCheck {
  const { appview, posts, shown } = evidence;
  const title = `Recent posts on ${appview.name}`;
  if (!posts || (posts.ok && posts.value.length > 0 && !shown)) {
    return { id: 'posts', status: 'pending', title, summary: 'Comparing…' };
  }
  if (!posts.ok) return { id: 'posts', status: 'skip', title, summary: `The PDS didn’t list the posts: ${posts.message}` };
  if (posts.value.length === 0) return { id: 'posts', status: 'info', title, summary: 'The account hasn’t posted anything.' };
  if (shown && !shown.ok) return { id: 'posts', status: 'warn', title, summary: `${appview.name} didn’t answer: ${shown.message}` };

  const presence = posts.value.map((post) => postPresence(post, shown, now));
  const missing = presence.filter((p) => p === 'missing').length;
  const fresh = presence.filter((p) => p === 'new').length;
  const counted = posts.value.length - fresh;
  const freshNote =
    fresh === 0 ? '' : ` ${fresh === 1 ? 'One post' : `${fresh} posts`} from the last two minutes ${fresh === 1 ? 'was' : 'were'} skipped.`;
  if (missing > 0) {
    return {
      id: 'posts',
      status: 'fail',
      title,
      summary: `${missing} of the ${counted} latest posts ${missing === 1 ? 'is' : 'are'} on the PDS but missing from ${appview.name}.${freshNote}`,
      detail: ['An AppView also skips posts it can’t read, such as malformed records, so open one to check.'],
    };
  }
  return {
    id: 'posts',
    status: 'pass',
    title,
    summary: `${appview.name} returns all ${counted} of the latest posts.${freshNote}`,
  };
}

function threadsCheck(evidence: Evidence): ShadowbanCheck {
  const { replies, identity, done } = evidence;
  const title = 'Replies in their threads';
  if (!replies) {
    return done
      ? { id: 'threads', status: 'skip', title, summary: 'Not checked, because the latest posts couldn’t be compared.' }
      : { id: 'threads', status: 'pending', title, summary: 'Opening the threads…' };
  }
  if (!replies.ok) return { id: 'threads', status: 'warn', title, summary: replies.message };
  if (replies.value.length === 0) {
    return { id: 'threads', status: 'skip', title, summary: 'None of the latest posts on the AppView is a reply.' };
  }
  const readings = replies.value.map((reply) => readReply(reply, identity?.did ?? ''));
  const count = (outcome: ReplyReading['outcome']) => readings.filter((r) => r.outcome === outcome).length;
  const total = readings.length;
  const hidden = count('hidden');
  const explained = count('explained');
  const unknown = count('unknown');
  const notes = [
    explained > 0
      ? `${explained === 1 ? 'One more is' : `${explained} more are`} hidden because of a block or a reply limit.`
      : null,
    unknown > 0
      ? `${unknown === 1 ? 'One reply' : `${unknown} replies`} couldn’t be checked.`
      : null,
  ].filter((note): note is string => note !== null);
  if (hidden > 0) {
    const own = replies.value.filter(
      (reply, index) => readings[index].outcome === 'hidden' && authorOf(reply.root) === identity?.did,
    ).length;
    const ownNote =
      own === 0
        ? ''
        : own === hidden
          ? hidden === 1
            ? ' It’s a reply in the account’s own thread.'
            : ' All of them are in the account’s own threads.'
          : ` ${own} of them are in the account’s own threads.`;
    return {
      id: 'threads',
      status: 'fail',
      title,
      summary: `${hidden} of ${total} recent replies ${hidden === 1 ? 'is' : 'are'} missing from ${hidden === 1 ? 'its thread' : 'their threads'}, and no block or reply limit explains it.${ownNote}`,
      detail: notes.length ? notes : undefined,
    };
  }
  const shownCount = count('shown');
  if (shownCount === 0) {
    return {
      id: 'threads',
      status: 'info',
      title,
      summary: notes.join(' ') || 'Couldn’t check.',
    };
  }
  return {
    id: 'threads',
    status: 'pass',
    title,
    summary:
      shownCount === total
        ? total === 1
          ? 'The recent reply appears under the post it replies to.'
          : `${total === 2 ? 'Both' : `All ${total}`} recent replies appear under the posts they reply to.`
        : `${shownCount} of ${total} recent replies appear under the posts they reply to. ${notes.join(' ')}`,
  };
}

function actorSearchCheck(evidence: Evidence): ShadowbanCheck {
  const { appview, actorSearch, identity, profile, done } = evidence;
  const title = 'Account in search';
  const handle = identity?.handle;
  if (!actorSearch) {
    if (done) {
      return {
        id: 'actorSearch',
        status: 'skip',
        title,
        summary: handle ? 'Not checked.' : 'The account has no handle to search for.',
      };
    }
    return { id: 'actorSearch', status: 'pending', title, summary: 'Searching…' };
  }
  if (!actorSearch.ok) {
    return {
      id: 'actorSearch',
      status: 'skip',
      title,
      summary: `${appview.name} didn’t answer an account search (${actorSearch.message}), so this wasn’t checked.`,
    };
  }
  const { inSearch, inTypeahead } = actorSearch.value;
  if (inSearch) return { id: 'actorSearch', status: 'pass', title, summary: `Searching for ${handle} finds it.` };
  const selfHidden =
    profile?.state === 'found' &&
    profile.labels.some((label) => label.val === NO_UNAUTHENTICATED && label.src === identity?.did);
  if (selfHidden) {
    return {
      id: 'actorSearch',
      status: 'info',
      title,
      summary: `Searching for ${handle} doesn’t find it. That’s expected, because the account asks to be hidden from people who aren’t signed in, and this search runs signed out.`,
    };
  }
  if (inTypeahead) {
    return {
      id: 'actorSearch',
      status: 'fail',
      title,
      summary: `Searching for ${handle} doesn’t find it, but typeahead does. ${appview.name} has the account and is leaving it out of search.`,
    };
  }
  return {
    id: 'actorSearch',
    status: 'warn',
    title,
    summary: `Neither search nor typeahead finds ${handle}. ${appview.name} may not have indexed the handle yet.`,
  };
}

function postSearchCheck(evidence: Evidence, now: number): ShadowbanCheck {
  const { appview, postSearch, posts, shown, done } = evidence;
  const title = 'Posts in search';
  if (!postSearch) {
    return done
      ? { id: 'postSearch', status: 'skip', title, summary: 'Not checked.' }
      : { id: 'postSearch', status: 'pending', title, summary: 'Searching…' };
  }
  if (!postSearch.ok) {
    return {
      id: 'postSearch',
      status: 'skip',
      title,
      summary: `${appview.name} didn’t answer a post search (${postSearch.message}), so this wasn’t checked.`,
    };
  }
  if (!posts?.ok || !shown?.ok) {
    return { id: 'postSearch', status: 'skip', title, summary: 'Not checked, because the latest posts couldn’t be compared.' };
  }
  const visible = new Set(shown.value);
  const eligible = posts.value.filter(
    (post) => visible.has(post.uri) && post.writtenAt !== null && now - post.writtenAt >= SEARCH_GRACE_MS,
  );
  if (eligible.length === 0) {
    return {
      id: 'postSearch',
      status: 'skip',
      title,
      summary: 'None of the latest posts is old enough to be in search yet. Search runs a few minutes behind.',
    };
  }
  const found = new Set(postSearch.value);
  const hits = eligible.filter((post) => found.has(post.uri)).length;
  if (hits === eligible.length) {
    return { id: 'postSearch', status: 'pass', title, summary: `Search finds all ${eligible.length} recent posts.` };
  }
  if (hits === 0) {
    return {
      id: 'postSearch',
      status: 'fail',
      title,
      summary: `Search finds none of the ${eligible.length} recent posts that ${appview.name} returns.`,
    };
  }
  return {
    id: 'postSearch',
    status: 'warn',
    title,
    summary: `Search finds ${hits} of the ${eligible.length} recent posts that ${appview.name} returns.`,
  };
}

function postRecordCheck(evidence: Evidence): ShadowbanCheck {
  const { identity, repo, post } = evidence;
  const title = 'Post on its PDS';
  if (!identity || !post) return { id: 'postRecord', status: 'pending', title, summary: 'Reading the PDS…' };
  const host = hostOf(identity.pds);
  if (repo?.state === 'inactive') {
    return { id: 'postRecord', status: 'skip', title, summary: 'Not checked, because the account isn’t active on its PDS.' };
  }
  if (!post.ok) return { id: 'postRecord', status: 'warn', title, summary: `${host} didn’t answer: ${post.message}` };
  if (!post.value) {
    return {
      id: 'postRecord',
      status: 'warn',
      title,
      summary: `${host} has no post at this address, so it was deleted. There’s nothing for an AppView to hide.`,
    };
  }
  return { id: 'postRecord', status: 'pass', title, summary: `The post is in the account’s repository on ${host}.` };
}

function postCheck(evidence: Evidence, now: number): ShadowbanCheck {
  const { appview, post, postShown } = evidence;
  const title = `Post on ${appview.name}`;
  if (!post) return { id: 'post', status: 'pending', title, summary: 'Comparing…' };
  if (!post.ok || !post.value) {
    return { id: 'post', status: 'skip', title, summary: 'Not checked, because there’s no post to compare.' };
  }
  if (!postShown) return { id: 'post', status: 'pending', title, summary: 'Asking the AppView…' };
  if (!postShown.ok) return { id: 'post', status: 'warn', title, summary: `${appview.name} didn’t answer: ${postShown.message}` };
  const presence = postPresence(post.value, postShown, now);
  if (presence === 'shown') return { id: 'post', status: 'pass', title, summary: `${appview.name} returns the post.` };
  if (presence === 'new') {
    return { id: 'post', status: 'info', title, summary: 'Posted less than two minutes ago. The AppView may not have it yet.' };
  }
  return {
    id: 'post',
    status: 'fail',
    title,
    summary: `The post is on the PDS, but ${appview.name} won’t return it.`,
    detail: ['An AppView also skips posts it can’t read, such as malformed records.'],
  };
}

function threadCheck(evidence: Evidence): ShadowbanCheck {
  const { post, postShown, postThread, identity, done } = evidence;
  const title = 'In its thread';
  const record = post?.ok ? post.value : undefined;
  if (post?.ok && !record) return { id: 'thread', status: 'skip', title, summary: 'Not checked, because there’s no post.' };
  if (record && !record.reply) {
    return { id: 'thread', status: 'skip', title, summary: 'It isn’t a reply, so there’s no thread to check.' };
  }
  if (postShown?.ok && record && !postShown.value.includes(record.uri)) {
    return { id: 'thread', status: 'skip', title, summary: 'Not checked, because the AppView doesn’t return the post at all.' };
  }
  if (!postThread) {
    return done
      ? { id: 'thread', status: 'skip', title, summary: 'Not checked.' }
      : { id: 'thread', status: 'pending', title, summary: 'Opening the thread…' };
  }
  if (!postThread.ok) return { id: 'thread', status: 'warn', title, summary: postThread.message };
  // Asked about this one post, a reply left out for a reason anyone can see
  // is still worth a warning: it is the thing that was asked about.
  const reading = readReply(postThread.value, identity?.did ?? '');
  const status: CheckStatus = {
    shown: 'pass',
    hidden: 'fail',
    explained: 'warn',
    unknown: 'info',
  }[reading.outcome] as CheckStatus;
  return { id: 'thread', status, title, summary: reading.reason };
}

/** The checks about the post that was asked about. None when an account was. */
export function buildPostChecks(evidence: Evidence, now: number): ShadowbanCheck[] {
  if (evidence.target.kind !== 'post') return [];
  return [postRecordCheck(evidence), postCheck(evidence, now), threadCheck(evidence)];
}

/** The checks about the account, which run whether an account or a post was asked about. */
export function buildAccountChecks(evidence: Evidence, now: number): ShadowbanCheck[] {
  return [
    pdsCheck(evidence),
    profileCheck(evidence),
    postsCheck(evidence, now),
    threadsCheck(evidence),
    actorSearchCheck(evidence),
    postSearchCheck(evidence, now),
  ];
}

/**
 * Every check for what has been observed so far: the post's first, when a
 * post was asked about, then the account's. `now` is when the comparison is
 * made, so the grace periods can be tested.
 */
export function buildChecks(evidence: Evidence, now: number): ShadowbanCheck[] {
  return [...buildPostChecks(evidence, now), ...buildAccountChecks(evidence, now)];
}

const POST_CHECK_IDS: ReadonlySet<ShadowbanCheck['id']> = new Set(['postRecord', 'post', 'thread']);

export type ShadowbanVerdict = {
  tone: 'pass' | 'warn' | 'fail' | 'pending';
  title: string;
  text: string;
};

/** The answer in one line, from the checks. */
export function shadowbanVerdict(evidence: Evidence, checks: ShadowbanCheck[]): ShadowbanVerdict {
  const name = evidence.appview.name;
  const isPost = evidence.target.kind === 'post';
  const by = (id: ShadowbanCheck['id']) => checks.find((check) => check.id === id);

  if (checks.some((check) => check.status === 'pending')) {
    return {
      tone: 'pending',
      title: `Checking on ${name}`,
      text: 'Reading the posts from the PDS and asking the AppView for the same ones.',
    };
  }
  if (evidence.repo?.state === 'inactive') {
    return { tone: 'warn', title: 'The account isn’t active on its PDS', text: by('pds')?.summary ?? '' };
  }
  const profile = evidence.profile;
  if (profile?.state === 'suspended') {
    return { tone: 'fail', title: `Suspended on ${name}`, text: by('profile')?.summary ?? '' };
  }
  if (profile?.state === 'missing') {
    return { tone: 'fail', title: `${name} doesn’t show this account`, text: by('profile')?.summary ?? '' };
  }
  // No answer about the profile or the posts leaves nothing compared, which
  // must not read as "nothing hidden".
  if (profile?.state === 'error' && (!evidence.shown || !evidence.shown.ok)) {
    return {
      tone: 'warn',
      title: `${name} didn’t answer`,
      text: `Nothing could be compared. Check that ${hostOf(evidence.appview.origin)} is an AppView that accepts requests from a browser.`,
    };
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const postFailed = failed.filter((check) => POST_CHECK_IDS.has(check.id));
  const accountFailed = failed.filter((check) => !POST_CHECK_IDS.has(check.id));
  const summaries = (list: ShadowbanCheck[]) => list.map((check) => check.summary).join(' ');
  const deleted = isPost && evidence.post?.ok === true && evidence.post.value === null;

  // A post that was asked about leads the answer, but the account's own
  // findings are never dropped from it.
  if (accountFailed.length > 0) {
    const lead = !isPost
      ? ''
      : deleted
        ? 'This post was deleted. '
        : postFailed.length > 0
          ? `${summaries(postFailed)} `
          : `The post itself shows on ${name}. `;
    return { tone: 'fail', title: `Possible shadowban on ${name}`, text: `${lead}${summaries(accountFailed)}` };
  }
  if (deleted) {
    return { tone: 'warn', title: 'This post was deleted', text: by('postRecord')?.summary ?? '' };
  }
  if (postFailed.length > 0) {
    return { tone: 'fail', title: `This post is hidden on ${name}`, text: summaries(postFailed) };
  }
  const warned = checks.filter((check) => check.status === 'warn');
  if (warned.length > 0) {
    return {
      tone: 'warn',
      title: `No shadowban found on ${name}, with ${warned.length === 1 ? 'one warning' : `${warned.length} warnings`}`,
      text: warned.map((check) => check.summary).join(' '),
    };
  }
  return {
    tone: 'pass',
    title: `No shadowban found on ${name}`,
    text: isPost ? `${name} shows the post and everything else that was checked.` : `${name} shows everything that was checked.`,
  };
}
