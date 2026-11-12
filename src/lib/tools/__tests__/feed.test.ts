import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeedChecks,
  feedUri,
  feedVerdict,
  needsViewer,
  parseFeedInput,
  reasonLabel,
  type FeedEvidence,
  type FeedProbe,
} from '@/lib/tools/feed';

const DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';
const SERVICE = 'did:web:feeds.example.com';
const ENDPOINT = 'https://feeds.example.com';
const FEED = feedUri(DID, 'whats-hot');

/** A feed where every step answers, to knock one part out of at a time. */
function probe(overrides: Partial<FeedProbe> = {}): FeedProbe {
  return {
    feed: FEED,
    record: {
      status: 'found',
      cid: 'bafyreifeed',
      value: { $type: 'app.bsky.feed.generator', did: SERVICE, displayName: 'Discover', createdAt: '2023-05-19T23:19:19.592Z' },
    },
    service: {
      did: SERVICE,
      status: 'resolved',
      services: [{ id: '#bsky_fg', type: 'BskyFeedGenerator', serviceEndpoint: ENDPOINT }],
      endpoint: ENDPOINT,
    },
    describe: {
      url: `${ENDPOINT}/xrpc/app.bsky.feed.describeFeedGenerator`,
      status: 'answered',
      httpStatus: 200,
      did: SERVICE,
      feedCount: 3,
      listsFeed: true,
    },
    skeleton: {
      url: `${ENDPOINT}/xrpc/app.bsky.feed.getFeedSkeleton?feed=x&limit=25`,
      status: 'answered',
      httpStatus: 200,
      items: [{ post: 'at://did:plc:a/app.bsky.feed.post/1' }, { post: 'at://did:plc:b/app.bsky.feed.post/2' }],
      cursor: 'next',
    },
    ...overrides,
  };
}

function evidence(overrides: Partial<FeedEvidence> = {}): FeedEvidence {
  return {
    authority: 'bsky.app',
    rkey: 'whats-hot',
    did: DID,
    probe: probe(),
    appview: { displayName: 'Discover', likeCount: 39616, isOnline: true, isValid: true },
    ...overrides,
  };
}

const statuses = (e: FeedEvidence) => buildFeedChecks(e).map((check) => [check.id, check.status]);
const statusOf = (e: FeedEvidence, id: string) => buildFeedChecks(e).find((check) => check.id === id)?.status;
const verdictOf = (e: FeedEvidence) => feedVerdict(e, buildFeedChecks(e), 'Discover');

test('parseFeedInput reads feed links and at:// URIs', () => {
  assert.deepEqual(parseFeedInput('https://bsky.app/profile/bsky.app/feed/whats-hot'), {
    ok: true,
    authority: 'bsky.app',
    rkey: 'whats-hot',
  });
  assert.deepEqual(parseFeedInput(`bsky.app/profile/${DID}/feed/whats-hot?x=1`), { ok: true, authority: DID, rkey: 'whats-hot' });
  assert.deepEqual(parseFeedInput(` ${FEED} `), { ok: true, authority: DID, rkey: 'whats-hot' });
  assert.deepEqual(parseFeedInput('at://Bsky.App/app.bsky.feed.generator/whats-hot'), {
    ok: true,
    authority: 'bsky.app',
    rkey: 'whats-hot',
  });
  // The same path on another client's host.
  assert.deepEqual(parseFeedInput('https://deer.social/profile/bsky.app/feed/whats-hot'), {
    ok: true,
    authority: 'bsky.app',
    rkey: 'whats-hot',
  });
  // This site's own record links spell the collection out.
  assert.deepEqual(parseFeedInput(`https://aturi.to/explore/${DID}/app.bsky.feed.generator/whats-hot`), {
    ok: true,
    authority: DID,
    rkey: 'whats-hot',
  });
});

