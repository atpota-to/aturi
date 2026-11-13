import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TID } from '@atproto/common-web';
import {
  APPVIEWS,
  DEFAULT_APPVIEW,
  INDEX_GRACE_MS,
  NOT_CHECKED,
  NO_UNAUTHENTICATED,
  SEARCH_GRACE_MS,
  THREAD_REPLY_CAP,
  buildChecks,
  parseShadowbanInput,
  placeReply,
  postPresence,
  readAppViewParam,
  readProfileFailure,
  readReply,
  readRepoPost,
  repliesToCheck,
  shadowbanVerdict,
  type Evidence,
  type ReplyProbe,
  type RepoPost,
  type ShadowbanCheck,
} from '@/lib/tools/shadowban';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const HOUR = 60 * 60_000;

function tidAt(ms: number, clock = 0): string {
  return TID.fromTime(ms * 1000, clock).toString();
}

function post(ageMs: number, reply?: { parent: string; root: string }, clock = 0): RepoPost {
  const rkey = tidAt(NOW - ageMs, clock);
  return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, rkey, text: 'hello', writtenAt: NOW - ageMs, reply: reply ?? null };
}

function otherPost(n: number, author = OTHER): string {
  return `at://${author}/app.bsky.feed.post/${tidAt(NOW - 10 * HOUR - n)}`;
}

function status(checks: ShadowbanCheck[], id: ShadowbanCheck['id']) {
  return checks.find((check) => check.id === id)?.status;
}

/** An account the AppView shows in full: every post returned, search finding it. */
function cleanAccount(): Evidence {
  const posts = [post(2 * HOUR), post(3 * HOUR, { parent: otherPost(1), root: otherPost(1) }), post(5 * HOUR)];
  return {
    target: { kind: 'account', actor: 'alice.example.com' },
    appview: DEFAULT_APPVIEW,
    identity: { did: DID, handle: 'alice.example.com', pds: 'https://pds.example.com' },
    repo: { state: 'active' },
    profile: { state: 'found', handle: 'alice.example.com', displayName: 'Alice', avatar: null, labels: [] },
    posts: { ok: true, value: posts },
    shown: { ok: true, value: posts.map((p) => p.uri) },
    replies: {
      ok: true,
      value: [{ uri: posts[1].uri, parent: otherPost(1), root: otherPost(1), thread: 'shown' }],
    },
    actorSearch: { ok: true, value: { inSearch: true, inTypeahead: true } },
    postSearch: { ok: true, value: posts.map((p) => p.uri) },
    done: true,
  };
}

// --- which AppView ----------------------------------------------------------

test('readAppViewParam defaults to Bluesky and reads listed ids in any case', () => {
  assert.deepEqual(readAppViewParam(''), { ok: true, appview: DEFAULT_APPVIEW });
  assert.equal(DEFAULT_APPVIEW.origin, 'https://api.bsky.app');
  assert.deepEqual(readAppViewParam('Blacksky'), { ok: true, appview: APPVIEWS[1] });
});

test('readAppViewParam maps a listed AppView’s host back to its entry', () => {
  assert.deepEqual(readAppViewParam('api.bsky.app'), { ok: true, appview: DEFAULT_APPVIEW });
  assert.deepEqual(readAppViewParam('https://api.blacksky.community/'), { ok: true, appview: APPVIEWS[1] });
});

test('readAppViewParam takes any other host, and its parameter reads back to the same place', () => {
  const typed = readAppViewParam('https://appview.example.com/xrpc');
  assert.deepEqual(typed, {
    ok: true,
    appview: { param: 'appview.example.com', name: 'appview.example.com', origin: 'https://appview.example.com', listed: false },
  });
  assert.ok(typed.ok);
  assert.deepEqual(readAppViewParam(typed.appview.param), typed);

  const local = readAppViewParam('http://localhost:2584');
  assert.ok(local.ok);
  assert.equal(local.appview.origin, 'http://localhost:2584');
  assert.deepEqual(readAppViewParam(local.appview.param), local);
});

test('readAppViewParam refuses plain http to another machine', () => {
  const choice = readAppViewParam('http://appview.example.com');
  assert.equal(choice.ok, false);
});

// --- what was asked about ---------------------------------------------------

