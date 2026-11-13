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

import { tidToDate } from '@/utils/atproto/tid';
import { NOT_LABELLED, parseSubjectInput, type LabelInput, type LabelTarget } from './labels';
import { normalizeHostUrl } from './xrpc';

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

export type ShadowbanTarget = LabelTarget;

/** The reason given for a record that is neither an account nor a post. */
export const NOT_CHECKED = 'This checks accounts and posts. Enter a handle, a DID, or a link to a post.';

/**
 * A handle, a DID, an at:// URI, or a profile or post link. The label
 * checker reads the same things, so its reader is borrowed; only its word
 * for "not an account or a post" is about labels.
 */
export function parseShadowbanInput(raw: string): LabelInput {
  const input = parseSubjectInput(raw);
  if (!input.ok && input.reason === NOT_LABELLED) return { ok: false, reason: NOT_CHECKED };
  return input;
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
  /**
   * From the PDS. For an account, its most recent posts. For a post, that
   * post alone, or none when the repository has no such record.
   */
  posts?: Probe<RepoPost[]>;
  /** Of `posts`, the URIs the AppView returned. */
  shown?: Probe<string[]>;
  replies?: Probe<ReplyProbe[]>;
  actorSearch?: Probe<ActorSearch>;
  /** URIs of the account's posts that post search returned. */
  postSearch?: Probe<string[]>;
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
      return { outcome: 'shown', label: 'In its thread', reason: 'Listed among the replies to the post it answers.' };
    case 'crowded':
      return {
        outcome: 'unknown',
        label: 'Thread too long to tell',
        reason: `The post it answers has more replies than the ${THREAD_REPLY_CAP} an AppView lists at once.`,
      };
    case 'no-parent':
      return {
        outcome: 'unknown',
        label: 'Parent not shown',
        reason: 'The post it answers is not on the AppView, so there is no thread for it to appear in.',
      };
    case 'error':
      return {
        outcome: 'unknown',
        label: 'Thread did not load',
        reason: reply.message ? `The thread could not be read: ${reply.message}` : 'The thread could not be read.',
      };
    case 'absent':
      break;
  }

  const ownThread = authorOf(reply.root) === author && authorOf(reply.parent) === author;
  if (reply.gate?.hidden && authorOf(reply.root) !== author) {
    return {
      outcome: 'explained',
      label: 'Hidden by the thread’s author',
      reason: 'The author of the thread hid this reply, which they are free to do.',
    };
  }
  if (reply.block?.found) {
    return {
      outcome: 'explained',
      label: 'Block in the thread',
      reason: 'This account and an author further up the thread block one another, and AppViews leave replies out across a block.',
    };
  }
  if (reply.gate?.restricted && authorOf(reply.root) !== author) {
    return {
      outcome: 'explained',
      label: 'Thread limits replies',
      reason: 'The thread’s author limits who can reply, and a reply from outside that rule is kept out of the thread.',
    };
  }
  const unchecked = [
    reply.block === null && !ownThread ? 'blocks' : null,
    reply.gate === null && !ownThread ? 'the thread’s reply rules' : null,
  ].filter(Boolean);
  return {
    outcome: 'hidden',
    label: 'Missing from its thread',
    reason: ownThread
      ? 'A reply in the account’s own thread, left out. No block or reply rule applies to that.'
      : `Left out of the thread, with no block or reply rule to explain it.${
          unchecked.length ? ` (Could not check ${unchecked.join(' or ')}.)` : ''
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
  id: 'pds' | 'profile' | 'posts' | 'threads' | 'actorSearch' | 'postSearch' | 'post' | 'thread';
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
  const isPost = evidence.target.kind === 'post';
  const title = isPost ? 'Post on its PDS' : 'Account on its PDS';
  const { identity, repo, posts } = evidence;
  if (!identity || !repo || (isPost && !posts)) {
    return { id: 'pds', status: 'pending', title, summary: 'Reading the repository…' };
  }
  const host = hostOf(identity.pds);
  if (repo.state === 'inactive') {
    return {
      id: 'pds',
      status: 'warn',
      title,
      summary: `${host} reports the account as ${repo.status ?? 'inactive'}. An AppView stops showing an account its own PDS has switched off.`,
    };
  }
  if (isPost && posts) {
    if (!posts.ok) return { id: 'pds', status: 'warn', title, summary: `${host} did not answer: ${posts.message}` };
    if (posts.value.length === 0) {
      return {
        id: 'pds',
        status: 'warn',
        title,
        summary: `${host} has no record at this address. The post was deleted, so there is nothing for an AppView to hide.`,
      };
    }
    return { id: 'pds', status: 'pass', title, summary: `The record is in the repository on ${host}.` };
  }
  if (repo.state === 'unknown') {
    return { id: 'pds', status: 'info', title, summary: `${host} did not say whether the account is active: ${repo.message}` };
  }
  return { id: 'pds', status: 'pass', title, summary: `Active on ${host}.` };
}

function profileCheck(evidence: Evidence): ShadowbanCheck {
  const { appview, profile, identity } = evidence;
  const title = evidence.target.kind === 'post' ? `Author on ${appview.name}` : `Profile on ${appview.name}`;
  if (!profile) return { id: 'profile', status: 'pending', title, summary: 'Asking the AppView…' };
  switch (profile.state) {
    case 'suspended':
      return {
        id: 'profile',
        status: 'fail',
        title,
        summary: `${appview.name} answers “${profile.message}”. That is a suspension it owns up to, not a hidden one.`,
      };
    case 'deactivated':
      return { id: 'profile', status: 'info', title, summary: `${appview.name} answers “${profile.message}”.` };
    case 'missing':
      return {
        id: 'profile',
        status: 'fail',
        title,
        summary: `${appview.name} has no profile for the account (“${profile.message}”). It has never indexed it, or has dropped it without saying so.`,
      };
    case 'error':
      return { id: 'profile', status: 'warn', title, summary: `${appview.name} did not answer: ${profile.message}` };
    case 'found':
      break;
  }
  const applied = moderationLabels(profile.labels, identity?.did ?? '');
  const selfHidden = profile.labels.some((label) => label.val === NO_UNAUTHENTICATED && label.src === identity?.did);
  const detail = selfHidden
    ? ['The account labels itself !no-unauthenticated: it asks apps not to show it to people who are not signed in.']
    : undefined;
  if (applied.length > 0) {
    return {
      id: 'profile',
      status: 'warn',
      title,
      summary: `Shown, with ${applied.length === 1 ? 'a label' : 'labels'} from moderation: ${applied.join(', ')}. Labels are moderation in the open; apps say they are there.`,
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
  if (!posts.ok) return { id: 'posts', status: 'skip', title, summary: `The PDS did not list the posts: ${posts.message}` };
  if (posts.value.length === 0) return { id: 'posts', status: 'info', title, summary: 'The account has not written any posts.' };
  if (shown && !shown.ok) return { id: 'posts', status: 'warn', title, summary: `${appview.name} did not answer: ${shown.message}` };

  const presence = posts.value.map((post) => postPresence(post, shown, now));
  const missing = presence.filter((p) => p === 'missing').length;
  const fresh = presence.filter((p) => p === 'new').length;
  const counted = posts.value.length - fresh;
  const freshNote =
    fresh === 0 ? '' : ` ${fresh === 1 ? 'One post' : `${fresh} posts`} under two minutes old ${fresh === 1 ? 'was' : 'were'} not counted.`;
  if (missing > 0) {
    return {
      id: 'posts',
      status: 'fail',
      title,
      summary: `${missing} of the ${counted} most recent posts ${missing === 1 ? 'is' : 'are'} in the repository but not on ${appview.name}.${freshNote}`,
      detail: ['A post an AppView cannot read (an invalid record) goes missing the same way, so open one to be sure.'],
    };
  }
  return {
    id: 'posts',
    status: 'pass',
    title,
    summary: `${appview.name} returns all ${counted} of the most recent posts.${freshNote}`,
  };
}

function threadsCheck(evidence: Evidence): ShadowbanCheck {
  const { replies, identity, done } = evidence;
  const title = 'Replies in their threads';
  if (!replies) {
    return done
      ? { id: 'threads', status: 'skip', title, summary: 'Not checked: the recent posts could not be compared.' }
      : { id: 'threads', status: 'pending', title, summary: 'Opening the threads…' };
  }
  if (!replies.ok) return { id: 'threads', status: 'warn', title, summary: replies.message };
  if (replies.value.length === 0) {
    return { id: 'threads', status: 'skip', title, summary: 'None of the recent posts the AppView returned is a reply.' };
  }
  const readings = replies.value.map((reply) => readReply(reply, identity?.did ?? ''));
  const count = (outcome: ReplyReading['outcome']) => readings.filter((r) => r.outcome === outcome).length;
  const total = readings.length;
  const hidden = count('hidden');
  const explained = count('explained');
  const unknown = count('unknown');
  const notes = [
    explained > 0
      ? `${explained === 1 ? 'One more is' : `${explained} more are`} left out because of a block or a reply rule.`
      : null,
    unknown > 0
      ? `For ${explained > 0 ? 'another' : unknown === 1 ? 'one' : ''}${unknown === 1 ? '' : `${explained > 0 ? ' ' : ''}${unknown}`}, it could not be told.`
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
            ? ' It is a reply in the account’s own thread.'
            : ' All of them are in the account’s own threads.'
          : ` ${own} of them are in the account’s own threads.`;
    return {
      id: 'threads',
      status: 'fail',
      title,
      summary: `${hidden} of ${total} recent replies ${hidden === 1 ? 'is' : 'are'} missing from the thread ${hidden === 1 ? 'it answers' : 'they answer'}, with nothing to explain it.${ownNote}`,
      detail: notes.length ? notes : undefined,
    };
  }
  const shownCount = count('shown');
  if (shownCount === 0) {
    return {
      id: 'threads',
      status: 'info',
      title,
      summary: notes.join(' ') || 'Could not tell.',
    };
  }
  return {
    id: 'threads',
    status: 'pass',
    title,
    summary:
      shownCount === total
        ? total === 1
          ? 'The one recent reply shows under the post it answers.'
          : `${total === 2 ? 'Both' : `All ${total}`} recent replies show under the posts they answer.`
        : `${shownCount} of ${total} recent replies show under the posts they answer. ${notes.join(' ')}`,
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
      summary: `${appview.name} did not answer a search for accounts (${actorSearch.message}), so this was not checked.`,
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
      summary: `Searching for ${handle} leaves it out, as it does every account that asks not to be shown to logged-out visitors. This search is made logged out, so it cannot tell more.`,
    };
  }
  if (inTypeahead) {
    return {
      id: 'actorSearch',
      status: 'fail',
      title,
      summary: `Searching for ${handle} leaves it out, though typeahead finds it by the same name. The AppView has the account and excludes it from search.`,
    };
  }
  return {
    id: 'actorSearch',
    status: 'warn',
    title,
    summary: `Neither search nor typeahead finds ${handle}. The AppView may not have indexed the handle yet.`,
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
      summary: `${appview.name} did not answer a search for posts (${postSearch.message}), so this was not checked.`,
    };
  }
  if (!posts?.ok || !shown?.ok) {
    return { id: 'postSearch', status: 'skip', title, summary: 'Not checked: the recent posts could not be compared.' };
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
      summary: 'None of the recent posts is old enough to have reached search, which lags by a few minutes.',
    };
  }
  const found = new Set(postSearch.value);
  const hits = eligible.filter((post) => found.has(post.uri)).length;
  if (hits === eligible.length) {
    return { id: 'postSearch', status: 'pass', title, summary: `Search finds all ${eligible.length} recent posts it should.` };
  }
  if (hits === 0) {
    return {
      id: 'postSearch',
      status: 'fail',
      title,
      summary: `Search finds none of the ${eligible.length} recent posts that ${appview.name} itself returns.`,
    };
  }
  return {
    id: 'postSearch',
    status: 'warn',
    title,
    summary: `Search finds ${hits} of the ${eligible.length} recent posts that ${appview.name} itself returns.`,
  };
}

function postCheck(evidence: Evidence, now: number): ShadowbanCheck {
  const { appview, posts, shown } = evidence;
  const title = `Post on ${appview.name}`;
  if (!posts) return { id: 'post', status: 'pending', title, summary: 'Comparing…' };
  if (!posts.ok || posts.value.length === 0) {
    return { id: 'post', status: 'skip', title, summary: 'Not checked: there is no record to compare.' };
  }
  if (!shown) return { id: 'post', status: 'pending', title, summary: 'Asking the AppView…' };
  if (!shown.ok) return { id: 'post', status: 'warn', title, summary: `${appview.name} did not answer: ${shown.message}` };
  const presence = postPresence(posts.value[0], shown, now);
  if (presence === 'shown') return { id: 'post', status: 'pass', title, summary: `${appview.name} returns the post.` };
  if (presence === 'new') {
    return { id: 'post', status: 'info', title, summary: 'Written under two minutes ago. The AppView may not have it yet.' };
  }
  return {
    id: 'post',
    status: 'fail',
    title,
    summary: `The record is in the repository, but ${appview.name} will not return it.`,
    detail: ['A record an AppView cannot read (an invalid post) goes missing the same way.'],
  };
}

function threadCheck(evidence: Evidence): ShadowbanCheck {
  const { posts, shown, replies, identity, done } = evidence;
  const title = 'In its thread';
  const post = posts?.ok ? posts.value[0] : undefined;
  if (posts?.ok && !post) return { id: 'thread', status: 'skip', title, summary: 'Not checked: there is no record.' };
  if (post && !post.reply) {
    return { id: 'thread', status: 'skip', title, summary: 'It is not a reply, so there is no thread to be left out of.' };
  }
  if (shown?.ok && post && !shown.value.includes(post.uri)) {
    return { id: 'thread', status: 'skip', title, summary: 'Not checked: the AppView does not return the post at all.' };
  }
  if (!replies) {
    return done
      ? { id: 'thread', status: 'skip', title, summary: 'Not checked.' }
      : { id: 'thread', status: 'pending', title, summary: 'Opening the thread…' };
  }
  if (!replies.ok || replies.value.length === 0) {
    return { id: 'thread', status: 'warn', title, summary: replies.ok ? 'Not checked.' : replies.message };
  }
  // Asked about this one post, a reply left out for a reason anyone can see
  // is still worth a warning: it is the thing that was asked about.
  const reading = readReply(replies.value[0], identity?.did ?? '');
  const status: CheckStatus = {
    shown: 'pass',
    hidden: 'fail',
    explained: 'warn',
    unknown: 'info',
  }[reading.outcome] as CheckStatus;
  return { id: 'thread', status, title, summary: reading.reason };
}

/**
 * The checks for what has been observed so far, in the order they are shown.
 * `now` is when the comparison is made, so the grace periods can be tested.
 */
export function buildChecks(evidence: Evidence, now: number): ShadowbanCheck[] {
  if (evidence.target.kind === 'post') {
    return [pdsCheck(evidence), profileCheck(evidence), postCheck(evidence, now), threadCheck(evidence)];
  }
  return [
    pdsCheck(evidence),
    profileCheck(evidence),
    postsCheck(evidence, now),
    threadsCheck(evidence),
    actorSearchCheck(evidence),
    postSearchCheck(evidence, now),
  ];
}

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
      text: 'Reading the repository from its PDS and asking the AppView for the same records.',
    };
  }
  if (evidence.repo?.state === 'inactive') {
    return { tone: 'warn', title: 'The account is not active on its PDS', text: by('pds')?.summary ?? '' };
  }
  if (isPost && evidence.posts?.ok && evidence.posts.value.length === 0) {
    return { tone: 'warn', title: 'This post no longer exists', text: by('pds')?.summary ?? '' };
  }
  const profile = evidence.profile;
  if (profile?.state === 'suspended') {
    return { tone: 'fail', title: `Suspended on ${name}`, text: by('profile')?.summary ?? '' };
  }
  if (profile?.state === 'missing') {
    return { tone: 'fail', title: `${name} does not show this account`, text: by('profile')?.summary ?? '' };
  }
  // No answer about the profile or the posts leaves nothing compared, which
  // must not read as "nothing hidden".
  if (profile?.state === 'error' && (!evidence.shown || !evidence.shown.ok)) {
    return {
      tone: 'warn',
      title: `${name} did not answer`,
      text: `Nothing could be compared: ${profile.message}. Check that ${hostOf(evidence.appview.origin)} serves the app.bsky API.`,
    };
  }

  const failed = checks.filter((check) => check.status === 'fail');
  if (failed.length > 0) {
    return {
      tone: 'fail',
      title: isPost ? `Hidden on ${name}` : `Signs of a shadowban on ${name}`,
      text: failed.map((check) => check.summary).join(' '),
    };
  }
  const warned = checks.filter((check) => check.status === 'warn');
  if (warned.length > 0) {
    return {
      tone: 'warn',
      title: `Nothing hidden found on ${name}, with ${warned.length === 1 ? 'one thing' : `${warned.length} things`} to look at`,
      text: warned.map((check) => check.summary).join(' '),
    };
  }
  return {
    tone: 'pass',
    title: `No sign of a shadowban on ${name}`,
    text: isPost
      ? `${name} shows the post wherever its repository says it should be.`
      : `Everything checked in the repository, ${name} shows too.`,
  };
}
