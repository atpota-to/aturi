/**
 * The shadowban checker's requests. What the answers mean is in shadowban.ts.
 *
 * Everything answers a browser directly, so nothing goes through this site's
 * server:
 *
 *   - The account's identity: the handle resolved and the DID document read,
 *     for where its repository lives.
 *   - Its PDS, for the repository as it is.
 *   - The AppView being checked, asked logged out for the same records.
 *   - Slingshot, for a thread's reply rules, and Constellation, for blocks:
 *     both only for a reply the AppView left out, to see whether something
 *     anyone can see explains it.
 */

import { CONSTELLATION, PLC_DIRECTORY, SLINGSHOT } from '@/utils/atproto/config';
import { resolveHandle } from '@/utils/atproto/identity';
import { getRecord, getRepoStatus, listRecordsPage } from '@/utils/atproto/pdsClient';
import { mapWithConcurrency } from '@/utils/atproto/slingshot';
import { isValidDid } from '@/utils/atproto/spaceUri';
import {
  POST_COLLECTION,
  RECENT_POSTS,
  authorOf,
  placeReply,
  readProfileFailure,
  readRepoPost,
  repliesToCheck,
  type ActorSearch,
  type AppView,
  type Evidence,
  type Identity,
  type Probe,
  type ProfileState,
  type RepoPost,
  type RepoState,
  type ReplyProbe,
  type ShadowbanTarget,
} from './shadowban';

/** Threads opened at once. */
const THREAD_CONCURRENCY = 4;

type DidDocument = {
  alsoKnownAs?: string[];
  service?: { id: string; type?: string; serviceEndpoint?: unknown }[];
};

async function readDocument(res: Response): Promise<DidDocument> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as DidDocument;
}

/**
 * A DID document, read from the browser. did:plc documents come from
 * plc.directory, which allows cross-origin reads. A did:web document is on
 * its own host, which often does not, so a direct read that fails is retried
 * through the same-origin /api/did-doc proxy the OAuth client uses.
 */