test('parseShadowbanInput reads accounts and posts, and refuses other records in its own words', () => {
  assert.deepEqual(parseShadowbanInput('@Alice.Example.com'), {
    ok: true,
    target: { kind: 'account', actor: 'alice.example.com' },
  });
  assert.deepEqual(parseShadowbanInput('https://bsky.app/profile/alice.example.com/post/3kabc'), {
    ok: true,
    target: { kind: 'post', actor: 'alice.example.com', rkey: '3kabc' },
  });
  assert.deepEqual(parseShadowbanInput(`at://${DID}/app.bsky.graph.list/3kabc`), { ok: false, reason: NOT_CHECKED });
});

// --- reading records and answers --------------------------------------------

test('readRepoPost takes the time from a TID key and the thread from the reply refs', () => {
  const rkey = tidAt(NOW - HOUR);
  const parent = otherPost(1);
  const root = otherPost(2);
  const read = readRepoPost({
    uri: `at://${DID}/app.bsky.feed.post/${rkey}`,
    value: { text: 'hi', createdAt: '2020-01-01T00:00:00.000Z', reply: { parent: { uri: parent }, root: { uri: root } } },
  });
  assert.equal(read.writtenAt, NOW - HOUR);
  assert.deepEqual(read.reply, { parent, root });
  assert.equal(read.text, 'hi');
});

test('readRepoPost falls back to createdAt for a key that is not a TID, and to the parent for a missing root', () => {
  const read = readRepoPost({
    uri: `at://${DID}/app.bsky.feed.post/custom-key`,
    value: { createdAt: '2026-11-13T11:00:00.000Z', reply: { parent: { uri: otherPost(1) } } },
  });
  assert.equal(read.writtenAt, Date.parse('2026-11-13T11:00:00.000Z'));
  assert.deepEqual(read.reply, { parent: otherPost(1), root: otherPost(1) });
  assert.equal(read.text, '');
});

test('readProfileFailure tells a suspension from a deactivation from an unknown account', () => {
  assert.equal(readProfileFailure(400, 'AccountTakedown', 'Account has been suspended').state, 'suspended');
  assert.equal(readProfileFailure(400, 'AccountDeactivated', 'Account is deactivated').state, 'deactivated');
  assert.equal(readProfileFailure(400, 'InvalidRequest', 'Profile not found').state, 'missing');
  assert.equal(readProfileFailure(502, null, null).state, 'error');
});

test('placeReply finds a reply as a thread view or a bare entry, and gives up on a full thread', () => {
  const uri = post(HOUR).uri;
  assert.equal(placeReply(uri, [{ post: { uri: otherPost(3) } }, { post: { uri } }]), 'shown');
  assert.equal(placeReply(uri, [{ $type: 'app.bsky.feed.defs#blockedPost', uri }]), 'shown');
  assert.equal(placeReply(uri, [{ post: { uri: otherPost(3) } }]), 'absent');
  assert.equal(placeReply(uri, undefined), 'absent');
  const full = Array.from({ length: THREAD_REPLY_CAP }, (_, n) => ({ post: { uri: otherPost(n) } }));
  assert.equal(placeReply(uri, full), 'crowded');
});

test('repliesToCheck keeps replies the AppView returned, newest first, up to the limit', () => {
  const a = post(HOUR, { parent: otherPost(1), root: otherPost(1) }, 1);
  const b = post(2 * HOUR, { parent: otherPost(2), root: otherPost(2) }, 2);
  const c = post(3 * HOUR);
  const d = post(4 * HOUR, { parent: otherPost(3), root: otherPost(3) }, 3);
  assert.deepEqual(repliesToCheck([a, b, c, d], [a.uri, c.uri, d.uri]), [a, d]);
  assert.deepEqual(repliesToCheck([a, b, c, d], [a.uri, b.uri, d.uri], 2), [a, b]);
});

test('postPresence allows a post too new to have been indexed', () => {
  const fresh = post(INDEX_GRACE_MS / 2);
  const old = post(INDEX_GRACE_MS * 2);
  const shown = { ok: true as const, value: [] };
  assert.equal(postPresence(fresh, shown, NOW), 'new');
  assert.equal(postPresence(old, shown, NOW), 'missing');
  assert.equal(postPresence(old, { ok: true, value: [old.uri] }, NOW), 'shown');
  assert.equal(postPresence(old, undefined, NOW), 'pending');
});

