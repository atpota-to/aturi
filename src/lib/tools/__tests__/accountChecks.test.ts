import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TID } from '@atproto/common-web';
import {
  labelSourceWords,
  labelSummary,
  profileAbsence,
  visibilityApplies,
  visibilitySummary,
} from '@/lib/tools/accountChecks';
import { BLUESKY_MODERATION_DID, type Label } from '@/lib/tools/labels';
import { DEFAULT_APPVIEW, type Evidence, type RepoPost } from '@/lib/tools/shadowban';

const DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const THIRD = 'did:plc:cccccccccccccccccccccccc';
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);
const HOUR = 60 * 60_000;

function label(src: string, val: string, extra: Partial<Label> = {}): Label {
  return { src, uri: DID, val, cts: '2026-01-01T00:00:00.000Z', ...extra };
}

function post(ageMs: number, reply?: { parent: string; root: string }): RepoPost {
  const rkey = TID.fromTime((NOW - ageMs) * 1000, 0).toString();
  return { uri: `at://${DID}/app.bsky.feed.post/${rkey}`, rkey, text: 'hello', writtenAt: NOW - ageMs, reply: reply ?? null };
}

const PARENT = `at://${OTHER}/app.bsky.feed.post/${TID.fromTime((NOW - 10 * HOUR) * 1000, 0).toString()}`;

/** Everything shown: the shadowban checker's clean account. */
function clean(): Evidence {
  const posts = [post(2 * HOUR), post(3 * HOUR, { parent: PARENT, root: PARENT }), post(5 * HOUR)];
  return {
    target: { kind: 'account', actor: DID },
    appview: DEFAULT_APPVIEW,
    checkedAt: NOW,
    identity: { did: DID, handle: 'alice.example.com', pds: 'https://pds.example.com' },
    repo: { state: 'active' },
    profile: { state: 'found', handle: 'alice.example.com', displayName: 'Alice', avatar: null, labels: [] },
    posts: { ok: true, value: posts },
    shown: { ok: true, value: posts.map((p) => p.uri) },
    replies: { ok: true, value: [{ uri: posts[1].uri, parent: PARENT, root: PARENT, thread: 'shown' }] },
    actorSearch: { ok: true, value: { inSearch: true, inTypeahead: true } },
    postSearch: { ok: true, value: posts.map((p) => p.uri) },
    done: true,
  };
}

// --- no Bluesky profile ------------------------------------------------------

test('profileAbsence reads the AppView’s words for an unknown, suspended or deactivated account', () => {
  assert.equal(profileAbsence('Profile not found'), 'missing');
  assert.equal(profileAbsence('Account has been suspended'), 'suspended');
  assert.equal(profileAbsence('Account is deactivated'), 'deactivated');
  assert.equal(profileAbsence('something else entirely'), 'missing');
});

test('the visibility check runs for a suspended account, not for one Bluesky never had', () => {
  assert.equal(visibilityApplies(null), true);
  assert.equal(visibilityApplies('suspended'), true);
  assert.equal(visibilityApplies('missing'), false);
  assert.equal(visibilityApplies('deactivated'), false);
});

// --- labels -----------------------------------------------------------------

test('labelSummary counts labels in force and the accounts behind them', () => {
  const summary = labelSummary(
    [label(OTHER, 'cornerstone'), label(OTHER, 'teambsky'), label(THIRD, 'bluesky-elder')],
    DID,
    NOW,
  );
  assert.equal(summary.active, 3);
  assert.equal(summary.sources, 2);
  assert.equal(summary.selfLabelled, false);
  assert.deepEqual(summary.moderation, []);
  assert.equal(labelSourceWords(summary), 'from 2 labelers');
});

test('labelSummary leaves out withdrawn and expired labels', () => {
  const summary = labelSummary(
    [
      label(OTHER, 'spam', { neg: true }),
      label(THIRD, 'old', { exp: '2026-01-02T00:00:00.000Z' }),
      label(THIRD, 'current', { exp: '2027-01-01T00:00:00.000Z' }),
    ],
    DID,
    NOW,
  );
  assert.equal(summary.active, 1);
  assert.equal(summary.sources, 1);
  assert.equal(labelSourceWords(summary), 'from 1 labeler');
});

test('labels from Bluesky’s moderation service are picked out, newest first', () => {
  const summary = labelSummary(
    [
      label(BLUESKY_MODERATION_DID, '!warn', { cts: '2026-03-01T00:00:00.000Z' }),
      label(BLUESKY_MODERATION_DID, 'spam', { cts: '2026-05-01T00:00:00.000Z' }),
      label(OTHER, 'cornerstone'),
    ],
    DID,
    NOW,
  );
  assert.deepEqual(summary.moderation, ['spam', '!warn']);
});