async function fetchDidDocument(did: string, signal: AbortSignal): Promise<DidDocument> {
  if (did.startsWith('did:plc:')) {
    return readDocument(await fetch(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`, { signal }));
  }
  if (!did.startsWith('did:web:')) throw new Error('Only did:plc and did:web can be resolved');
  const [host, ...path] = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
  const url = path.length ? `https://${host}/${path.join('/')}/did.json` : `https://${host}/.well-known/did.json`;
  try {
    return await readDocument(await fetch(url, { signal }));
  } catch (err) {
    if (signal.aborted) throw err;
    return readDocument(await fetch(`/api/did-doc?url=${encodeURIComponent(url)}`, { signal }));
  }
}

/** The PDS a DID document names, without a trailing slash. */
function pdsFrom(document: DidDocument): string | null {
  const service =
    document.service?.find((s) => s.id === '#atproto_pds' || s.id.endsWith('#atproto_pds')) ??
    document.service?.find((s) => s.type === 'AtprotoPersonalDataServer');
  return typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint.replace(/\/$/, '') : null;
}

/** The handle a DID document claims first, if any. */
function claimedHandle(document: DidDocument): string | null {
  const aka = (document.alsoKnownAs ?? []).find((entry) => /^at:\/\//i.test(entry));
  return aka ? aka.slice('at://'.length).toLowerCase() : null;
}

type XrpcAnswer<T> =
  | { ok: true; body: T }
  | { ok: false; status: number; error: string | null; message: string | null };

/** A query to the AppView. A failure is an answer too, unless the run was abandoned. */
async function xrpc<T>(
  origin: string,
  nsid: string,
  params: [string, string][],
  signal: AbortSignal,
): Promise<XrpcAnswer<T>> {
  let res: Response;
  try {
    res = await fetch(`${origin}/xrpc/${nsid}?${new URLSearchParams(params)}`, { signal });
  } catch (err) {
    if (signal.aborted) throw err;
    return { ok: false, status: 0, error: null, message: null };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
    return {
      ok: false,
      status: res.status,
      error: typeof body?.error === 'string' ? body.error : null,
      message: typeof body?.message === 'string' && body.message ? body.message : null,
    };
  }
  try {
    return { ok: true, body: (await res.json()) as T };
  } catch {
    return { ok: false, status: res.status, error: null, message: 'the answer was not JSON' };
  }
}

/** What went wrong, in a few words. A status of 0 is a request that never got an answer. */
function failureWords(answer: { status: number; error: string | null; message: string | null }): string {
  if (answer.status === 0) return 'the host is down, or does not take requests from a browser';
  return answer.message ?? answer.error ?? `HTTP ${answer.status}`;
}

function pdsFailure(err: unknown): string {
  const status = (err as { status?: number }).status;
  return status ? `HTTP ${status}` : 'no answer';
}

/* -------------------------------------------------------------------------- *
 * The account and its repository
 * -------------------------------------------------------------------------- */

async function resolveIdentity(actor: string, signal: AbortSignal): Promise<Identity> {
  const did = actor.startsWith('did:') ? actor : await resolveHandle(actor);
  if (!did || !isValidDid(did)) {
    throw new Error(`${actor} does not resolve to an account. Check the spelling, or use its DID.`);
  }
  let document;
  try {
    document = await fetchDidDocument(did, signal);
  } catch (err) {
    if (signal.aborted) throw err;
    throw new Error(`The DID document for ${did} could not be read, so its PDS is unknown.`);
  }
  const pds = pdsFrom(document);
  if (!pds) throw new Error(`The DID document for ${did} names no PDS, so there is no repository to compare with.`);
  return { did, handle: actor.startsWith('did:') ? claimedHandle(document) : actor, pds };
}

async function readRepo(identity: Identity): Promise<RepoState> {
  try {
    const status = await getRepoStatus(identity.pds, identity.did);
    return status.active ? { state: 'active' } : { state: 'inactive', status: status.status ?? null };
  } catch (err) {
    return { state: 'unknown', message: pdsFailure(err) };
  }
}

async function readRecentPosts(identity: Identity): Promise<Probe<RepoPost[]>> {
  try {
    // listRecords lists newest first by record key, which for a post is the
    // time it was written.
    const page = await listRecordsPage(identity.pds, {
      repo: identity.did,
      collection: POST_COLLECTION,
      limit: RECENT_POSTS,
    });
    return { ok: true, value: (page.records ?? []).map(readRepoPost) };
  } catch (err) {
    return { ok: false, message: pdsFailure(err) };
  }
}

/** The one post asked about, or none when the repository has no such record. */
async function readOnePost(identity: Identity, rkey: string): Promise<Probe<RepoPost[]>> {
  try {
    const record = await getRecord(identity.pds, { repo: identity.did, collection: POST_COLLECTION, rkey });
    return { ok: true, value: [readRepoPost(record)] };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 404) return { ok: true, value: [] };
    return { ok: false, message: pdsFailure(err) };
  }
}

/* -------------------------------------------------------------------------- *
 * The AppView
 * -------------------------------------------------------------------------- */

type ProfileBody = {
  handle?: string;
  displayName?: string;
  avatar?: string;
  labels?: { val?: unknown; src?: unknown }[];
};

async function readProfile(origin: string, did: string, signal: AbortSignal): Promise<ProfileState> {
  const answer = await xrpc<ProfileBody>(origin, 'app.bsky.actor.getProfile', [['actor', did]], signal);
  if (!answer.ok) {
    if (answer.status === 0) return { state: 'error', message: failureWords(answer) };
    return readProfileFailure(answer.status, answer.error, answer.message);
  }
  const profile = answer.body;
  return {
    state: 'found',
    handle: profile.handle && profile.handle !== 'handle.invalid' ? profile.handle : null,
    displayName: profile.displayName?.trim() || null,
    avatar: profile.avatar ?? null,
    labels: (profile.labels ?? []).flatMap((label) =>
      typeof label.val === 'string' && typeof label.src === 'string' ? [{ val: label.val, src: label.src }] : [],
    ),
  };
}

/** Which of the posts the AppView returns. One request: getPosts takes up to 25. */
async function readShown(origin: string, posts: RepoPost[], signal: AbortSignal): Promise<Probe<string[]>> {
  const answer = await xrpc<{ posts?: { uri?: unknown }[] }>(
    origin,
    'app.bsky.feed.getPosts',
    posts.map((post): [string, string] => ['uris', post.uri]),
    signal,
  );
  if (!answer.ok) return { ok: false, message: failureWords(answer) };
  return {
    ok: true,
    value: (answer.body.posts ?? []).flatMap((post) => (typeof post.uri === 'string' ? [post.uri] : [])),
  };
}

/* -------------------------------------------------------------------------- *
 * Replies
 * -------------------------------------------------------------------------- */

/** Ask for the parent's thread, one level down, and look for the reply in it. */
async function findInThread(origin: string, post: RepoPost, signal: AbortSignal): Promise<ReplyProbe> {
  const { parent, root } = post.reply as { parent: string; root: string };
  const base = { uri: post.uri, parent, root };
  const answer = await xrpc<{ thread?: { $type?: string; replies?: unknown } }>(
    origin,
    'app.bsky.feed.getPostThread',
    [
      ['uri', parent],
      ['depth', '1'],
      ['parentHeight', '0'],
    ],
    signal,
  );
  if (!answer.ok) {
    if (answer.error === 'NotFound') return { ...base, thread: 'no-parent' };
    return { ...base, thread: 'error', message: failureWords(answer) };
  }
  const thread = answer.body.thread;
  if (thread?.$type !== 'app.bsky.feed.defs#threadViewPost') return { ...base, thread: 'no-parent' };
  return { ...base, thread: placeReply(post.uri, thread.replies) };
}

/**
 * The thread's reply rules, from the threadgate record beside its root,
 * read through Slingshot as the post inspector reads it. No record is the
 * ordinary case and means anyone may reply.
 */
async function readGate(reply: ReplyProbe, signal: AbortSignal): Promise<ReplyProbe['gate']> {
  const match = /^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/.exec(reply.root);
  if (!match) return null;
  const gate = `at://${match[1]}/app.bsky.feed.threadgate/${match[2]}`;
  try {
    const res = await fetch(
      `${SLINGSHOT}/xrpc/blue.microcosm.repo.getRecordByUri?at_uri=${encodeURIComponent(gate)}`,
      { signal },
    );
    if (res.status === 400 || res.status === 404) return { restricted: false, hidden: false };
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: { allow?: unknown; hiddenReplies?: unknown } };
    const value = body.value ?? {};
    return {
      // `allow` absent means anyone may reply; any list, even an empty one, limits it.
      restricted: Array.isArray(value.allow),
      hidden: Array.isArray(value.hiddenReplies) && value.hiddenReplies.includes(reply.uri),
    };
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

/** Whether `blocker` has a block record naming `blocked`, from Constellation. Null when it did not answer. */
async function hasBlocked(blocker: string, blocked: string, signal: AbortSignal): Promise<boolean | null> {
  const params = new URLSearchParams({
    subject: blocked,
    source: 'app.bsky.graph.block:subject',
    did: blocker,
    limit: '1',
  });
  try {
    const res = await fetch(`${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?${params}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { total?: unknown; records?: unknown[] };
    return (typeof body.total === 'number' && body.total > 0) || (body.records?.length ?? 0) > 0;
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

/**
 * A block either way between the replier and the authors of the parent and
 * the root. Blocks made by subscribing to a moderation list are not records
 * naming the account, so they are not found here.
 */
async function readBlock(reply: ReplyProbe, author: string, signal: AbortSignal): Promise<ReplyProbe['block']> {
  const others = [...new Set([authorOf(reply.parent), authorOf(reply.root)])].filter(
    (did) => did && did !== author,
  );
  if (others.length === 0) return { found: false };
  const answers = await Promise.all(
    others.flatMap((other) => [hasBlocked(author, other, signal), hasBlocked(other, author, signal)]),
  );
  if (answers.some((answer) => answer === true)) return { found: true };
  return answers.some((answer) => answer === null) ? null : { found: false };
}

async function checkReplies(
  origin: string,
  author: string,
  replies: RepoPost[],
  signal: AbortSignal,
): Promise<Probe<ReplyProbe[]>> {
  const probes = await mapWithConcurrency(replies, THREAD_CONCURRENCY, async (reply) => {
    const probe = await findInThread(origin, reply, signal);
    if (probe.thread !== 'absent') return probe;
    const [gate, block] = await Promise.all([readGate(probe, signal), readBlock(probe, author, signal)]);
    return { ...probe, gate, block };
  });
  return { ok: true, value: probes };
}

/* -------------------------------------------------------------------------- *
 * Search
 * -------------------------------------------------------------------------- */

type ActorsBody = { actors?: { did?: unknown }[] };

async function searchActor(origin: string, identity: Identity, signal: AbortSignal): Promise<Probe<ActorSearch>> {
  const handle = identity.handle as string;
  const [search, typeahead] = await Promise.all([
    xrpc<ActorsBody>(origin, 'app.bsky.actor.searchActors', [['q', handle], ['limit', '25']], signal),
    xrpc<ActorsBody>(origin, 'app.bsky.actor.searchActorsTypeahead', [['q', handle], ['limit', '10']], signal),
  ]);
  if (!search.ok) return { ok: false, message: failureWords(search) };
  const has = (body: ActorsBody) => (body.actors ?? []).some((actor) => actor.did === identity.did);
  return {
    ok: true,
    value: { inSearch: has(search.body), inTypeahead: typeahead.ok ? has(typeahead.body) : null },
  };
}

/**
 * The account's latest posts in post search. `q` is required, and `*` with
 * an `author` lists everything that author has in the index.
 */
async function searchPosts(origin: string, did: string, signal: AbortSignal): Promise<Probe<string[]>> {
  const answer = await xrpc<{ posts?: { uri?: unknown }[] }>(
    origin,
    'app.bsky.feed.searchPosts',
    [
      ['q', '*'],
      ['author', did],
      ['sort', 'latest'],
      ['limit', String(RECENT_POSTS)],
    ],
    signal,
  );
  if (!answer.ok) return { ok: false, message: failureWords(answer) };
  return {
    ok: true,
    value: (answer.body.posts ?? []).flatMap((post) => (typeof post.uri === 'string' ? [post.uri] : [])),
  };
}

/* -------------------------------------------------------------------------- *
 * The run
 * -------------------------------------------------------------------------- */

/**
 * Gather the evidence for an account or a post, publishing as each part
 * arrives so the check list fills in step by step. Only an account that
 * cannot be found is thrown; every other failure is recorded as evidence.
 */
export async function investigate(
  target: ShadowbanTarget,
  appview: AppView,
  signal: AbortSignal,
  publish: (evidence: Evidence) => void,
): Promise<Evidence> {
  let evidence: Evidence = { target, appview, checkedAt: Date.now() };
  const update = (patch: Partial<Evidence>) => {
    evidence = { ...evidence, ...patch };
    if (!signal.aborted) publish(evidence);
  };
  publish(evidence);

  const identity = await resolveIdentity(target.actor, signal);
  update({ identity });

  const { origin } = appview;
  const isPost = target.kind === 'post';
  await Promise.all([
    readRepo(identity).then((repo) => update({ repo })),
    readProfile(origin, identity.did, signal).then((profile) => update({ profile })),
    (async () => {
      const posts = isPost ? await readOnePost(identity, target.rkey) : await readRecentPosts(identity);
      update({ posts });
      if (!posts.ok || posts.value.length === 0) return;
      const shown = await readShown(origin, posts.value, signal);
      update({ shown });
      if (!shown.ok) return;
      const replies = isPost
        ? posts.value.filter((post) => post.reply && shown.value.includes(post.uri))
        : repliesToCheck(posts.value, shown.value);
      if (isPost && replies.length === 0) return;
      update({ replies: await checkReplies(origin, identity.did, replies, signal) });
    })(),
    isPost ? null : searchPosts(origin, identity.did, signal).then((postSearch) => update({ postSearch })),
    isPost || !identity.handle
      ? null
      : searchActor(origin, identity, signal).then((actorSearch) => update({ actorSearch })),
  ]);

  update({ done: true });
  return evidence;
}