// --- what a missing reply means ---------------------------------------------

function absent(patch: Partial<ReplyProbe> = {}): ReplyProbe {
  return { uri: post(HOUR).uri, parent: otherPost(1), root: otherPost(1), thread: 'absent', gate: { restricted: false, hidden: false }, block: { found: false }, ...patch };
}

test('readReply calls an unexplained absence hidden', () => {
  assert.equal(readReply(absent(), DID).outcome, 'hidden');
  assert.equal(readReply({ ...absent(), thread: 'shown' }, DID).outcome, 'shown');
});

test('readReply explains an absence by a block, a hidden reply, or the thread’s reply rules', () => {
  assert.equal(readReply(absent({ block: { found: true } }), DID).outcome, 'explained');
  assert.equal(readReply(absent({ gate: { restricted: false, hidden: true } }), DID).outcome, 'explained');
  assert.equal(readReply(absent({ gate: { restricted: true, hidden: false } }), DID).outcome, 'explained');
});

test('readReply does not excuse a missing reply in the account’s own thread with its own rules', () => {
  const ownRoot = post(2 * HOUR).uri;
  const reading = readReply(absent({ parent: ownRoot, root: ownRoot, gate: { restricted: true, hidden: true } }), DID);
  assert.equal(reading.outcome, 'hidden');
  assert.match(reading.reason, /own thread/);
});

test('readReply says when blocks or rules could not be checked', () => {
  const reading = readReply(absent({ block: null, gate: null }), DID);
  assert.equal(reading.outcome, 'hidden');
  assert.match(reading.reason, /Couldn’t check blocks or the thread’s reply limits/);
});

test('readReply cannot tell for a crowded thread, a missing parent or a failed read', () => {
  for (const thread of ['crowded', 'no-parent', 'error'] as const) {
    assert.equal(readReply({ ...absent(), thread }, DID).outcome, 'unknown', thread);
  }
});

// --- an account -------------------------------------------------------------

test('an account the AppView shows in full passes every check', () => {
  const evidence = cleanAccount();
  const checks = buildChecks(evidence, NOW);
  assert.deepEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['pds', 'pass'],
      ['profile', 'pass'],
      ['posts', 'pass'],
      ['threads', 'pass'],
      ['actorSearch', 'pass'],
      ['postSearch', 'pass'],
    ],
  );
  const verdict = shadowbanVerdict(evidence, checks);
  assert.equal(verdict.tone, 'pass');
  assert.equal(verdict.title, 'No shadowban found on Bluesky');
});

test('the checks wait for what has not arrived, and so does the verdict', () => {
  const evidence: Evidence = { target: { kind: 'account', actor: 'alice.example.com' }, appview: DEFAULT_APPVIEW };
  const checks = buildChecks(evidence, NOW);
  assert.ok(checks.every((check) => check.status === 'pending'));
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'pending');
});

test('a post in the repository and not on the AppView is a sign, and a fresh one is not', () => {
  const evidence = cleanAccount();
  assert.ok(evidence.posts?.ok && evidence.shown?.ok);
  const missing = evidence.posts.value[0];
  const fresh = post(INDEX_GRACE_MS / 4, undefined, 9);
  evidence.posts = { ok: true, value: [fresh, ...evidence.posts.value] };
  evidence.shown = { ok: true, value: evidence.shown.value.filter((uri) => uri !== missing.uri) };
  const checks = buildChecks(evidence, NOW);
  const posts = checks.find((check) => check.id === 'posts');
  assert.equal(posts?.status, 'fail');
  assert.match(posts?.summary ?? '', /^1 of the 3 latest posts is on the PDS but missing from Bluesky\. One post from the last two minutes was skipped\./);
  const verdict = shadowbanVerdict(evidence, checks);
  assert.equal(verdict.tone, 'fail');
  assert.equal(verdict.title, 'Possible shadowban on Bluesky');
});