test('parseFeedInput says why something is not a feed', () => {
  const reason = (raw: string) => {
    const parsed = parseFeedInput(raw);
    return parsed.ok ? '' : parsed.reason;
  };
  assert.match(reason(''), /Enter a feed/);
  assert.match(reason(`at://${DID}/app.bsky.feed.post/3abc`), /app\.bsky\.feed\.post record/);
  assert.match(reason(`at://${DID}/app.bsky.feed.generator`), /three parts/);
  assert.match(reason('https://bsky.app/profile/bsky.app/post/3abc'), /post inspector/);
  assert.match(reason('https://bsky.app/profile/bsky.app/lists/3abc'), /list, not a feed/);
  assert.match(reason('https://example.com/'), /does not point at a feed/);
  assert.match(reason('at://not a handle/app.bsky.feed.generator/x'), /not a handle or a DID/);
});

test('a feed where every step answers passes', () => {
  const e = evidence();
  assert.deepEqual(statuses(e), [
    ['record', 'pass'],
    ['service', 'pass'],
    ['describe', 'pass'],
    ['skeleton', 'pass'],
    ['appview', 'pass'],
  ]);
  const verdict = verdictOf(e);
  assert.equal(verdict.tone, 'pass');
  assert.match(verdict.text, /returned 2 posts and a cursor.*feeds\.example\.com/);
});

test('a missing record fails and skips the rest', () => {
  const e = evidence({ probe: { feed: FEED, record: { status: 'missing' } } });
  assert.deepEqual(statuses(e), [
    ['record', 'fail'],
    ['service', 'skip'],
    ['describe', 'skip'],
    ['skeleton', 'skip'],
    ['appview', 'pass'],
  ]);
  assert.match(verdictOf(e).title, /no readable feed record/);
});

test('a record without a did, or missing required fields, is caught', () => {
  const noDid = evidence({ probe: { feed: FEED, record: { status: 'found', cid: 'x', value: { displayName: 'A' } } } });
  assert.equal(statusOf(noDid, 'record'), 'fail');
  const thin = probe();
  thin.record = { status: 'found', cid: 'x', value: { $type: 'app.bsky.feed.generator', did: SERVICE } };
  assert.equal(statusOf(evidence({ probe: thin }), 'record'), 'warn');
});