test('self-labels change the wording: sources, or set by the account', () => {
  const both = labelSummary([label(DID, '!no-unauthenticated'), label(OTHER, 'cornerstone')], DID, NOW);
  assert.equal(labelSourceWords(both), 'from 2 sources');
  const self = labelSummary([label(DID, '!no-unauthenticated')], DID, NOW);
  assert.equal(labelSourceWords(self), 'set by the account');
  assert.equal(labelSourceWords(labelSummary([], DID, NOW)), '');
});

// --- visibility -------------------------------------------------------------

test('a clean account is "Nothing hidden", with six passing or grey dots', () => {
  const summary = visibilitySummary(clean(), NOW);
  assert.equal(summary.tone, 'pass');
  assert.equal(summary.short, 'Nothing hidden');
  assert.equal(summary.dots.length, 6);
  assert.equal(summary.done, 6);
  assert.ok(summary.dots.every((dot) => dot.state === 'pass' || dot.state === 'skip'));
});

test('while checks run, the dots say which are back and the words count them', () => {
  const { shown, replies, actorSearch, postSearch, done, ...rest } = clean();
  void shown;
  void replies;
  void actorSearch;
  void postSearch;
  void done;
  const summary = visibilitySummary(rest, NOW);
  assert.equal(summary.tone, 'pending');
  assert.equal(summary.dots[0].state, 'pass');
  assert.equal(summary.dots[1].state, 'pass');
  assert.equal(summary.dots[2].state, 'run');
  assert.equal(summary.short, `${summary.done} of 6 checks`);

  const fresh = visibilitySummary({ target: rest.target, appview: rest.appview }, NOW);
  assert.equal(fresh.done, 0);
  assert.equal(fresh.short, 'Reading the PDS');
});

test('left out of search but found by typeahead is a failure the card names', () => {
  const evidence = clean();
  evidence.actorSearch = { ok: true, value: { inSearch: false, inTypeahead: true } };
  const summary = visibilitySummary(evidence, NOW);
  assert.equal(summary.tone, 'fail');
  assert.equal(summary.short, 'Left out of search');
  assert.equal(summary.dots.find((dot) => dot.id === 'actorSearch')?.state, 'fail');
});

test('more than one failure keeps the first and counts the rest', () => {
  const evidence = clean();
  evidence.actorSearch = { ok: true, value: { inSearch: false, inTypeahead: true } };
  evidence.shown = { ok: true, value: [] };
  const summary = visibilitySummary(evidence, NOW);
  assert.equal(summary.tone, 'fail');
  assert.equal(summary.short, 'Posts missing');
  assert.ok(summary.more >= 1);
});

test('a suspension, a deactivation and a profile Bluesky never had each get their own words', () => {
  const suspended = clean();
  suspended.profile = { state: 'suspended', message: 'Account has been suspended' };
  assert.deepEqual(
    [visibilitySummary(suspended, NOW).tone, visibilitySummary(suspended, NOW).short],
    ['fail', 'Suspended'],
  );
  const deactivated = clean();
  deactivated.profile = { state: 'deactivated', message: 'Account is deactivated' };
  assert.equal(visibilitySummary(deactivated, NOW).short, 'Deactivated');
  assert.equal(visibilitySummary(deactivated, NOW).tone, 'info');
  const missing = clean();
  missing.profile = { state: 'missing', message: 'Profile not found' };
  assert.equal(visibilitySummary(missing, NOW).short, 'No profile on Bluesky');
});

test('moderation labels on the profile are a warning, named as Bluesky’s', () => {
  const evidence = clean();
  evidence.profile = {
    state: 'found',
    handle: 'alice.example.com',
    displayName: 'Alice',
    avatar: null,
    labels: [{ val: '!warn', src: BLUESKY_MODERATION_DID }],
  };
  const summary = visibilitySummary(evidence, NOW);
  assert.equal(summary.tone, 'warn');
  assert.equal(summary.short, 'Labelled by Bluesky');
});

test('an account its PDS has switched off is not the AppView’s doing', () => {
  const evidence = clean();
  evidence.repo = { state: 'inactive', status: 'takendown' };
  const summary = visibilitySummary(evidence, NOW);
  assert.equal(summary.tone, 'warn');
  assert.equal(summary.short, 'Not active on its PDS');
});