test('a reply missing from its thread is a sign; one left out across a block is not', () => {
  const evidence = cleanAccount();
  assert.ok(evidence.replies?.ok);
  const [reply] = evidence.replies.value;

  evidence.replies = { ok: true, value: [{ ...reply, thread: 'absent', gate: { restricted: false, hidden: false }, block: { found: false } }] };
  let checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'threads'), 'fail');
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'fail');

  evidence.replies = { ok: true, value: [{ ...reply, thread: 'absent', gate: { restricted: false, hidden: false }, block: { found: true } }] };
  checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'threads'), 'info');
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'pass');
});

test('a reply missing from the account’s own thread is said to be so', () => {
  const evidence = cleanAccount();
  const root = post(6 * HOUR).uri;
  evidence.replies = {
    ok: true,
    value: [{ uri: post(HOUR).uri, parent: root, root, thread: 'absent', gate: { restricted: false, hidden: false }, block: { found: false } }],
  };
  const threads = buildChecks(evidence, NOW).find((check) => check.id === 'threads');
  assert.equal(threads?.status, 'fail');
  assert.match(threads?.summary ?? '', /It’s a reply in the account’s own thread\./);
});

test('left out of search but found by typeahead is a sign', () => {
  const evidence = cleanAccount();
  evidence.actorSearch = { ok: true, value: { inSearch: false, inTypeahead: true } };
  const checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'actorSearch'), 'fail');
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'fail');
});

test('left out of search is expected for an account that asks not to be shown logged out', () => {
  const evidence = cleanAccount();
  evidence.profile = {
    state: 'found',
    handle: 'alice.example.com',
    displayName: null,
    avatar: null,
    labels: [{ val: NO_UNAUTHENTICATED, src: DID }],
  };
  evidence.actorSearch = { ok: true, value: { inSearch: false, inTypeahead: true } };
  const checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'actorSearch'), 'info');
  // The self-label is not moderation, so the profile still passes.
  assert.equal(status(checks, 'profile'), 'pass');
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'pass');
});

test('found by neither search nor typeahead is worth a look, not a sign', () => {
  const evidence = cleanAccount();
  evidence.actorSearch = { ok: true, value: { inSearch: false, inTypeahead: false } };
  const checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'actorSearch'), 'warn');
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'warn');
});

test('an AppView without search skips the search checks', () => {
  const evidence = cleanAccount();
  evidence.appview = APPVIEWS[1];
  evidence.actorSearch = { ok: false, message: 'HTTP 502' };
  evidence.postSearch = { ok: false, message: 'HTTP 502' };
  const checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'actorSearch'), 'skip');
  assert.equal(status(checks, 'postSearch'), 'skip');
  assert.equal(shadowbanVerdict(evidence, checks).title, 'No shadowban found on Blacksky');
});

test('post search counts only posts the AppView returns that are old enough to be searchable', () => {
  const evidence = cleanAccount();
  assert.ok(evidence.posts?.ok);
  const young = post(SEARCH_GRACE_MS / 2, undefined, 7);
  evidence.posts = { ok: true, value: [young, ...evidence.posts.value] };
  evidence.shown = { ok: true, value: evidence.posts.value.map((p) => p.uri) };
  const [, a, b, c] = evidence.posts.value;

  evidence.postSearch = { ok: true, value: [a.uri, b.uri, c.uri] };
  assert.equal(status(buildChecks(evidence, NOW), 'postSearch'), 'pass');

  evidence.postSearch = { ok: true, value: [a.uri] };
  assert.equal(status(buildChecks(evidence, NOW), 'postSearch'), 'warn');

  evidence.postSearch = { ok: true, value: [] };
  assert.equal(status(buildChecks(evidence, NOW), 'postSearch'), 'fail');
});

test('labels from moderation are a warning: moderation in the open', () => {
  const evidence = cleanAccount();
  evidence.profile = {
    state: 'found',
    handle: 'alice.example.com',
    displayName: null,
    avatar: null,
    labels: [{ val: 'spam', src: OTHER }],
  };
  const checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'profile'), 'warn');
  assert.match(checks[1].summary, /spam/);
});