test('a service with no #bsky_fg entry fails, with what to add', () => {
  const e = evidence({
    probe: probe({
      service: { did: SERVICE, status: 'resolved', services: [{ id: '#atproto_pds', type: 'X', serviceEndpoint: ENDPOINT }], endpoint: null },
      describe: undefined,
      skeleton: undefined,
    }),
  });
  const check = buildFeedChecks(e).find((c) => c.id === 'service');
  assert.equal(check?.status, 'fail');
  assert.match(check?.fix?.[0] ?? '', /#bsky_fg.*BskyFeedGenerator/);
  assert.equal(statusOf(e, 'skeleton'), 'skip');
  assert.match(verdictOf(e).title, /service that cannot be found/);

  const wrongType = probe();
  wrongType.service = { did: SERVICE, status: 'resolved', services: [{ id: '#bsky_fg', type: 'Other', serviceEndpoint: ENDPOINT }], endpoint: ENDPOINT };
  assert.equal(statusOf(evidence({ probe: wrongType }), 'service'), 'warn');

  const unresolved = probe({ service: { did: SERVICE, status: 'error', services: [], endpoint: null, error: 'the host has no DNS record' } });
  assert.equal(statusOf(evidence({ probe: unresolved }), 'service'), 'fail');
});

test('a generator that does not implement describeFeedGenerator is a note, not a failure', () => {
  const quiet = probe();
  quiet.describe = { url: 'u', status: 'answered', httpStatus: 404 };
  const e = evidence({ probe: quiet });
  assert.equal(statusOf(e, 'describe'), 'info');
  assert.equal(verdictOf(e).tone, 'pass');

  const unlisted = probe();
  unlisted.describe = { url: 'u', status: 'answered', httpStatus: 200, did: SERVICE, feedCount: 10, listsFeed: false };
  assert.equal(statusOf(evidence({ probe: unlisted }), 'describe'), 'warn');

  const otherDid = probe();
  otherDid.describe = { url: 'u', status: 'answered', httpStatus: 200, did: 'did:web:other.example', feedCount: 1, listsFeed: true };
  assert.equal(statusOf(evidence({ probe: otherDid }), 'describe'), 'warn');
});

test('a personalised feed is reported as needing a viewer, not as broken', () => {
  const personal = probe();
  personal.skeleton = { url: 'u', status: 'answered', httpStatus: 401, xrpcError: 'AuthRequiredError', message: 'log in' };
  const e = evidence({ probe: personal });
  assert.equal(statusOf(e, 'skeleton'), 'info');
  const verdict = verdictOf(e);
  assert.equal(verdict.tone, 'info');
  assert.match(verdict.title, /signed-in viewer/);
  assert.equal(needsViewer(personal.skeleton), true);
  assert.equal(needsViewer({ httpStatus: 400, xrpcError: 'UnknownFeed' }), false);
  assert.equal(needsViewer(undefined), false);
});

test('a generator that fails to return a skeleton fails the feed', () => {
  const unknown = probe();
  unknown.skeleton = { url: 'u', status: 'answered', httpStatus: 400, xrpcError: 'UnknownFeed' };
  const check = buildFeedChecks(evidence({ probe: unknown })).find((c) => c.id === 'skeleton');
  assert.equal(check?.status, 'fail');
  assert.match(check?.summary ?? '', /does not know this feed/);

  const down = probe();
  down.skeleton = { url: 'u', status: 'error', error: 'the host did not answer in time' };
  assert.equal(statusOf(evidence({ probe: down }), 'skeleton'), 'fail');
  assert.match(verdictOf(evidence({ probe: down })).title, /not answering/);

  const garbage = probe();
  garbage.skeleton = { url: 'u', status: 'answered', httpStatus: 200, unreadable: true };
  assert.equal(statusOf(evidence({ probe: garbage }), 'skeleton'), 'fail');

  const empty = probe();
  empty.skeleton = { url: 'u', status: 'answered', httpStatus: 200, items: [] };
  assert.equal(statusOf(evidence({ probe: empty }), 'skeleton'), 'warn');
});

test('the AppView not knowing the feed, or calling it offline, is a warning', () => {
  assert.equal(statusOf(evidence({ appview: { error: 'could not find feed' } }), 'appview'), 'warn');
  assert.equal(statusOf(evidence({ appview: null }), 'appview'), 'warn');
  const offline = evidence({ appview: { isOnline: false, isValid: true, likeCount: 1 } });
  const check = buildFeedChecks(offline).find((c) => c.id === 'appview');
  assert.equal(check?.status, 'warn');
  assert.match(check?.summary ?? '', /offline\. It has 1 like\./);
  assert.equal(verdictOf(offline).tone, 'warn');
});

test('steps not yet observed are pending, and a handle that does not resolve stops everything', () => {
  const waiting: FeedEvidence = { authority: 'bsky.app', rkey: 'whats-hot' };
  assert.ok(buildFeedChecks(waiting).every((check) => check.status === 'pending'));
  assert.equal(feedVerdict(waiting, buildFeedChecks(waiting), 'x').tone, 'pending');

  // The AppView can answer before the generator does.
  const half: FeedEvidence = { authority: 'bsky.app', rkey: 'whats-hot', did: DID, appview: { isOnline: true, isValid: true } };
  assert.equal(statusOf(half, 'appview'), 'pass');
  assert.equal(statusOf(half, 'record'), 'pending');

  const lost: FeedEvidence = { authority: 'nobody.example', rkey: 'x', did: null };
  assert.deepEqual(statuses(lost).map(([, s]) => s), ['fail', 'skip', 'skip', 'skip', 'skip']);

  const noService: FeedEvidence = { authority: 'bsky.app', rkey: 'x', did: DID, probe: null, probeError: 'The lookup service did not answer.' };
  assert.equal(statusOf(noService, 'record'), 'fail');
  assert.equal(statusOf(noService, 'appview'), 'pending');
});

test('reasonLabel names a skeleton reason', () => {
  assert.equal(reasonLabel('app.bsky.feed.defs#skeletonReasonRepost'), 'Repost');
  assert.equal(reasonLabel('app.bsky.feed.defs#skeletonReasonPin'), 'Pin');
  assert.equal(reasonLabel('com.example#other'), 'Other');
});