test('a suspension and an unknown account are named in the verdict', () => {
  const evidence = cleanAccount();
  evidence.profile = { state: 'suspended', message: 'Account has been suspended' };
  assert.equal(shadowbanVerdict(evidence, buildChecks(evidence, NOW)).title, 'Suspended on Bluesky');
  evidence.profile = { state: 'missing', message: 'Profile not found' };
  assert.equal(shadowbanVerdict(evidence, buildChecks(evidence, NOW)).title, 'Bluesky doesn’t show this account');
});

test('an AppView that does not answer is said so, not reported as hiding nothing', () => {
  const evidence = cleanAccount();
  evidence.profile = { state: 'error', message: 'the host is down' };
  evidence.shown = { ok: false, message: 'the host is down' };
  evidence.replies = undefined;
  evidence.actorSearch = { ok: false, message: 'the host is down' };
  evidence.postSearch = { ok: false, message: 'the host is down' };
  const verdict = shadowbanVerdict(evidence, buildChecks(evidence, NOW));
  assert.equal(verdict.tone, 'warn');
  assert.equal(verdict.title, 'Bluesky didn’t answer');
});

test('an account its PDS has switched off is not the AppView’s doing', () => {
  const evidence = cleanAccount();
  evidence.repo = { state: 'inactive', status: 'takendown' };
  evidence.profile = { state: 'suspended', message: 'Account has been suspended' };
  const verdict = shadowbanVerdict(evidence, buildChecks(evidence, NOW));
  assert.equal(verdict.tone, 'warn');
  assert.equal(verdict.title, 'The account isn’t active on its PDS');
  assert.match(verdict.text, /takendown/);
});

// --- a post -----------------------------------------------------------------

function cleanPost(reply?: { parent: string; root: string }): Evidence {
  const one = post(HOUR, reply);
  return {
    target: { kind: 'post', actor: DID, rkey: one.rkey },
    appview: DEFAULT_APPVIEW,
    identity: { did: DID, handle: 'alice.example.com', pds: 'https://pds.example.com' },
    repo: { state: 'active' },
    profile: { state: 'found', handle: 'alice.example.com', displayName: null, avatar: null, labels: [] },
    posts: { ok: true, value: [one] },
    shown: { ok: true, value: [one.uri] },
    replies: reply
      ? { ok: true, value: [{ uri: one.uri, parent: reply.parent, root: reply.root, thread: 'shown' }] }
      : undefined,
    done: true,
  };
}

test('a post that is not a reply is checked for itself alone', () => {
  const evidence = cleanPost();
  const checks = buildChecks(evidence, NOW);
  assert.deepEqual(
    checks.map((check) => [check.id, check.status]),
    [
      ['pds', 'pass'],
      ['profile', 'pass'],
      ['post', 'pass'],
      ['thread', 'skip'],
    ],
  );
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'pass');
});

test('a post the AppView will not return is hidden', () => {
  const evidence = cleanPost({ parent: otherPost(1), root: otherPost(1) });
  evidence.shown = { ok: true, value: [] };
  evidence.replies = undefined;
  const checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'post'), 'fail');
  assert.equal(status(checks, 'thread'), 'skip');
  assert.equal(shadowbanVerdict(evidence, checks).title, 'Hidden on Bluesky');
});

test('a reply left out of its thread is hidden, and one left out across a block is a warning', () => {
  const ref = { parent: otherPost(1), root: otherPost(1) };
  const evidence = cleanPost(ref);
  assert.ok(evidence.replies?.ok);
  const [reply] = evidence.replies.value;

  evidence.replies = { ok: true, value: [{ ...reply, thread: 'absent', gate: { restricted: false, hidden: false }, block: { found: false } }] };
  let checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'thread'), 'fail');
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'fail');

  evidence.replies = { ok: true, value: [{ ...reply, thread: 'absent', gate: { restricted: false, hidden: false }, block: { found: true } }] };
  checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'thread'), 'warn');
  assert.equal(shadowbanVerdict(evidence, checks).tone, 'warn');
});

test('a deleted post is not a hidden one', () => {
  const evidence = cleanPost();
  evidence.posts = { ok: true, value: [] };
  evidence.shown = undefined;
  const checks = buildChecks(evidence, NOW);
  assert.equal(status(checks, 'post'), 'skip');
  const verdict = shadowbanVerdict(evidence, checks);
  assert.equal(verdict.tone, 'warn');
  assert.equal(verdict.title, 'This post was deleted');
});
